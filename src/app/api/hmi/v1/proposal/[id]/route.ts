import { z } from "zod";

import { answerHmiProposal } from "~/server/hmi/hmiProposalRepository";

import { jsonNoStore, readJsonBody } from "../../../../auth/responses";
import { requireHmi } from "../../hmiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const answerSchema = z.object({ result: z.enum(["accepted", "rejected"]) });

/**
 * `POST /api/hmi/v1/proposal/:id` — `{ result: "accepted" | "rejected" }`,
 * JSON. The operator's decision on a Planvorschlag sent to the calling HMI:
 * 204. 400 `invalid_request` for a malformed body, 404 `proposal_not_found`
 * when the id is unknown or belongs to another HMI, 409 `proposal_closed`
 * when it was already answered, superseded, expired or cancelled. Recording
 * the answer changes nothing else; the HMI reports its running plan via
 * `/api/hmi/v1/status`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireHmi(request);
  if ("response" in auth) return auth.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = answerSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);
  const { id } = await context.params;
  const result = await answerHmiProposal(
    auth.db,
    auth.hmi.id,
    id,
    parsed.data.result,
    new Date(),
  );
  if (!result.ok) {
    return result.kind === "not-found"
      ? jsonNoStore({ error: "proposal_not_found" }, 404)
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
