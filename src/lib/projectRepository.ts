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
  PALLETS_STORE_NAME,
  PROJECTS_STORE_NAME,
  PROJECT_QUARANTINE_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
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

export type QuarantineRecord = {
  id: string;
  sourceStore: PlannerStoreName;
  sourceId: string | null;
  quarantinedAt: number;
  diagnostics: RepositoryDiagnostic[];
  record: unknown;
};

export interface PlannerRecordStorage {
  list(storeName: PlannerStoreName): Promise<unknown[]>;
  get(storeName: PlannerStoreName, id: string): Promise<unknown>;
  put(storeName: PlannerStoreName, record: unknown): Promise<void>;
  delete(storeName: PlannerStoreName, id: string): Promise<void>;
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

  async put(storeName: PlannerStoreName, record: unknown): Promise<void> {
    await runPlannerTransaction(
      storeName,
      "readwrite",
      (transaction) => {
        transaction.objectStore(storeName).put(record);
      },
      this.indexedDb,
    );
  }

  async delete(storeName: PlannerStoreName, id: string): Promise<void> {
    await runPlannerTransaction(
      storeName,
      "readwrite",
      (transaction) => {
        transaction.objectStore(storeName).delete(id);
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

  constructor(
    initial: Partial<Record<PlannerStoreName, readonly unknown[]>> = {},
  ) {
    const names: PlannerStoreName[] = [
      PALLETS_STORE_NAME,
      PROJECTS_STORE_NAME,
      PROJECT_RESOURCES_STORE_NAME,
      PROJECT_QUARANTINE_STORE_NAME,
    ];
    names.forEach((name) => {
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

  async put(storeName: PlannerStoreName, value: unknown): Promise<void> {
    const id = recordId(value);
    if (!id) throw new Error(`Record for "${storeName}" is missing an id.`);
    this.store(storeName).set(id, cloneValue(value));
  }

  async delete(storeName: PlannerStoreName, id: string): Promise<void> {
    this.store(storeName).delete(id);
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

      let project = savedPalletToProject(normalized.pallet);
      const existing = await this.storage.get(PROJECTS_STORE_NAME, project.id);
      if (existing !== undefined) {
        if (conflictPolicy === "skip") {
          diagnostics.push({
            severity: "warning",
            code: "legacy-project-conflict-skipped",
            message: `Project "${project.id}" already exists; the saved pallet was not re-imported.`,
            store: PALLETS_STORE_NAME,
            recordId: normalized.pallet.id,
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

  async migrateSavedPalletStore(
    options: { conflictPolicy?: ProjectConflictPolicy } = {},
  ): Promise<LegacyMigrationResult> {
    const rows = await this.storage.list(PALLETS_STORE_NAME);
    return this.migrateSavedPallets(rows, options);
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
