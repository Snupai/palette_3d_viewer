import { deleteUser } from "~/server/auth/deleteUser";

import { jsonNoStore } from "../../../auth/responses";
import { requireAdmin } from "../../requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/admin/users/:id — revoke sessions, retain planner records. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const { id } = await context.params;
  const result = await deleteUser(guard.db, guard.admin.id, id);
  if (result !== "deleted") {
    const status =
      result === "user_not_found" ? 404 : result === "forbidden" ? 403 : 409;
    return jsonNoStore({ error: result }, status);
  }
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
