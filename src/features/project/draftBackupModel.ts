import { safeMigrateProject } from "~/domain/project/projectMigration";
import type { Project } from "~/domain/project/projectSchema";
import type { RecordVersion } from "~/lib/plannerRecordStorage";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import type { StorageMode } from "~/lib/storageMode";

import type { LoadedProjectVersion } from "./projectConflictModel";

/**
 * Local backups of unsaved server drafts (ADR 0002, issue #35). No React:
 * the browser storage is passed in so tests use an in-memory fake.
 *
 * A backup is not a sync: it never writes to the server by itself. It keeps a
 * draft the server did not accept (unreachable server, expired session) or an
 * open editor draft, so it survives a reload or a re-login. Each backup
 * belongs to one server, one user and one project, and to the draft that
 * wrote it: its `token`. Only the holder of that token (the window's draft
 * lease) may replace or remove it, so a draft never overwrites or deletes
 * another draft's backup. It is removed once exactly that draft is saved (or
 * settled in the conflict view), when the user confirms discarding it, and on
 * a confirmed sign-out. An expired session keeps it.
 */

/** Whose drafts: one server (its origin) and one signed-in user. */
export type DraftBackupScope = { server: string; userId: string };

export type DraftBackup = {
  projectId: string;
  project: Project;
  /**
   * The stored version the draft is based on; `null` when the plan was not
   * stored yet. A restore saves against exactly this version, so a plan that
   * changed on the server meanwhile opens the conflict view (ADR 0006).
   */
  baseVersion: RecordVersion | null;
  /** Epoch milliseconds of the last backup write. */
  savedAt: number;
  /**
   * The draft that wrote it. Records from before tokens existed read as
   * `legacy:<savedAt>`, a token no lease holds: they count as foreign.
   */
  token: string;
  /** Bumped on every write of the same draft. */
  rev: number;
};

/** Who may write a backup: the token of the draft and its next revision. */
export type DraftBackupWriter = { token: string; rev: number };

export type DraftBackupWriteResult =
  | "written"
  /** Another draft's backup sits in that slot; it was left untouched. */
  | "foreign"
  /** The browser refused (storage full, blocked): the draft is memory-only. */
  | "failed";

/** The part of the Web Storage API the backups use. */
export type DraftBackupStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

const KEY_PREFIX = "palette.draftBackup.v1";

function scopePrefix(scope: DraftBackupScope): string {
  return `${KEY_PREFIX}:${encodeURIComponent(scope.server)}:${encodeURIComponent(scope.userId)}:`;
}

function backupKey(scope: DraftBackupScope, projectId: string): string {
  return `${scopePrefix(scope)}${encodeURIComponent(projectId)}`;
}

/**
 * The scope drafts are backed up in: server mode with a known user only.
 * `user` is the draft's author, so a draft lost to an expired session is
 * still backed up for the user who made it.
 */
export function draftBackupScope(
  mode: StorageMode,
  server: string,
  userId: string | null,
): DraftBackupScope | null {
  if (mode !== "server" || !userId || !server) return null;
  return { server, userId };
}

/** The version a draft of `projectId` is based on, from the loaded plan. */
export function draftBaseVersion(
  loaded: LoadedProjectVersion | null,
  projectId: string,
): RecordVersion | null {
  return loaded?.projectId === projectId ? loaded.version : null;
}

/** Token and revision of a stored record, read without validating the plan. */
function storedIdentity(raw: string): { token: string; rev: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { token, rev, savedAt } = value as Record<string, unknown>;
  if (typeof token === "string") {
    return { token, rev: typeof rev === "number" ? rev : 0 };
  }
  return typeof savedAt === "number"
    ? { token: `legacy:${savedAt}`, rev: 0 }
    : null;
}

/**
 * Writes (or replaces) the backup of `project` for the draft `writer`. A slot
 * held by another draft — or holding anything unreadable — is never
 * overwritten.
 */
export function writeDraftBackup(
  storage: DraftBackupStorage | null,
  scope: DraftBackupScope,
  project: Project,
  baseVersion: RecordVersion | null,
  now: number,
  writer: DraftBackupWriter,
): DraftBackupWriteResult {
  if (!storage) return "failed";
  const key = backupKey(scope, project.id);
  const backup: DraftBackup = {
    projectId: project.id,
    project,
    baseVersion,
    savedAt: now,
    token: writer.token,
    rev: writer.rev,
  };
  try {
    const existing = storage.getItem(key);
    if (existing !== null && storedIdentity(existing)?.token !== writer.token) {
      return "foreign";
    }
    storage.setItem(key, JSON.stringify(backup));
    return "written";
  } catch {
    return "failed";
  }
}

