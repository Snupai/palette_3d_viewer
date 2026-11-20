import { renameHmi } from "~/server/hmi/hmiRepository";

import { jsonNoStore, readJsonBody } from "../../../auth/responses";
import { requireAdmin } from "../../requireAdmin";
import { hmiNotFound, invalidHmiName, toAdminHmi } from "../hmiAdminApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `PATCH /api/admin/hmis/:id` — `{ name }` → 200 `{ hmi }`; 400 `invalid_name`, 404 `hmi_not_found`. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const { id } = await context.params;
  const name =
    typeof json.body === "object" && json.body !== null
      ? (json.body as { name?: unknown }).name
      : undefined;
  const result = await renameHmi(guard.db, id, name);
  if (!result.ok) {
    return result.kind === "not-found" ? hmiNotFound() : invalidHmiName();
  }
  return jsonNoStore({ hmi: toAdminHmi(result.hmi) });
}
