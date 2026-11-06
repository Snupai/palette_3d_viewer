import { safeMigrateProject } from "~/domain/project/projectMigration";
import type { Project } from "~/domain/project/projectSchema";
import type { SessionUser } from "~/features/auth/plannerAccessModel";
import { planContent, stableJson, type ConflictChoice } from "~/features/project/projectConflictModel";
import type { Translate } from "~/i18n";
import type { BrowserLocalPlannerStorage, BrowserPlanSyncLink } from "~/lib/browserPlanStorage";
import { PROJECTS_STORE_NAME, PROJECT_RESOURCES_STORE_NAME } from "~/lib/plannerDatabase";
import { RecordVersionConflictError } from "~/lib/plannerRecordStorage";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import {
  contentHash, mayReplaceProject, readLocalImportInventory, projectEntryKey,
  projectImportCopyId, resolveProjectImportConflict,
  type CatalogPlanEntry, type LocalImportTarget, type LocalUnreadableEntry,
  type ServerProjectState, type ServerRead,
} from "./localImportModel";

/** Browser-only inventory; never pass the legacy local-mode source here. */
export type BrowserSyncSource = Pick<BrowserLocalPlannerStorage,
  "list" | "getVersioned" | "getMetadata" | "confirmSync"
>;
export type BrowserSyncContext = { server: string; user: SessionUser };
export type BrowserSyncStatus = "new" | "unchanged" | "local-changed" | "server-changed" |
  "conflict" | "server-deleted" | "other-owner" | "server-unreadable";
export type BrowserSyncEntry = {
  key: string;
  project: Project;
  localVersion: number;
  link: BrowserPlanSyncLink | null;
  status: BrowserSyncStatus;
  server: ServerProjectState | null;
  canReplace: boolean;
  selectable: boolean;
  pending: boolean;
};
export type BrowserSyncPlan = {
  projects: BrowserSyncEntry[];
  /** Informational only: browser synchronization never publishes catalog entries. */
  catalog: CatalogPlanEntry[];
  unreadable: LocalUnreadableEntry[];
};

/** Identity and creation timestamps change when publishing as a separate copy. */
export function browserSyncContentHash(project: Project): string {
  return contentHash(planContent({ ...project, id: "", createdAt: 0 }));
}
function copyScope(context: BrowserSyncContext): string {
  return stableJson([context.server, context.user.id]);
}
function isPending(status: BrowserSyncStatus): boolean {
  return status === "conflict" || status === "server-deleted" || status === "other-owner";
}

/** Read-only three-way comparison against the link for this server AND account. */
async function classify(
  target: LocalImportTarget,
  entry: Pick<BrowserSyncEntry, "key" | "project" | "localVersion" | "link">,
  context: BrowserSyncContext,
): Promise<BrowserSyncEntry> {
  const read = await target.readProject(entry.link?.serverId ?? entry.project.id);
  const server = read.kind === "found" ? read.state : null;
  const canReplace = server !== null && mayReplaceProject(context.user, server.createdBy);
  let status: BrowserSyncStatus;
  if (read.kind === "unreadable") status = "server-unreadable";
  else if (!server) status = entry.link ? "server-deleted" : "new";
  else if (!canReplace) status = "other-owner";
  else {
    const localHash = browserSyncContentHash(entry.project);
    const serverHash = browserSyncContentHash(server.project);
    if (localHash === serverHash) status = "unchanged";
    else if (!entry.link) status = "conflict";
    else {
      const localChanged = localHash !== entry.link.syncedContentHash;
      const serverChanged = server.version !== entry.link.syncedVersion || serverHash !== entry.link.syncedContentHash;
      status = localChanged ? (serverChanged ? "conflict" : "local-changed") : "server-changed";
    }
  }
  return { ...entry, status, server, canReplace, selectable: status !== "server-unreadable", pending: isPending(status) };
}

