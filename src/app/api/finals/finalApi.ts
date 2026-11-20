import type { NextResponse } from "next/server";

import { getSessionUser, type SessionUser } from "~/server/auth/sessionUser";
import type { PlannerDatabase } from "~/server/db/database";
import { getServerDatabase } from "~/server/db/serverDatabase";
import { mayManageFinals } from "~/server/finals/finalPermission";
import {
  MAX_FINAL_ROB_BYTES,
  type FinalConflict,
  type FinalInvalid,
  type FinalSummary,
} from "~/server/finals/finalRepository";

import { jsonNoStore, serverStorageDisabled } from "../auth/responses";

/**
 * Shared pieces of the planner-facing Fertigstand API (ADR 0013).
 * Server-only. The HMI-facing API (`/api/hmi/v1`) is separate and uses
 * device tokens instead of sessions.
 */

/** A mark body carries the `.rob` plus a few short fields. */
export const MAX_MARK_BODY_BYTES = MAX_FINAL_ROB_BYTES * 2 + 16 * 1024;

export type ApiFinal = {
  id: string;
  recordId: string;
  recordVersion: number;
  name: string;
  fileName: string;
  sha256: string;
  markedAt: string;
};

export function toApiFinal(final: FinalSummary): ApiFinal {
  return {
    id: final.id,
    recordId: final.recordId,
    recordVersion: final.recordVersion,
    name: final.name,
    fileName: final.fileName,
    sha256: final.sha256,
    markedAt: final.markedAt.toISOString(),
  };
}

/**
 * Guard for writes: 404 in local storage mode, 401 without a session, 403
 * when {@link mayManageFinals} refuses the user.
 */
export async function requireFinalManager(
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
  if (!mayManageFinals(user)) {
    return { response: jsonNoStore({ error: "forbidden" }, 403) };
  }
  return { db, user };
}

/** Maps a repository rejection to its HTTP response. */
export function finalRejectionResponse(
  result: FinalInvalid | FinalConflict,
): NextResponse {
  if (result.kind === "conflict") {
    return jsonNoStore(
      { error: "version_conflict", currentVersion: result.actualVersion },
      409,
    );
  }
  if (result.reason === "rob-too-large") {
    return jsonNoStore({ error: "rob_too_large" }, 413);
  }
  if (result.reason === "rob-invalid") {
    return jsonNoStore({ error: "rob_invalid", message: result.message }, 422);
  }
  return jsonNoStore({ error: "invalid_request", reason: result.reason }, 400);
}
