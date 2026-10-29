import { z } from "zod";
import { duplicateProjectModel } from "~/domain/project/projectFactory";
import {
  safeMigrateProject,
  type ProjectParseDiagnostic,
} from "~/domain/project/projectMigration";
import {
  PROJECT_RESOURCE_SCHEMA_VERSION,
  projectResourceSchema,
  safeParseProjectResource,
  type ProjectResource,
} from "~/domain/project/projectResource";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  projectSchema,
  type Project,
} from "~/domain/project/projectSchema";
import {
  type ProjectConflictPolicy,
  type ProjectRepository,
  type RepositoryDiagnostic,
} from "~/lib/projectRepository";

export const PROJECT_PACKAGE_FORMAT =
  "palette-3d-viewer/project-package" as const;
export const PROJECT_PACKAGE_SCHEMA_VERSION = 1 as const;

function addDuplicateIds(
  values: readonly { id: string }[],
  path: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach(({ id }, index) => {
    if (seen.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path, index, "id"],
        message: `duplicate id "${id}"`,
      });
    }
    seen.add(id);
  });
}

export const projectPackageSchema = z
  .object({
    format: z.literal(PROJECT_PACKAGE_FORMAT),
    schemaVersion: z.literal(PROJECT_PACKAGE_SCHEMA_VERSION),
    exportedAt: z.number().finite().nonnegative(),
    projects: z.array(projectSchema),
    resources: z.array(projectResourceSchema),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIds(value.projects, "projects", context);
    addDuplicateIds(value.resources, "resources", context);
  });

const projectPackageEnvelopeSchema = z
  .object({
    format: z.literal(PROJECT_PACKAGE_FORMAT),
    schemaVersion: z.number().int(),
    exportedAt: z.number().finite().nonnegative(),
    projects: z.array(z.unknown()),
    resources: z.array(z.unknown()),
  })
  .strict();

export type ProjectPackage = z.infer<typeof projectPackageSchema>;

export type ProjectPackageDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  path: (string | number)[];
};

export type CreateProjectPackageInput = {
  projects: readonly unknown[];
  resources?: readonly unknown[];
};

function projectDiagnostic(
  index: number,
  diagnostic: ProjectParseDiagnostic,
): ProjectPackageDiagnostic {
  return {
    severity: "error",
    code: diagnostic.code,
    message: diagnostic.message,
    path: ["projects", index, ...diagnostic.path],
  };
}

export function createProjectPackage(
  input: CreateProjectPackageInput,
  dependencies: { now?: () => number } = {},
): ProjectPackage {
  const projects = input.projects.map((project) => {
    const result = safeMigrateProject(project);
    if (!result.success) {
      throw new z.ZodError(
        result.diagnostics.map((diagnostic) => ({
          code: z.ZodIssueCode.custom,
          path: diagnostic.path,
          message: diagnostic.message,
        })),
      );
    }
    return result.project;
  });
  const resources = (input.resources ?? []).map((resource) =>
    projectResourceSchema.parse(resource),
  );
  return projectPackageSchema.parse({
    format: PROJECT_PACKAGE_FORMAT,
    schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
    exportedAt: (dependencies.now ?? Date.now)(),
    projects,
    resources,
  });
}

export function exportProjectPackageJson(
  input: CreateProjectPackageInput,
  options: { now?: () => number; pretty?: boolean } = {},
): string {
  return JSON.stringify(
    createProjectPackage(input, options),
    null,
    options.pretty === false ? undefined : 2,
  );
}

export type ProjectPackageParseResult = {
  value: ProjectPackage | null;
  diagnostics: ProjectPackageDiagnostic[];
};

