import { and, asc, eq, sql } from "drizzle-orm";

import {
  PLANNER_STORE_NAMES,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";

import type { PlannerDatabase } from "../db/database";
import { plannerRecords, type PlannerRecordRow } from "../db/schema";

/**
 * Server-side planner record repository (ADR 0004 / 0006). Server-only.
 *
 * The server checks only structure — allowed store, id, JSON object shape and
 * size; full Zod domain validation stays in the client (ADR 0004). Writes and
 * deletes compare the caller's expected version inside the same statement
 * (`UPDATE … WHERE version = ?`), so a stale writer gets a conflict result
 * instead of overwriting (ADR 0006).
 *
 * Every function returns a result union instead of throwing for caller
 * mistakes, so a route handler can map `invalid` → 400, `forbidden` → 403
 * and `conflict` → 409.
 * Database failures still throw.
 *
 * Deletes retain a tombstone with an empty payload. Recreating the same key
 * atomically advances its version; reads and conflicts hide deleted rows.
 */

/** Largest accepted record, measured as UTF-8 bytes of its JSON text. */
export const MAX_RECORD_BYTES = 4 * 1024 * 1024;
/** Longest accepted record id, in UTF-16 code units. */
export const MAX_RECORD_ID_LENGTH = 256;

export type RecordVersion = number;

export type StoredRecord = {
  store: PlannerStoreName;
  id: string;
  record: Record<string, unknown>;
  version: RecordVersion;
  /** Creating user's id; `null` when unknown or that user was deleted. */
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RecordInvalidReason =
  | "unknown-store"
  | "invalid-id"
  | "not-object"
  | "not-json"
  | "too-large"
  | "invalid-version";

export type RecordInvalid = {
  ok: false;
  kind: "invalid";
  reason: RecordInvalidReason;
  message: string;
};

export type RecordConflict = {
  ok: false;
  kind: "conflict";
  store: PlannerStoreName;
  id: string;
  expectedVersion: RecordVersion | null;
  /** `null` when the record does not exist. */
  actualVersion: RecordVersion | null;
};

/**
 * An update or delete restricted by `onlyCreatedBy` hit a record created by
 * someone else (or by a deleted user).
 */
export type RecordForbidden = {
  ok: false;
  kind: "forbidden";
  store: PlannerStoreName;
  id: string;
};

export type ListRecordsResult =
  | { ok: true; records: StoredRecord[] }
  | RecordInvalid;

export type GetRecordResult =
  | { ok: true; record: StoredRecord | null }
  | RecordInvalid;

export type PutRecordResult =
  | { ok: true; record: StoredRecord }
  | RecordInvalid
  | RecordForbidden
  | RecordConflict;

export type DeleteRecordResult =
  | { ok: true }
  | RecordInvalid
  | RecordForbidden
  | RecordConflict;

export type PutRecordInput = {
  store: string;
  /** The record; its `id` field is the record id. */
  record: unknown;
  /**
   * `null`: the record must not exist yet (insert). A number: the record must
   * exist with exactly that version (update). There is no unconditional write.
   */
  expectedVersion: RecordVersion | null;
  /** Creator on creation (including recreation); unchanged by updates. */
  userId: string | null;
  /**
   * Update only: apply only if the record's `created_by` is this user id,
   * checked in the same statement as the version. Ignored for inserts.
   */
  onlyCreatedBy?: string;
};

export type DeleteRecordInput = {
  store: string;
  id: string;
  /** The record must exist with exactly this version. */
  expectedVersion: RecordVersion;
  /** Delete only if the record's `created_by` is this user id (atomic). */
  onlyCreatedBy?: string;
};

function invalid(reason: RecordInvalidReason, message: string): RecordInvalid {
  return { ok: false, kind: "invalid", reason, message };
}

export function isPlannerStoreName(value: unknown): value is PlannerStoreName {
  return (
    typeof value === "string" &&
    (PLANNER_STORE_NAMES as readonly string[]).includes(value)
  );
}

// C0 and C1 control characters (including DEL).
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** Non-empty, at most {@link MAX_RECORD_ID_LENGTH}, no control characters. */
export function isValidRecordId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECORD_ID_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

function isVersion(value: unknown): value is RecordVersion {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function unknownStore(store: string): RecordInvalid {
  return invalid("unknown-store", `Unknown record store "${store}".`);
}

function checkId(id: unknown): RecordInvalid | null {
  return isValidRecordId(id)
    ? null
    : invalid(
        "invalid-id",
        `Record id must be 1–${MAX_RECORD_ID_LENGTH} characters without control characters.`,
      );
}

const JSONB_UNSAFE =
  /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * PostgreSQL `jsonb` rejects `\u0000` and unpaired surrogate escapes, which
 * `JSON.stringify` emits without complaint; check every key and string value
 * up front so such input is a validation result, not a database error.
 * Iterative, so deep nesting cannot overflow the stack.
 */
function hasOnlyJsonbSafeStrings(root: unknown): boolean {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (JSONB_UNSAFE.test(value)) return false;
    } else if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
    } else if (typeof value === "object" && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (JSONB_UNSAFE.test(key)) return false;
        pending.push(entry);
      }
    }
  }
  return true;
}

