import { z } from "zod";

import {
  ActorNotAdminError,
  findUserById,
  setUserPassword,
} from "~/server/auth/accounts";
import { MAX_PASSWORD_LENGTH } from "~/server/auth/password";
import { passwordProblem } from "~/server/auth/passwordStrength";

import { jsonNoStore, readJsonBody } from "../../../../auth/responses";
import { requireAdmin } from "../../../requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetSchema = z.object({
  password: z.string().max(MAX_PASSWORD_LENGTH + 1),
});

/**
 * `POST /api/admin/users/:id/password` — `{ password }` → 204. Sets the
 * user's password and revokes all of their sessions (ADR 0005), including
 * the admin's own when resetting their own account. 404 `user_not_found`,
 * 400 `weak_password` (with `reason`), 403 `forbidden` when the acting admin
 * was deleted while the request was in flight.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const { id } = await context.params;

  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = resetSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);

  const target = await findUserById(guard.db, id);
  if (!target) return jsonNoStore({ error: "user_not_found" }, 404);

  const problem = passwordProblem(parsed.data.password, target.username);
  if (problem) {
    return jsonNoStore({ error: "weak_password", reason: problem }, 400);
  }
  let updated: boolean;
  try {
    updated = await setUserPassword(guard.db, id, parsed.data.password, {
      actorId: guard.admin.id,
    });
  } catch (error) {
    if (error instanceof ActorNotAdminError) {
      return jsonNoStore({ error: "forbidden" }, 403);
    }
    throw error;
  }
  if (!updated) return jsonNoStore({ error: "user_not_found" }, 404);
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