export async function planBrowserSync(
  source: BrowserSyncSource, target: LocalImportTarget, context: BrowserSyncContext,
): Promise<BrowserSyncPlan> {
  const projects: BrowserSyncEntry[] = [];
  const unreadable: LocalUnreadableEntry[] = [];
  for (const row of await source.list(PROJECTS_STORE_NAME)) {
    const parsed = safeMigrateProject(row);
    if (!parsed.success) {
      unreadable.push({ store: PROJECTS_STORE_NAME, recordId: null });
      continue;
    }
    // Capture content and version together, so cleanup cannot remove a newer edit.
    const current = await source.getVersioned(PROJECTS_STORE_NAME, parsed.project.id);
    if (!current) continue;
    const fresh = safeMigrateProject(current.record);
    if (!fresh.success) {
      unreadable.push({ store: PROJECTS_STORE_NAME, recordId: parsed.project.id });
      continue;
    }
    const metadata = await source.getMetadata(fresh.project.id);
    const link = metadata?.links.find(({server, userId}) => server === context.server && userId === context.user.id) ?? null;
    projects.push(await classify(target, {
      key: projectEntryKey(fresh.project.id), project: fresh.project, localVersion: current.version, link,
    }, context));
  }
  // Catalog data is excluded from the browser workflow even for administrators.
  // Preserve the established admin-only classification for stray legacy data.
  const catalogRows = await source.list(PROJECT_RESOURCES_STORE_NAME);
  const inventory = await readLocalImportInventory({ list: async (store) => store === PROJECT_RESOURCES_STORE_NAME ? catalogRows : [] });
  const catalog: CatalogPlanEntry[] = [];
  for (const local of inventory.catalog) catalog.push({ key: local.key, local, status: "admin-only", server: null, canReplace: false });
  return { projects, catalog, unreadable: [...unreadable, ...inventory.unreadable] };
}

export type BrowserSyncAbortReason = "unauthenticated" | "network";
export function browserSyncAbortReason(error: unknown): BrowserSyncAbortReason | null {
  if (error instanceof ServerStorageError && (error.kind === "network" || error.kind === "unauthenticated")) return error.kind;
  return error instanceof TypeError ? "network" : null;
}
export function browserSyncErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ServerStorageError && error.status === 413 && error.errorCode === "record_too_large") return t("localImport.error.recordTooLarge");
  return error instanceof Error ? error.message : t("localImport.error.unknown");
}
export type BrowserSyncOutcome = {
  key: string;
  kind: "synced" | "kept-local" | "failed" | "conflict" | "refreshed";
  entry?: BrowserSyncEntry;
  error?: unknown;
  /** A newer local edit (or deliberate deletion) won the cleanup race. */
  localRetained?: boolean;
};
export type BrowserSyncOptions = {
  publicConfirmed: boolean;
  isSessionLive: () => boolean;
  now: number;
  onProgress?: (outcome: BrowserSyncOutcome) => void;
};
export type BrowserSyncRun = {
  outcomes: BrowserSyncOutcome[];
  conflicts: BrowserSyncEntry[];
  aborted: BrowserSyncAbortReason | null;
};
function sessionError(): ServerStorageError {
  return new ServerStorageError("unauthenticated", "put", PROJECTS_STORE_NAME, 401);
}
async function retain(
  source: BrowserSyncSource, entry: BrowserSyncEntry, state: ServerProjectState,
  context: BrowserSyncContext, now: number,
): Promise<BrowserSyncOutcome> {
  const result = await source.confirmSync(entry.project.id, {
    server: context.server, userId: context.user.id, serverId: state.project.id,
    syncedVersion: state.version, syncedContentHash: browserSyncContentHash(state.project), syncedAt: now,
  }, entry.localVersion);
  return { key: entry.key, kind: "synced", localRetained: result === "retained" };
}
function conflictOutcome(entry: BrowserSyncEntry, refreshed = false): BrowserSyncOutcome {
  return { key: entry.key, kind: refreshed ? "refreshed" : "conflict", entry };
}
async function refresh(target: LocalImportTarget, entry: BrowserSyncEntry, context: BrowserSyncContext): Promise<BrowserSyncOutcome> {
  return conflictOutcome(await classify(target, entry, context), true);
}