export type ValidatedRecord = {
  id: string;
  /** The JSON round-trip of the input — exactly what is stored. */
  json: Record<string, unknown>;
  bytes: number;
};

/**
 * Structural record check: a plain JSON object with a valid string `id`,
 * serializable, storable as `jsonb` and at most
 * {@link MAX_RECORD_BYTES}. Domain validation is the client's job.
 */
export function validateRecord(
  record: unknown,
): { ok: true; value: ValidatedRecord } | RecordInvalid {
  if (!isPlainObject(record)) {
    return invalid("not-object", "Record must be a JSON object.");
  }
  const idError = checkId(record.id);
  if (idError) return idError;
  let text: string;
  try {
    text = JSON.stringify(record);
  } catch {
    return invalid("not-json", "Record is not serializable as JSON.");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_RECORD_BYTES) {
    return invalid(
      "too-large",
      `Record is ${bytes} bytes; the limit is ${MAX_RECORD_BYTES}.`,
    );
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  if (!hasOnlyJsonbSafeStrings(json)) {
    return invalid(
      "not-json",
      "Record strings must not contain NUL characters or unpaired surrogates.",
    );
  }
  return { ok: true, value: { id: record.id as string, json, bytes } };
}

function toStoredRecord(row: PlannerRecordRow): StoredRecord {
  return {
    store: row.store as PlannerStoreName,
    id: row.id,
    record: row.json,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function recordKey(store: string, id: string) {
  return and(eq(plannerRecords.store, store), eq(plannerRecords.id, id));
}

function creatorGuard(onlyCreatedBy: string | undefined) {
  return onlyCreatedBy === undefined
    ? undefined
    : eq(plannerRecords.createdBy, onlyCreatedBy);
}

/**
 * Why a guarded write matched no row: `forbidden` when the record exists but
 * belongs to someone else, otherwise a version conflict. The write itself was
 * atomic; this follow-up read only picks the error to report.
 */
async function rejectedWrite(
  db: PlannerDatabase,
  store: PlannerStoreName,
  id: string,
  expectedVersion: RecordVersion | null,
  onlyCreatedBy: string | undefined,
): Promise<RecordForbidden | RecordConflict> {
  const [row] = await db
    .select({
      version: plannerRecords.version,
      createdBy: plannerRecords.createdBy,
    })
    .from(plannerRecords)
    .where(and(recordKey(store, id), eq(plannerRecords.deleted, false)))
    .limit(1);
  if (row && onlyCreatedBy !== undefined && row.createdBy !== onlyCreatedBy) {
    return { ok: false, kind: "forbidden", store, id };
  }
  return {
    ok: false,
    kind: "conflict",
    store,
    id,
    expectedVersion,
    actualVersion: row?.version ?? null,
  };
}

/** All records of one store, ordered by id. */
export async function listRecords(
  db: PlannerDatabase,
  store: string,
): Promise<ListRecordsResult> {
  if (!isPlannerStoreName(store)) return unknownStore(store);
  const rows = await db
    .select()
    .from(plannerRecords)
    .where(
      and(eq(plannerRecords.store, store), eq(plannerRecords.deleted, false)),
    )
    .orderBy(asc(plannerRecords.id));
  return { ok: true, records: rows.map(toStoredRecord) };
}

/** One record, or `record: null` when it does not exist. */
export async function getRecord(
  db: PlannerDatabase,
  store: string,
  id: string,
): Promise<GetRecordResult> {
  if (!isPlannerStoreName(store)) return unknownStore(store);
  const idError = checkId(id);
  if (idError) return idError;
  const [row] = await db
    .select()
    .from(plannerRecords)
    .where(and(recordKey(store, id), eq(plannerRecords.deleted, false)))
    .limit(1);
  return { ok: true, record: row ? toStoredRecord(row) : null };
}

/**
 * Inserts (`expectedVersion: null`) or updates (`expectedVersion: n`) one
 * record. The version check is part of the write statement, so of two
 * concurrent writers with the same expected version exactly one succeeds.
 */
export async function putRecord(
  db: PlannerDatabase,
  input: PutRecordInput,
  now: Date,
): Promise<PutRecordResult> {
  const { store, expectedVersion } = input;
  if (!isPlannerStoreName(store)) return unknownStore(store);
  if (expectedVersion !== null && !isVersion(expectedVersion)) {
    return invalid(
      "invalid-version",
      "Expected version must be null or a positive integer.",
    );
  }
  const validated = validateRecord(input.record);
  if (!validated.ok) return validated;
  const { id, json } = validated.value;

  const rows =
    expectedVersion === null
      ? await db
          .insert(plannerRecords)
          .values({
            store,
            id,
            json,
            version: 1,
            createdBy: input.userId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [plannerRecords.store, plannerRecords.id],
            set: {
              json,
              deleted: false,
              version: sql`${plannerRecords.version} + 1`,
              createdBy: input.userId,
              createdAt: now,
              updatedAt: now,
            },
            setWhere: eq(plannerRecords.deleted, true),
          })
          .returning()
      : await db
          .update(plannerRecords)
          // `created_by` / `created_at` are deliberately not touched.
          .set({
            json,
            version: expectedVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              recordKey(store, id),
              eq(plannerRecords.deleted, false),
              eq(plannerRecords.version, expectedVersion),
              creatorGuard(input.onlyCreatedBy),
            ),
          )
          .returning();

  const [row] = rows;
  if (row) return { ok: true, record: toStoredRecord(row) };
  return rejectedWrite(
    db,
    store,
    id,
    expectedVersion,
    // Creation only replaces tombstones; a live record always conflicts.
    expectedVersion === null ? undefined : input.onlyCreatedBy,
  );
}

/** Deletes one record if it is still at `expectedVersion`. */
export async function deleteRecord(
  db: PlannerDatabase,
  input: DeleteRecordInput,
): Promise<DeleteRecordResult> {
  const { store, id, expectedVersion } = input;
  if (!isPlannerStoreName(store)) return unknownStore(store);
  const idError = checkId(id);
  if (idError) return idError;
  if (!isVersion(expectedVersion)) {
    return invalid(
      "invalid-version",
      "Expected version must be a positive integer.",
    );
  }
  const removed = await db
    .update(plannerRecords)
    .set({
      deleted: true,
      json: {},
      createdBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        recordKey(store, id),
        eq(plannerRecords.deleted, false),
        eq(plannerRecords.version, expectedVersion),
        creatorGuard(input.onlyCreatedBy),
      ),
    )
    .returning({ id: plannerRecords.id });
  if (removed.length > 0) return { ok: true };
  return rejectedWrite(db, store, id, expectedVersion, input.onlyCreatedBy);
}