function parseBackup(raw: string | null): DraftBackup | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { projectId, project, baseVersion, savedAt, token, rev } =
    value as Record<string, unknown>;
  if (typeof projectId !== "string" || typeof savedAt !== "number") {
    return null;
  }
  if (
    baseVersion !== null &&
    !(typeof baseVersion === "number" && Number.isInteger(baseVersion))
  ) {
    return null;
  }
  const migrated = safeMigrateProject(project);
  if (!migrated.success || migrated.project.id !== projectId) return null;
  return {
    projectId,
    project: migrated.project,
    baseVersion,
    savedAt,
    token: typeof token === "string" ? token : `legacy:${savedAt}`,
    rev: typeof rev === "number" ? rev : 0,
  };
}

/** Every readable backup of the scope, newest first. */
export function readDraftBackups(
  storage: DraftBackupStorage | null,
  scope: DraftBackupScope,
): DraftBackup[] {
  if (!storage) return [];
  const prefix = scopePrefix(scope);
  const backups: DraftBackup[] = [];
  try {
    for (const key of scopeKeys(storage, prefix)) {
      // An unreadable entry stays where it is: it is not ours to delete.
      const backup = parseBackup(storage.getItem(key));
      if (backup) backups.push(backup);
    }
  } catch {
    return [];
  }
  return backups.sort(
    (left, right) =>
      right.savedAt - left.savedAt ||
      left.projectId.localeCompare(right.projectId),
  );
}

function scopeKeys(storage: DraftBackupStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Removes the backup of one project if it still belongs to the draft `token`
 * (and, given `rev`, still holds exactly that revision): a saved, settled or
 * discarded draft never removes a newer or another draft's backup.
 */
export function removeDraftBackup(
  storage: DraftBackupStorage | null,
  scope: DraftBackupScope,
  projectId: string,
  token: string,
  rev?: number,
): boolean {
  if (!storage) return false;
  const key = backupKey(scope, projectId);
  try {
    const existing = storage.getItem(key);
    const identity = existing === null ? null : storedIdentity(existing);
    if (
      !identity ||
      identity.token !== token ||
      (rev !== undefined && identity.rev !== rev)
    ) {
      return false;
    }
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the scope user's backups on that server whose token is in `tokens`
 * (the drafts a confirmed sign-out warning covered). Other users, other
 * servers and backups written after the warning keep theirs. Returns the
 * count.
 */
export function removeAllDraftBackups(
  storage: DraftBackupStorage | null,
  scope: DraftBackupScope,
  tokens: ReadonlySet<string>,
): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    for (const key of scopeKeys(storage, scopePrefix(scope))) {
      const existing = storage.getItem(key);
      const identity = existing === null ? null : storedIdentity(existing);
      if (identity && tokens.has(identity.token)) {
        storage.removeItem(key);
        removed += 1;
      }
    }
  } catch {
    return removed;
  }
  return removed;
}

/**
 * What the live backup store means for the UI, derived on every change
 * rather than snapshotted at sign-in, so a backup written during the session
 * (a failed `.rob` import, a failed save) counts at once.
 */
export type DraftBackupStatus = {
  /**
   * Backups to offer for restore: only while signed in, and not the backup of
   * the draft still open (and unsaved) in this window — that one is simply
   * saved again. A foreign backup of the same plan stays on offer.
   */
  restorable: DraftBackup[];
  /**
   * Unsaved work an explicit sign-out would discard: an open unsaved draft or
   * any backup of this user on this server.
   */
  hasPendingDrafts: boolean;
};

export function draftBackupStatus({
  backups,
  openDraftToken,
  draftOpen,
  signedIn,
}: {
  /** The live backups of the current (or last signed-in) user. */
  backups: readonly DraftBackup[];
  /** The token of the draft lease this window holds. */
  openDraftToken: string | null;
  /** Some surface holds unsaved changes in this window. */
  draftOpen: boolean;
  signedIn: boolean;
}): DraftBackupStatus {
  const mirrored = draftOpen ? openDraftToken : null;
  return {
    restorable: signedIn
      ? backups.filter(({ token }) => token !== mirrored)
      : [],
    hasPendingDrafts: draftOpen || backups.length > 0,
  };
}

/** Why a save did not reach the server; the draft stays in the browser. */
export type SaveFailure = "network" | "session";

/**
 * A failed save that leaves a pending draft: no answer from the server, or
 * the session is gone. Anything else (validation, permissions, conflicts) is
 * not pending — retrying would fail the same way.
 */
export function saveFailureReason(cause: unknown): SaveFailure | null {
  if (!(cause instanceof ServerStorageError)) return null;
  if (cause.kind === "network") return "network";
  if (cause.kind === "unauthenticated") return "session";
  return null;
}
