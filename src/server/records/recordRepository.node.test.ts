// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "../db/database";
import { plannerRecords, users } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import {
  deleteRecord,
  getRecord,
  listRecords,
  MAX_RECORD_BYTES,
  MAX_RECORD_ID_LENGTH,
  putRecord,
  validateRecord,
} from "./recordRepository";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-02T00:00:00.000Z");
const T2 = new Date("2026-01-03T00:00:00.000Z");

let database: OpenDatabase;
const alice = "user-alice";
const bob = "user-bob";

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.delete(plannerRecords);
  await database.db.delete(users);
  // Direct rows: the repository only needs valid `users.id` references.
  await database.db.insert(users).values(
    [alice, bob].map((id) => ({
      id,
      username: id,
      passwordHash: "unused",
      role: "user" as const,
      createdAt: T0,
    })),
  );
});

function insert(id: string, body: Record<string, unknown> = {}) {
  return putRecord(
    database.db,
    {
      store: "projects",
      record: { id, ...body },
      expectedVersion: null,
      userId: alice,
    },
    T0,
  );
}

describe("putRecord", () => {
  it("inserts with version 1 and created_by set", async () => {
    const result = await insert("project-1", { name: "A" });
    expect(result).toEqual({
      ok: true,
      record: {
        store: "projects",
        id: "project-1",
        record: { id: "project-1", name: "A" },
        version: 1,
        createdBy: alice,
        createdAt: T0,
        updatedAt: T0,
      },
    });
  });

  it("updates at the expected version, bumps it and keeps created_by", async () => {
    await insert("project-1", { name: "A" });
    const result = await putRecord(
      database.db,
      {
        store: "projects",
        record: { id: "project-1", name: "B" },
        expectedVersion: 1,
        userId: bob,
      },
      T1,
    );
    expect(result).toEqual({
      ok: true,
      record: {
        store: "projects",
        id: "project-1",
        record: { id: "project-1", name: "B" },
        version: 2,
        createdBy: alice,
        createdAt: T0,
        updatedAt: T1,
      },
    });
  });

  it("reports a conflict instead of overwriting a newer version", async () => {
    await insert("project-1", { name: "A" });
    const write = (name: string, now: Date) =>
      putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1", name },
          expectedVersion: 1,
          userId: bob,
        },
        now,
      );
    expect((await write("B", T1)).ok).toBe(true);
    expect(await write("C", T2)).toEqual({
      ok: false,
      kind: "conflict",
      store: "projects",
      id: "project-1",
      expectedVersion: 1,
      actualVersion: 2,
    });
    const stored = await getRecord(database.db, "projects", "project-1");
    expect(stored.ok && stored.record?.record).toEqual({
      id: "project-1",
      name: "B",
    });
  });

  it("lets exactly one of two concurrent writers at the same version win", async () => {
    await insert("project-1");
    const results = await Promise.all(
      ["B", "C"].map((name) =>
        putRecord(
          database.db,
          {
            store: "projects",
            record: { id: "project-1", name },
            expectedVersion: 1,
            userId: bob,
          },
          T1,
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        kind: "conflict",
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
        actualVersion: 2,
      },
    ]);
  });

  it("reports a conflict when inserting an existing id", async () => {
    await insert("project-1", { name: "A" });
    expect(await insert("project-1", { name: "B" })).toEqual({
      ok: false,
      kind: "conflict",
      store: "projects",
      id: "project-1",
      expectedVersion: null,
      actualVersion: 1,
    });
  });

  it("reports a conflict when updating a missing record", async () => {
    expect(
      await putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "missing" },
          expectedVersion: 3,
          userId: alice,
        },
        T1,
      ),
    ).toEqual({
      ok: false,
      kind: "conflict",
      store: "projects",
      id: "missing",
      expectedVersion: 3,
      actualVersion: null,
    });
  });

  it("keeps the same id in different stores apart", async () => {
    await insert("shared-id", { kind: "project" });
    const pallet = await putRecord(
      database.db,
      {
        store: "pallets",
        record: { id: "shared-id", kind: "pallet" },
        expectedVersion: null,
        userId: null,
      },
      T0,
    );
    expect(pallet.ok && pallet.record.createdBy).toBeNull();
    expect(pallet.ok && pallet.record.version).toBe(1);
  });

  it.each([
    [{ store: "record-versions" }, "unknown-store"],
    [{ record: [] }, "not-object"],
    [{ record: "text" }, "not-object"],
    [{ record: new Date(0) }, "not-object"],
    [{ record: { name: "no id" } }, "invalid-id"],
    [{ record: { id: "" } }, "invalid-id"],
    [{ record: { id: 7 } }, "invalid-id"],
    [{ record: { id: "a\nb" } }, "invalid-id"],
    [{ record: { id: "x".repeat(MAX_RECORD_ID_LENGTH + 1) } }, "invalid-id"],
    [{ expectedVersion: 0 }, "invalid-version"],
    [{ expectedVersion: 1.5 }, "invalid-version"],
  ] as const)("rejects %o as %s", async (override, reason) => {
    const result = await putRecord(
      database.db,
      {
        store: "projects",
        record: { id: "project-1" },
        expectedVersion: null,
        userId: alice,
        ...override,
      },
      T0,
    );
    expect(result).toMatchObject({ ok: false, kind: "invalid", reason });
    const listed = await listRecords(database.db, "projects");
    expect(listed.ok && listed.records).toEqual([]);
  });
});

