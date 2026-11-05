import { duplicateProjectModel } from "~/domain/project/projectFactory";
import { safeMigrateProject } from "~/domain/project/projectMigration";
import {
  projectResourceSchema,
  safeParseProjectResource,
  type ProjectResource,
} from "~/domain/project/projectResource";
import type { Project } from "~/domain/project/projectSchema";
import type { SessionUser } from "~/features/auth/plannerAccessModel";
import {
  planContent,
  samePlanContent,
  stableJson,
  type ConflictChoice,
} from "~/features/project/projectConflictModel";
import { normalizeStoredPallet } from "~/lib/palletPersistence";
import {
  LEGACY_MIGRATIONS_STORE_NAME,
  PALLETS_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import {
  recordId,
  RecordVersionConflictError,
  type PlannerRecordStorage,
  type RecordVersion,
} from "~/lib/plannerRecordStorage";
import { savedPalletToProject } from "~/lib/projectAdapters";
import type { ProjectRepository } from "~/lib/projectRepository";

/**
 * Explicit import of this browser's local plans into the server (#37,
 * ADR 0007). No React: the dialog drives these steps.
 *
 * 1. {@link readLocalImportInventory} reads the local stores (IndexedDB plans,
 *    Werkskatalog, legacy saved pallets) through `list` only — the local
 *    originals are never written, migrated or deleted.
 * 2. {@link planLocalImport} compares every local entry with the server.
 * 3. {@link runLocalImport} creates the selected new entries and hands
 *    differing ones to the conflict view.
 * 4. {@link resolveProjectImportConflict} / {@link resolveCatalogImportConflict}
 *    carry out one choice per conflict.
 *
 * Retries are idempotent: new entries are created with `expectedVersion: null`
 * (insert only, the server records the session user as creator), entries the
 * server already holds with the same content are skipped, and a copy gets an
 * id derived from the local id and content, so importing the same local state
 * as a copy twice finds the first copy instead of creating a second one.
 * Replacing an existing server entry needs write permission and is checked
 * atomically against the server version the user saw; an update never changes
 * the entry's creator. Werkskatalog entries are imported only by admins.
 */

export type LocalProjectSource = "project" | "legacy-pallet";

export type LocalProjectEntry = {
  /** Unique within an inventory: `project:<id>`. */
  key: string;
  source: LocalProjectSource;
  project: Project;
};

export type LocalCatalogEntry = {
  /** Unique within an inventory: `catalog:<id>`. */
  key: string;
  resource: ProjectResource;
};

/** A local record that cannot be imported because it does not parse. */
export type LocalUnreadableEntry = {
  store: PlannerStoreName;
  recordId: string | null;
};

export type LocalImportInventory = {
  projects: LocalProjectEntry[];
  catalog: LocalCatalogEntry[];
  unreadable: LocalUnreadableEntry[];
};

/** Read access to the local stores; the import never writes them. */
export type LocalImportSource = Pick<PlannerRecordStorage, "list">;

export function projectEntryKey(id: string): string {
  return `project:${id}`;
}

export function catalogEntryKey(id: string): string {
  return `catalog:${id}`;
}

export function localInventorySize(inventory: LocalImportInventory): number {
  return inventory.projects.length + inventory.catalog.length;
}

function byUpdatedAtDesc<T extends { id: string; updatedAt: number }>(
  left: T,
  right: T,
): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function parseLegacyList(json: string | null | undefined): {
  rows: unknown[];
  invalid: boolean;
} {
  if (!json) return { rows: [], invalid: false };
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? { rows: parsed as unknown[], invalid: false }
      : { rows: [], invalid: true };
  } catch {
    return { rows: [], invalid: true };
  }
}

/**
 * Everything this browser holds locally that could be imported. Saved
 * pallets (IndexedDB `pallets` and the older `saved_pallets_v1` list) count
 * only while local mode has not turned them into a project yet: a migration
 * marker or a local project with the same id means the local project is the
 * current state (or was deliberately deleted).
 */
