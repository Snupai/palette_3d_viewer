import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import type { PlannerDatabase } from "../db/database";
import { generateSessionToken, hashSessionToken } from "../auth/sessionToken";
import { hmiDevices, planFinals } from "../db/schema";
import { getFinal, isFinalId } from "../finals/finalRepository";

/**
 * Registered HMIs (ADR 0013). Server-only.
 *
 * Admins create HMIs, rename and revoke them and regenerate their tokens.
 * A device token is generated like a session token (32 random bytes,
 * base64url) and only its SHA-256 is stored; the plain token is returned
 * exactly once, by {@link createHmi} and {@link regenerateHmiToken}.
 * Caller mistakes come back as result unions; database failures throw.
 */

/** Longest HMI name, in UTF-16 code units (e.g. "Linie 3 – Halle Süd"). */
export const MAX_HMI_NAME_LENGTH = 100;
/** Longest stored `appVersion`, in UTF-16 code units. */
export const MAX_HMI_APP_VERSION_LENGTH = 100;
/**
 * `last_seen_at` is written at most this often per HMI, so polling (two
 * requests every 10 s plus downloads) does not write on every request.
 */
export const LAST_SEEN_WRITE_INTERVAL_MS = 15_000;

/** The Fertigstand an HMI reported as running. */
export type HmiActiveFinal = {
  id: string;
  name: string;
  sha256: string;
  /** Withdrawn since: the HMI still runs a plan that left the list. */
  withdrawn: boolean;
};

export type HmiSummary = {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  appVersion: string | null;
  activeFinal: HmiActiveFinal | null;
};

/** The HMI an authenticated device request belongs to. */
export type AuthenticatedHmi = {
  id: string;
  name: string;
  tokenHash: string;
  lastSeenAt: Date | null;
};

export type HmiNotFound = { ok: false; kind: "not-found"; id: string };
export type HmiInvalidName = { ok: false; kind: "invalid-name" };

/** HMI ids are UUIDs, checked like Fertigstand ids before reaching a `uuid` column. */
export const isHmiId = isFinalId;

// C0 and C1 control characters (including DEL).
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isPrintable(value: string, maxLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER.test(value) &&
    !LONE_SURROGATE.test(value)
  );
}

/** The trimmed name, or `null` when it is empty, too long or unprintable. */
export function normalizeHmiName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return isPrintable(name, MAX_HMI_NAME_LENGTH) ? name : null;
}

/** A reported app version, trimmed; `null` when absent or unusable. */
export function normalizeHmiAppVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const version = value.trim();
  return isPrintable(version, MAX_HMI_APP_VERSION_LENGTH) ? version : null;
}

const summaryColumns = {
  id: hmiDevices.id,
  name: hmiDevices.name,
  createdAt: hmiDevices.createdAt,
  revokedAt: hmiDevices.revokedAt,
  lastSeenAt: hmiDevices.lastSeenAt,
  appVersion: hmiDevices.appVersion,
  finalId: planFinals.id,
  finalName: planFinals.name,
  finalSha256: planFinals.sha256,
  finalWithdrawnAt: planFinals.withdrawnAt,
};

type SummaryRow = {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  appVersion: string | null;
  finalId: string | null;
  finalName: string | null;
  finalSha256: string | null;
  finalWithdrawnAt: Date | null;
};

function toSummary(row: SummaryRow): HmiSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
    lastSeenAt: row.lastSeenAt,
    appVersion: row.appVersion,
    activeFinal:
      row.finalId === null
        ? null
        : {
            id: row.finalId,
            name: row.finalName!,
            sha256: row.finalSha256!,
            withdrawn: row.finalWithdrawnAt !== null,
          },
  };
}

function selectSummaries(db: PlannerDatabase) {
  return db
    .select(summaryColumns)
    .from(hmiDevices)
    .leftJoin(planFinals, eq(hmiDevices.activeFinalId, planFinals.id));
}

/** Every HMI, ordered by name (case-insensitive) then id. */
export async function listHmis(db: PlannerDatabase): Promise<HmiSummary[]> {
  const rows = await selectSummaries(db).orderBy(
    sql`lower(${hmiDevices.name})`,
    asc(hmiDevices.id),
  );
  return rows.map(toSummary);
}

/** One HMI, or `null`. */
export async function getHmi(
  db: PlannerDatabase,
  id: string,
): Promise<HmiSummary | null> {
  if (!isHmiId(id)) return null;
  const [row] = await selectSummaries(db).where(eq(hmiDevices.id, id)).limit(1);
  return row ? toSummary(row) : null;
}

export type HmiWithToken = { ok: true; hmi: HmiSummary; token: string };

/** Registers an HMI. The returned token is never retrievable again. */
export async function createHmi(
  db: PlannerDatabase,
  name: unknown,
  now: Date,
): Promise<HmiWithToken | HmiInvalidName> {
  const normalized = normalizeHmiName(name);
  if (normalized === null) return { ok: false, kind: "invalid-name" };
  const token = generateSessionToken();
  const id = randomUUID();
  await db.insert(hmiDevices).values({
    id,
    name: normalized,
    tokenHash: hashSessionToken(token),
    createdAt: now,
  });
  return { ok: true, hmi: (await getHmi(db, id))!, token };
}