describe("validateRecord", () => {
  it("accepts a record of exactly the size limit and rejects one byte more", () => {
    const overhead = JSON.stringify({ id: "r", pad: "" }).length;
    const exact = { id: "r", pad: "x".repeat(MAX_RECORD_BYTES - overhead) };
    expect(validateRecord(exact)).toMatchObject({
      ok: true,
      value: { bytes: MAX_RECORD_BYTES },
    });
    expect(validateRecord({ ...exact, pad: `${exact.pad}x` })).toMatchObject({
      ok: false,
      reason: "too-large",
    });
  });

  it("counts UTF-8 bytes, not characters", () => {
    const overhead = JSON.stringify({ id: "r", pad: "" }).length;
    const chars = Math.floor((MAX_RECORD_BYTES - overhead) / 2) + 1;
    expect(validateRecord({ id: "r", pad: "ä".repeat(chars) })).toMatchObject({
      ok: false,
      reason: "too-large",
    });
  });

  it("rejects values PostgreSQL jsonb cannot store", () => {
    expect(validateRecord({ id: "r", text: "a\u0000b" })).toMatchObject({
      ok: false,
      reason: "not-json",
    });
    expect(validateRecord({ id: "r", list: ["\ud800"] })).toMatchObject({
      ok: false,
      reason: "not-json",
    });
    expect(validateRecord({ id: "r", nested: { "\udc00": 1 } })).toMatchObject({
      ok: false,
      reason: "not-json",
    });
    expect(validateRecord({ id: "r", n: 1n })).toMatchObject({
      ok: false,
      reason: "not-json",
    });
  });

  it("stores the JSON form of the input", () => {
    expect(
      validateRecord({ id: "r", when: new Date(T0), skip: undefined }),
    ).toMatchObject({
      ok: true,
      value: { json: { id: "r", when: "2026-01-01T00:00:00.000Z" } },
    });
  });

  it("round-trips emoji, backslashes and literal \\u0000 text", async () => {
    const body = { emoji: "📦", text: "C:\\u0000\\path" };
    const result = await insert("unicode", body);
    expect(result.ok && result.record.record).toEqual({
      id: "unicode",
      ...body,
    });
  });
});

