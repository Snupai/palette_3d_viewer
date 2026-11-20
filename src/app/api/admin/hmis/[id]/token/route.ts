import { regenerateHmiToken } from "~/server/hmi/hmiRepository";

import { jsonNoStore, readJsonBody } from "../../../../auth/responses";
import { requireAdmin } from "../../../requireAdmin";
import { hmiNotFound, toAdminHmi } from "../../hmiAdminApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/hmis/:id/token` → 200 `{ hmi, token }`: a new token, shown
 * only in this answer. The old token stops working at once and a revocation
 * is lifted. 404 `hmi_not_found`. The body is ignored but must be JSON
 * (e.g. `{}`): like every cookie-authenticated write, a cross-site form
 * cannot send it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const { id } = await context.params;
  const result = await regenerateHmiToken(guard.db, id);
  if (!result.ok) return hmiNotFound();
  return jsonNoStore({ hmi: toAdminHmi(result.hmi), token: result.token });
}
