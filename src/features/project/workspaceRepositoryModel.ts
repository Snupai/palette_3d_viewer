import { duplicateProjectModel, type DuplicateProjectInput } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { PlannerSession } from "~/features/auth/plannerAccessModel";
import { exportProjectPackageJson, importProjectPackageJson, parseProjectPackageJson, type ProjectPackageImportOptions } from "~/lib/projectPackage";
import { sortProjects, type ProjectRepository, type ProjectListOptions } from "~/lib/projectRepository";
import type { RecordVersion } from "~/lib/plannerRecordStorage";
import type { StorageMode } from "~/lib/storageMode";

export type WorkspacePlanOrigin = "server" | "browser-local";
export type WorkspaceProjectReference = { id: string; origin: WorkspacePlanOrigin };

/** New plans follow the deliberate session state; open plans never change origin. */
export function newWorkspacePlanOrigin(mode: StorageMode, session: PlannerSession): WorkspacePlanOrigin {
  return mode === "server" && session.status === "anonymous" ? "browser-local" : "server";
}

/** Selection keys include origin, while persisted project ids stay untouched. */
export class WorkspaceRepositoryModel {
  private readonly origins = new WeakMap<Project, WorkspacePlanOrigin>();
  private readonly localVersions = new Map<string, RecordVersion | null>();

  constructor(readonly mode: StorageMode, readonly primary: ProjectRepository, readonly browser: ProjectRepository | null) {}

  key(reference: WorkspaceProjectReference): string {
    return this.mode === "local" ? reference.id : `${reference.origin}:${encodeURIComponent(reference.id)}`;
  }

  reference(key: string): WorkspaceProjectReference {
    if (this.mode === "server") {
      for (const origin of ["browser-local", "server"] as const) {
        if (key.startsWith(`${origin}:`)) return { origin, id: decodeURIComponent(key.slice(origin.length + 1)) };
      }
    }
    // Existing bookmarks still refer to server plans (or the sole local-mode store).
    return { origin: "server", id: key };
  }

  register(project: Project, origin: WorkspacePlanOrigin): Project {
    this.origins.set(project, origin);
    return project;
  }

  keyFor = (project: Project): string => this.key({ id: project.id, origin: this.origins.get(project) ?? "server" });

  repository(origin: WorkspacePlanOrigin): ProjectRepository {
    if (origin === "server") return this.primary;
    if (!this.browser) throw new Error("Browser plans require server storage mode.");
    return this.browser;
  }

  async list(options: ProjectListOptions = {}) {
    const origins: WorkspacePlanOrigin[] = this.browser ? ["server", "browser-local"] : ["server"];
    // A failed server listing must not hide the independently stored Browserplans.
    const results = await Promise.allSettled(origins.map(async (origin) => {
      const result = await this.repository(origin).listProjects(options);
      result.projects.forEach((project) => this.register(project, origin));
      return result;
    }));
    return {
      projects: sortProjects(results.flatMap((result) => result.status === "fulfilled" ? result.value.projects : []), options.sortBy, options.sortDirection),
      diagnostics: results.flatMap((result) => result.status === "fulfilled" ? result.value.diagnostics : []),
      errors: results.flatMap((result) => result.status === "rejected" ? [result.reason as unknown] : []),
    };
  }

  async load(key: string) {
    const { origin, id } = this.reference(key);
    const result = await this.repository(origin).getProject(id);
    if (origin === "browser-local") this.localVersions.set(id, result.version ?? null);
    if (result.project) this.register(result.project, origin);
    return result;
  }

  async save(project: Project, origin: WorkspacePlanOrigin, serverOptions?: { expectedVersion: RecordVersion | null }) {
    if (origin === "browser-local") await requestPersistentBrowserStorage();
    const saved = await this.repository(origin).saveProjectVersioned(project, origin === "browser-local"
      ? { expectedVersion: this.localVersions.get(project.id) ?? null }
      : serverOptions);
    if (origin === "browser-local") this.localVersions.set(saved.project.id, saved.version);
    this.register(saved.project, origin);
    return saved;
  }

  async copy(project: Project, origin: WorkspacePlanOrigin, input: DuplicateProjectInput = {}) {
    // Always mint a fresh id, including copying a server plan into this browser.
    const copy = duplicateProjectModel(project, { ...input, id: `project-${crypto.randomUUID()}` });
    return this.save(copy, origin, { expectedVersion: null });
  }

  async remove(key: string) {
    const { origin, id } = this.reference(key);
    return this.repository(origin).deleteProject(id);
  }

  async importPackage(raw: string, origin: WorkspacePlanOrigin, options: ProjectPackageImportOptions = {}, canWriteResources = false) {
    const repository = this.repository(origin);
    const parsed = parseProjectPackageJson(raw);
    if (!parsed.value) return importProjectPackageJson(repository, raw, options);
    const keepResources = this.mode === "local" || (origin === "server" && canWriteResources);
    const versions = new Map<string, RecordVersion | null>();
    const port = {
      hasProject: repository.hasProject.bind(repository),
      getProject: async (id: string) => {
        const result = await repository.getProject(id);
        versions.set(id, result.version ?? null);
        return result;
      },
      saveProject: async (project: Project) => {
        const saved = await repository.saveProjectVersioned(project, this.mode === "server" ? { expectedVersion: versions.get(project.id) ?? null } : undefined);
        this.register(saved.project, origin);
        return saved.project;
      },
      hasResource: repository.hasResource.bind(repository),
      getResource: repository.getResource.bind(repository),
      saveResource: repository.saveResource.bind(repository),
    };
    const result = await importProjectPackageJson(port, exportProjectPackageJson({ projects: parsed.value.projects, resources: keepResources ? parsed.value.resources : [] }), options);
    result.projects.forEach((project) => this.register(project, origin));
    result.diagnostics.unshift(...parsed.diagnostics);
    result.skippedResources += keepResources ? 0 : parsed.value.resources.length;
    return result;
  }
}

export function isBrowserQuotaError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  return ("name" in cause && cause.name === "QuotaExceededError") || ("cause" in cause && cause.cause !== cause && isBrowserQuotaError(cause.cause));
}

/** Best effort; denying persistent storage must not prevent an explicit local save. */
export async function requestPersistentBrowserStorage(storage: Pick<StorageManager, "persist"> | undefined = globalThis.navigator?.storage): Promise<void> {
  try { await storage?.persist?.(); } catch { /* Unsupported or denied by browser policy. */ }
}
