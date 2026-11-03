import { z } from "zod";
import {
  duplicateProjectModel,
  type DuplicateProjectInput,
  type ProjectFactoryDependencies,
} from "~/domain/project/projectFactory";
import {
  safeMigrateProject,
  type ProjectParseDiagnostic,
} from "~/domain/project/projectMigration";
import {
  projectResourceSchema,
  safeParseProjectResource,
  type ProjectResource,
  type ProjectResourceKind,
} from "~/domain/project/projectResource";
import type { Project, ProjectV2 } from "~/domain/project/projectSchema";
import { normalizeStoredPallet } from "~/lib/palletPersistence";
import { savedPalletToProject } from "~/lib/projectAdapters";
import {
  LEGACY_MIGRATIONS_STORE_NAME,
  PALLETS_STORE_NAME,
  PLANNER_STORE_NAMES,
  PROJECTS_STORE_NAME,
  PROJECT_QUARANTINE_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
  RECORD_VERSIONS_STORE_NAME,
  recordVersionKey,
  requestToPromise,
  runPlannerTransaction,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";

export type ProjectConflictPolicy = "skip" | "overwrite" | "rename";

export type RepositoryDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  store: PlannerStoreName;
  recordId: string | null;
  path: (string | number)[];
};

/**
 * Durable proof that a SavedPallet has already been turned into a project.
 * The legacy store is never mutated by the migration, so without this marker a
 * deliberately deleted project would be recreated on the next mount.
 */
export type LegacyMigrationMarker = {
  /** SavedPallet id, not the project id — the source record is what we track. */
  id: string;
  projectId: string;
  migratedAt: number;
};

export type QuarantineRecord = {
  id: string;
  sourceStore: PlannerStoreName;
  sourceId: string | null;
  quarantinedAt: number;
  diagnostics: RepositoryDiagnostic[];
  record: unknown;
};

/**
 * Monotonic per-record version (ADR 0006). The first write of an id yields 1;
 * every later put increments it. Versions survive deletes as tombstones, so a
 * record recreated after a delete never reuses a version a stale client might
 * still hold. Records written before versioning existed count as version 1.
 */
export type RecordVersion = number;

export type RecordWriteOptions = {
  /**
   * Omitted: unconditional write (local mode, today's behaviour).
   * `null`: the record must not exist yet.
   * A number: the record must exist with exactly that version.
   */
  expectedVersion?: RecordVersion | null;
};

export type VersionedRecord = {
  record: unknown;
  version: RecordVersion;
};

