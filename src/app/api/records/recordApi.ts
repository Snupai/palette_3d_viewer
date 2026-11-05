import type { NextResponse } from "next/server";

import {
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import {
  MAX_RECORD_BYTES,
  type RecordConflict,
  type RecordForbidden,
  type RecordInvalid,
  type StoredRecord,
} from "~/server/records/recordRepository";

import { jsonNoStore } from "../auth/responses";

/**
 * Shared pieces of the records API (#31, ADR 0003/0004/0006). Server-only.
 *
 * Reads are public; writes need a session and pass the store's policy:
 * projects may be changed by their creator or an admin, the Werkskatalog
 * (`project-resources`) only by an admin. The other client stores
 * (`pallets`, `project-quarantine`, `legacy-migrations`) hold local legacy
 * and maintenance data and are not exposed.
 */

export type WritePolicy = "creator-or-admin" | "admin";

const WRITE_POLICIES: ReadonlyMap<string, WritePolicy> = new Map<
  PlannerStoreName,
  WritePolicy
>([
  [PROJECTS_STORE_NAME, "creator-or-admin"],
  [PROJECT_RESOURCES_STORE_NAME, "admin"],
]);

/** The write policy of an API-exposed store, or `null` for any other name. */
export function writePolicyFor(store: string): WritePolicy | null {
  return WRITE_POLICIES.get(store) ?? null;
}

/**
 * Largest accepted expected version: `version` is a PostgreSQL `integer`
 * and an update stores `expectedVersion + 1`.
 */
export const MAX_EXPECTED_VERSION = 2_147_483_646;

/** Request bodies wrap the record; leave room for the envelope. */
export const MAX_RECORD_BODY_BYTES = MAX_RECORD_BYTES + 64 * 1024;

export type ApiRecord = {
  record: Record<string, unknown>;
  version: number;
  /** Creating user's id; `null` when unknown or that user was deleted. */
  createdBy: string | null;
};

export function toApiRecord(stored: StoredRecord): ApiRecord {
  return {
    record: stored.record,
    version: stored.version,
    createdBy: stored.createdBy,
  };
}

export function unknownStore(): NextResponse {
  return jsonNoStore({ error: "unknown_store" }, 404);
}

/** Maps a repository rejection to its HTTP response. */
export function rejectionResponse(
  result: RecordInvalid | RecordForbidden | RecordConflict,
): NextResponse {
  switch (result.kind) {
    case "conflict":
      return jsonNoStore(
        { error: "version_conflict", currentVersion: result.actualVersion },
        409,
      );
    case "forbidden":
      return jsonNoStore({ error: "forbidden" }, 403);
    case "invalid":
      switch (result.reason) {
        case "unknown-store":
          return unknownStore();
        case "invalid-id":
          return jsonNoStore({ error: "invalid_id" }, 400);
        case "too-large":
          return jsonNoStore({ error: "record_too_large" }, 413);
        default:
          return jsonNoStore(
            { error: "invalid_record", reason: result.reason },
            400,
          );
      }
  }
}

/**
 * Reads a JSON request body of at most `maxBytes`. JSON only: a cross-site
 * HTML form cannot send `application/json` without a CORS preflight, so this
 * is the CSRF guard for cookie-authenticated writes. 415 for other content
 * types, 413 when too large (counted while streaming, not only from
 * `Content-Length`), 400 for invalid UTF-8 or JSON.
 */
export async function readJsonBodyWithin(
  request: Request,
  maxBytes: number,
): Promise<{ body: unknown } | { response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return {
      response: jsonNoStore({ error: "unsupported_media_type" }, 415),
    };
  }
  const tooLarge = () => ({
    response: jsonNoStore({ error: "record_too_large" }, 413),
  });
  const invalidRequest = () => ({
    response: jsonNoStore({ error: "invalid_request" }, 400),
  });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!request.body) return invalidRequest();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return { body: JSON.parse(text) as unknown };
  } catch {
    return invalidRequest();
  }
}
