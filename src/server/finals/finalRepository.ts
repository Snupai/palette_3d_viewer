import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { PROJECTS_STORE_NAME } from "~/lib/plannerDatabase";
import { parseRobText } from "~/lib/robParser";

import type { PlannerDatabase } from "../db/database";
import { planFinals, plannerRecords, type PlanFinalRow } from "../db/schema";
import { isValidRecordId } from "../records/recordRepository";

/**
 * Fertigstände (ADR 0013). Server-only.
 *
 * Marking freezes the `.rob` the client generated for one exact saved project
 * version. The server checks that version, that the text parses as `.rob`
 * and its size, then stores the text byte for byte and its SHA-256. Marking
 * again replaces the current Fertigstand (the old one is withdrawn, not
 * deleted); a project has at most one current Fertigstand, enforced by a
 * partial unique index. Deleting a project withdraws its Fertigstände
 * ({@link withdrawFinalsOfRecord}, called by `deleteRecord`).
 *
 * Like the record repository, caller mistakes come back as result unions;
 * database failures throw.
 */

/** Largest accepted `.rob`, in UTF-8 bytes. Real plans are below ~10 KB. */
export const MAX_FINAL_ROB_BYTES = 256 * 1024;
/**
 * Longest display name shown on an HMI, in UTF-16 code units: room for the
 * product and project numbers (200 each) joined by the client.
 */
export const MAX_FINAL_NAME_LENGTH = 500;
/** Longest `.rob` file name, in UTF-16 code units. */
export const MAX_FINAL_FILE_NAME_LENGTH = 255;

/** A Fertigstand without its `.rob` text. */
export type FinalSummary = {
  id: string;
  recordId: string;
  recordVersion: number;
  name: string;
  fileName: string;
  sha256: string;
  /** Marking user's id; `null` when that account was deleted. */
  markedBy: string | null;
  markedAt: Date;
  /** `null` while current. */
  withdrawnAt: Date | null;
};

export type StoredFinal = FinalSummary & { robText: string };

export type FinalInvalidReason =
  | "invalid-record-id"
  | "invalid-version"
  | "invalid-name"
  | "invalid-file-name"
  | "rob-too-large"
  | "rob-invalid";

export type FinalInvalid = {
  ok: false;
  kind: "invalid";
  reason: FinalInvalidReason;
  message: string;
};

/**
 * The project is not stored at the version the `.rob` was generated from:
 * edited since, or deleted (`actualVersion: null`).
 */
export type FinalConflict = {
  ok: false;
  kind: "conflict";
  recordId: string;
  expectedVersion: number;
  actualVersion: number | null;
};

export type FinalNotFound = { ok: false; kind: "not-found"; id: string };

export type MarkFinalInput = {
  recordId: string;
  recordVersion: number;
  name: string;
  fileName: string;
  robText: string;
  /** The marking user. */
  userId: string | null;
};

export type MarkFinalResult =
  | {
      ok: true;
      final: FinalSummary;
      /** The Fertigstand this one withdrew, if any. */
      replaced: FinalSummary | null;
      /**
       * The same version, text and names were already current: nothing was
       * written and `final` is the existing row.
       */
      unchanged: boolean;
    }
  | FinalInvalid
  | FinalConflict;

export type WithdrawFinalResult =
  | { ok: true; final: FinalSummary }
  | FinalNotFound;

function invalid(reason: FinalInvalidReason, message: string): FinalInvalid {
  return { ok: false, kind: "invalid", reason, message };
}

// C0 and C1 control characters (including DEL).
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Fertigstand id: a UUID. Checked before it reaches a `uuid` column. */
export function isFinalId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isVersion(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 2_147_483_647
  );
}

function isLabel(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}

/** Lower-case hex SHA-256 of the text's UTF-8 bytes. */
export function robSha256(robText: string): string {
  return createHash("sha256").update(robText, "utf8").digest("hex");
}

