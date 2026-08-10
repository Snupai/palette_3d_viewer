import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProject,
  createProjectV2,
} from "~/domain/project/projectFactory";
import { createProjectResource } from "~/domain/project/projectResource";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import { projectSolutionToPalletData } from "~/lib/projectAdapters";
import { semanticRobPlanFingerprint } from "~/lib/parityGoldenCase";
import {
  MemoryPlannerRecordStorage,
  ProjectConflictError,
  ProjectRepository,
} from "~/lib/projectRepository";
import {
  PALLETS_STORE_NAME,
  PROJECTS_STORE_NAME,
  PROJECT_QUARANTINE_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
} from "~/lib/plannerDatabase";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText } from "~/lib/robParser";

function project(
  id: string,
  projectNumber: string,
  productNumber: string,
  timestamp: number,
) {
  return createProject(
    { id, projectNumber, productNumber },
    { createId: (kind) => `${id}-${kind}`, now: () => timestamp },
  );
}

const rawText = readFileSync(
  resolve(
    process.cwd(),
    "src",
    "lib",
    "__fixtures__",
    "anonymized-plan-lf.rob",
  ),
  "utf8",
);

function savedPallet(): SavedPallet {
  return {
    schemaVersion: 1,
    id: "saved-rob",
    name: "legacy-product.rob",
    createdAt: 55,
    data: parseRobText(rawText),
    rawText,
    originalRawText: rawText,
  };
}

