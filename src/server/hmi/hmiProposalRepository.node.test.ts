// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "../db/database";
import {
  hmiDevices,
  hmiProposals,
  planFinals,
  plannerRecords,
  users,
} from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import { markFinal, withdrawFinal } from "../finals/finalRepository";
import {
  answerHmiProposal,
  cancelHmiProposal,
  createHmiProposal,
  effectiveProposalState,
  getHmiProposal,
  getOpenHmiProposal,
  HMI_PROPOSAL_TTL_MS,
  listHmiProposals,
} from "./hmiProposalRepository";
import { createHmi, revokeHmi } from "./hmiRepository";

const T0 = new Date("2026-11-20T08:00:00.000Z");
const T1 = new Date("2026-11-20T08:05:00.000Z");
const T2 = new Date("2026-11-20T08:10:00.000Z");
const ROB = ["1200 800 144", "200 300 150", "1", "1", "0 0", "1 0", "2"]
  .concat(["100 50 0 150 200 0 1 0 0", "100 50 0 450 200 0 1 0 0"])
  .join("\r\n");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let database: OpenDatabase;
let hmiId: string;
let otherHmiId: string;

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.delete(hmiProposals);
  await database.db.delete(hmiDevices);
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
  await database.db.delete(users);
  await database.db.insert(users).values({
    id: "alice",
    username: "alice",
    passwordHash: "x",
    role: "user",
    createdAt: T0,
  });
  for (const name of ["Linie 3", "Linie 4"]) {
    const created = await createHmi(database.db, name, T0);
    if (!created.ok) throw new Error("createHmi failed");
    if (name === "Linie 3") hmiId = created.hmi.id;
    else otherHmiId = created.hmi.id;
  }
});

async function finalOf(recordId: string, name: string, version = 1, now = T0) {
  await database.db
    .insert(plannerRecords)
    .values({
      store: "projects",
      id: recordId,
      version,
      json: { id: recordId },
    })
    .onConflictDoUpdate({
      target: [plannerRecords.store, plannerRecords.id],
      set: { version },
    });
  const marked = await markFinal(
    database.db,
    {
      recordId,
      recordVersion: version,
      name,
      fileName: `${recordId}.rob`,
      robText: `${ROB}\r\n${"\r\n".repeat(version - 1)}`,
      userId: "alice",
    },
    now,
  );
  if (!marked.ok) throw new Error("markFinal failed");
  return marked.final;
}

async function propose(finalId: string, now = T1, target = hmiId) {
  const result = await createHmiProposal(
    database.db,
    { hmiId: target, finalId, userId: "alice" },
    now,
  );
  if (!result.ok) throw new Error(`createHmiProposal failed: ${result.kind}`);
  return result;
}

