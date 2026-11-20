// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "../db/database";
import { planFinals, plannerRecords, users } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import { deleteRecord, putRecord } from "../records/recordRepository";
import {
  getFinal,
  listCurrentFinals,
  markFinal,
  MAX_FINAL_ROB_BYTES,
  robSha256,
  validateMarkFinalInput,
  withdrawFinal,
  type MarkFinalInput,
} from "./finalRepository";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-02T00:00:00.000Z");
const T2 = new Date("2026-01-03T00:00:00.000Z");

/** A one-layer `.rob` with two grips; `CRLF_ROB` is the same with CRLF. */
const ROB_LINES = [
  "1200 800 144",
  "200 300 150",
  "1",
  "1",
  "0 0",
  "1 0",
  "2",
  "100 50 0 150 200 0 1 0 0",
  "100 50 0 450 200 0 1 0 0",
];
const LF_ROB = `${ROB_LINES.join("\n")}\n`;
const CRLF_ROB = `${ROB_LINES.join("\r\n")}\r\n`;
const LF_SHA256 =
  "3ce7a2ce3c1d8b0604463515fdc6d04912698b21debd86c595b272c959ccc804";
const CRLF_SHA256 =
  "2ba87cd84ffc7f6f302c26707adc128a889977bd5480f745ab58aab0a4e4db3e";

let database: OpenDatabase;
const alice = "user-alice";

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
  await database.db.delete(users);
  await database.db.insert(users).values({
    id: alice,
    username: alice,
    passwordHash: "unused",
    role: "user",
    createdAt: T0,
  });
});

async function project(id: string, edits = 0): Promise<number> {
  const created = await putRecord(
    database.db,
    {
      store: "projects",
      record: { id },
      expectedVersion: null,
      userId: alice,
    },
    T0,
  );
  if (!created.ok) throw new Error("create failed");
  let version = created.record.version;
  for (let edit = 0; edit < edits; edit += 1) {
    const saved = await putRecord(
      database.db,
      {
        store: "projects",
        record: { id, edit },
        expectedVersion: version,
        userId: alice,
      },
      T0,
    );
    if (!saved.ok) throw new Error("update failed");
    version = saved.record.version;
  }
  return version;
}

function input(overrides: Partial<MarkFinalInput> = {}): MarkFinalInput {
  return {
    recordId: "p1",
    recordVersion: 1,
    name: "SKU 9",
    fileName: "line-7.rob",
    robText: LF_ROB,
    userId: alice,
    ...overrides,
  };
}

