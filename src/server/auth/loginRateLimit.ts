import { isIP } from "node:net";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10_000;

type Bucket = { failures: number; pending: number; expiresAt: number };
export type LoginAttempt =
  | { retryAfter: number }
  | { finish: (success: boolean | null) => void };

/** Fixed windows; pending checks reserve capacity before asynchronous hashing. */
export function createLoginRateLimiter(
  now: () => number = Date.now,
  maxEntries = MAX_ENTRIES,
) {
  const buckets = new Map<string, Bucket>();

  return {
    begin(username: string, address: string): LoginAttempt {
      const time = now();
      for (const [key, bucket] of buckets) {
        if (bucket.expiresAt <= time && bucket.pending === 0)
          buckets.delete(key);
      }
      const keys = [
        `user:${username.trim().toLowerCase()}`,
        `address:${address}`,
      ];
      const limits = [5, 30];
      let retryAfter = 0;
      for (const [index, key] of keys.entries()) {
        const bucket = buckets.get(key);
        if (bucket && bucket.failures + bucket.pending >= limits[index]!) {
          retryAfter = Math.max(
            retryAfter,
            Math.max(1, Math.ceil((bucket.expiresAt - time) / 1000)),
          );
        }
      }
      if (retryAfter) return { retryAfter };
      // Do not evict active counters: rotating names must not bypass the limit.
      if (
        buckets.size + keys.filter((key) => !buckets.has(key)).length >
        maxEntries
      ) {
        return { retryAfter: Math.ceil(WINDOW_MS / 1000) };
      }
      const reserved = keys.map((key) => {
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { failures: 0, pending: 0, expiresAt: time + WINDOW_MS };
          buckets.set(key, bucket);
        }
        bucket.pending++;
        return bucket;
      });
      let finished = false;
      return {
        finish(success) {
          if (finished) return;
          finished = true;
          reserved.forEach((bucket, index) => {
            bucket.pending--;
            if (success === false) bucket.failures++;
            // An authenticated user cannot clear an address's password spray.
            if (success === true && index === 0) bucket.failures = 0;
            if (bucket.pending === 0 && bucket.failures === 0)
              buckets.delete(keys[index]!);
          });
        },
      };
    },
  };
}

/** Next's Request exposes no socket peer. Untrusted/missing headers share a bucket. */
export function loginClientAddress(
  request: Request,
  trustProxy: boolean,
): string {
  if (!trustProxy) return "unknown";
  const value = request.headers.get("x-forwarded-for")?.trim() ?? "";
  // Require the trusted proxy to overwrite the header with one client IP.
  // Scoped IPv6 addresses are not valid URL hosts. Use the shared fallback.
  if (!isIP(value) || value.includes("%")) return "unknown";
  // URL canonicalizes equivalent IPv6 spellings.
  return isIP(value) === 6 ? new URL(`http://[${value}]`).hostname : value;
}

export const loginRateLimiter = createLoginRateLimiter();