/**
 * Checks everything about a mark request that does not need the database.
 * The `.rob` must parse with the same parser the planner imports with; a
 * text PostgreSQL cannot store unchanged (NUL, lone surrogates) is refused
 * instead of being altered.
 */
export function validateMarkFinalInput(
  input: MarkFinalInput,
): { ok: true; sha256: string } | FinalInvalid {
  if (!isValidRecordId(input.recordId)) {
    return invalid("invalid-record-id", "Project id is invalid.");
  }
  if (!isVersion(input.recordVersion)) {
    return invalid(
      "invalid-version",
      "Project version must be a positive integer.",
    );
  }
  if (!isLabel(input.name, MAX_FINAL_NAME_LENGTH)) {
    return invalid(
      "invalid-name",
      `Name must be 1–${MAX_FINAL_NAME_LENGTH} characters without control characters.`,
    );
  }
  if (
    !isLabel(input.fileName, MAX_FINAL_FILE_NAME_LENGTH) ||
    /[/\\]/.test(input.fileName)
  ) {
    return invalid(
      "invalid-file-name",
      `File name must be 1–${MAX_FINAL_FILE_NAME_LENGTH} characters without path separators or control characters.`,
    );
  }
  if (typeof input.robText !== "string") {
    return invalid("rob-invalid", ".rob text must be a string.");
  }
  const bytes = Buffer.byteLength(input.robText, "utf8");
  if (bytes > MAX_FINAL_ROB_BYTES) {
    return invalid(
      "rob-too-large",
      `.rob is ${bytes} bytes; the limit is ${MAX_FINAL_ROB_BYTES}.`,
    );
  }
  if (input.robText.includes("\u0000") || LONE_SURROGATE.test(input.robText)) {
    return invalid(
      "rob-invalid",
      ".rob must not contain NUL characters or unpaired surrogates.",
    );
  }
  try {
    parseRobText(input.robText);
  } catch (cause) {
    return invalid(
      "rob-invalid",
      cause instanceof Error ? cause.message : ".rob does not parse.",
    );
  }
  return { ok: true, sha256: robSha256(input.robText) };
}

const summaryColumns = {
  id: planFinals.id,
  recordId: planFinals.recordId,
  recordVersion: planFinals.recordVersion,
  name: planFinals.name,
  fileName: planFinals.fileName,
  sha256: planFinals.sha256,
  markedBy: planFinals.markedBy,
  markedAt: planFinals.markedAt,
  withdrawnAt: planFinals.withdrawnAt,
};

function toSummary(row: FinalSummary | PlanFinalRow): FinalSummary {
  return {
    id: row.id,
    recordId: row.recordId,
    recordVersion: row.recordVersion,
    name: row.name,
    fileName: row.fileName,
    sha256: row.sha256,
    markedBy: row.markedBy,
    markedAt: row.markedAt,
    withdrawnAt: row.withdrawnAt,
  };
}

type PlannerExecutor =
  | PlannerDatabase
  | Parameters<Parameters<PlannerDatabase["transaction"]>[0]>[0];

function projectFinals(recordId: string) {
  return and(
    eq(planFinals.recordStore, PROJECTS_STORE_NAME),
    eq(planFinals.recordId, recordId),
  );
}

/**
 * Marks one saved project version finished. The project row is locked for
 * the transaction, so a concurrent save or delete of the project and a
 * concurrent mark of the same project are serialized against this one: the
 * version check cannot pass for a version that is being replaced.
 */