describe("getRecord / listRecords", () => {
  it("returns null for a missing record", async () => {
    expect(await getRecord(database.db, "projects", "missing")).toEqual({
      ok: true,
      record: null,
    });
  });

  it("lists one store ordered by id", async () => {
    await insert("b");
    await insert("a");
    await putRecord(
      database.db,
      {
        store: "pallets",
        record: { id: "c" },
        expectedVersion: null,
        userId: alice,
      },
      T0,
    );
    const listed = await listRecords(database.db, "projects");
    expect(listed.ok && listed.records.map((record) => record.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("validates store and id", async () => {
    expect(await listRecords(database.db, "users")).toMatchObject({
      ok: false,
      reason: "unknown-store",
    });
    expect(await getRecord(database.db, "projects", "")).toMatchObject({
      ok: false,
      reason: "invalid-id",
    });
  });
});

describe("deleteRecord", () => {
  it("deletes at the expected version", async () => {
    await insert("project-1");
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
      }),
    ).toEqual({ ok: true });
    expect(await getRecord(database.db, "projects", "project-1")).toEqual({
      ok: true,
      record: null,
    });
  });

  it("hides tombstones, rejects stale writes and atomically recreates at a higher version", async () => {
    await insert("project-1", { name: "private payload" });
    await insert("visible");
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
      }),
    ).toEqual({ ok: true });
    expect(await getRecord(database.db, "projects", "project-1")).toEqual({
      ok: true,
      record: null,
    });
    const listed = await listRecords(database.db, "projects");
    expect(listed.ok && listed.records.map((row) => row.id)).toEqual([
      "visible",
    ]);
    const [tombstone] = await database.db
      .select()
      .from(plannerRecords)
      .where(eq(plannerRecords.id, "project-1"));
    expect(tombstone).toMatchObject({
      deleted: true,
      json: {},
      version: 1,
      createdBy: alice,
    });
    const staleWrite = () =>
      putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1", name: "stale" },
          expectedVersion: 1,
          userId: alice,
          onlyCreatedBy: alice,
        },
        T2,
      );
    expect(await staleWrite()).toMatchObject({
      kind: "conflict",
      actualVersion: null,
    });
    const results = await Promise.all(
      ["B", "C"].map((name) =>
        putRecord(
          database.db,
          {
            store: "projects",
            record: { id: "project-1", name },
            expectedVersion: null,
            userId: alice,
            onlyCreatedBy: alice,
          },
          T1,
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => result.ok)).toMatchObject({
      record: { version: 2, createdBy: alice, createdAt: T1, updatedAt: T1 },
    });
    expect(results.find((result) => !result.ok)).toMatchObject({
      kind: "conflict",
      actualVersion: 2,
    });
    expect(await staleWrite()).toMatchObject({
      kind: "conflict",
      actualVersion: 2,
    });
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
        onlyCreatedBy: alice,
      }),
    ).toMatchObject({ kind: "conflict", actualVersion: 2 });
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 2,
        onlyCreatedBy: alice,
      }),
    ).toEqual({ ok: true });
    const recreated = await insert("project-1");
    expect(recreated).toMatchObject({ ok: true, record: { version: 3 } });
  });

  it("reserves a tombstone for its former creator; only an unrestricted (admin) write revives it for someone else", async () => {
    await insert("project-1", { name: "alice's plan" });
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
        onlyCreatedBy: alice,
      }),
    ).toEqual({ ok: true });
    const revive = (userId: string, onlyCreatedBy?: string) =>
      putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1", name: `${userId}'s plan` },
          expectedVersion: null,
          userId,
          onlyCreatedBy,
        },
        T1,
      );
    expect(await revive(bob, bob)).toEqual({
      ok: false,
      kind: "forbidden",
      store: "projects",
      id: "project-1",
    });
    const [untouched] = await database.db
      .select()
      .from(plannerRecords)
      .where(eq(plannerRecords.id, "project-1"));
    expect(untouched).toMatchObject({
      deleted: true,
      json: {},
      version: 1,
      createdBy: alice,
    });
    expect(await revive(alice, alice)).toMatchObject({
      ok: true,
      record: { version: 2, createdBy: alice },
    });
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 2,
      }),
    ).toEqual({ ok: true });
    expect(await revive(bob)).toMatchObject({
      ok: true,
      record: { version: 3, createdBy: bob },
    });
  });

  it("reports a conflict for a stale or missing version and keeps the record", async () => {
    await insert("project-1");
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 2,
      }),
    ).toEqual({
      ok: false,
      kind: "conflict",
      store: "projects",
      id: "project-1",
      expectedVersion: 2,
      actualVersion: 1,
    });
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "missing",
        expectedVersion: 1,
      }),
    ).toMatchObject({ kind: "conflict", actualVersion: null });
    const stored = await getRecord(database.db, "projects", "project-1");
    expect(stored.ok && stored.record?.version).toBe(1);
  });

  it("rejects an invalid expected version", async () => {
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 0,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-version" });
  });
});

