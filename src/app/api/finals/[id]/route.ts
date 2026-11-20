import { withdrawFinal } from "~/server/finals/finalRepository";

import { jsonNoStore } from "../../auth/responses";
import { requireFinalManager } from "../finalApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `DELETE /api/finals/:id` — withdraws a current Fertigstand (ADR 0013):
 * 204. The row stays (an HMI may still run it); it only leaves the lists.
 * 401 without a session, 403 when the user may not withdraw, 404
 * `final_not_found` for an unknown or already withdrawn id. No body, so a
 * cross-site `DELETE` needs a CORS preflight. 404 in local storage mode.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireFinalManager(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await withdrawFinal(auth.db, id, new Date());
  if (!result.ok) return jsonNoStore({ error: "final_not_found" }, 404);
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