export async function markFinal(
  db: PlannerDatabase,
  input: MarkFinalInput,
  now: Date,
): Promise<MarkFinalResult> {
  const validated = validateMarkFinalInput(input);
  if (!validated.ok) return validated;
  const { sha256 } = validated;

  return db.transaction(async (tx): Promise<MarkFinalResult> => {
    const [project] = await tx
      .select({
        version: plannerRecords.version,
        deleted: plannerRecords.deleted,
      })
      .from(plannerRecords)
      .where(
        and(
          eq(plannerRecords.store, PROJECTS_STORE_NAME),
          eq(plannerRecords.id, input.recordId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !project ||
      project.deleted ||
      project.version !== input.recordVersion
    ) {
      return {
        ok: false,
        kind: "conflict",
        recordId: input.recordId,
        expectedVersion: input.recordVersion,
        actualVersion: project && !project.deleted ? project.version : null,
      };
    }

    const [current] = await tx
      .select()
      .from(planFinals)
      .where(and(projectFinals(input.recordId), isNull(planFinals.withdrawnAt)))
      .limit(1);
    if (
      current &&
      current.recordVersion === input.recordVersion &&
      current.sha256 === sha256 &&
      current.name === input.name &&
      current.fileName === input.fileName
    ) {
      return {
        ok: true,
        final: toSummary(current),
        replaced: null,
        unchanged: true,
      };
    }

    let replaced: FinalSummary | null = null;
    if (current) {
      // A concurrent withdraw may have won; then nothing is replaced.
      const [withdrawn] = await tx
        .update(planFinals)
        .set({ withdrawnAt: now })
        .where(
          and(eq(planFinals.id, current.id), isNull(planFinals.withdrawnAt)),
        )
        .returning();
      replaced = withdrawn ? toSummary(withdrawn) : null;
    }
    const [inserted] = await tx
      .insert(planFinals)
      .values({
        id: randomUUID(),
        recordStore: PROJECTS_STORE_NAME,
        recordId: input.recordId,
        recordVersion: input.recordVersion,
        name: input.name,
        fileName: input.fileName,
        robText: input.robText,
        sha256,
        markedBy: input.userId,
        markedAt: now,
      })
      .returning();
    return {
      ok: true,
      final: toSummary(inserted!),
      replaced,
      unchanged: false,
    };
  });
}

/** Withdraws a current Fertigstand; unknown or already withdrawn → not found. */
export async function withdrawFinal(
  db: PlannerDatabase,
  id: string,
  now: Date,
): Promise<WithdrawFinalResult> {
  if (!isFinalId(id)) return { ok: false, kind: "not-found", id };
  const [row] = await db
    .update(planFinals)
    .set({ withdrawnAt: now })
    .where(and(eq(planFinals.id, id), isNull(planFinals.withdrawnAt)))
    .returning();
  return row
    ? { ok: true, final: toSummary(row) }
    : { ok: false, kind: "not-found", id };
}

/**
 * Withdraws every current Fertigstand of a project (the project is being
 * deleted). Run it in the deleting transaction. Returns how many it withdrew.
 */
export async function withdrawFinalsOfRecord(
  db: PlannerExecutor,
  recordId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(planFinals)
    .set({ withdrawnAt: now })
    .where(and(projectFinals(recordId), isNull(planFinals.withdrawnAt)))
    .returning({ id: planFinals.id });
  return rows.length;
}

/**
 * Current Fertigstände, ordered by name (case-insensitive) then id;
 * optionally only the one of `recordId`.
 */
export async function listCurrentFinals(
  db: PlannerDatabase,
  filter: { recordId?: string } = {},
): Promise<FinalSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(planFinals)
    .where(
      and(
        isNull(planFinals.withdrawnAt),
        filter.recordId === undefined
          ? undefined
          : projectFinals(filter.recordId),
      ),
    )
    .orderBy(sql`lower(${planFinals.name})`, asc(planFinals.id));
  return rows.map(toSummary);
}

/**
 * One Fertigstand with its `.rob` text, current or withdrawn (an HMI may
 * still run a withdrawn one), or `null`.
 */
export async function getFinal(
  db: PlannerDatabase,
  id: string,
): Promise<StoredFinal | null> {
  if (!isFinalId(id)) return null;
  const [row] = await db
    .select()
    .from(planFinals)
    .where(eq(planFinals.id, id))
    .limit(1);
  return row ? { ...toSummary(row), robText: row.robText } : null;
}