export async function readLocalImportInventory(
  source: LocalImportSource,
  legacyLocalStorageJson?: string | null,
): Promise<LocalImportInventory> {
  const [projectRows, catalogRows, palletRows, markerRows] = await Promise.all([
    source.list(PROJECTS_STORE_NAME),
    source.list(PROJECT_RESOURCES_STORE_NAME),
    source.list(PALLETS_STORE_NAME),
    source.list(LEGACY_MIGRATIONS_STORE_NAME),
  ]);
  const unreadable: LocalUnreadableEntry[] = [];

  const projects: Project[] = [];
  for (const row of projectRows) {
    const result = safeMigrateProject(row);
    if (result.success) projects.push(result.project);
    else
      unreadable.push({ store: PROJECTS_STORE_NAME, recordId: recordId(row) });
  }
  const projectIds = new Set(projects.map(({ id }) => id));

  const migratedPallets = new Set(
    markerRows.map(recordId).filter((id): id is string => id !== null),
  );
  const legacy = parseLegacyList(legacyLocalStorageJson);
  if (legacy.invalid) {
    unreadable.push({ store: PALLETS_STORE_NAME, recordId: null });
  }
  const legacyProjects: Project[] = [];
  for (const row of [...palletRows, ...legacy.rows]) {
    const normalized = normalizeStoredPallet(row);
    if ("issue" in normalized) {
      unreadable.push({
        store: PALLETS_STORE_NAME,
        recordId: normalized.issue.id,
      });
      continue;
    }
    const { pallet } = normalized;
    if (migratedPallets.has(pallet.id)) continue;
    let project: Project;
    try {
      project = savedPalletToProject(pallet);
    } catch {
      unreadable.push({ store: PALLETS_STORE_NAME, recordId: pallet.id });
      continue;
    }
    // The same pallet can sit in both legacy stores; the first one wins.
    if (projectIds.has(project.id)) continue;
    projectIds.add(project.id);
    legacyProjects.push(project);
  }

  const catalog: ProjectResource[] = [];
  for (const row of catalogRows) {
    const parsed = safeParseProjectResource(row);
    if (parsed.success) catalog.push(parsed.resource);
    else {
      unreadable.push({
        store: PROJECT_RESOURCES_STORE_NAME,
        recordId: recordId(row),
      });
    }
  }

  return {
    projects: [
      ...projects.map((project) => ({ project, source: "project" as const })),
      ...legacyProjects.map((project) => ({
        project,
        source: "legacy-pallet" as const,
      })),
    ]
      .sort((left, right) => byUpdatedAtDesc(left.project, right.project))
      .map(({ project, source }) => ({
        key: projectEntryKey(project.id),
        source,
        project,
      })),
    catalog: catalog.sort(byUpdatedAtDesc).map((resource) => ({
      key: catalogEntryKey(resource.id),
      resource,
    })),
    unreadable,
  };
}

/** Werkskatalog content without the timestamp every save rewrites. */
function catalogContent(resource: ProjectResource): string {
  return stableJson({ ...resource, updatedAt: undefined });
}

function sameCatalogContent(
  left: ProjectResource,
  right: ProjectResource,
): boolean {
  return catalogContent(left) === catalogContent(right);
}