/** No consent means no writes, including retention. Postponing likewise leaves the durable source untouched. */
export async function runBrowserSync(
  source: BrowserSyncSource, target: LocalImportTarget, plan: BrowserSyncPlan,
  selection: ReadonlySet<string>, context: BrowserSyncContext, options: BrowserSyncOptions,
): Promise<BrowserSyncRun> {
  const run: BrowserSyncRun = { outcomes: [], conflicts: [], aborted: null };
  for (const entry of plan.projects) {
    if (!selection.has(entry.key)) continue;
    let outcome: BrowserSyncOutcome;
    try {
      if (!options.publicConfirmed || !entry.selectable) outcome = { key: entry.key, kind: "kept-local" };
      else if (!options.isSessionLive()) throw sessionError();
      else if (entry.pending) outcome = conflictOutcome(entry);
      else if (entry.status === "new" || entry.status === "local-changed") {
        const project = entry.server ? { ...entry.project, id: entry.server.project.id, createdAt: entry.server.project.createdAt } : entry.project;
        try {
          const version = entry.server ? await target.replaceProject(project, entry.server.version) : await target.createProject(project);
          outcome = await retain(source, entry, {project, version, createdBy: context.user.id}, context, options.now);
        } catch (error) {
          if (!(error instanceof RecordVersionConflictError)) throw error;
          // A retry may discover that the previous insert succeeded despite a lost response.
          const current = await classify(target, entry, context);
          outcome = current.status === "unchanged" && current.server ? await retain(source, entry, current.server, context, options.now) : conflictOutcome(current, true);
        }
      } else {
        // Re-read before discarding local content; a stale comparison is never confirmation.
        const current = await target.readProject(entry.server!.project.id);
        outcome = current.kind === "found" && current.state.version === entry.server!.version
          ? await retain(source, entry, current.state, context, options.now)
          : await refresh(target, entry, context);
      }
    } catch (error) {
      outcome = { key: entry.key, kind: "failed", error };
      run.aborted = browserSyncAbortReason(error);
    }
    run.outcomes.push(outcome);
    if (outcome.entry && (outcome.kind === "conflict" || outcome.kind === "refreshed")) run.conflicts.push(outcome.entry);
    options.onProgress?.(outcome);
    if (run.aborted) break;
  }
  return run;
}

/** Whole-plan choices reuse the import's insert-only / version-checked conflict resolver. */
export async function resolveBrowserSyncConflict(
  source: BrowserSyncSource, target: LocalImportTarget, entry: BrowserSyncEntry,
  choice: ConflictChoice, context: BrowserSyncContext, options: BrowserSyncOptions,
): Promise<BrowserSyncOutcome> {
  let outcome: BrowserSyncOutcome;
  try {
    if (!options.publicConfirmed) return { key: entry.key, kind: "kept-local" };
    if (!options.isSessionLive()) throw sessionError();
    if (choice === "keep-server") {
      const current = await target.readProject(entry.link?.serverId ?? entry.project.id);
      if (current.kind === "missing" && entry.status === "server-deleted" && entry.link) {
        // Accept the known deletion without recreating anything; preserve the tombstone link.
        const result = await source.confirmSync(entry.project.id, entry.link, entry.localVersion);
        outcome = { key: entry.key, kind: "synced", localRetained: result === "retained" };
      } else if (current.kind === "found" && current.state.version === entry.server?.version) outcome = await retain(source, entry, current.state, context, options.now);
      else outcome = await refresh(target, entry, context);
    } else if (choice === "keep-mine" && (!entry.canReplace || !entry.server)) {
      outcome = { key: entry.key, kind: "kept-local" };
    } else {
      const local = choice === "keep-mine" && entry.server ? { ...entry.project, id: entry.server.project.id, createdAt: entry.server.project.createdAt } : entry.project;
      const resolved = await resolveProjectImportConflict(target, {
        key: entry.key, local, server: entry.server, canReplace: entry.canReplace, refreshed: false,
      }, choice, { user: context.user, now: options.now, copyUserId: copyScope(context) });
      if (resolved.kind === "refreshed") outcome = await refresh(target, entry, context);
      else if (resolved.kind === "forbidden") outcome = { key: entry.key, kind: "kept-local" };
      else if (resolved.kind === "replaced" || resolved.kind === "created") {
        outcome = await retain(source, entry, {project: local, version: resolved.version, createdBy: entry.server?.createdBy ?? context.user.id}, context, options.now);
      } else {
        const id = choice === "save-copy" ? projectImportCopyId(entry.project, copyScope(context)) : local.id;
        const read: ServerRead<ServerProjectState> = await target.readProject(id);
        if (read.kind !== "found" || (choice === "save-copy" && (read.state.createdBy !== context.user.id || browserSyncContentHash(read.state.project) !== browserSyncContentHash(entry.project)))) outcome = await refresh(target, entry, context);
        else outcome = await retain(source, entry, read.state, context, options.now);
      }
    }
  } catch (error) { outcome = { key: entry.key, kind: "failed", error }; }
  options.onProgress?.(outcome);
  return outcome;
}
