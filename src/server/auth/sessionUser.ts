import type { PlannerDatabase } from "../db/database";
import { verifySession, type AuthUser } from "./accounts";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  type SessionCookieOptions,
} from "./sessionToken";

/**
 * Request-level session helpers shared by the API route handlers (auth #30,
 * records #31, admin users #32). Server-only.
 */

/** What the API returns about a user: no hash, no timestamps. */
export type SessionUser = Pick<AuthUser, "id" | "username" | "role">;

export function toSessionUser(user: AuthUser): SessionUser {
  return { id: user.id, username: user.username, role: user.role };
}

/** The session token from the request's `Cookie` header, or `null`. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * The user of the request's session, or `null` when there is no cookie or
 * the session is malformed, unknown, revoked or expired.
 */
export async function getSessionUser(
  request: Request,
  db: PlannerDatabase,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = await verifySession(db, token, now);
  return session ? toSessionUser(session.user) : null;
}

/**
 * Cookie attributes for this request (ADR 0008): `Secure` unless the server
 * runs in development and the request targets localhost / loopback.
 */
export function sessionCookieOptionsFor(
  request: Request,
): SessionCookieOptions {
  return sessionCookieOptions({
    nodeEnv:
      process.env.NODE_ENV === "development" ? "development" : "production",
    hostname: new URL(request.url).hostname,
  });
}