export async function renameHmi(
  db: PlannerDatabase,
  id: string,
  name: unknown,
): Promise<{ ok: true; hmi: HmiSummary } | HmiInvalidName | HmiNotFound> {
  const normalized = normalizeHmiName(name);
  if (normalized === null) return { ok: false, kind: "invalid-name" };
  if (!isHmiId(id)) return { ok: false, kind: "not-found", id };
  const updated = await db
    .update(hmiDevices)
    .set({ name: normalized })
    .where(eq(hmiDevices.id, id))
    .returning({ id: hmiDevices.id });
  if (updated.length === 0) return { ok: false, kind: "not-found", id };
  return { ok: true, hmi: (await getHmi(db, id))! };
}

/**
 * Revokes an HMI: its token is refused from now on. Revoking a revoked HMI
 * keeps the original `revokedAt`.
 */
export async function revokeHmi(
  db: PlannerDatabase,
  id: string,
  now: Date,
): Promise<{ ok: true; hmi: HmiSummary } | HmiNotFound> {
  if (!isHmiId(id)) return { ok: false, kind: "not-found", id };
  await db
    .update(hmiDevices)
    .set({ revokedAt: now })
    .where(and(eq(hmiDevices.id, id), isNull(hmiDevices.revokedAt)));
  const hmi = await getHmi(db, id);
  return hmi ? { ok: true, hmi } : { ok: false, kind: "not-found", id };
}

/**
 * Replaces the HMI's token; the old one stops working at once. Also lifts a
 * revocation: generating a token is how an admin re-admits an HMI.
 */
export async function regenerateHmiToken(
  db: PlannerDatabase,
  id: string,
): Promise<HmiWithToken | HmiNotFound> {
  if (!isHmiId(id)) return { ok: false, kind: "not-found", id };
  const token = generateSessionToken();
  const updated = await db
    .update(hmiDevices)
    .set({ tokenHash: hashSessionToken(token), revokedAt: null })
    .where(eq(hmiDevices.id, id))
    .returning({ id: hmiDevices.id });
  if (updated.length === 0) return { ok: false, kind: "not-found", id };
  return { ok: true, hmi: (await getHmi(db, id))!, token };
}

/** The non-revoked HMI whose token hashes to `tokenHash`, or `null`. */
export async function findActiveHmiByTokenHash(
  db: PlannerDatabase,
  tokenHash: string,
): Promise<AuthenticatedHmi | null> {
  const [row] = await db
    .select({
      id: hmiDevices.id,
      name: hmiDevices.name,
      tokenHash: hmiDevices.tokenHash,
      lastSeenAt: hmiDevices.lastSeenAt,
    })
    .from(hmiDevices)
    .where(
      and(eq(hmiDevices.tokenHash, tokenHash), isNull(hmiDevices.revokedAt)),
    )
    .limit(1);
  return row ?? null;
}

/** Whether `last_seen_at` is old enough to be written again. */
export function lastSeenIsStale(lastSeenAt: Date | null, now: Date): boolean {
  return (
    lastSeenAt === null ||
    now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS
  );
}

/**
 * Records an authenticated request. Writes only when the stored value is
 * older than {@link LAST_SEEN_WRITE_INTERVAL_MS}; the condition is repeated
 * in SQL so concurrent requests write at most once. Returns whether it wrote.
 */
export async function recordHmiSeen(
  db: PlannerDatabase,
  hmi: Pick<AuthenticatedHmi, "id" | "lastSeenAt">,
  now: Date,
): Promise<boolean> {
  if (!lastSeenIsStale(hmi.lastSeenAt, now)) return false;
  const threshold = new Date(now.getTime() - LAST_SEEN_WRITE_INTERVAL_MS);
  const updated = await db
    .update(hmiDevices)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(hmiDevices.id, hmi.id),
        or(
          isNull(hmiDevices.lastSeenAt),
          lte(hmiDevices.lastSeenAt, threshold),
        ),
      ),
    )
    .returning({ id: hmiDevices.id });
  return updated.length > 0;
}

export type HmiStatusReport = {
  activeFinalId: string | null;
  activeSha256: string | null;
  appVersion: string | null;
};

/**
 * Stores what the HMI reports as running (`POST /api/hmi/v1/status`).
 * `last_seen_at` is left to the throttled {@link recordHmiSeen}. The active Fertigstand is kept only when the planner knows
 * it and `activeSha256` matches its bytes; otherwise the HMI runs something
 * the planner cannot vouch for and `active_final_id` becomes `null`.
 * Returns the stored active Fertigstand id.
 */
export async function reportHmiStatus(
  db: PlannerDatabase,
  hmiId: string,
  report: HmiStatusReport,
): Promise<{ activeFinalId: string | null }> {
  let activeFinalId: string | null = null;
  if (report.activeFinalId !== null) {
    const final = await getFinal(db, report.activeFinalId);
    if (final && final.sha256 === report.activeSha256) activeFinalId = final.id;
  }
  await db
    .update(hmiDevices)
    .set({
      activeFinalId,
      appVersion: normalizeHmiAppVersion(report.appVersion),
    })
    .where(and(eq(hmiDevices.id, hmiId), isNull(hmiDevices.revokedAt)));
  return { activeFinalId };
}
