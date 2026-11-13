import { z } from "zod";

import {
  ActorNotAdminError,
  createUser,
  listUsers,
  UsernameTakenError,
  type AuthUser,
} from "~/server/auth/accounts";
import { MAX_PASSWORD_LENGTH } from "~/server/auth/password";
import { passwordProblem } from "~/server/auth/passwordStrength";
import {
  normalizeUsername,
  USER_ROLES,
  UsernameError,
} from "~/server/auth/userModel";

import { jsonNoStore, readJsonBody } from "../../auth/responses";
import { requireAdmin } from "../requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the admin API returns per account: never the password hash. */
function toAdminUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** `GET /api/admin/users` — every account, ordered by username. */
export async function GET(request: Request): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;
  const users = await listUsers(guard.db);
  return jsonNoStore({ users: users.map(toAdminUser) });
}

// Length bounds are checked by `passwordProblem`; this cap only keeps an
// oversized body from reaching it.
const createSchema = z.object({
  username: z.string().max(256),
  password: z.string().max(MAX_PASSWORD_LENGTH + 1),
  role: z.enum(USER_ROLES).default("user"),
});

/**
 * `POST /api/admin/users` — `{ username, password, role? }` → 201 with the
 * new account. 400 `invalid_username` / `weak_password` (with `reason`),
 * 409 `username_taken`, 403 `forbidden` if the acting admin was deleted
 * meanwhile.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireAdmin(request);
  if ("response" in guard) return guard.response;

  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = createSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);

  let username: string;
  try {
    username = normalizeUsername(parsed.data.username);
  } catch (error) {
    if (error instanceof UsernameError) {
      return jsonNoStore({ error: "invalid_username" }, 400);
    }
    throw error;
  }
  const problem = passwordProblem(parsed.data.password, username);
  if (problem) {
    return jsonNoStore({ error: "weak_password", reason: problem }, 400);
  }

  try {
    const user = await createUser(
      guard.db,
      { username, password: parsed.data.password, role: parsed.data.role },
      new Date(),
      { actorId: guard.admin.id },
    );
    return jsonNoStore({ user: toAdminUser(user) }, 201);
  } catch (error) {
    if (error instanceof UsernameTakenError) {
      return jsonNoStore({ error: "username_taken" }, 409);
    }
    if (error instanceof ActorNotAdminError) {
      return jsonNoStore({ error: "forbidden" }, 403);
    }
    throw error;
  }
}
