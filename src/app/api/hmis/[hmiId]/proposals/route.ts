import { z } from "zod";

import { getHmi } from "~/server/hmi/hmiRepository";
import {
  createHmiProposal,
  listHmiProposals,
} from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore, readJsonBody } from "../../../auth/responses";
import { hmiNotFound } from "../../../admin/hmis/hmiAdminApi";
import { requireFinalManager } from "../../../finals/finalApi";
import { requireSignedIn, toApiHmiProposal } from "../../hmisApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/hmis/:hmiId/proposals` — the HMI's latest Planvorschläge (at
 * most 20), newest first: `{ proposals: [...] }`. 401 without a session,
 * 404 `hmi_not_found`; 404 in local storage mode.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ hmiId: string }> },
): Promise<Response> {
  const auth = await requireSignedIn(request);
  if ("response" in auth) return auth.response;
  const { hmiId } = await context.params;
  const hmi = await getHmi(auth.db, hmiId);
  if (!hmi) return hmiNotFound();
  const proposals = await listHmiProposals(auth.db, hmi.id, new Date());
  return jsonNoStore({ proposals: proposals.map(toApiHmiProposal) });
}

const proposeSchema = z.object({ finalId: z.string() });

/**
 * `POST /api/hmis/:hmiId/proposals` — `{ finalId }`, JSON only. Proposes a
 * current Fertigstand to the HMI: `201 { proposal, supersededId }`; the
 * HMI's open proposal, if any, is superseded. Nothing changes on the HMI
 * until its operator accepts there. 401 without a session, 403 when the user
 * may not propose, 404 `hmi_not_found`, 404 `final_not_found` (unknown or
 * withdrawn), 409 `hmi_revoked`; 404 in local storage mode.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ hmiId: string }> },
): Promise<Response> {
  const auth = await requireFinalManager(request);
  if ("response" in auth) return auth.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = proposeSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);
  const { hmiId } = await context.params;
  const result = await createHmiProposal(
    auth.db,
    { hmiId, finalId: parsed.data.finalId, userId: auth.user.id },
    new Date(),
  );
  if (!result.ok) {
    switch (result.kind) {
      case "hmi-not-found":
        return hmiNotFound();
      case "hmi-revoked":
        return jsonNoStore({ error: "hmi_revoked" }, 409);
      case "final-not-found":
        return jsonNoStore({ error: "final_not_found" }, 404);
    }
  }
  return jsonNoStore(
    {
      proposal: toApiHmiProposal(result.proposal),
      supersededId: result.supersededId,
    },
    201,
  );
}
