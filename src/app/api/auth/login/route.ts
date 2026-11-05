import { z } from "zod";

import {
  authenticate,
  createSession,
  revokeSession,
} from "~/server/auth/accounts";
import {
  readSessionToken,
  sessionCookieOptionsFor,
  toSessionUser,
} from "~/server/auth/sessionUser";
import { getServerDatabase } from "~/server/db/serverDatabase";

import { jsonNoStore, serverStorageDisabled } from "../responses";

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

  // JSON only: a cross-site HTML form cannot send it without a CORS preflight.
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return jsonNoStore({ error: "unsupported_media_type" }, 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);

  const user = await authenticate(
    db,
    parsed.data.username,
    parsed.data.password,
  );
  // Same answer for unknown user and wrong password.
  if (!user) return jsonNoStore({ error: "invalid_credentials" }, 401);

  // A fresh token on every login; this browser's previous session ends.
  const previous = readSessionToken(request);
  if (previous) await revokeSession(db, previous);
  const session = await createSession(db, user.id, new Date());

  const response = jsonNoStore({ user: toSessionUser(user) });
  response.cookies.set({
    ...sessionCookieOptionsFor(request),
    value: session.token,
    expires: session.expiresAt,
  });
  return response;
}
