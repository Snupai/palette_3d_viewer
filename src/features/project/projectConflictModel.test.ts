// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { translateDe } from "~/i18n";
import { PROJECTS_STORE_NAME } from "~/lib/plannerDatabase";
import { savedPalletToProject } from "~/lib/projectAdapters";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
  RecordVersionConflictError,
} from "~/lib/projectRepository";
import { parseRobText } from "~/lib/robParser";
import {
  compareConflictPlans,
  createProjectConflict,
  isProjectVersionConflict,
  projectSaveOptions,
  readConflictServerState,
  resolveProjectConflict,
} from "./projectConflictModel";

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

function robProject(): Project {
  return savedPalletToProject({
    schemaVersion: 1,
    id: "saved-rob",
    name: "legacy-product.rob",
    createdAt: 55,
    data: parseRobText(rawText),
    rawText,
    originalRawText: rawText,
  });
}

function plan(id = "plan", projectNumber = "L-1"): Project {
  return createProject(
    { id, projectNumber, productNumber: "Coffee" },
    { createId: (kind) => `${id}-${kind}`, now: () => 100 },
  );
}

/** A repository plus the stored version of `project`, saved once. */
async function stored(project: Project) {
  const storage = new MemoryPlannerRecordStorage();
  const repository = new ProjectRepository(storage, {
    now: () => 500,
    createId: (kind) => `copy-${kind}`,
  });
  const { version } = await repository.saveProjectVersioned(project);
  return { storage, repository, version };
}

describe("projectSaveOptions", () => {
  const loaded = { projectId: "plan", version: 4 };

  it("saves against the loaded version only in server mode", () => {
    expect(projectSaveOptions("server", loaded, "plan")).toEqual({
      expectedVersion: 4,
    });
    expect(projectSaveOptions("local", loaded, "plan")).toBeUndefined();
  });

  it("writes other plans without a remembered version as before", () => {
    expect(projectSaveOptions("server", loaded, "other")).toBeUndefined();
    expect(projectSaveOptions("server", null, "plan")).toBeUndefined();
  });
});

describe("isProjectVersionConflict", () => {
  it("matches only version conflicts on the saved plan", () => {
    const conflict = new RecordVersionConflictError(
      PROJECTS_STORE_NAME,
      "plan",
      3,
      4,
    );
    expect(isProjectVersionConflict(conflict, "plan")).toBe(true);
    expect(isProjectVersionConflict(conflict, "other")).toBe(false);
    expect(isProjectVersionConflict(new Error("offline"), "plan")).toBe(false);
  });
});

describe("compareConflictPlans", () => {
  it("lists every field side by side and marks exactly the changed ones", () => {
    const server = robProject();
    const mine = updateProject(
      server,
      {
        projectNumber: "Linie 7",
        package: {
          ...server.package,
          weightKg: 12.5,
          labelSidesAtPickup: ["top", "left"],
        },
      },
      { now: () => 900 },
    );

    const comparison = compareConflictPlans(mine, server, translateDe);

    expect(
      comparison.rows
        .filter(({ differs }) => differs)
        .map(({ id, mine: left, server: right }) => [id, left, right]),
    ).toEqual([
      ["projectNumber", "Linie 7", server.projectNumber || "–"],
      ["packageWeight", "12.5 kg", "–"],
      ["labelSides", "oben, links", "–"],
      // Label sides are handling geometry, so the draft needs a review.
      ["geometryReview", "Ja", "Nein"],
    ]);
    expect(comparison.differingCount).toBe(4);
    expect(comparison.hasUnlistedDifferences).toBe(false);
    expect(comparison.rows.map(({ id }) => id)).toEqual([
      "projectNumber",
      "productNumber",
      "packageDimensions",
      "packageWeight",
      "packageClearance",
      "inletOrientation",
      "multiPick",
      "labelSides",
      "pallet",
      "overhang",
      "maxGross",
      "layerCount",
      "packagesPerLayer",
      "totalPackages",
      "interlayers",
      "patterns",
      "geometryReview",
      "gripper",
      "palletStation",
      "robotCycles",
    ]);
  });

  it("shows the real stack figures of both plan states", () => {
    const project = robProject();
    const rows = Object.fromEntries(
      compareConflictPlans(project, project, translateDe).rows.map((row) => [
        row.id,
        [row.mine, row.server, row.differs],
      ]),
    );
    expect(rows.layerCount).toEqual(["3", "3", false]);
    expect(rows.packagesPerLayer).toEqual(["1 / 3", "1 / 3", false]);
    expect(rows.totalPackages).toEqual(["5", "5", false]);
  });

  it("flags a changed pattern even when every count stays the same", () => {
    const server = robProject();
    const solution = server.solutions[0]!;
    const mine: Project = {
      ...server,
      solutions: [
        {
          ...solution,
          patterns: [
            { ...solution.patterns[0]!, name: "Muster A (neu)" },
            ...solution.patterns.slice(1),
          ],
        },
      ],
    };

    const comparison = compareConflictPlans(mine, server, translateDe);

    expect(
      comparison.rows.filter(({ differs }) => differs).map(({ id }) => id),
    ).toEqual(["patterns"]);
  });

  it("reports differences outside the listed fields instead of claiming equality", () => {
    const server = plan();
    const mine: Project = {
      ...server,
      source: { kind: "new" },
      createdAt: server.createdAt + 1,
    };
    const comparison = compareConflictPlans(mine, server, translateDe);
    expect(comparison.differingCount).toBe(0);
    expect(comparison.hasUnlistedDifferences).toBe(true);
  });

  it("ignores the save timestamp and finds identical plan states", () => {
    const server = plan();
    const mine = { ...server, updatedAt: server.updatedAt + 1000 };
    expect(compareConflictPlans(mine, server, translateDe)).toMatchObject({
      differingCount: 0,
      hasUnlistedDifferences: false,
    });
  });

  it("marks every row when the plan was deleted on the server", () => {
    const comparison = compareConflictPlans(plan(), null, translateDe);
    expect(comparison.differingCount).toBe(comparison.rows.length);
    expect(comparison.rows.every(({ server }) => server === "–")).toBe(true);
  });
});

