import { getHmi } from "~/server/hmi/hmiRepository";
import { listHmiProposals } from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore } from "../../auth/responses";
import { hmiNotFound, toAdminHmi } from "../../admin/hmis/hmiAdminApi";
import { requireSignedIn, toApiHmiProposal } from "../hmisApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/hmis/:hmiId` — one HMI for the QR page (ADR 0013): `{ hmi: { id,
 * name, createdAt, revokedAt, lastSeenAt, appVersion, activeFinal },
 * proposal }` where `proposal` is the HMI's latest Planvorschlag in any
 * state (or `null`), so the page can follow it to accepted or rejected.
 * 401 without a session, 404 `hmi_not_found`; 404 in local storage mode.
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
  const [latest] = await listHmiProposals(auth.db, hmi.id, new Date(), 1);
  return jsonNoStore({
    hmi: toAdminHmi(hmi),
    proposal: latest ? toApiHmiProposal(latest) : null,
  });
}
