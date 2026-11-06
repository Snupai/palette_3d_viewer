// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  PLANNER_DATABASE_NAME,
  PROJECTS_STORE_NAME,
} from "~/lib/plannerDatabase";
import { createBrowserLocalPlannerStorage } from "~/lib/plannerStorageFactory";
import { describePlannerRecordStorageContract } from "~/lib/plannerRecordStorageContract";
import {
  IndexedDbPlannerRecordStorage,
  MemoryPlannerRecordStorage,
} from "~/lib/projectRepository";

describePlannerRecordStorageContract(() => new MemoryPlannerRecordStorage(), {
  label: "MemoryPlannerRecordStorage",
});

// A new IDBFactory is a separate, empty in-memory IndexedDB per test.
describePlannerRecordStorageContract(
  () => new IndexedDbPlannerRecordStorage(new IDBFactory()),
  { label: "IndexedDbPlannerRecordStorage" },
);

describePlannerRecordStorageContract(
  () => createBrowserLocalPlannerStorage({ indexedDb: new IDBFactory() }),
  { label: "BrowserLocalPlannerStorage (named database)" },
);

describe("record versions of records written before versioning", () => {
  it("counts seeded memory records as version 1", async () => {
    const storage = new MemoryPlannerRecordStorage({
      [PROJECTS_STORE_NAME]: [{ id: "seeded", n: 1 }],
    });

    expect(await storage.getVersioned(PROJECTS_STORE_NAME, "seeded")).toEqual({
      record: { id: "seeded", n: 1 },
      version: 1,
    });
    expect(
      await storage.put(
        PROJECTS_STORE_NAME,
        { id: "seeded", n: 2 },
        { expectedVersion: 1 },
      ),
    ).toBe(2);
  });

  it("counts IndexedDB records from database version 4 as version 1", async () => {
    const indexedDb = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDb.open(PLANNER_DATABASE_NAME, 4);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore(PROJECTS_STORE_NAME, { keyPath: "id" })
          .put({ id: "legacy", n: 1 });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB open failed."));
    });
    const storage = new IndexedDbPlannerRecordStorage(indexedDb);

    expect(await storage.getVersioned(PROJECTS_STORE_NAME, "legacy")).toEqual({
      record: { id: "legacy", n: 1 },
      version: 1,
    });
    expect(
      await storage.put(
        PROJECTS_STORE_NAME,
        { id: "legacy", n: 2 },
        { expectedVersion: 1 },
      ),
    ).toBe(2);
    expect(await storage.list(PROJECTS_STORE_NAME)).toEqual([
      { id: "legacy", n: 2 },
    ]);
  });
});
