import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import type { PlannerDatabase } from "../db/database";
import {
  hmiDevices,
  hmiProposals,
  planFinals,
  users,
  type HmiProposalState,
} from "../db/schema";
import { isFinalId } from "../finals/finalRepository";
import { isHmiId } from "./hmiRepository";

/**
 * Planvorschläge (ADR 0013). Server-only.
 *
 * A signed-in user proposes one current Fertigstand to one HMI; the HMI
 * shows it to its operator, who accepts or rejects it there. Proposing never
 * changes what runs on an HMI — only the operator's confirmation does.
 *
 * An HMI has at most one open (`pending`) proposal: a new one supersedes it.
 * A pending proposal closes by itself after {@link HMI_PROPOSAL_TTL_MS}
 * (`expired`) or when its Fertigstand is withdrawn — replaced by a newer mark
 * or "Nicht mehr fertig" — (`superseded`). Those two are derived on read
 * ({@link effectiveProposalState}) and persisted by the next write, so reads
 * never write. Caller mistakes come back as result unions; database failures
 * throw.
 */

/** A proposal nobody answered closes after 24 h. */
export const HMI_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
/** How many proposals `listHmiProposals` returns at most. */
export const HMI_PROPOSAL_LIST_LIMIT = 20;

export type HmiProposal = {
  id: string;
  hmiId: string;
  finalId: string;
  /** Display name and checksum of the proposed Fertigstand. */
  finalName: string;
  finalSha256: string;
  /** Proposing user's id and name; `null` when that account was deleted. */
  proposedBy: string | null;
  proposedByName: string | null;
  createdAt: Date;
  /** Effective state at the time of reading. */
  state: HmiProposalState;
  /** `null` while pending. */
  resolvedAt: Date | null;
};

export type HmiProposalResult = "accepted" | "rejected";

/** Proposal ids are UUIDs, checked before reaching a `uuid` column. */
export const isHmiProposalId = isFinalId;

type ProposalNotFound = { ok: false; kind: "not-found" };
/** The proposal is no longer pending (answered, superseded, expired, cancelled). */
type ProposalClosed = { ok: false; kind: "closed"; proposal: HmiProposal };

export type CreateHmiProposalResult =
  | { ok: true; proposal: HmiProposal; supersededId: string | null }
  | { ok: false; kind: "hmi-not-found" }
  | { ok: false; kind: "hmi-revoked" }
  | { ok: false; kind: "final-not-found" };

export type CloseHmiProposalResult =
  | { ok: true; proposal: HmiProposal }
  | ProposalNotFound
  | ProposalClosed;

type ProposalRow = {
  id: string;
  hmiId: string;
  finalId: string;
  finalName: string;
  finalSha256: string;
  finalWithdrawnAt: Date | null;
  proposedBy: string | null;
  proposedByName: string | null;
  createdAt: Date;
  state: HmiProposalState;
  resolvedAt: Date | null;
};

/**
 * The state a stored proposal has at `now`: a pending one is `expired` once
 * its 24 h are over and `superseded` once its Fertigstand was withdrawn
 * (whichever happened first), with the matching resolution time.
 */
export function effectiveProposalState(
  row: Pick<ProposalRow, "state" | "resolvedAt" | "createdAt"> & {
    finalWithdrawnAt: Date | null;
  },
  now: Date,
): { state: HmiProposalState; resolvedAt: Date | null } {
  if (row.state !== "pending") {
    return { state: row.state, resolvedAt: row.resolvedAt };
  }
  const expiresAt = new Date(row.createdAt.getTime() + HMI_PROPOSAL_TTL_MS);
  const withdrawnAt = row.finalWithdrawnAt;
  // A withdrawal that is visible counts even if its time is after `now`
  // (taken before the read): it already happened.
  if (withdrawnAt !== null) {
    return withdrawnAt < expiresAt
      ? { state: "superseded", resolvedAt: withdrawnAt }
      : { state: "expired", resolvedAt: expiresAt };
  }
  if (expiresAt <= now) return { state: "expired", resolvedAt: expiresAt };
  return { state: "pending", resolvedAt: null };
}

function toProposal(row: ProposalRow, now: Date): HmiProposal {
  const effective = effectiveProposalState(row, now);
  return {
    id: row.id,
    hmiId: row.hmiId,
    finalId: row.finalId,
    finalName: row.finalName,
    finalSha256: row.finalSha256,
    proposedBy: row.proposedBy,
    proposedByName: row.proposedByName,
    createdAt: row.createdAt,
    state: effective.state,
    resolvedAt: effective.resolvedAt,
  };
}

