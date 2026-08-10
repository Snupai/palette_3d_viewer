import { describe, expect, it } from "vitest";
import {
  createProject,
  createProjectV2,
} from "~/domain/project/projectFactory";
import { createProjectResource } from "~/domain/project/projectResource";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import {
  PROJECT_PACKAGE_FORMAT,
  PROJECT_PACKAGE_SCHEMA_VERSION,
  exportProjectPackageJson,
  exportRepositoryPackageJson,
  importProjectPackageJson,
  parseProjectPackageJson,
} from "~/lib/projectPackage";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

function fixtureProject(id = "project-1", projectNumber = "P-1") {
  return createProject(
    { id, projectNumber, productNumber: "PRODUCT" },
    { createId: (kind) => `${id}-${kind}`, now: () => 10 },
  );
}

function fixtureResource() {
  return createProjectResource(
    { kind: "pallet", value: getPalletTemplate("euro") },
    { now: () => 20 },
  );
}

describe("portable project packages", () => {
  it("round-trips validated projects and resources through JSON", () => {
    const project = fixtureProject();
    const resource = fixtureResource();
    const json = exportProjectPackageJson(
      { projects: [project], resources: [resource] },
      { now: () => 30 },
    );

    const parsed = parseProjectPackageJson(json);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value).toEqual({
      format: PROJECT_PACKAGE_FORMAT,
      schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
      exportedAt: 30,
      projects: [project],
      resources: [resource],
    });
  });

  it("normalizes ProjectV2 content while parsing an older portable backup", () => {
    const project = createProjectV2(
      { id: "v2-project" },
      { createId: (kind) => `${kind}-v2`, now: () => 1 },
    );
    const raw = JSON.stringify({
      format: PROJECT_PACKAGE_FORMAT,
      schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
      exportedAt: 2,
      projects: [project],
      resources: [],
    });

    const parsed = parseProjectPackageJson(raw);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value?.projects[0]?.schemaVersion).toBe(3);
  });

  it("returns diagnostics for malformed JSON, unknown versions, and invalid rows", () => {
    expect(parseProjectPackageJson("{bad json")).toMatchObject({
      value: null,
      diagnostics: [expect.objectContaining({ code: "invalid-json" })],
    });

    const unknownVersion = parseProjectPackageJson(
      JSON.stringify({
        format: PROJECT_PACKAGE_FORMAT,
        schemaVersion: 99,
        exportedAt: 1,
        projects: [],
        resources: [],
      }),
    );
    expect(unknownVersion).toMatchObject({
      value: null,
      diagnostics: [
        expect.objectContaining({ code: "unsupported-package-version" }),
      ],
    });

    const invalidRow = parseProjectPackageJson(
      JSON.stringify({
        format: PROJECT_PACKAGE_FORMAT,
        schemaVersion: PROJECT_PACKAGE_SCHEMA_VERSION,
        exportedAt: 1,
        projects: [{ id: "bad", schemaVersion: 3 }],
        resources: [{ id: "bad-resource", schemaVersion: 999 }],
      }),
    );
    expect(invalidRow.value).toMatchObject({ projects: [], resources: [] });
    expect(invalidRow.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "invalid-project",
        "unsupported-resource-version",
      ]),
    );
  });

  it("applies skip, overwrite, and rename conflict policies", async () => {
    const sourceProject = fixtureProject("same-id", "IMPORTED");
    const sourceResource = fixtureResource();
    const json = exportProjectPackageJson(
      { projects: [sourceProject], resources: [sourceResource] },
      { now: () => 30 },
    );

    const skipRepository = new ProjectRepository(
      new MemoryPlannerRecordStorage(),
    );
    await skipRepository.saveProject(fixtureProject("same-id", "EXISTING"));
    await skipRepository.saveResource(sourceResource);
    const skipped = await importProjectPackageJson(skipRepository, json, {
      conflictPolicy: "skip",
    });
    expect(skipped).toMatchObject({
      projects: [],
      resources: [],
      skippedProjects: 1,
      skippedResources: 1,
    });
    expect(
      (await skipRepository.getProject("same-id")).project?.projectNumber,
    ).toBe("EXISTING");

    const mixedPolicyRepository = new ProjectRepository(
      new MemoryPlannerRecordStorage(),
    );
    await mixedPolicyRepository.saveProject(
      fixtureProject("same-id", "EXISTING"),
    );
    await mixedPolicyRepository.saveResource(sourceResource);
    const mixedPolicy = await importProjectPackageJson(
      mixedPolicyRepository,
      json,
      {
        projectConflictPolicy: "skip",
        resourceConflictPolicy: "overwrite",
      },
    );
    expect(mixedPolicy).toMatchObject({
      projects: [],
      resources: [sourceResource],
      skippedProjects: 1,
      skippedResources: 0,
    });

    const overwriteRepository = new ProjectRepository(
      new MemoryPlannerRecordStorage(),
    );
    await overwriteRepository.saveProject(
      fixtureProject("same-id", "EXISTING"),
    );
    const overwritten = await importProjectPackageJson(
      overwriteRepository,
      json,
      { conflictPolicy: "overwrite" },
    );
    expect(overwritten.projects[0]?.projectNumber).toBe("IMPORTED");
    expect(
      (await overwriteRepository.getProject("same-id")).project?.projectNumber,
    ).toBe("IMPORTED");

    const renameRepository = new ProjectRepository(
      new MemoryPlannerRecordStorage(),
    );
    await renameRepository.saveProject(fixtureProject("same-id", "EXISTING"));
    await renameRepository.saveResource(sourceResource);
    const renamed = await importProjectPackageJson(renameRepository, json, {
      conflictPolicy: "rename",
      createId: (kind) =>
        kind === "project" ? "renamed-project" : "renamed-resource",
      now: () => 100,
    });
    expect(renamed.projects[0]).toMatchObject({
      id: "renamed-project",
      createdAt: 100,
      updatedAt: 100,
    });
    expect(renamed.resources[0]).toMatchObject({
      id: "renamed-resource",
      createdAt: 100,
      updatedAt: 100,
      value: { id: "renamed-resource" },
    });
  });

  it("exports selected repository records with missing-id diagnostics", async () => {
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage());
    const project = fixtureProject();
    await repository.saveProject(project);

    const result = await exportRepositoryPackageJson(
      repository,
      { projectIds: [project.id, "missing"], resourceIds: [] },
      { now: () => 50, pretty: false },
    );
    const parsed = parseProjectPackageJson(result.json);

    expect(parsed.value?.projects).toEqual([project]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "missing-project" }),
    ]);
  });
});