describe("resolveProjectConflict", () => {
  /** Someone else saves `projectNumber` in between; returns their version. */
  async function concurrentSave(
    repository: ProjectRepository,
    base: Project,
    projectNumber: string,
  ) {
    return repository.saveProjectVersioned(
      updateProject(base, { projectNumber }, { now: () => 700 }),
    );
  }

  async function conflictAfterConcurrentSave() {
    const base = plan();
    const { repository, storage, version } = await stored(base);
    const theirs = await concurrentSave(repository, base, "Theirs");
    const mine = updateProject(
      base,
      { projectNumber: "Mine" },
      {
        now: () => 800,
      },
    );
    await expect(
      repository.saveProjectVersioned(mine, { expectedVersion: version }),
    ).rejects.toBeInstanceOf(RecordVersionConflictError);
    const conflict = createProjectConflict(
      mine,
      await readConflictServerState(repository, base.id),
    );
    return { repository, storage, base, mine, theirs, conflict };
  }

  it("reads the current server state into the conflict", async () => {
    const { conflict, theirs } = await conflictAfterConcurrentSave();
    expect(conflict.server?.version).toBe(2);
    expect(conflict.server?.version).toBe(theirs.version);
    expect(conflict.server?.project.projectNumber).toBe("Theirs");
    expect(conflict.refreshed).toBe(false);
  });

  it("saves the own draft against the compared server version", async () => {
    const { repository, conflict } = await conflictAfterConcurrentSave();

    const outcome = await resolveProjectConflict(
      repository,
      conflict,
      "keep-mine",
    );

    expect(outcome).toMatchObject({ kind: "saved-mine", version: 3 });
    const current = await repository.getProject("plan");
    expect(current.project?.projectNumber).toBe("Mine");
    expect(current.version).toBe(3);
  });

  it("refreshes the comparison instead of overwriting a newer server save", async () => {
    const { repository, conflict } = await conflictAfterConcurrentSave();
    await concurrentSave(repository, conflict.server!.project, "Theirs again");

    const outcome = await resolveProjectConflict(
      repository,
      conflict,
      "keep-mine",
    );

    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind !== "refreshed") return;
    expect(outcome.conflict.mine).toBe(conflict.mine);
    expect(outcome.conflict.server?.version).toBe(3);
    expect(outcome.conflict.server?.project.projectNumber).toBe("Theirs again");
    expect(outcome.conflict.refreshed).toBe(true);
    expect((await repository.getProject("plan")).project?.projectNumber).toBe(
      "Theirs again",
    );
  });

  it("adopts the server state it compared", async () => {
    const { repository, conflict } = await conflictAfterConcurrentSave();

    const outcome = await resolveProjectConflict(
      repository,
      conflict,
      "keep-server",
    );

    expect(outcome).toMatchObject({ kind: "adopted-server", version: 2 });
    if (outcome.kind !== "adopted-server") return;
    expect(outcome.project.projectNumber).toBe("Theirs");
  });

  it("refreshes instead of adopting a server state the user has not seen", async () => {
    const { repository, conflict } = await conflictAfterConcurrentSave();
    await concurrentSave(repository, conflict.server!.project, "Newer");

    const outcome = await resolveProjectConflict(
      repository,
      conflict,
      "keep-server",
    );

    expect(outcome).toMatchObject({
      kind: "refreshed",
      conflict: { server: { version: 3 }, refreshed: true },
    });
  });

  it("saves the draft as a new plan and leaves the server state alone", async () => {
    const { repository, conflict } = await conflictAfterConcurrentSave();

    const outcome = await resolveProjectConflict(
      repository,
      conflict,
      "save-copy",
      { projectNumber: "Mine Kopie" },
    );

    expect(outcome).toMatchObject({
      kind: "saved-copy",
      project: { id: "copy-project", projectNumber: "Mine Kopie" },
    });
    const original = await repository.getProject("plan");
    expect(original.project?.projectNumber).toBe("Theirs");
    expect(original.version).toBe(2);
  });

  describe("when the plan was deleted on the server", () => {
    async function deletedConflict() {
      const base = plan();
      const { repository, storage } = await stored(base);
      await storage.delete(PROJECTS_STORE_NAME, base.id);
      const conflict = createProjectConflict(
        updateProject(base, { projectNumber: "Mine" }, { now: () => 800 }),
        await readConflictServerState(repository, base.id),
      );
      return { repository, conflict };
    }

    it("has no server state to compare", async () => {
      const { conflict } = await deletedConflict();
      expect(conflict.server).toBeNull();
    });

    it("recreates the plan from the draft only while it is still gone", async () => {
      const { repository, conflict } = await deletedConflict();
      const outcome = await resolveProjectConflict(
        repository,
        conflict,
        "keep-mine",
      );
      expect(outcome).toMatchObject({
        kind: "saved-mine",
        project: { projectNumber: "Mine" },
      });
    });

    it("discards the draft and closes the plan", async () => {
      const { repository, conflict } = await deletedConflict();
      expect(
        await resolveProjectConflict(repository, conflict, "keep-server"),
      ).toEqual({ kind: "server-deleted" });
    });
  });
});