type PlannerExecutor =
  | PlannerDatabase
  | Parameters<Parameters<PlannerDatabase["transaction"]>[0]>[0];

function selectProposals(db: PlannerExecutor) {
  return db
    .select({
      id: hmiProposals.id,
      hmiId: hmiProposals.hmiId,
      finalId: hmiProposals.finalId,
      finalName: planFinals.name,
      finalSha256: planFinals.sha256,
      finalWithdrawnAt: planFinals.withdrawnAt,
      proposedBy: hmiProposals.proposedBy,
      proposedByName: users.username,
      createdAt: hmiProposals.createdAt,
      state: hmiProposals.state,
      resolvedAt: hmiProposals.resolvedAt,
    })
    .from(hmiProposals)
    .innerJoin(planFinals, eq(hmiProposals.finalId, planFinals.id))
    .leftJoin(users, eq(hmiProposals.proposedBy, users.id));
}

async function findProposal(
  db: PlannerExecutor,
  hmiId: string,
  proposalId: string,
): Promise<ProposalRow | null> {
  if (!isHmiId(hmiId) || !isHmiProposalId(proposalId)) return null;
  const [row] = await selectProposals(db)
    .where(and(eq(hmiProposals.id, proposalId), eq(hmiProposals.hmiId, hmiId)))
    .limit(1);
  return row ?? null;
}

/**
 * Stores the derived closing of a stale pending row. Conditional on
 * `pending`, so it never overwrites an answer that won a race.
 */
async function persistClosing(
  db: PlannerExecutor,
  proposal: HmiProposal,
): Promise<void> {
  if (proposal.state === "pending") return;
  await db
    .update(hmiProposals)
    .set({ state: proposal.state, resolvedAt: proposal.resolvedAt })
    .where(
      and(eq(hmiProposals.id, proposal.id), eq(hmiProposals.state, "pending")),
    );
}

/**
 * Moves a pending proposal to `next` unless it already closed. Returns the
 * stored outcome: `closed` when it was answered, superseded, expired or
 * cancelled first (persisting a derived closing on the way).
 */
async function closeProposal(
  db: PlannerDatabase,
  hmiId: string,
  proposalId: string,
  next: "accepted" | "rejected" | "cancelled",
  now: Date,
): Promise<CloseHmiProposalResult> {
  return db.transaction(async (tx): Promise<CloseHmiProposalResult> => {
    const found = await findProposal(tx, hmiId, proposalId);
    if (!found) return { ok: false, kind: "not-found" };
    // Hold the Fertigstand so it cannot be withdrawn between the check and
    // the answer; then re-read the proposal with the locked state.
    await tx
      .select({ id: planFinals.id })
      .from(planFinals)
      .where(eq(planFinals.id, found.finalId))
      .for("share");
    const current = toProposal(
      (await findProposal(tx, hmiId, proposalId))!,
      now,
    );
    // The HMI repeating its own answer (e.g. after a lost 204) succeeds again.
    if (current.state === next && next !== "cancelled") {
      return { ok: true, proposal: current };
    }
    if (current.state !== "pending") {
      await persistClosing(tx, current);
      return { ok: false, kind: "closed", proposal: current };
    }
    const updated = await tx
      .update(hmiProposals)
      .set({ state: next, resolvedAt: now })
      .where(
        and(eq(hmiProposals.id, proposalId), eq(hmiProposals.state, "pending")),
      )
      .returning({ id: hmiProposals.id });
    const proposal = toProposal(
      (await findProposal(tx, hmiId, proposalId))!,
      now,
    );
    // A concurrent identical answer (retry racing the first request) won.
    return updated.length > 0 ||
      (proposal.state === next && next !== "cancelled")
      ? { ok: true, proposal }
      : { ok: false, kind: "closed", proposal };
  });
}

/**
 * Proposes a current Fertigstand to an HMI. The HMI row is locked for the
 * transaction, so concurrent proposals to the same HMI are serialized: each
 * supersedes the one before it, and the partial unique index never fires.
 * The Fertigstand is read `FOR SHARE`, so it cannot be withdrawn in between.
 */