export function parseProjectPackageJson(
  raw: string,
): ProjectPackageParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      value: null,
      diagnostics: [
        {
          severity: "error",
          code: "invalid-json",
          message: "Project package contains invalid JSON.",
          path: [],
        },
      ],
    };
  }

  const envelope = projectPackageEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    return {
      value: null,
      diagnostics: envelope.error.issues.map((issue) => ({
        severity: "error" as const,
        code: "invalid-package-envelope",
        message: issue.message,
        path: issue.path,
      })),
    };
  }
  if (envelope.data.schemaVersion !== PROJECT_PACKAGE_SCHEMA_VERSION) {
    return {
      value: null,
      diagnostics: [
        {
          severity: "error",
          code: "unsupported-package-version",
          message: `Unsupported project package version ${envelope.data.schemaVersion}.`,
          path: ["schemaVersion"],
        },
      ],
    };
  }

  const diagnostics: ProjectPackageDiagnostic[] = [];
  const projects: Project[] = [];
  const projectIds = new Set<string>();
  envelope.data.projects.forEach((project, index) => {
    const result = safeMigrateProject(project);
    if (!result.success) {
      diagnostics.push(
        ...result.diagnostics.map((diagnostic) =>
          projectDiagnostic(index, diagnostic),
        ),
      );
      return;
    }
    if (projectIds.has(result.project.id)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-project-id",
        message: `Project id "${result.project.id}" occurs more than once.`,
        path: ["projects", index, "id"],
      });
      return;
    }
    projectIds.add(result.project.id);
    projects.push(result.project);
  });

  const resources: ProjectResource[] = [];
  const resourceIds = new Set<string>();
  envelope.data.resources.forEach((resource, index) => {
    const result = safeParseProjectResource(resource);
    if (!result.success) {
      diagnostics.push(
        ...result.diagnostics.map((diagnostic) => ({
          severity: "error" as const,
          code: diagnostic.code,
          message: diagnostic.message,
          path: ["resources", index, ...diagnostic.path],
        })),
      );
      return;
    }
    if (resourceIds.has(result.resource.id)) {
      diagnostics.push({
        severity: "error",
        code: "duplicate-resource-id",
        message: `Resource id "${result.resource.id}" occurs more than once.`,
        path: ["resources", index, "id"],
      });
      return;
    }
    resourceIds.add(result.resource.id);
    resources.push(result.resource);
  });

  const value = projectPackageSchema.parse({
    format: PROJECT_PACKAGE_FORMAT,
    schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
    exportedAt: envelope.data.exportedAt,
    projects,
    resources,
  });
  return { value, diagnostics };
}

export type ProjectPackageImportOptions = {
  conflictPolicy?: ProjectConflictPolicy;
  projectConflictPolicy?: ProjectConflictPolicy;
  resourceConflictPolicy?: ProjectConflictPolicy;
  createId?: (kind: "project" | "resource", sourceId: string) => string;
  now?: () => number;
};

export type ProjectPackageImportResult = {
  projects: Project[];
  resources: ProjectResource[];
  skippedProjects: number;
  skippedResources: number;
  diagnostics: ProjectPackageDiagnostic[];
};

function repositoryDiagnostics(
  diagnostics: readonly RepositoryDiagnostic[],
): ProjectPackageDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
  }));
}

function renamedResource(
  resource: ProjectResource,
  id: string,
  now: number,
): ProjectResource {
  return projectResourceSchema.parse({
    ...resource,
    id,
    createdAt: now,
    updatedAt: now,
    value: { ...resource.value, id },
  });
}

