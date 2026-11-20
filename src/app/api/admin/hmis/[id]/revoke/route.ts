import { revokeHmi } from "~/server/hmi/hmiRepository";

import { jsonNoStore, readJsonBody } from "../../../../auth/responses";
import { requireAdmin } from "../../../requireAdmin";
import { hmiNotFound, toAdminHmi } from "../../hmiAdminApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/hmis/:id/revoke` → 200 `{ hmi }`: the HMI's token gets
 * 401 from now on, until a new one is generated. Idempotent. 404
 * `hmi_not_found`. The body is ignored but must be JSON (e.g. `{}`): like
 * every cookie-authenticated write, a cross-site form cannot send it.
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
  const result = await revokeHmi(guard.db, id, new Date());
  if (!result.ok) return hmiNotFound();
  return jsonNoStore({ hmi: toAdminHmi(result.hmi) });
}
