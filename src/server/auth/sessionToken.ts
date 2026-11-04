import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes → 43 base64url characters. */
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Sessions live 12 hours: one working shift plus slack. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "palette_session";

/**
 * Creates an opaque session token. Only its hash is stored (`sessions.token_hash`),
 * so a leaked database cannot be replayed as cookies.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of the token. Tokens carry 256 bits of entropy, so no salt or KDF is needed. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

/** Constant-time comparison of two hex token hashes. */
export function sessionTokenHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sessionExpiresAt(
  nowMs: number,
  ttlMs = SESSION_TTL_MS,
): number {
  return nowMs + ttlMs;
}

/** A session is valid strictly before `expiresAtMs`. */
export function isSessionExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export type SessionCookieOptions = {
  name: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
};

/**
 * ADR 0008: the cookie is always `Secure`; plain HTTP is only tolerated for
 * local development on `localhost` / loopback.
 */
export function sessionCookieOptions(input: {
  nodeEnv: "development" | "test" | "production";
  hostname: string;
  ttlMs?: number;
}): SessionCookieOptions {
  const loopback =
    input.hostname === "localhost" ||
    input.hostname === "127.0.0.1" ||
    input.hostname === "::1" ||
    input.hostname === "[::1]";
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: !(input.nodeEnv === "development" && loopback),
    maxAge: Math.floor((input.ttlMs ?? SESSION_TTL_MS) / 1000),
  };
}
