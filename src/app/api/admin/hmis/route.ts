import { createHmi, listHmis } from "~/server/hmi/hmiRepository";

import { jsonNoStore, readJsonBody } from "../../auth/responses";
import { requireAdmin } from "../requireAdmin";
import { invalidHmiName, toAdminHmi } from "./hmiAdminApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/admin/hmis` — every registered HMI, ordered by name. */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const hmis = await listHmis(guard.db);
  return jsonNoStore({ hmis: hmis.map(toAdminHmi) });
}

/**
 * `POST /api/admin/hmis` — `{ name }` → 201 `{ hmi, token }`. The token is
 * returned only here (and when regenerated); the server keeps its hash.
 * 400 `invalid_name`.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const name =
    typeof json.body === "object" && json.body !== null
      ? (json.body as { name?: unknown }).name
      : undefined;
  const result = await createHmi(guard.db, name, new Date());
  if (!result.ok) return invalidHmiName();
  return jsonNoStore({ hmi: toAdminHmi(result.hmi), token: result.token }, 201);
}
