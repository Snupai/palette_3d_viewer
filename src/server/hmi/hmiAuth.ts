import type { PlannerDatabase } from "../db/database";
import {
  hashSessionToken,
  isWellFormedSessionToken,
} from "../auth/sessionToken";
import {
  findActiveHmiByTokenHash,
  recordHmiSeen,
  type AuthenticatedHmi,
} from "./hmiRepository";

/**
 * Device-token authentication for the HMI API (`/api/hmi/v1`, ADR 0013).
 * Server-only.
 *
 * `Authorization: Bearer <token>` resolves to a registered, non-revoked HMI;
 * a missing, malformed, unknown or revoked token is `unauthenticated` (401).
 * Each valid token then has its own fixed-window request budget. Unknown
 * tokens are not counted: they cannot be guessed (256 bits) and counting
 * them would let random tokens fill the limiter.
 */

/** Requests per token and window. Normal polling uses about 20 per minute. */
export const HMI_RATE_LIMIT = 300;
export const HMI_RATE_WINDOW_MS = 60_000;

export type HmiRateLimiter = {
  /** Counts one request for `key`; `retryAfter` (seconds) when over budget. */
  take(key: string): { ok: true } | { ok: false; retryAfter: number };
};

/** Fixed windows per key, like `loginRateLimit.ts`; the clock is injectable. */
export function createHmiRateLimiter(
  now: () => number = Date.now,
  limit = HMI_RATE_LIMIT,
  windowMs = HMI_RATE_WINDOW_MS,
): HmiRateLimiter {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return {
    take(key) {
      const time = now();
      // Only valid tokens get buckets, so the map stays small; sweep it here.
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.expiresAt <= time) buckets.delete(bucketKey);
      }
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { count: 0, expiresAt: time + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= limit) {
        return {
          ok: false,
          retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - time) / 1000)),
        };
      }
      bucket.count++;
      return { ok: true };
    },
  };
}

/** The bearer token of an `Authorization` header, or `null`. */
export function readBearerToken(header: string | null): string | null {
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

export type HmiAuthResult =
  | { ok: true; hmi: AuthenticatedHmi }
  | { ok: false; kind: "unauthenticated" }
  | { ok: false; kind: "rate-limited"; retryAfter: number };

/**
 * Resolves the request's token to its HMI and counts the request against the
 * token's budget. Unless `recordSeen` is `false`, an accepted request also
 * updates `last_seen_at` (throttled, see `recordHmiSeen`).
 */
export async function authenticateHmi(
  db: PlannerDatabase,
  authorization: string | null,
  options: {
    now: Date;
    limiter: HmiRateLimiter;
    recordSeen?: boolean;
  },
): Promise<HmiAuthResult> {
  const token = readBearerToken(authorization);
  if (!token || !isWellFormedSessionToken(token)) {
    return { ok: false, kind: "unauthenticated" };
  }
  const tokenHash = hashSessionToken(token);
  const hmi = await findActiveHmiByTokenHash(db, tokenHash);
  if (!hmi) return { ok: false, kind: "unauthenticated" };
  const allowed = options.limiter.take(tokenHash);
  if (!allowed.ok) {
    return { ok: false, kind: "rate-limited", retryAfter: allowed.retryAfter };
  }
  if (options.recordSeen !== false) await recordHmiSeen(db, hmi, options.now);
  return { ok: true, hmi };
}

let defaultLimiter = createHmiRateLimiter();

/** The process-wide limiter used by the route handlers. */
export function hmiRateLimiter(): HmiRateLimiter {
  return defaultLimiter;
}

/** Test-only: replaces the process-wide limiter (`undefined` → a fresh default). */
export function setHmiRateLimiterForTesting(
  limiter: HmiRateLimiter | undefined,
): void {
  defaultLimiter = limiter ?? createHmiRateLimiter();
}
