import { getOpenHmiProposal } from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore } from "../../../auth/responses";
import { requireHmi } from "../hmiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/hmi/v1/proposal` — the open Planvorschlag for the calling HMI
 * as `{ proposal: { id, finalId, name, sha256, proposedBy, createdAt } }`,
 * or `204` when there is none. `proposedBy` is the proposing user's name
 * (`null` once that account is deleted). Device token only; 404 in local
 * storage mode.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireHmi(request);
  if ("response" in auth) return auth.response;
  const proposal = await getOpenHmiProposal(auth.db, auth.hmi.id, new Date());
  if (!proposal) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  return jsonNoStore({
    proposal: {
      id: proposal.id,
      finalId: proposal.finalId,
      name: proposal.finalName,
      sha256: proposal.finalSha256,
      proposedBy: proposal.proposedByName,
      createdAt: proposal.createdAt.toISOString(),
    },
  });
}