/** FNV-1a over UTF-16 code units, two seeds → 16 hex digits. */
function contentHash(text: string): string {
  const fnv = (seed: number) => {
    let hash = seed;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x2f5c1b37)}`;
}

/** Longest part of the original id kept in a copy id (ids are ≤ 200). */
const COPY_ID_PREFIX_LENGTH = 160;

/**
 * Id of the copy of one local state: the same local id and content always
 * yield the same copy id, so a repeated "import as copy" finds the existing
 * copy instead of creating a duplicate.
 */
export function importCopyId(id: string, content: string): string {
  return `${id.slice(0, COPY_ID_PREFIX_LENGTH)}~import-${contentHash(content)}`;
}

export function projectImportCopyId(project: Project): string {
  return importCopyId(project.id, planContent(project));
}

export function catalogImportCopyId(resource: ProjectResource): string {
  return importCopyId(resource.id, catalogContent(resource));
}

/** Current server state of a plan, with its creator as reported. */
export type ServerProjectState = {
  project: Project;
  version: RecordVersion;
  /** User id; `null` when none is recorded, `undefined` when unknown. */
  createdBy: string | null | undefined;
};

export type ServerCatalogState = {
  resource: ProjectResource;
  version: RecordVersion;
};

export type ServerRead<T> =
  | { kind: "missing" }
  | { kind: "found"; state: T }
  /** A record exists but does not parse; the import leaves it alone. */
  | { kind: "unreadable" };

/** Server operations the import needs; see {@link createLocalImportTarget}. */
export type LocalImportTarget = {
  readProject(id: string): Promise<ServerRead<ServerProjectState>>;
  readCatalog(id: string): Promise<ServerRead<ServerCatalogState>>;
  /** Insert only; rejects with `RecordVersionConflictError` if the id exists. */
  createProject(project: Project): Promise<RecordVersion>;
  /** Update at exactly `expectedVersion`; the creator stays unchanged. */
  replaceProject(
    project: Project,
    expectedVersion: RecordVersion,
  ): Promise<RecordVersion>;
  createCatalog(resource: ProjectResource): Promise<RecordVersion>;
  replaceCatalog(
    resource: ProjectResource,
    expectedVersion: RecordVersion,
  ): Promise<RecordVersion>;
};

/**
 * The import target backed by the server-mode repository. `creatorOf`
 * reports the creator the server sent with the last read of a record
 * (`ServerPlannerRecordStorage.createdBy`).
 */
export function createLocalImportTarget(
  repository: Pick<
    ProjectRepository,
    | "getProject"
    | "saveProjectVersioned"
    | "getResource"
    | "saveResourceVersioned"
  >,
  creatorOf: (store: PlannerStoreName, id: string) => string | null | undefined,
): LocalImportTarget {
  return {
    async readProject(id) {
      const result = await repository.getProject(id);
      if (result.project && typeof result.version === "number") {
        return {
          kind: "found",
          state: {
            project: result.project,
            version: result.version,
            createdBy: creatorOf(PROJECTS_STORE_NAME, id),
          },
        };
      }
      return result.diagnostics.length > 0
        ? { kind: "unreadable" }
        : { kind: "missing" };
    },
    async readCatalog(id) {
      const result = await repository.getResource(id);
      if (result.resource && typeof result.version === "number") {
        return {
          kind: "found",
          state: { resource: result.resource, version: result.version },
        };
      }
      return result.diagnostics.length > 0
        ? { kind: "unreadable" }
        : { kind: "missing" };
    },
    async createProject(project) {
      return (
        await repository.saveProjectVersioned(project, {
          expectedVersion: null,
        })
      ).version;
    },
    async replaceProject(project, expectedVersion) {
      return (
        await repository.saveProjectVersioned(project, { expectedVersion })
      ).version;
    },
    async createCatalog(resource) {
      return (
        await repository.saveResourceVersioned(resource, {
          expectedVersion: null,
        })
      ).version;
    },
    async replaceCatalog(resource, expectedVersion) {
      return (
        await repository.saveResourceVersioned(resource, { expectedVersion })
      ).version;
    },
  };
}

export type ImportStatus =
  /** Not on the server: importing creates it with the user as creator. */
  | "new"
  /** The server already holds the same content. */
  | "unchanged"
  /** This local state was already imported as a copy. */
  | "copied"
  /** The server holds different content under the same id. */
  | "differs"
  /** The server record under this id does not parse. */
  | "server-unreadable"
  /** A Werkskatalog entry the signed-in user may not import. */
  | "admin-only";

export type ProjectPlanEntry = {
  key: string;
  local: LocalProjectEntry;
  status: Exclude<ImportStatus, "admin-only">;
  server: ServerProjectState | null;
  /** Whether "replace the server state" is offered for a difference. */
  canReplace: boolean;
};

export type CatalogPlanEntry = {
  key: string;
  local: LocalCatalogEntry;
  status: ImportStatus;
  server: ServerCatalogState | null;
  canReplace: boolean;
};

export type LocalImportPlan = {
  projects: ProjectPlanEntry[];
  catalog: CatalogPlanEntry[];
  unreadable: LocalUnreadableEntry[];
};

export function isAdmin(user: SessionUser): boolean {
  return user.role === "admin";
}

/** Same rule as the records API: the creator or an admin (ADR 0003). */
export function mayReplaceProject(
  user: SessionUser,
  createdBy: string | null | undefined,
): boolean {
  return isAdmin(user) || (createdBy !== undefined && createdBy === user.id);
}

async function classifyProject(
  target: LocalImportTarget,
  project: Project,
  user: SessionUser,
): Promise<Pick<ProjectPlanEntry, "status" | "server" | "canReplace">> {
  const read = await target.readProject(project.id);
  if (read.kind === "unreadable") {
    return { status: "server-unreadable", server: null, canReplace: false };
  }
  if (read.kind === "found" && samePlanContent(project, read.state.project)) {
    return { status: "unchanged", server: read.state, canReplace: false };
  }
  const copy = await target.readProject(projectImportCopyId(project));
  const server = read.kind === "found" ? read.state : null;
  if (copy.kind !== "missing") {
    return { status: "copied", server, canReplace: false };
  }
  if (!server) return { status: "new", server: null, canReplace: false };
  return {
    status: "differs",
    server,
    canReplace: mayReplaceProject(user, server.createdBy),
  };
}

async function classifyCatalog(
  target: LocalImportTarget,
  resource: ProjectResource,
  user: SessionUser,
): Promise<Pick<CatalogPlanEntry, "status" | "server" | "canReplace">> {
  const read = await target.readCatalog(resource.id);
  if (read.kind === "unreadable") {
    return { status: "server-unreadable", server: null, canReplace: false };
  }
  if (
    read.kind === "found" &&
    sameCatalogContent(resource, read.state.resource)
  ) {
    return { status: "unchanged", server: read.state, canReplace: false };
  }
  const copy = await target.readCatalog(catalogImportCopyId(resource));
  const server = read.kind === "found" ? read.state : null;
  if (copy.kind !== "missing") {
    return { status: "copied", server, canReplace: false };
  }
  // The Werkskatalog is admin-only, also on import (ADR 0003/0007).
  if (!isAdmin(user))
    return { status: "admin-only", server, canReplace: false };
  if (!server) return { status: "new", server: null, canReplace: false };
  return { status: "differs", server, canReplace: true };
}

/** Compares every local entry with the server; reads only. */
export async function planLocalImport(
  target: LocalImportTarget,
  inventory: LocalImportInventory,
  user: SessionUser,
): Promise<LocalImportPlan> {
  const projects: ProjectPlanEntry[] = [];
  for (const local of inventory.projects) {
    projects.push({
      key: local.key,
      local,
      ...(await classifyProject(target, local.project, user)),
    });
  }
  const catalog: CatalogPlanEntry[] = [];
  for (const local of inventory.catalog) {
    catalog.push({
      key: local.key,
      local,
      ...(await classifyCatalog(target, local.resource, user)),
    });
  }
  return { projects, catalog, unreadable: inventory.unreadable };
}

export function isImportable(status: ImportStatus): boolean {
  return status === "new" || status === "differs";
}

/** Keys of every entry the user can select; the default selection. */
export function importableKeys(plan: LocalImportPlan): string[] {
  return [...plan.projects, ...plan.catalog]
    .filter(({ status }) => isImportable(status))
    .map(({ key }) => key);
}

export type ImportPlanSummary = Record<ImportStatus, number> & {
  unreadable: number;
};

export function summarizeImportPlan(plan: LocalImportPlan): ImportPlanSummary {
  const summary: ImportPlanSummary = {
    new: 0,
    unchanged: 0,
    copied: 0,
    differs: 0,
    "server-unreadable": 0,
    "admin-only": 0,
    unreadable: plan.unreadable.length,
  };
  for (const { status } of [...plan.projects, ...plan.catalog]) {
    summary[status] += 1;
  }
  return summary;
}

/**
 * The import may start only with something selected and the explicit
 * confirmation that imported plans become publicly readable (ADR 0003/0007).
 */
export function canStartImport(
  plan: LocalImportPlan,
  selection: ReadonlySet<string>,
  publicConfirmed: boolean,
): boolean {
  return (
    publicConfirmed && importableKeys(plan).some((key) => selection.has(key))
  );
}

export type ProjectImportConflict = {
  key: string;
  local: Project;
  /** `null` when the server entry was deleted in the meantime. */
  server: ServerProjectState | null;
  canReplace: boolean;
  /** The server changed again while a choice was being saved. */
  refreshed: boolean;
};

export type CatalogImportConflict = {
  key: string;
  local: ProjectResource;
  server: ServerCatalogState | null;
  canReplace: boolean;
  refreshed: boolean;
};

export type ImportFailure = { key: string; error: unknown };

export type LocalImportRun = {
  /** Keys of entries created on the server by this run. */
  created: string[];
  /** Keys found already imported while running (e.g. on a retry). */
  alreadyImported: string[];
  conflicts: ProjectImportConflict[];
  catalogConflicts: CatalogImportConflict[];
  failures: ImportFailure[];
  /** The error that stopped the run (e.g. the session expired); else `null`. */
  aborted: unknown;
};

export type RunLocalImportOptions = {
  /** Errors that stop the whole run instead of failing one entry. */
  isFatal?: (error: unknown) => boolean;
};

function isVersionConflict(error: unknown, id: string): boolean {
  return error instanceof RecordVersionConflictError && error.id === id;
}

/**
 * Imports the selected entries: creates the new ones and returns the
 * differing ones as conflicts for the conflict view. An entry created by
 * someone else meanwhile (insert conflict) is compared again instead of
 * overwritten. Werkskatalog entries are skipped for non-admins.
 */
export async function runLocalImport(
  target: LocalImportTarget,
  plan: LocalImportPlan,
  selection: ReadonlySet<string>,
  user: SessionUser,
  options: RunLocalImportOptions = {},
): Promise<LocalImportRun> {
  const run: LocalImportRun = {
    created: [],
    alreadyImported: [],
    conflicts: [],
    catalogConflicts: [],
    failures: [],
    aborted: null,
  };
  const isFatal = options.isFatal ?? (() => false);

  for (const entry of plan.projects) {
    if (!selection.has(entry.key) || !isImportable(entry.status)) continue;
    const { project } = entry.local;
    if (entry.status === "differs") {
      run.conflicts.push({
        key: entry.key,
        local: project,
        server: entry.server,
        canReplace: entry.canReplace,
        refreshed: false,
      });
      continue;
    }
    try {
      try {
        await target.createProject(project);
        run.created.push(entry.key);
      } catch (error) {
        if (!isVersionConflict(error, project.id)) throw error;
        const again = await classifyProject(target, project, user);
        if (again.status === "differs" || again.status === "new") {
          run.conflicts.push({
            key: entry.key,
            local: project,
            server: again.server,
            canReplace: again.status === "new" ? true : again.canReplace,
            refreshed: true,
          });
        } else if (again.status === "server-unreadable") {
          run.failures.push({ key: entry.key, error });
        } else {
          run.alreadyImported.push(entry.key);
        }
      }
    } catch (error) {
      if (isFatal(error)) {
        run.aborted = error;
        return run;
      }
      run.failures.push({ key: entry.key, error });
    }
  }

  if (!isAdmin(user)) return run;
  for (const entry of plan.catalog) {
    if (!selection.has(entry.key) || !isImportable(entry.status)) continue;
    const { resource } = entry.local;
    if (entry.status === "differs") {
      run.catalogConflicts.push({
        key: entry.key,
        local: resource,
        server: entry.server,
        canReplace: entry.canReplace,
        refreshed: false,
      });
      continue;
    }
    try {
      try {
        await target.createCatalog(resource);
        run.created.push(entry.key);
      } catch (error) {
        if (!isVersionConflict(error, resource.id)) throw error;
        const again = await classifyCatalog(target, resource, user);
        if (again.status === "differs" || again.status === "new") {
          run.catalogConflicts.push({
            key: entry.key,
            local: resource,
            server: again.server,
            canReplace: true,
            refreshed: true,
          });
        } else if (again.status === "server-unreadable") {
          run.failures.push({ key: entry.key, error });
        } else {
          run.alreadyImported.push(entry.key);
        }
      }
    } catch (error) {
      if (isFatal(error)) {
        run.aborted = error;
        return run;
      }
      run.failures.push({ key: entry.key, error });
    }
  }
  return run;
}

/**
 * The copy of a local plan: deterministic id (see {@link importCopyId}), new
 * timestamps, optionally a marked project number. Created by the importing
 * user; the server original stays untouched.
 */
export function projectImportCopy(
  local: Project,
  now: number,
  projectNumber?: string,
): Project {
  return duplicateProjectModel(
    local,
    { id: projectImportCopyId(local), projectNumber },
    { now: () => now },
  );
}

const RESOURCE_NAME_MAX = 200;

export function catalogImportCopy(
  local: ProjectResource,
  now: number,
  name: string,
): ProjectResource {
  const id = catalogImportCopyId(local);
  const copyName = name.trim().slice(0, RESOURCE_NAME_MAX).trim() || local.name;
  return projectResourceSchema.parse({
    ...local,
    id,
    name: copyName,
    createdAt: now,
    updatedAt: now,
    value: { ...local.value, id, name: copyName },
  });
}

export type ProjectImportOutcome =
  /** Nothing written; the server state stays, the local original too. */
  | { kind: "kept-server" }
  /** The local plan replaced the server state (creator unchanged). */
  | { kind: "replaced"; version: RecordVersion }
  /** The server entry was gone; the local plan was created anew. */
  | { kind: "created"; version: RecordVersion }
  | { kind: "copied"; project: Project }
  /** This exact local state already exists as a copy. */
  | { kind: "copy-exists"; id: string }
  /** The user may not replace this plan; nothing was written. */
  | { kind: "forbidden" }
  /** The server changed again: compare anew before deciding. */
  | { kind: "refreshed"; conflict: ProjectImportConflict };

export type ImportResolveOptions = {
  user: SessionUser;
  now: number;
  /** Project number of a copy; omitted keeps the local one. */
  copyProjectNumber?: string;
};

async function refreshedProjectConflict(
  target: LocalImportTarget,
  conflict: ProjectImportConflict,
  user: SessionUser,
): Promise<ProjectImportOutcome> {
  const read = await target.readProject(conflict.local.id);
  const server = read.kind === "found" ? read.state : null;
  return {
    kind: "refreshed",
    conflict: {
      ...conflict,
      server,
      canReplace: server ? mayReplaceProject(user, server.createdBy) : true,
      refreshed: true,
    },
  };
}

/**
 * Carries out one choice of the conflict view for an imported plan.
 * "keep-server" writes nothing; "save-copy" inserts the deterministic copy;
 * "keep-mine" replaces the server state only with write permission and only
 * at the version the user compared against — otherwise a refreshed conflict
 * comes back and nothing is written.
 */
export async function resolveProjectImportConflict(
  target: LocalImportTarget,
  conflict: ProjectImportConflict,
  choice: ConflictChoice,
  options: ImportResolveOptions,
): Promise<ProjectImportOutcome> {
  if (choice === "keep-server") return { kind: "kept-server" };
  if (choice === "save-copy") {
    const copy = projectImportCopy(
      conflict.local,
      options.now,
      options.copyProjectNumber,
    );
    try {
      await target.createProject(copy);
      return { kind: "copied", project: copy };
    } catch (error) {
      if (!isVersionConflict(error, copy.id)) throw error;
      return { kind: "copy-exists", id: copy.id };
    }
  }
  if (!conflict.canReplace) return { kind: "forbidden" };
  const id = conflict.local.id;
  try {
    if (conflict.server === null) {
      const version = await target.createProject(conflict.local);
      return { kind: "created", version };
    }
    const version = await target.replaceProject(
      conflict.local,
      conflict.server.version,
    );
    return { kind: "replaced", version };
  } catch (error) {
    if (!isVersionConflict(error, id)) throw error;
    return refreshedProjectConflict(target, conflict, options.user);
  }
}

export type CatalogImportOutcome =
  | { kind: "kept-server" }
  | { kind: "replaced"; version: RecordVersion }
  | { kind: "created"; version: RecordVersion }
  | { kind: "copied"; resource: ProjectResource }
  | { kind: "copy-exists"; id: string }
  | { kind: "forbidden" }
  | { kind: "refreshed"; conflict: CatalogImportConflict };

/** {@link resolveProjectImportConflict} for a Werkskatalog entry (admins). */
export async function resolveCatalogImportConflict(
  target: LocalImportTarget,
  conflict: CatalogImportConflict,
  choice: ConflictChoice,
  options: { user: SessionUser; now: number; copyName: string },
): Promise<CatalogImportOutcome> {
  if (!isAdmin(options.user)) return { kind: "forbidden" };
  if (choice === "keep-server") return { kind: "kept-server" };
  if (choice === "save-copy") {
    const copy = catalogImportCopy(
      conflict.local,
      options.now,
      options.copyName,
    );
    try {
      await target.createCatalog(copy);
      return { kind: "copied", resource: copy };
    } catch (error) {
      if (!isVersionConflict(error, copy.id)) throw error;
      return { kind: "copy-exists", id: copy.id };
    }
  }
  const id = conflict.local.id;
  try {
    if (conflict.server === null) {
      return {
        kind: "created",
        version: await target.createCatalog(conflict.local),
      };
    }
    return {
      kind: "replaced",
      version: await target.replaceCatalog(
        conflict.local,
        conflict.server.version,
      ),
    };
  } catch (error) {
    if (!isVersionConflict(error, id)) throw error;
    const read = await target.readCatalog(id);
    return {
      kind: "refreshed",
      conflict: {
        ...conflict,
        server: read.kind === "found" ? read.state : null,
        refreshed: true,
      },
    };
  }
}