export interface PlannerRecordStorage {
  list(storeName: PlannerStoreName): Promise<unknown[]>;
  get(storeName: PlannerStoreName, id: string): Promise<unknown>;
  /** Record and its current version, read together; `undefined` when missing. */
  getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined>;
  /** Resolves with the record's new version. */
  put(
    storeName: PlannerStoreName,
    record: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion>;
  delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void>;
}

/**
 * The stored record's version differs from the caller's expected version.
 * Distinct from `ProjectConflictError`, which reports duplicate ids.
 */
export class RecordVersionConflictError extends Error {
  constructor(
    readonly storeName: PlannerStoreName,
    readonly id: string,
    readonly expectedVersion: RecordVersion | null,
    /** `null` when the record does not exist. */
    readonly actualVersion: RecordVersion | null,
  ) {
    super(
      `Record "${id}" in "${storeName}" is at version ${
        actualVersion ?? "none"
      }, expected ${expectedVersion ?? "none"}.`,
    );
    this.name = "RecordVersionConflictError";
  }
}

/** Version of a stored record, given whether it exists and its metadata. */
function currentRecordVersion(
  exists: boolean,
  storedVersion: RecordVersion | undefined,
): RecordVersion | null {
  return exists ? (storedVersion ?? 1) : null;
}

function assertExpectedVersion(
  storeName: PlannerStoreName,
  id: string,
  options: RecordWriteOptions | undefined,
  current: RecordVersion | null,
): void {
  const expected = options?.expectedVersion;
  if (expected === undefined || expected === current) return;
  throw new RecordVersionConflictError(storeName, id, expected, current);
}

function nextRecordVersion(
  current: RecordVersion | null,
  storedVersion: RecordVersion | undefined,
): RecordVersion {
  return (current ?? storedVersion ?? 0) + 1;
}

function requireRecordId(storeName: PlannerStoreName, value: unknown): string {
  const id = recordId(value);
  if (!id) throw new Error(`Record for "${storeName}" is missing an id.`);
  return id;
}

function recordId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (typeof input !== "object" || input === null) return input;
    if (seen.has(input)) return "[Circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  try {
    return JSON.stringify(normalize(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

type RecordVersionRow = { id: string; version: RecordVersion };

function storedVersionOf(row: unknown): RecordVersion | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const version = (row as { version?: unknown }).version;
  return typeof version === "number" ? version : undefined;
}

export class IndexedDbPlannerRecordStorage implements PlannerRecordStorage {
  constructor(private readonly indexedDb: IDBFactory = globalThis.indexedDB) {}

  list(storeName: PlannerStoreName): Promise<unknown[]> {
    return runPlannerTransaction(
      storeName,
      "readonly",
      (transaction) =>
        requestToPromise(transaction.objectStore(storeName).getAll()),
      this.indexedDb,
    );
  }

  get(storeName: PlannerStoreName, id: string): Promise<unknown> {
    return runPlannerTransaction(
      storeName,
      "readonly",
      (transaction) =>
        requestToPromise(transaction.objectStore(storeName).get(id)),
      this.indexedDb,
    );
  }

  getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    return runPlannerTransaction(
      [storeName, RECORD_VERSIONS_STORE_NAME],
      "readonly",
      async (transaction) => {
        const [record, versionRow] = await Promise.all([
          requestToPromise<unknown>(transaction.objectStore(storeName).get(id)),
          requestToPromise<unknown>(
            transaction
              .objectStore(RECORD_VERSIONS_STORE_NAME)
              .get(recordVersionKey(storeName, id)),
          ),
        ]);
        if (record === undefined) return undefined;
        return { record, version: storedVersionOf(versionRow) ?? 1 };
      },
      this.indexedDb,
    );
  }

  async put(
    storeName: PlannerStoreName,
    record: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion> {
    const id = requireRecordId(storeName, record);
    return runPlannerTransaction(
      [storeName, RECORD_VERSIONS_STORE_NAME],
      "readwrite",
      async (transaction) => {
        const records = transaction.objectStore(storeName);
        const versions = transaction.objectStore(RECORD_VERSIONS_STORE_NAME);
        const key = recordVersionKey(storeName, id);
        // Check and write share one readwrite transaction, so the expected
        // version comparison is atomic with the write (ADR 0006).
        const [count, versionRow] = await Promise.all([
          requestToPromise(records.count(id)),
          requestToPromise<unknown>(versions.get(key)),
        ]);
        const stored = storedVersionOf(versionRow);
        const current = currentRecordVersion(count > 0, stored);
        assertExpectedVersion(storeName, id, options, current);
        const version = nextRecordVersion(current, stored);
        records.put(record);
        versions.put({ id: key, version } satisfies RecordVersionRow);
        return version;
      },
      this.indexedDb,
    );
  }

  async delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void> {
    await runPlannerTransaction(
      [storeName, RECORD_VERSIONS_STORE_NAME],
      "readwrite",
      async (transaction) => {
        const records = transaction.objectStore(storeName);
        const versions = transaction.objectStore(RECORD_VERSIONS_STORE_NAME);
        const key = recordVersionKey(storeName, id);
        const [count, versionRow] = await Promise.all([
          requestToPromise(records.count(id)),
          requestToPromise<unknown>(versions.get(key)),
        ]);
        const current = currentRecordVersion(
          count > 0,
          storedVersionOf(versionRow),
        );
        assertExpectedVersion(storeName, id, options, current);
        if (current === null) return;
        records.delete(id);
        // Keep the last version as a tombstone so a recreated record continues
        // counting instead of reusing versions.
        versions.put({ id: key, version: current } satisfies RecordVersionRow);
      },
      this.indexedDb,
    );
  }
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryPlannerRecordStorage implements PlannerRecordStorage {
  private readonly stores = new Map<PlannerStoreName, Map<string, unknown>>();
  /** Explicit versions and tombstones; records without an entry are version 1. */
  private readonly versions = new Map<string, RecordVersion>();

  constructor(
    initial: Partial<Record<PlannerStoreName, readonly unknown[]>> = {},
  ) {
    PLANNER_STORE_NAMES.forEach((name) => {
      const records = new Map<string, unknown>();
      for (const value of initial[name] ?? []) {
        const id = recordId(value);
        if (!id) {
          throw new Error(`Memory store "${name}" record is missing an id.`);
        }
        records.set(id, cloneValue(value));
      }
      this.stores.set(name, records);
    });
  }

  async list(storeName: PlannerStoreName): Promise<unknown[]> {
    return [...this.store(storeName).values()].map(cloneValue);
  }

  async get(storeName: PlannerStoreName, id: string): Promise<unknown> {
    const value = this.store(storeName).get(id);
    return value === undefined ? undefined : cloneValue(value);
  }

  async getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    const value = this.store(storeName).get(id);
    if (value === undefined) return undefined;
    return {
      record: cloneValue(value),
      version: this.versions.get(recordVersionKey(storeName, id)) ?? 1,
    };
  }

  async put(
    storeName: PlannerStoreName,
    value: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion> {
    const id = requireRecordId(storeName, value);
    const store = this.store(storeName);
    const key = recordVersionKey(storeName, id);
    const stored = this.versions.get(key);
    const current = currentRecordVersion(store.has(id), stored);
    assertExpectedVersion(storeName, id, options, current);
    const version = nextRecordVersion(current, stored);
    store.set(id, cloneValue(value));
    this.versions.set(key, version);
    return version;
  }

  async delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void> {
    const store = this.store(storeName);
    const key = recordVersionKey(storeName, id);
    const current = currentRecordVersion(store.has(id), this.versions.get(key));
    assertExpectedVersion(storeName, id, options, current);
    if (current === null) return;
    store.delete(id);
    this.versions.set(key, current);
  }

  private store(storeName: PlannerStoreName): Map<string, unknown> {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Unknown memory store "${storeName}".`);
    return store;
  }
}

export type ProjectSortField =
  | "updatedAt"
  | "createdAt"
  | "projectNumber"
  | "productNumber";
export type SortDirection = "asc" | "desc";

export type ProjectListOptions = {
  search?: string;
  projectNumber?: string;
  productNumber?: string;
  sortBy?: ProjectSortField;
  sortDirection?: SortDirection;
};

export type ProjectListResult = {
  projects: Project[];
  diagnostics: RepositoryDiagnostic[];
};

export type ProjectReadResult = {
  project: Project | null;
  diagnostics: RepositoryDiagnostic[];
};

export type ResourceListOptions = {
  search?: string;
  kind?: ProjectResourceKind;
  sortBy?: "name" | "updatedAt" | "createdAt";
  sortDirection?: SortDirection;
};

export type ResourceListResult = {
  resources: ProjectResource[];
  diagnostics: RepositoryDiagnostic[];
};

export type ResourceReadResult = {
  resource: ProjectResource | null;
  diagnostics: RepositoryDiagnostic[];
};

export type ProjectRepositoryDependencies = ProjectFactoryDependencies;

function compareString(left: string, right: string): number {
  const normalizedLeft = left.toLocaleLowerCase();
  const normalizedRight = right.toLocaleLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function sortProjects(
  projects: readonly Project[],
  sortBy: ProjectSortField = "updatedAt",
  direction: SortDirection = "desc",
): Project[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...projects].sort((left, right) => {
    const leftValue = left[sortBy];
    const rightValue = right[sortBy];
    const comparison =
      typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : compareString(String(leftValue), String(rightValue));
    return comparison === 0
      ? compareString(left.id, right.id)
      : comparison * multiplier;
  });
}

export function projectMatchesSearch(
  project: Project,
  search: string,
): boolean {
  const query = search.trim().toLocaleLowerCase();
  if (query === "") return true;
  const sourceName =
    project.source.kind === "rob-import" ? project.source.fileName : "";
  return [
    project.id,
    project.projectNumber,
    project.productNumber,
    sourceName,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

export function projectMatchesFilters(
  project: Project,
  options: Pick<
    ProjectListOptions,
    "search" | "projectNumber" | "productNumber"
  >,
): boolean {
  const projectNumber = options.projectNumber?.trim().toLocaleLowerCase() ?? "";
  const productNumber = options.productNumber?.trim().toLocaleLowerCase() ?? "";
  return (
    projectMatchesSearch(project, options.search ?? "") &&
    (projectNumber === "" ||
      project.projectNumber.toLocaleLowerCase().includes(projectNumber)) &&
    (productNumber === "" ||
      project.productNumber.toLocaleLowerCase().includes(productNumber))
  );
}

export class ProjectConflictError extends Error {
  constructor(
    readonly kind: "project" | "resource",
    readonly id: string,
  ) {
    super(
      `${kind === "project" ? "Project" : "Resource"} "${id}" already exists.`,
    );
    this.name = "ProjectConflictError";
  }
}

export class ProjectRepository {
  private readonly now: () => number;
  private readonly createId: NonNullable<
    ProjectFactoryDependencies["createId"]
  >;

  constructor(
    private readonly storage: PlannerRecordStorage = new IndexedDbPlannerRecordStorage(),
    dependencies: ProjectRepositoryDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.createId =
      dependencies.createId ??
      ((kind) =>
        `${kind}-${
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        }`);
  }

  async saveProject(projectInput: unknown): Promise<Project> {
    const result = safeMigrateProject(projectInput);
    if (!result.success) {
      throw new z.ZodError(
        result.diagnostics.map((diagnostic) => ({
          code: z.ZodIssueCode.custom,
          path: diagnostic.path,
          message: diagnostic.message,
        })),
      );
    }
    await this.storage.put(PROJECTS_STORE_NAME, result.project);
    return result.project;
  }

  async listProjects(
    options: ProjectListOptions = {},
  ): Promise<ProjectListResult> {
    const rows = await this.storage.list(PROJECTS_STORE_NAME);
    const projects: Project[] = [];
    const diagnostics: RepositoryDiagnostic[] = [];
    for (const row of rows) {
      const normalized = safeMigrateProject(row);
      if (!normalized.success) {
        const rowDiagnostics = normalized.diagnostics.map((diagnostic) =>
          this.projectDiagnostic(row, diagnostic),
        );
        diagnostics.push(...rowDiagnostics);
        await this.quarantine(PROJECTS_STORE_NAME, row, rowDiagnostics);
        continue;
      }
      projects.push(normalized.project);
      if (normalized.migrated) {
        await this.storage.put(PROJECTS_STORE_NAME, normalized.project);
      }
    }

    const filtered = projects.filter((project) =>
      projectMatchesFilters(project, options),
    );
    return {
      projects: sortProjects(filtered, options.sortBy, options.sortDirection),
      diagnostics,
    };
  }

  async searchProjects(
    search: string,
    options: Omit<ProjectListOptions, "search"> = {},
  ): Promise<ProjectListResult> {
    return this.listProjects({ ...options, search });
  }

  async getProject(id: string): Promise<ProjectReadResult> {
    const row = await this.storage.get(PROJECTS_STORE_NAME, id);
    if (row === undefined) return { project: null, diagnostics: [] };
    const normalized = safeMigrateProject(row);
    if (!normalized.success) {
      const diagnostics = normalized.diagnostics.map((diagnostic) =>
        this.projectDiagnostic(row, diagnostic),
      );
      await this.quarantine(PROJECTS_STORE_NAME, row, diagnostics);
      return { project: null, diagnostics };
    }
    if (normalized.migrated) {
      await this.storage.put(PROJECTS_STORE_NAME, normalized.project);
    }
    return { project: normalized.project, diagnostics: [] };
  }

  async hasProject(id: string): Promise<boolean> {
    return (await this.storage.get(PROJECTS_STORE_NAME, id)) !== undefined;
  }

  async deleteProject(id: string): Promise<boolean> {
    const existing = await this.storage.get(PROJECTS_STORE_NAME, id);
    if (existing === undefined) return false;
    await this.storage.delete(PROJECTS_STORE_NAME, id);
    return true;
  }

  async duplicateProject(
    id: string,
    input: DuplicateProjectInput = {},
  ): Promise<ProjectReadResult> {
    const source = await this.getProject(id);
    if (!source.project) return source;
    const duplicate = duplicateProjectModel(source.project, input, {
      now: this.now,
      createId: this.createId,
    });
    await this.assertProjectIdAvailable(duplicate.id);
    await this.storage.put(PROJECTS_STORE_NAME, duplicate);
    return { project: duplicate, diagnostics: source.diagnostics };
  }

  async saveProjectAs(
    projectInput: Project | ProjectV2,
    input: DuplicateProjectInput = {},
  ): Promise<Project> {
    const duplicate = duplicateProjectModel(projectInput, input, {
      now: this.now,
      createId: this.createId,
    });
    await this.assertProjectIdAvailable(duplicate.id);
    await this.storage.put(PROJECTS_STORE_NAME, duplicate);
    return duplicate;
  }

  async saveResource(resourceInput: unknown): Promise<ProjectResource> {
    const resource = projectResourceSchema.parse(resourceInput);
    await this.storage.put(PROJECT_RESOURCES_STORE_NAME, resource);
    return resource;
  }

  async listResources(
    options: ResourceListOptions = {},
  ): Promise<ResourceListResult> {
    const rows = await this.storage.list(PROJECT_RESOURCES_STORE_NAME);
    const resources: ProjectResource[] = [];
    const diagnostics: RepositoryDiagnostic[] = [];
    for (const row of rows) {
      const parsed = safeParseProjectResource(row);
      if (!parsed.success) {
        const rowDiagnostics: RepositoryDiagnostic[] = parsed.diagnostics.map(
          (diagnostic) => ({
            severity: "error",
            code: diagnostic.code,
            message: diagnostic.message,
            store: PROJECT_RESOURCES_STORE_NAME,
            recordId: recordId(row),
            path: diagnostic.path,
          }),
        );
        diagnostics.push(...rowDiagnostics);
        await this.quarantine(
          PROJECT_RESOURCES_STORE_NAME,
          row,
          rowDiagnostics,
        );
        continue;
      }
      resources.push(parsed.resource);
    }

    const search = options.search?.trim().toLocaleLowerCase() ?? "";
    const filtered = resources.filter(
      (resource) =>
        (!options.kind || resource.kind === options.kind) &&
        (search === "" ||
          resource.id.toLocaleLowerCase().includes(search) ||
          resource.name.toLocaleLowerCase().includes(search)),
    );
    const sortBy = options.sortBy ?? "updatedAt";
    const multiplier = (options.sortDirection ?? "desc") === "asc" ? 1 : -1;
    filtered.sort((left, right) => {
      const leftValue = left[sortBy];
      const rightValue = right[sortBy];
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareString(String(leftValue), String(rightValue));
      return comparison === 0
        ? compareString(left.id, right.id)
        : comparison * multiplier;
    });

    return { resources: filtered, diagnostics };
  }

  async getResource(id: string): Promise<ResourceReadResult> {
    const row = await this.storage.get(PROJECT_RESOURCES_STORE_NAME, id);
    if (row === undefined) return { resource: null, diagnostics: [] };
    const parsed = safeParseProjectResource(row);
    if (parsed.success) return { resource: parsed.resource, diagnostics: [] };
    const diagnostics: RepositoryDiagnostic[] = parsed.diagnostics.map(
      (diagnostic) => ({
        severity: "error",
        code: diagnostic.code,
        message: diagnostic.message,
        store: PROJECT_RESOURCES_STORE_NAME,
        recordId: recordId(row),
        path: diagnostic.path,
      }),
    );
    await this.quarantine(PROJECT_RESOURCES_STORE_NAME, row, diagnostics);
    return { resource: null, diagnostics };
  }

  async hasResource(id: string): Promise<boolean> {
    return (
      (await this.storage.get(PROJECT_RESOURCES_STORE_NAME, id)) !== undefined
    );
  }

  async deleteResource(id: string): Promise<boolean> {
    const existing = await this.storage.get(PROJECT_RESOURCES_STORE_NAME, id);
    if (existing === undefined) return false;
    await this.storage.delete(PROJECT_RESOURCES_STORE_NAME, id);
    return true;
  }

  async migrateSavedPallets(
    rows: readonly unknown[],
    options: { conflictPolicy?: ProjectConflictPolicy } = {},
  ): Promise<LegacyMigrationResult> {
    const projects: Project[] = [];
    const diagnostics: RepositoryDiagnostic[] = [];
    let skippedCount = 0;
    const conflictPolicy = options.conflictPolicy ?? "skip";

    for (const row of rows) {
      const normalized = normalizeStoredPallet(row);
      if ("issue" in normalized) {
        const rowDiagnostics: RepositoryDiagnostic[] = [
          {
            severity: "error",
            code: "invalid-legacy-pallet",
            message: normalized.issue.reason,
            store: PALLETS_STORE_NAME,
            recordId: normalized.issue.id,
            path: [],
          },
        ];
        diagnostics.push(...rowDiagnostics);
        await this.quarantine(PALLETS_STORE_NAME, row, rowDiagnostics);
        skippedCount += 1;
        continue;
      }

      const palletId = normalized.pallet.id;
      if (conflictPolicy === "skip" && (await this.wasMigrated(palletId))) {
        // The source pallet is never deleted, so only this marker keeps a
        // deliberately removed project from reappearing on the next mount.
        diagnostics.push({
          severity: "warning",
          code: "legacy-pallet-already-migrated",
          message: `Saved pallet "${palletId}" was already migrated; it was not imported again.`,
          store: PALLETS_STORE_NAME,
          recordId: palletId,
          path: [],
        });
        skippedCount += 1;
        continue;
      }

      let project = savedPalletToProject(normalized.pallet);
      const existing = await this.storage.get(PROJECTS_STORE_NAME, project.id);
      if (existing !== undefined) {
        if (conflictPolicy === "skip") {
          // Backfill the marker for pallets migrated before markers existed.
          await this.markMigrated(palletId, project.id);
          diagnostics.push({
            severity: "warning",
            code: "legacy-project-conflict-skipped",
            message: `Project "${project.id}" already exists; the saved pallet was not re-imported.`,
            store: PALLETS_STORE_NAME,
            recordId: palletId,
            path: ["id"],
          });
          skippedCount += 1;
          continue;
        }
        if (conflictPolicy === "rename") {
          project = duplicateProjectModel(
            project,
            { id: this.createId("project") },
            { now: this.now, createId: this.createId },
          );
          await this.assertProjectIdAvailable(project.id);
        }
      }

      await this.storage.put(PROJECTS_STORE_NAME, project);
      await this.markMigrated(palletId, project.id);
      projects.push(project);
    }

    return {
      projects,
      migratedCount: projects.length,
      skippedCount,
      diagnostics,
      sourceDeleted: false,
    };
  }

  /**
   * `legacyLocalStorageJson` is the pre-IndexedDB `saved_pallets_v1` list;
   * like the store rows it is only read, and migration markers keep it from
   * being imported twice.
   */
  async migrateSavedPalletStore(
    options: {
      conflictPolicy?: ProjectConflictPolicy;
      legacyLocalStorageJson?: string | null;
    } = {},
  ): Promise<LegacyMigrationResult> {
    const rows = [...(await this.storage.list(PALLETS_STORE_NAME))];
    const legacyDiagnostics: RepositoryDiagnostic[] = [];
    if (options.legacyLocalStorageJson) {
      let legacyRows: unknown = null;
      try {
        legacyRows = JSON.parse(options.legacyLocalStorageJson);
      } catch {
        // Reported below like a non-list value.
      }
      if (Array.isArray(legacyRows)) {
        rows.push(...(legacyRows as unknown[]));
      } else {
        legacyDiagnostics.push({
          severity: "error",
          code: "invalid-legacy-local-storage",
          message:
            "Saved pallets in legacy browser storage are not a valid pallet list and were not imported.",
          store: PALLETS_STORE_NAME,
          recordId: null,
          path: [],
        });
      }
    }
    const result = await this.migrateSavedPallets(rows, options);
    result.diagnostics.unshift(...legacyDiagnostics);
    return result;
  }

  async listQuarantine(): Promise<QuarantineRecord[]> {
    const rows = await this.storage.list(PROJECT_QUARANTINE_STORE_NAME);
    return rows
      .filter((row): row is QuarantineRecord => {
        if (typeof row !== "object" || row === null) return false;
        return typeof (row as { id?: unknown }).id === "string";
      })
      .sort((left, right) => right.quarantinedAt - left.quarantinedAt);
  }

  async listLegacyMigrations(): Promise<LegacyMigrationMarker[]> {
    const rows = await this.storage.list(LEGACY_MIGRATIONS_STORE_NAME);
    return rows
      .filter((row): row is LegacyMigrationMarker => {
        if (typeof row !== "object" || row === null) return false;
        return typeof (row as { id?: unknown }).id === "string";
      })
      .sort((left, right) => right.migratedAt - left.migratedAt);
  }

  private async wasMigrated(palletId: string): Promise<boolean> {
    return (
      (await this.storage.get(LEGACY_MIGRATIONS_STORE_NAME, palletId)) !==
      undefined
    );
  }

  private async markMigrated(
    palletId: string,
    projectId: string,
  ): Promise<void> {
    const marker: LegacyMigrationMarker = {
      id: palletId,
      projectId,
      migratedAt: this.now(),
    };
    await this.storage.put(LEGACY_MIGRATIONS_STORE_NAME, marker);
  }

  private projectDiagnostic(
    row: unknown,
    diagnostic: ProjectParseDiagnostic,
  ): RepositoryDiagnostic {
    return {
      severity: "error",
      code: diagnostic.code,
      message: diagnostic.message,
      store: PROJECTS_STORE_NAME,
      recordId: recordId(row),
      path: diagnostic.path,
    };
  }

  private async quarantine(
    sourceStore: PlannerStoreName,
    row: unknown,
    diagnostics: RepositoryDiagnostic[],
  ): Promise<void> {
    const sourceId = recordId(row);
    const id = `${sourceStore}:${sourceId ?? hashString(stableJson(row))}`;
    const record: QuarantineRecord = {
      id,
      sourceStore,
      sourceId,
      quarantinedAt: this.now(),
      diagnostics,
      record: row,
    };
    await this.storage.put(PROJECT_QUARANTINE_STORE_NAME, record);
  }

  private async assertProjectIdAvailable(id: string): Promise<void> {
    if ((await this.storage.get(PROJECTS_STORE_NAME, id)) !== undefined) {
      throw new ProjectConflictError("project", id);
    }
  }
}

export type LegacyMigrationResult = {
  projects: Project[];
  migratedCount: number;
  skippedCount: number;
  diagnostics: RepositoryDiagnostic[];
  /** Always false: migration never deletes the SavedPallet source record. */
  sourceDeleted: false;
};

export function createProjectRepository(
  storage?: PlannerRecordStorage,
  dependencies?: ProjectRepositoryDependencies,
): ProjectRepository {
  return new ProjectRepository(storage, dependencies);
}