describe("validateMarkFinalInput", () => {
  it("hashes the UTF-8 bytes of the text as lower-case hex", () => {
    expect(validateMarkFinalInput(input())).toEqual({
      ok: true,
      sha256: LF_SHA256,
    });
    expect(validateMarkFinalInput(input({ robText: CRLF_ROB }))).toEqual({
      ok: true,
      sha256: CRLF_SHA256,
    });
    expect(robSha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("refuses text that does not parse as .rob, with the parser's line", () => {
    expect(validateMarkFinalInput(input({ robText: "1200 800\n" }))).toEqual({
      ok: false,
      kind: "invalid",
      reason: "rob-invalid",
      message: "Unexpected .rob format: expected at least 6 lines",
    });
  });

  it("refuses text above the size limit and texts PostgreSQL would alter", () => {
    const tooLarge = LF_ROB + " ".repeat(MAX_FINAL_ROB_BYTES);
    expect(validateMarkFinalInput(input({ robText: tooLarge }))).toMatchObject({
      ok: false,
      reason: "rob-too-large",
    });
    expect(
      validateMarkFinalInput(input({ robText: `${LF_ROB}\u0000` })),
    ).toMatchObject({ ok: false, reason: "rob-invalid" });
  });

  it("refuses empty names, control characters and path separators", () => {
    expect(validateMarkFinalInput(input({ name: "  " }))).toMatchObject({
      reason: "invalid-name",
    });
    expect(validateMarkFinalInput(input({ name: "a\nb" }))).toMatchObject({
      reason: "invalid-name",
    });
    expect(
      validateMarkFinalInput(input({ fileName: "../x.rob" })),
    ).toMatchObject({ reason: "invalid-file-name" });
    expect(
      validateMarkFinalInput(input({ fileName: "a\\x.rob" })),
    ).toMatchObject({ reason: "invalid-file-name" });
    // Product and project number (200 each) joined by " · " still fit.
    expect(
      validateMarkFinalInput(
        input({ name: `${"a".repeat(200)} · ${"b".repeat(200)}` }),
      ),
    ).toMatchObject({ ok: true });
    expect(validateMarkFinalInput(input({ recordVersion: 0 }))).toMatchObject({
      reason: "invalid-version",
    });
    expect(validateMarkFinalInput(input({ recordId: "" }))).toMatchObject({
      reason: "invalid-record-id",
    });
  });
});

describe("markFinal", () => {
  it("stores the .rob byte for byte, CRLF line endings included", async () => {
    await project("p1");
    const marked = await markFinal(
      database.db,
      input({ robText: CRLF_ROB }),
      T1,
    );
    expect(marked).toMatchObject({
      ok: true,
      unchanged: false,
      replaced: null,
    });
    if (!marked.ok) return;
    expect(marked.final).toEqual({
      id: marked.final.id,
      recordId: "p1",
      recordVersion: 1,
      name: "SKU 9",
      fileName: "line-7.rob",
      sha256: CRLF_SHA256,
      markedBy: alice,
      markedAt: T1,
      withdrawnAt: null,
    });
    const stored = await getFinal(database.db, marked.final.id);
    expect(stored?.robText).toBe(CRLF_ROB);
    expect(Buffer.from(stored!.robText, "utf8")).toEqual(
      Buffer.from(CRLF_ROB, "utf8"),
    );
  });

  it("answers a stale project version with a conflict and stores nothing", async () => {
    await project("p1", 2);
    expect(
      await markFinal(database.db, input({ recordVersion: 2 }), T1),
    ).toEqual({
      ok: false,
      kind: "conflict",
      recordId: "p1",
      expectedVersion: 2,
      actualVersion: 3,
    });
    expect(await listCurrentFinals(database.db)).toEqual([]);
  });

  it("answers an unknown or deleted project with a conflict without version", async () => {
    expect(await markFinal(database.db, input(), T1)).toMatchObject({
      kind: "conflict",
      actualVersion: null,
    });
    await project("p1");
    await deleteRecord(database.db, {
      store: "projects",
      id: "p1",
      expectedVersion: 1,
    });
    expect(await markFinal(database.db, input(), T1)).toMatchObject({
      kind: "conflict",
      actualVersion: null,
    });
  });

  it("replaces the current Fertigstand and withdraws the old one", async () => {
    await project("p1", 1);
    const first = await markFinal(database.db, input({ recordVersion: 2 }), T1);
    if (!first.ok) throw new Error("mark failed");
    const second = await markFinal(
      database.db,
      input({ recordVersion: 2, robText: CRLF_ROB }),
      T2,
    );
    expect(second).toMatchObject({
      ok: true,
      unchanged: false,
      replaced: { id: first.final.id, withdrawnAt: T2 },
    });
    if (!second.ok) return;
    expect((await listCurrentFinals(database.db)).map(({ id }) => id)).toEqual([
      second.final.id,
    ]);
    // The replaced one stays readable for an HMI still running it.
    expect(await getFinal(database.db, first.final.id)).toMatchObject({
      withdrawnAt: T2,
      robText: LF_ROB,
    });
  });

  it("leaves an identical current Fertigstand untouched", async () => {
    await project("p1");
    const first = await markFinal(database.db, input(), T1);
    const again = await markFinal(database.db, input(), T2);
    if (!first.ok) throw new Error("mark failed");
    expect(again).toEqual({
      ok: true,
      final: first.final,
      replaced: null,
      unchanged: true,
    });
  });

  it("keeps at most one current Fertigstand per project", async () => {
    await project("p1");
    await project("p2");
    await markFinal(database.db, input(), T1);
    await markFinal(database.db, input({ name: "SKU 9b" }), T1);
    await markFinal(database.db, input({ recordId: "p2", name: "A" }), T1);
    expect(
      (await listCurrentFinals(database.db)).map(({ recordId, name }) => [
        recordId,
        name,
      ]),
    ).toEqual([
      ["p2", "A"],
      ["p1", "SKU 9b"],
    ]);
    const rows = await database.db
      .select({ id: planFinals.id })
      .from(planFinals)
      .where(eq(planFinals.recordId, "p1"));
    expect(rows).toHaveLength(2);
    // The database itself refuses a second current row.
    const [current] = await listCurrentFinals(database.db, { recordId: "p1" });
    await expect(
      database.db.insert(planFinals).values({
        id: "00000000-0000-4000-8000-000000000001",
        recordId: "p1",
        recordVersion: 1,
        name: "dup",
        fileName: "dup.rob",
        robText: LF_ROB,
        sha256: current!.sha256,
        markedAt: T2,
      }),
    ).rejects.toThrow();
  });
});

describe("withdrawFinal", () => {
  it("withdraws a current Fertigstand once; later calls find nothing", async () => {
    await project("p1");
    const marked = await markFinal(database.db, input(), T1);
    if (!marked.ok) throw new Error("mark failed");
    expect(await withdrawFinal(database.db, marked.final.id, T2)).toEqual({
      ok: true,
      final: { ...marked.final, withdrawnAt: T2 },
    });
    expect(await listCurrentFinals(database.db)).toEqual([]);
    expect(await withdrawFinal(database.db, marked.final.id, T2)).toEqual({
      ok: false,
      kind: "not-found",
      id: marked.final.id,
    });
    expect(await withdrawFinal(database.db, "not-a-uuid", T2)).toEqual({
      ok: false,
      kind: "not-found",
      id: "not-a-uuid",
    });
  });

  it("lets the project be marked again after a withdrawal", async () => {
    await project("p1");
    const marked = await markFinal(database.db, input(), T1);
    if (!marked.ok) throw new Error("mark failed");
    await withdrawFinal(database.db, marked.final.id, T2);
    expect(await markFinal(database.db, input(), T2)).toMatchObject({
      ok: true,
      unchanged: false,
      replaced: null,
    });
  });
});

describe("project deletion", () => {
  it("withdraws the project's Fertigstände instead of deleting them", async () => {
    await project("p1");
    await project("p2");
    const marked = await markFinal(database.db, input(), T1);
    const other = await markFinal(
      database.db,
      input({ recordId: "p2", name: "Other" }),
      T1,
    );
    if (!marked.ok || !other.ok) throw new Error("mark failed");
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "p1",
        expectedVersion: 1,
      }),
    ).toEqual({ ok: true });
    expect((await listCurrentFinals(database.db)).map(({ id }) => id)).toEqual([
      other.final.id,
    ]);
    const withdrawn = await getFinal(database.db, marked.final.id);
    expect(withdrawn?.robText).toBe(LF_ROB);
    expect(withdrawn?.withdrawnAt).toBeInstanceOf(Date);
  });

  it("withdraws nothing when the delete is rejected", async () => {
    await project("p1", 1);
    await markFinal(database.db, input({ recordVersion: 2 }), T1);
    expect(
      await deleteRecord(database.db, {
        store: "projects",
        id: "p1",
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, kind: "conflict" });
    expect(await listCurrentFinals(database.db)).toHaveLength(1);
  });
});
