import { z } from "zod";

import { loginWithPassword } from "~/server/auth/accounts";
import {
  readSessionToken,
  sessionCookieOptionsFor,
  toSessionUser,
} from "~/server/auth/sessionUser";
import { getServerDatabase } from "~/server/db/serverDatabase";

import { jsonNoStore, readJsonBody, serverStorageDisabled } from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded so an oversized password cannot make argon2 hash megabytes.
const loginSchema = z.object({
  username: z.string().max(256),
  password: z.string().min(1).max(1024),
});

/** `POST /api/auth/login` — `{ username, password }` → session cookie. */
export async function POST(request: Request): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();

  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = loginSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);

  // A fresh token on every login; this browser's previous session ends.
  // Password re-check and session insert are atomic against a reset.
  const result = await loginWithPassword(
    db,
    parsed.data.username,
    parsed.data.password,
    new Date(),
    readSessionToken(request),
  );
  // Same answer for unknown user and wrong password.
  if (!result) return jsonNoStore({ error: "invalid_credentials" }, 401);
  const { user, session } = result;

  const response = jsonNoStore({ user: toSessionUser(user) });
  response.cookies.set({
    ...sessionCookieOptionsFor(request),
    value: session.token,
    expires: session.expiresAt,
  });
  return response;
}