describe("createHmiProposal", () => {
  it("stores a pending proposal with the Fertigstand and proposer", async () => {
    const final = await finalOf("project-1", "SKU 9 · P-12");
    const { proposal, supersededId } = await propose(final.id);
    expect(supersededId).toBeNull();
    expect(proposal).toEqual({
      id: proposal.id,
      hmiId,
      finalId: final.id,
      finalName: "SKU 9 · P-12",
      finalSha256: final.sha256,
      proposedBy: "alice",
      proposedByName: "alice",
      createdAt: T1,
      state: "pending",
      resolvedAt: null,
    });
    expect(await getOpenHmiProposal(database.db, hmiId, T1)).toEqual(proposal);
  });

  it("supersedes the open proposal of the same HMI only", async () => {
    const first = await finalOf("project-1", "A");
    const second = await finalOf("project-2", "B");
    const older = await propose(first.id, T1);
    const elsewhere = await propose(first.id, T1, otherHmiId);
    const newer = await propose(second.id, T2);

    expect(newer.supersededId).toBe(older.proposal.id);
    expect(
      (await getHmiProposal(database.db, hmiId, older.proposal.id, T2))!,
    ).toMatchObject({ state: "superseded", resolvedAt: T2 });
    expect((await getOpenHmiProposal(database.db, hmiId, T2))!.id).toBe(
      newer.proposal.id,
    );
    expect((await getOpenHmiProposal(database.db, otherHmiId, T2))!.id).toBe(
      elsewhere.proposal.id,
    );
    const pending = await database.db
      .select({ id: hmiProposals.id })
      .from(hmiProposals)
      .where(eq(hmiProposals.state, "pending"));
    expect(pending).toHaveLength(2);
  });

  it("serializes concurrent proposals to one HMI", async () => {
    const final = await finalOf("project-1", "A");
    const results = await Promise.all(
      [T1, T1, T1].map((now) =>
        createHmiProposal(
          database.db,
          { hmiId, finalId: final.id, userId: "alice" },
          now,
        ),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const states = (await listHmiProposals(database.db, hmiId, T1))
      .map((proposal) => proposal.state)
      .sort();
    expect(states).toEqual(["pending", "superseded", "superseded"]);
  });

  it("refuses unknown and revoked HMIs and withdrawn Fertigstände", async () => {
    const final = await finalOf("project-1", "A");
    const input = { hmiId, finalId: final.id, userId: "alice" };
    expect(
      await createHmiProposal(database.db, { ...input, hmiId: "nope" }, T1),
    ).toEqual({ ok: false, kind: "hmi-not-found" });
    expect(
      await createHmiProposal(database.db, { ...input, hmiId: UNKNOWN_ID }, T1),
    ).toEqual({ ok: false, kind: "hmi-not-found" });
    expect(
      await createHmiProposal(
        database.db,
        { ...input, finalId: UNKNOWN_ID },
        T1,
      ),
    ).toEqual({ ok: false, kind: "final-not-found" });

    await withdrawFinal(database.db, final.id, T1);
    expect(await createHmiProposal(database.db, input, T1)).toEqual({
      ok: false,
      kind: "final-not-found",
    });

    const current = await finalOf("project-2", "B");
    await revokeHmi(database.db, hmiId, T1);
    expect(
      await createHmiProposal(
        database.db,
        { ...input, finalId: current.id },
        T1,
      ),
    ).toEqual({ ok: false, kind: "hmi-revoked" });
  });
});

describe("closing", () => {
  it("records the operator's answer once", async () => {
    const final = await finalOf("project-1", "A");
    const { proposal } = await propose(final.id);
    const answered = await answerHmiProposal(
      database.db,
      hmiId,
      proposal.id,
      "accepted",
      T2,
    );
    expect(answered).toEqual({
      ok: true,
      proposal: { ...proposal, state: "accepted", resolvedAt: T2 },
    });
    expect(await getOpenHmiProposal(database.db, hmiId, T2)).toBeNull();
    expect(
      await answerHmiProposal(database.db, hmiId, proposal.id, "rejected", T2),
    ).toEqual({
      ok: false,
      kind: "closed",
      proposal: { ...proposal, state: "accepted", resolvedAt: T2 },
    });
  });

  it("does not let another HMI answer", async () => {
    const final = await finalOf("project-1", "A");
    const { proposal } = await propose(final.id);
    expect(
      await answerHmiProposal(
        database.db,
        otherHmiId,
        proposal.id,
        "accepted",
        T2,
      ),
    ).toEqual({ ok: false, kind: "not-found" });
    expect(
      await answerHmiProposal(database.db, hmiId, "nope", "accepted", T2),
    ).toEqual({ ok: false, kind: "not-found" });
  });

  it("lets the planner side cancel a pending proposal", async () => {
    const final = await finalOf("project-1", "A");
    const { proposal } = await propose(final.id);
    const cancelled = await cancelHmiProposal(
      database.db,
      hmiId,
      proposal.id,
      T2,
    );
    expect(cancelled).toMatchObject({
      ok: true,
      proposal: { state: "cancelled", resolvedAt: T2 },
    });
    expect(
      await answerHmiProposal(database.db, hmiId, proposal.id, "accepted", T2),
    ).toMatchObject({ ok: false, kind: "closed" });
  });
});

describe("derived closing", () => {
  it("expires a pending proposal after 24 h and persists that on answer", async () => {
    const final = await finalOf("project-1", "A");
    const { proposal } = await propose(final.id);
    const expiresAt = new Date(T1.getTime() + HMI_PROPOSAL_TTL_MS);
    const justBefore = new Date(expiresAt.getTime() - 1);

    expect((await getOpenHmiProposal(database.db, hmiId, justBefore))!.id).toBe(
      proposal.id,
    );
    expect(await getOpenHmiProposal(database.db, hmiId, expiresAt)).toBeNull();
    expect(
      await answerHmiProposal(
        database.db,
        hmiId,
        proposal.id,
        "accepted",
        expiresAt,
      ),
    ).toEqual({
      ok: false,
      kind: "closed",
      proposal: { ...proposal, state: "expired", resolvedAt: expiresAt },
    });
    const [row] = await database.db
      .select()
      .from(hmiProposals)
      .where(eq(hmiProposals.id, proposal.id));
    expect(row).toMatchObject({ state: "expired", resolvedAt: expiresAt });
  });

  it("supersedes a proposal whose Fertigstand was withdrawn or re-marked", async () => {
    const final = await finalOf("project-1", "A");
    const { proposal } = await propose(final.id);
    await finalOf("project-1", "A", 2, T2);
    expect(await getOpenHmiProposal(database.db, hmiId, T2)).toBeNull();
    expect(
      await getHmiProposal(database.db, hmiId, proposal.id, T2),
    ).toMatchObject({ state: "superseded", resolvedAt: T2 });

    // A new proposal closes the stale row instead of colliding with it.
    const next = await finalOf("project-2", "B");
    const created = await propose(next.id, T2);
    expect(created.supersededId).toBeNull();
    const states = await database.db
      .select({ state: hmiProposals.state })
      .from(hmiProposals)
      .where(eq(hmiProposals.id, proposal.id));
    expect(states).toEqual([{ state: "superseded" }]);
  });

  it("derives whichever closing came first", () => {
    const createdAt = T0;
    const expiresAt = new Date(T0.getTime() + HMI_PROPOSAL_TTL_MS);
    const later = new Date(expiresAt.getTime() + 1000);
    const pending = { state: "pending" as const, resolvedAt: null, createdAt };
    expect(
      effectiveProposalState({ ...pending, finalWithdrawnAt: later }, later),
    ).toEqual({ state: "expired", resolvedAt: expiresAt });
    expect(
      effectiveProposalState({ ...pending, finalWithdrawnAt: T1 }, later),
    ).toEqual({ state: "superseded", resolvedAt: T1 });
    expect(
      effectiveProposalState({ ...pending, finalWithdrawnAt: null }, T1),
    ).toEqual({ state: "pending", resolvedAt: null });
    expect(
      effectiveProposalState(
        { state: "accepted", resolvedAt: T1, createdAt, finalWithdrawnAt: T1 },
        later,
      ),
    ).toEqual({ state: "accepted", resolvedAt: T1 });
  });
});

describe("listHmiProposals", () => {
  it("lists the HMI's proposals newest first and keeps deleted proposers", async () => {
    const final = await finalOf("project-1", "A");
    const first = await propose(final.id, T1);
    const second = await propose(final.id, T2);
    await database.db.delete(users).where(eq(users.id, "alice"));
    const listed = await listHmiProposals(database.db, hmiId, T2);
    expect(listed.map((proposal) => [proposal.id, proposal.state])).toEqual([
      [second.proposal.id, "pending"],
      [first.proposal.id, "superseded"],
    ]);
    expect(listed[0]).toMatchObject({ proposedBy: null, proposedByName: null });
    expect(await listHmiProposals(database.db, otherHmiId, T2)).toEqual([]);
    expect(await listHmiProposals(database.db, hmiId, T2, 1)).toHaveLength(1);
  });
});