export async function importProjectPackageJson(
  repository: ProjectRepository,
  raw: string,
  options: ProjectPackageImportOptions = {},
): Promise<ProjectPackageImportResult> {
  const parsed = parseProjectPackageJson(raw);
  const diagnostics = [...parsed.diagnostics];
  if (!parsed.value) {
    return {
      projects: [],
      resources: [],
      skippedProjects: 0,
      skippedResources: 0,
      diagnostics,
    };
  }

  const now = options.now ?? Date.now;
  const createId =
    options.createId ??
    ((kind: "project" | "resource") =>
      `${kind}-${
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      }`);
  const defaultPolicy = options.conflictPolicy ?? "skip";
  const projectPolicy = options.projectConflictPolicy ?? defaultPolicy;
  const resourcePolicy = options.resourceConflictPolicy ?? defaultPolicy;
  const projects: Project[] = [];
  const resources: ProjectResource[] = [];
  let skippedProjects = 0;
  let skippedResources = 0;

  for (const source of parsed.value.projects) {
    let project = source;
    const hasConflict = await repository.hasProject(project.id);
    const existing = await repository.getProject(project.id);
    diagnostics.push(...repositoryDiagnostics(existing.diagnostics));
    if (hasConflict) {
      if (projectPolicy === "skip") {
        skippedProjects += 1;
        diagnostics.push({
          severity: "warning",
          code: "project-conflict-skipped",
          message: `Project "${project.id}" already exists and was skipped.`,
          path: ["projects", source.id],
        });
        continue;
      }
      if (projectPolicy === "rename") {
        const renamedId = createId("project", source.id);
        if (await repository.hasProject(renamedId)) {
          skippedProjects += 1;
          diagnostics.push({
            severity: "error",
            code: "project-rename-conflict",
            message: `Generated project id "${renamedId}" already exists; project "${source.id}" was skipped.`,
            path: ["projects", source.id, "id"],
          });
          continue;
        }
        project = duplicateProjectModel(project, { id: renamedId }, { now });
      }
    }
    await repository.saveProject(project);
    projects.push(project);
  }

  for (const source of parsed.value.resources) {
    let resource = source;
    const hasConflict = await repository.hasResource(resource.id);
    const existing = await repository.getResource(resource.id);
    diagnostics.push(...repositoryDiagnostics(existing.diagnostics));
    if (hasConflict) {
      if (resourcePolicy === "skip") {
        skippedResources += 1;
        diagnostics.push({
          severity: "warning",
          code: "resource-conflict-skipped",
          message: `Resource "${resource.id}" already exists and was skipped.`,
          path: ["resources", source.id],
        });
        continue;
      }
      if (resourcePolicy === "rename") {
        const renamedId = createId("resource", source.id);
        if (await repository.hasResource(renamedId)) {
          skippedResources += 1;
          diagnostics.push({
            severity: "error",
            code: "resource-rename-conflict",
            message: `Generated resource id "${renamedId}" already exists; resource "${source.id}" was skipped.`,
            path: ["resources", source.id, "id"],
          });
          continue;
        }
        resource = renamedResource(resource, renamedId, now());
      }
    }
    await repository.saveResource(resource);
    resources.push(resource);
  }

  return {
    projects,
    resources,
    skippedProjects,
    skippedResources,
    diagnostics,
  };
}

export async function exportRepositoryPackageJson(
  repository: ProjectRepository,
  selection: {
    projectIds?: readonly string[];
    resourceIds?: readonly string[];
  } = {},
  options: { now?: () => number; pretty?: boolean } = {},
): Promise<{ json: string; diagnostics: ProjectPackageDiagnostic[] }> {
  const diagnostics: ProjectPackageDiagnostic[] = [];
  const projects: Project[] = [];
  const resources: ProjectResource[] = [];

  if (selection.projectIds) {
    for (const id of selection.projectIds) {
      const result = await repository.getProject(id);
      diagnostics.push(...repositoryDiagnostics(result.diagnostics));
      if (result.project) projects.push(result.project);
      else {
        diagnostics.push({
          severity: "warning",
          code: "missing-project",
          message: `Project "${id}" does not exist and was not exported.`,
          path: ["projects", id],
        });
      }
    }
  } else {
    const result = await repository.listProjects();
    projects.push(...result.projects);
    diagnostics.push(...repositoryDiagnostics(result.diagnostics));
  }

  if (selection.resourceIds) {
    for (const id of selection.resourceIds) {
      const result = await repository.getResource(id);
      diagnostics.push(...repositoryDiagnostics(result.diagnostics));
      if (result.resource) resources.push(result.resource);
      else {
        diagnostics.push({
          severity: "warning",
          code: "missing-resource",
          message: `Resource "${id}" does not exist and was not exported.`,
          path: ["resources", id],
        });
      }
    }
  } else {
    const result = await repository.listResources();
    resources.push(...result.resources);
    diagnostics.push(...repositoryDiagnostics(result.diagnostics));
  }

  return {
    json: exportProjectPackageJson(
      { projects, resources },
      { now: options.now, pretty: options.pretty },
    ),
    diagnostics,
  };
}

/** Public metadata for diagnostics and compatibility displays. */
export const PROJECT_PACKAGE_CONTENT_VERSIONS = {
  project: CURRENT_PROJECT_SCHEMA_VERSION,
  resource: PROJECT_RESOURCE_SCHEMA_VERSION,
} as const;

export const exportProjectPackage = exportProjectPackageJson;
export const importProjectPackage = importProjectPackageJson;
export const parseProjectPackage = parseProjectPackageJson;
