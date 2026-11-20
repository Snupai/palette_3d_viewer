import { createHash } from "node:crypto";

import type { NextResponse } from "next/server";

import type { PlannerDatabase } from "~/server/db/database";
import { getServerDatabase } from "~/server/db/serverDatabase";
import type { FinalSummary } from "~/server/finals/finalRepository";
import { authenticateHmi, hmiRateLimiter } from "~/server/hmi/hmiAuth";
import type { AuthenticatedHmi } from "~/server/hmi/hmiRepository";

import { jsonNoStore, serverStorageDisabled } from "../../auth/responses";

/**
 * Shared pieces of the HMI API v1 (ADR 0013, `docs/hmi-api-v1.md`).
 * Server-only. Device tokens, never sessions.
 */

/**
 * Guard for every HMI route: 404 `server_storage_disabled` in local storage
 * mode, 401 `unauthenticated` for a missing, unknown or revoked token, 429
 * `rate_limited` with `Retry-After` over the token's budget.
 */
export async function requireHmi(
  request: Request,
): Promise<
  { db: PlannerDatabase; hmi: AuthenticatedHmi } | { response: NextResponse }
> {
  const db = getServerDatabase();
  if (!db) return { response: serverStorageDisabled() };
  const result = await authenticateHmi(
    db,
    request.headers.get("authorization"),
    { now: new Date(), limiter: hmiRateLimiter() },
  );
  if (result.ok) return { db, hmi: result.hmi };
  if (result.kind === "rate-limited") {
    const response = jsonNoStore({ error: "rate_limited" }, 429);
    response.headers.set("retry-after", String(result.retryAfter));
    return { response };
  }
  const response = jsonNoStore({ error: "unauthenticated" }, 401);
  response.headers.set("www-authenticate", 'Bearer realm="hmi"');
  return { response };
}

/** A list entry as the HMIs see it (no project version, no marker). */
export type HmiFinal = {
  id: string;
  recordId: string;
  name: string;
  fileName: string;
  sha256: string;
  markedAt: string;
};

export function toHmiFinal(final: FinalSummary): HmiFinal {
  return {
    id: final.id,
    recordId: final.recordId,
    name: final.name,
    fileName: final.fileName,
    sha256: final.sha256,
    markedAt: final.markedAt.toISOString(),
  };
}

/** Strong ETag over the exact JSON body: it changes with any listed field. */
export function bodyEtag(body: string): string {
  return `"${createHash("sha256").update(body, "utf8").digest("hex")}"`;
}

/**
 * Whether an `If-None-Match` header matches `etag` (RFC 9110 weak
 * comparison: `W/` prefixes are ignored; `*` matches anything).
 */
export function ifNoneMatchMatches(
  header: string | null,
  etag: string,
): boolean {
  if (header === null) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, "");
  return header
    .split(",")
    .some((tag) => tag.trim() === "*" || strip(tag) === strip(etag));
}

/** `304 Not Modified` with the validator, never cached by intermediaries. */
export function notModified(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: { etag, "cache-control": "no-store" },
  });
}