describe("project repository", () => {
  it("validates save/get/list/delete and provides deterministic search and sort", async () => {
    const storage = new MemoryPlannerRecordStorage();
    const repository = new ProjectRepository(storage);
    await repository.saveProject(project("b", "B-200", "Tea", 20));
    await repository.saveProject(project("a", "A-100", "Coffee", 10));

    expect(
      (await repository.listProjects()).projects.map(({ id }) => id),
    ).toEqual(["b", "a"]);
    expect(
      (
        await repository.listProjects({
          sortBy: "projectNumber",
          sortDirection: "asc",
        })
      ).projects.map(({ id }) => id),
    ).toEqual(["a", "b"]);
    expect(
      (await repository.searchProjects("coffee")).projects.map(({ id }) => id),
    ).toEqual(["a"]);
    expect(
      (
        await repository.listProjects({
          projectNumber: "a-1",
          productNumber: "coffee",
          sortBy: "productNumber",
          sortDirection: "asc",
        })
      ).projects.map(({ id }) => id),
    ).toEqual(["a"]);
    expect(
      (
        await repository.listProjects({
          projectNumber: "a-1",
          productNumber: "tea",
        })
      ).projects,
    ).toEqual([]);
    expect((await repository.getProject("a")).project?.productNumber).toBe(
      "Coffee",
    );
    expect(await repository.deleteProject("a")).toBe(true);
    expect(await repository.deleteProject("a")).toBe(false);
  });

  it("duplicates and saves-as without overwriting the source", async () => {
    const storage = new MemoryPlannerRecordStorage();
    const repository = new ProjectRepository(storage, {
      createId: () => "generated-copy",
      now: () => 100,
    });
    const source = project("source", "P-1", "Product", 1);
    await repository.saveProject(source);

    const duplicate = await repository.duplicateProject("source", {
      projectNumber: "P-1 copy",
    });
    const savedAs = await repository.saveProjectAs(source, {
      id: "explicit-copy",
      projectNumber: "P-2",
    });

    expect(duplicate.project).toMatchObject({
      id: "generated-copy",
      projectNumber: "P-1 copy",
      createdAt: 100,
    });
    expect(savedAs).toMatchObject({
      id: "explicit-copy",
      projectNumber: "P-2",
    });
    expect((await repository.getProject("source")).project).toEqual(source);
    await expect(
      repository.saveProjectAs(source, { id: "explicit-copy" }),
    ).rejects.toBeInstanceOf(ProjectConflictError);
  });

  it("dispatches stored V2 records and repairs them to the current version", async () => {
    const legacyProject = createProjectV2(
      { id: "v2-project" },
      { createId: (kind) => `${kind}-v2`, now: () => 1 },
    );
    const storage = new MemoryPlannerRecordStorage({
      [PROJECTS_STORE_NAME]: [legacyProject],
    });
    const repository = new ProjectRepository(storage);

    const result = await repository.getProject("v2-project");
    const persisted = (await storage.get(
      PROJECTS_STORE_NAME,
      "v2-project",
    )) as { schemaVersion: number };

    expect(result.project?.schemaVersion).toBe(3);
    expect(persisted.schemaVersion).toBe(3);
  });

  it("quarantines malformed rows and returns exact diagnostics", async () => {
    const storage = new MemoryPlannerRecordStorage({
      [PROJECTS_STORE_NAME]: [
        { id: "future-project", schemaVersion: 999, projectNumber: "future" },
      ],
    });
    const repository = new ProjectRepository(storage, { now: () => 77 });

    const result = await repository.listProjects();
    const quarantine = await storage.list(PROJECT_QUARANTINE_STORE_NAME);

    expect(result.projects).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported-project-version",
        recordId: "future-project",
        path: ["schemaVersion"],
      }),
    ]);
    expect(quarantine).toEqual([
      expect.objectContaining({
        id: "projects:future-project",
        sourceId: "future-project",
        quarantinedAt: 77,
      }),
    ]);
    expect(
      await storage.get(PROJECTS_STORE_NAME, "future-project"),
    ).toBeDefined();
  });

  it("persists reusable resources in their separate store", async () => {
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage());
    const resource = createProjectResource(
      { kind: "pallet", value: getPalletTemplate("euro") },
      { now: () => 5 },
    );

    await repository.saveResource(resource);

    expect(
      (await repository.listResources({ kind: "pallet" })).resources,
    ).toEqual([resource]);
    expect((await repository.getResource(resource.id)).resource).toEqual(
      resource,
    );
    expect(await repository.deleteResource(resource.id)).toBe(true);
  });

  it("uses safe resource version dispatch and quarantines future rows", async () => {
    const storage = new MemoryPlannerRecordStorage({
      [PROJECT_RESOURCES_STORE_NAME]: [
        { id: "future-resource", schemaVersion: 999 },
      ],
    });
    const repository = new ProjectRepository(storage, { now: () => 6 });

    const result = await repository.listResources();

    expect(result.resources).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported-resource-version",
        recordId: "future-resource",
        path: ["schemaVersion"],
      }),
    ]);
    expect(await repository.listQuarantine()).toEqual([
      expect.objectContaining({
        id: "project-resources:future-resource",
        sourceId: "future-resource",
      }),
    ]);
  });

  it("migrates SavedPallet deterministically without deleting the source", async () => {
    const legacy = savedPallet();
    const storage = new MemoryPlannerRecordStorage({
      [PALLETS_STORE_NAME]: [legacy],
    });
    const repository = new ProjectRepository(storage);

    const first = await repository.migrateSavedPalletStore();
    const second = await repository.migrateSavedPalletStore();
    const sourceRows = await storage.list(PALLETS_STORE_NAME);
    const migrated = first.projects[0]!;

    expect(first).toMatchObject({
      migratedCount: 1,
      skippedCount: 0,
      sourceDeleted: false,
    });
    expect(second).toMatchObject({
      migratedCount: 0,
      skippedCount: 1,
      sourceDeleted: false,
    });
    expect(sourceRows).toEqual([legacy]);
    expect(migrated.id).toBe(legacy.id);
    expect(
      semanticRobPlanFingerprint(projectSolutionToPalletData(migrated)),
    ).toBe(semanticRobPlanFingerprint(legacy.data));
  });

  it("rejects malformed caller data instead of persisting it", async () => {
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage());

    await expect(
      repository.saveProject({ id: "bad", schemaVersion: 3 }),
    ).rejects.toThrow();
    expect((await repository.listProjects()).projects).toEqual([]);
  });
});
