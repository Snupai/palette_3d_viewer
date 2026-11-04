import { describe, expect, it } from "vitest";
import {
  PLANNER_STORE_NAMES,
  PROJECTS_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import type { PlannerRecordStorage } from "~/lib/projectRepository";

/**
 * Creates a fresh, empty storage. Called once per test, so implementations
 * must not share records between calls (e.g. a new `IDBFactory` per call).
 */
export type PlannerRecordStorageFactory = () =>
  | PlannerRecordStorage
  | Promise<PlannerRecordStorage>;

export type PlannerRecordStorageContractOptions = {
  /** Name of the outer `describe` block. */
  label?: string;
};

type ContractRecord = { id: string; [key: string]: unknown };

function sortById(records: readonly unknown[]): ContractRecord[] {
  return [...(records as ContractRecord[])].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/**
 * Shared behaviour every {@link PlannerRecordStorage} implementation must
 * satisfy (IndexedDB, memory and — roadmap M9 — the server client).
 *
 * Record order from `list` is not part of the contract, so assertions sort by
 * id. Records are opaque to storage: whatever is put comes back structurally
 * equal, and neither the input nor returned values alias the stored copy.
 *
 * Call it inside a test file; extend it by adding further `describe` blocks
 * here so every implementation picks them up.
 */
export function describePlannerRecordStorageContract(
  factory: PlannerRecordStorageFactory,
  options: PlannerRecordStorageContractOptions = {},
): void {
  const create = async (): Promise<PlannerRecordStorage> => factory();

  describe(options.label ?? "PlannerRecordStorage contract", () => {
    describe.each(PLANNER_STORE_NAMES.map((storeName) => ({ storeName })))(
      "store $storeName",
      ({ storeName }: { storeName: PlannerStoreName }) => {
        it("starts empty", async () => {
          const storage = await create();

          expect(await storage.list(storeName)).toEqual([]);
        });

        it("returns undefined for a missing id", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "present", value: 1 });

          expect(await storage.get(storeName, "missing")).toBeUndefined();
        });

        it("round-trips a nested record through put, get and list", async () => {
          const storage = await create();
          const record = {
            id: "record-1",
            name: "Lage 1",
            count: 4,
            flags: [true, false],
            nested: { x: 1200, y: 800, empty: null },
          };

          await storage.put(storeName, record);

          expect(await storage.get(storeName, "record-1")).toEqual(record);
          expect(await storage.list(storeName)).toEqual([record]);
        });

        it("lists every record exactly once", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "b", value: 2 });
          await storage.put(storeName, { id: "a", value: 1 });
          await storage.put(storeName, { id: "c", value: 3 });

          expect(sortById(await storage.list(storeName))).toEqual([
            { id: "a", value: 1 },
            { id: "b", value: 2 },
            { id: "c", value: 3 },
          ]);
        });

        it("overwrites a record with the same id", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "same", value: 1, stale: true });
          await storage.put(storeName, { id: "same", value: 2 });

          expect(await storage.get(storeName, "same")).toEqual({
            id: "same",
            value: 2,
          });
          expect(await storage.list(storeName)).toEqual([
            { id: "same", value: 2 },
          ]);
        });

        it("deletes only the requested record", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "keep", value: 1 });
          await storage.put(storeName, { id: "drop", value: 2 });

          await storage.delete(storeName, "drop");

          expect(await storage.get(storeName, "drop")).toBeUndefined();
          expect(await storage.list(storeName)).toEqual([
            { id: "keep", value: 1 },
          ]);
        });

        it("treats deleting a missing or already deleted id as a no-op", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "keep", value: 1 });
          await storage.put(storeName, { id: "drop", value: 2 });

          await expect(
            storage.delete(storeName, "never-existed"),
          ).resolves.toBeUndefined();
          await storage.delete(storeName, "drop");
          await expect(
            storage.delete(storeName, "drop"),
          ).resolves.toBeUndefined();

          expect(await storage.list(storeName)).toEqual([
            { id: "keep", value: 1 },
          ]);
        });

        it("can store a record again after deleting it", async () => {
          const storage = await create();
          await storage.put(storeName, { id: "again", value: 1 });
          await storage.delete(storeName, "again");
          await storage.put(storeName, { id: "again", value: 2 });

          expect(await storage.list(storeName)).toEqual([
            { id: "again", value: 2 },
          ]);
        });

        it("rejects a record without an id and stores nothing", async () => {
          const storage = await create();

          await expect(
            storage.put(storeName, { value: 1 }),
          ).rejects.toBeInstanceOf(Error);
          expect(await storage.list(storeName)).toEqual([]);
        });

        it("does not alias the stored copy with put input or read results", async () => {
          const storage = await create();
          const input = { id: "copy", tags: ["a"], nested: { value: 1 } };
          await storage.put(storeName, input);

          input.tags.push("mutated-input");
          input.nested.value = 2;
          const read = (await storage.get(storeName, "copy")) as typeof input;
          read.tags.push("mutated-get");
          const [listed] = (await storage.list(storeName)) as (typeof input)[];
          listed!.nested.value = 3;

          expect(await storage.get(storeName, "copy")).toEqual({
            id: "copy",
            tags: ["a"],
            nested: { value: 1 },
          });
        });
      },
    );

    describe("store isolation", () => {
      it("keeps records with the same id in different stores apart", async () => {
        const storage = await create();
        for (const storeName of PLANNER_STORE_NAMES) {
          await storage.put(storeName, { id: "shared", store: storeName });
        }

        for (const storeName of PLANNER_STORE_NAMES) {
          expect(await storage.get(storeName, "shared")).toEqual({
            id: "shared",
            store: storeName,
          });
          expect(await storage.list(storeName)).toEqual([
            { id: "shared", store: storeName },
          ]);
        }
      });

      it("does not leak a put into other stores", async () => {
        const storage = await create();
        await storage.put(PROJECTS_STORE_NAME, { id: "only-here", value: 1 });

        for (const storeName of PLANNER_STORE_NAMES) {
          const expected =
            storeName === PROJECTS_STORE_NAME
              ? [{ id: "only-here", value: 1 }]
              : [];
          expect(await storage.list(storeName)).toEqual(expected);
        }
      });

      it("deletes from one store without touching the same id elsewhere", async () => {
        const storage = await create();
        await storage.put(PROJECTS_STORE_NAME, { id: "shared", value: 1 });
        await storage.put(PROJECT_RESOURCES_STORE_NAME, {
          id: "shared",
          value: 2,
        });

        await storage.delete(PROJECTS_STORE_NAME, "shared");

        expect(
          await storage.get(PROJECTS_STORE_NAME, "shared"),
        ).toBeUndefined();
        expect(
          await storage.get(PROJECT_RESOURCES_STORE_NAME, "shared"),
        ).toEqual({ id: "shared", value: 2 });
      });
    });

    describe("instance isolation", () => {
      it("gives every factory call an independent, empty storage", async () => {
        const first = await create();
        await first.put(PROJECTS_STORE_NAME, { id: "first-only", value: 1 });

        const second = await create();

        expect(await second.list(PROJECTS_STORE_NAME)).toEqual([]);
        expect(await first.list(PROJECTS_STORE_NAME)).toEqual([
          { id: "first-only", value: 1 },
        ]);
      });
    });
  });
}