export async function createHmiProposal(
  db: PlannerDatabase,
  input: { hmiId: string; finalId: string; userId: string },
  now: Date,
): Promise<CreateHmiProposalResult> {
  if (!isHmiId(input.hmiId)) return { ok: false, kind: "hmi-not-found" };
  if (!isFinalId(input.finalId)) return { ok: false, kind: "final-not-found" };

  return db.transaction(async (tx): Promise<CreateHmiProposalResult> => {
    const [hmi] = await tx
      .select({ revokedAt: hmiDevices.revokedAt })
      .from(hmiDevices)
      .where(eq(hmiDevices.id, input.hmiId))
      .for("update")
      .limit(1);
    if (!hmi) return { ok: false, kind: "hmi-not-found" };
    if (hmi.revokedAt !== null) return { ok: false, kind: "hmi-revoked" };

    const [final] = await tx
      .select({ id: planFinals.id })
      .from(planFinals)
      .where(
        and(eq(planFinals.id, input.finalId), isNull(planFinals.withdrawnAt)),
      )
      .for("share")
      .limit(1);
    if (!final) return { ok: false, kind: "final-not-found" };

    let supersededId: string | null = null;
    const [open] = await selectProposals(tx)
      .where(
        and(
          eq(hmiProposals.hmiId, input.hmiId),
          eq(hmiProposals.state, "pending"),
        ),
      )
      .limit(1);
    if (open) {
      const effective = toProposal(open, now);
      if (effective.state === "pending") {
        // Conditional: an answer or cancel that committed first stays.
        const superseded = await tx
          .update(hmiProposals)
          .set({ state: "superseded", resolvedAt: now })
          .where(
            and(
              eq(hmiProposals.id, open.id),
              eq(hmiProposals.state, "pending"),
            ),
          )
          .returning({ id: hmiProposals.id });
        supersededId = superseded[0]?.id ?? null;
      } else {
        await persistClosing(tx, effective);
      }
    }

    const id = randomUUID();
    await tx.insert(hmiProposals).values({
      id,
      hmiId: input.hmiId,
      finalId: input.finalId,
      proposedBy: input.userId,
      createdAt: now,
      state: "pending",
    });
    const created = await findProposal(tx, input.hmiId, id);
    return { ok: true, proposal: toProposal(created!, now), supersededId };
  });
}

/** The HMI's open proposal at `now`, or `null`. */
export async function getOpenHmiProposal(
  db: PlannerDatabase,
  hmiId: string,
  now: Date,
): Promise<HmiProposal | null> {
  if (!isHmiId(hmiId)) return null;
  const [row] = await selectProposals(db)
    .where(
      and(eq(hmiProposals.hmiId, hmiId), eq(hmiProposals.state, "pending")),
    )
    .limit(1);
  if (!row) return null;
  const proposal = toProposal(row, now);
  return proposal.state === "pending" ? proposal : null;
}

/** One proposal of an HMI with its state at `now`, or `null`. */
export async function getHmiProposal(
  db: PlannerDatabase,
  hmiId: string,
  proposalId: string,
  now: Date,
): Promise<HmiProposal | null> {
  const row = await findProposal(db, hmiId, proposalId);
  return row ? toProposal(row, now) : null;
}

/** The HMI's latest proposals, newest first, with their state at `now`. */
export async function listHmiProposals(
  db: PlannerDatabase,
  hmiId: string,
  now: Date,
  limit = HMI_PROPOSAL_LIST_LIMIT,
): Promise<HmiProposal[]> {
  if (!isHmiId(hmiId)) return [];
  const rows = await selectProposals(db)
    .where(eq(hmiProposals.hmiId, hmiId))
    .orderBy(desc(hmiProposals.createdAt), desc(hmiProposals.id))
    .limit(limit);
  return rows.map((row) => toProposal(row, now));
}

/**
 * The operator's answer, reported by the HMI the proposal was sent to.
 * Repeating the stored answer succeeds again (idempotent retry); a different
 * answer or another closing is `closed`.
 */
export function answerHmiProposal(
  db: PlannerDatabase,
  hmiId: string,
  proposalId: string,
  result: HmiProposalResult,
  now: Date,
): Promise<CloseHmiProposalResult> {
  return closeProposal(db, hmiId, proposalId, result, now);
}

/** Takes back a pending proposal from the planner side. */
export function cancelHmiProposal(
  db: PlannerDatabase,
  hmiId: string,
  proposalId: string,
  now: Date,
): Promise<CloseHmiProposalResult> {
  return closeProposal(db, hmiId, proposalId, "cancelled", now);
}
