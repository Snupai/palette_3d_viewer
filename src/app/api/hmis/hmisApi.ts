import type { NextResponse } from "next/server";

import { getSessionUser, type SessionUser } from "~/server/auth/sessionUser";
import type { PlannerDatabase } from "~/server/db/database";
import { getServerDatabase } from "~/server/db/serverDatabase";
import type { HmiProposal } from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore, serverStorageDisabled } from "../auth/responses";

/**
 * Shared pieces of the planner-facing HMI API (`/api/hmis`, ADR 0013): the
 * QR page reads an HMI and sends Planvorschläge. Session users, never device
 * tokens. Writes additionally pass `requireFinalManager`.
 */

/**
 * Guard for reads: 404 in local storage mode, 401 without a session. HMI
 * names and what runs where are not public, unlike projects (ADR 0003).
 */
export async function requireSignedIn(
  request: Request,
): Promise<
  { db: PlannerDatabase; user: SessionUser } | { response: NextResponse }
> {
  const db = getServerDatabase();
  if (!db) return { response: serverStorageDisabled() };
  const user = await getSessionUser(request, db);
  if (!user) {
    return { response: jsonNoStore({ error: "unauthenticated" }, 401) };
  }
  return { db, user };
}

export type ApiHmiProposal = {
  id: string;
  hmiId: string;
  finalId: string;
  finalName: string;
  finalSha256: string;
  /** Proposing user's name; `null` once that account is deleted. */
  proposedBy: string | null;
  createdAt: string;
  state: HmiProposal["state"];
  resolvedAt: string | null;
};

export function toApiHmiProposal(proposal: HmiProposal): ApiHmiProposal {
  return {
    id: proposal.id,
    hmiId: proposal.hmiId,
    finalId: proposal.finalId,
    finalName: proposal.finalName,
    finalSha256: proposal.finalSha256,
    proposedBy: proposal.proposedByName,
    createdAt: proposal.createdAt.toISOString(),
    state: proposal.state,
    resolvedAt: proposal.resolvedAt?.toISOString() ?? null,
  };
}

export function proposalNotFound(): NextResponse {
  return jsonNoStore({ error: "proposal_not_found" }, 404);
}
