import {
  cancelHmiProposal,
  getHmiProposal,
} from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore } from "../../../../auth/responses";
import { requireFinalManager } from "../../../../finals/finalApi";
import {
  proposalNotFound,
  requireSignedIn,
  toApiHmiProposal,
} from "../../../hmisApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ hmiId: string; id: string }> };

/**
 * `GET /api/hmis/:hmiId/proposals/:id` — one Planvorschlag with its current
 * state: `{ proposal }`. 401 without a session, 404 `proposal_not_found`
 * (also for another HMI's proposal); 404 in local storage mode.
 */
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await requireSignedIn(request);
  if ("response" in auth) return auth.response;
  const { hmiId, id } = await context.params;
  const proposal = await getHmiProposal(auth.db, hmiId, id, new Date());
  if (!proposal) return proposalNotFound();
  return jsonNoStore({ proposal: toApiHmiProposal(proposal) });
}

/**
 * `DELETE /api/hmis/:hmiId/proposals/:id` — takes back a pending
 * Planvorschlag (state `cancelled`): 204. 401 without a session, 403 when the
 * user may not act on proposals, 404 `proposal_not_found`, 409
 * `proposal_closed` with its `state` when it was already answered,
 * superseded or expired. No body, so a cross-site `DELETE` needs a CORS
 * preflight. 404 in local storage mode.
 */
export async function DELETE(
  request: Request,
  context: Context,
): Promise<Response> {
  const auth = await requireFinalManager(request);
  if ("response" in auth) return auth.response;
  const { hmiId, id } = await context.params;
  const result = await cancelHmiProposal(auth.db, hmiId, id, new Date());
  if (!result.ok) {
    return result.kind === "not-found"
      ? proposalNotFound()
      : jsonNoStore(
          { error: "proposal_closed", state: result.proposal.state },
          409,
        );
  }
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