it("keeps records when their creator is deleted", async () => {
  await insert("project-1");
  await database.db.delete(users);
  const stored = await getRecord(database.db, "projects", "project-1");
  expect(stored.ok && stored.record?.createdBy).toBeNull();
});

describe("maxCreatedRecords", () => {
  const create = (id: string, userId = alice) =>
    putRecord(
      database.db,
      {
        store: "projects",
        record: { id },
        expectedVersion: null,
        userId,
        onlyCreatedBy: userId,
        maxCreatedRecords: 2,
      },
      T0,
    );

  it("rejects a creation past the user's live-record quota atomically", async () => {
    const first = await Promise.all(["a", "b", "c"].map((id) => create(id)));
    expect(first.map((result) => result.ok)).toEqual([true, true, false]);
    expect(first[2]).toEqual({
      ok: false,
      kind: "quota-exceeded",
      store: "projects",
      limit: 2,
    });
    // Other users and other stores have their own budget.
    expect((await create("d", bob)).ok).toBe(true);
    // Deleting frees a slot; reviving one's own tombstone counts again.
    await deleteRecord(database.db, {
      store: "projects",
      id: "a",
      expectedVersion: 1,
    });
    expect(await create("a")).toMatchObject({
      ok: true,
      record: { version: 2 },
    });
    expect(await create("e")).toMatchObject({ kind: "quota-exceeded" });
    const listed = await listRecords(database.db, "projects");
    expect(listed.ok && listed.records.map((row) => row.id)).toEqual([
      "a",
      "b",
      "d",
    ]);
  });
});

describe("onlyCreatedBy", () => {
  it("updates and deletes only the creator's records", async () => {
    await insert("project-1", { name: "A" });

    const update = (userId: string) =>
      putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1", name: userId },
          expectedVersion: 1,
          userId,
          onlyCreatedBy: userId,
        },
        T1,
      );
    expect(await update(bob)).toEqual({
      ok: false,
      kind: "forbidden",
      store: "projects",
      id: "project-1",
    });
    expect(await update(alice)).toMatchObject({
      ok: true,
      record: { version: 2, record: { name: alice }, createdBy: alice },
    });

    const remove = (userId: string, expectedVersion: number) =>
      deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion,
        onlyCreatedBy: userId,
      });
    expect(await remove(bob, 2)).toMatchObject({ kind: "forbidden" });
    expect(await remove(alice, 1)).toMatchObject({
      kind: "conflict",
      actualVersion: 2,
    });
    expect(await remove(alice, 2)).toEqual({ ok: true });
    expect(await remove(alice, 2)).toMatchObject({
      kind: "conflict",
      actualVersion: null,
    });
  });

  it("reports forbidden before a version conflict for someone else's record", async () => {
    await insert("project-1");
    expect(
      await putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1" },
          expectedVersion: 7,
          userId: bob,
          onlyCreatedBy: bob,
        },
        T1,
      ),
    ).toMatchObject({ kind: "forbidden" });
  });

  it("treats a record whose creator was deleted as nobody's", async () => {
    await insert("project-1");
    await database.db.delete(users).where(eq(users.id, alice));
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "project-1",
        expectedVersion: 1,
        onlyCreatedBy: alice,
      }),
    ).toMatchObject({ kind: "forbidden" });
  });

  it("lets an insert of an existing id conflict, not be forbidden", async () => {
    await insert("project-1");
    expect(
      await putRecord(
        database.db,
        {
          store: "projects",
          record: { id: "project-1" },
          expectedVersion: null,
          userId: bob,
          onlyCreatedBy: bob,
        },
        T1,
      ),
    ).toMatchObject({ kind: "conflict", actualVersion: 1 });
  });
});
