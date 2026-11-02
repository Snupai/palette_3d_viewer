// @vitest-environment node
import { describe, expect, it } from "vitest";
import { translateDe } from "~/i18n";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import {
  editedImportRobDownload,
  hasRobPlan,
  libraryRobDownload,
} from "~/features/project/projectRobDownload";
import { applyProjectEditorCommand } from "~/features/editor/editorModel";
import { exportProjectRobDownload } from "~/features/robotics/robotWorkspaceModel";
import { savedPalletToProject } from "~/lib/projectAdapters";
import { CURRENT_PALLET_SCHEMA_VERSION } from "~/lib/palletPersistence";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";
import { parseRobText } from "~/lib/robParser";
import type { Project } from "~/domain/project/projectSchema";

import {
  planningStageForProject,
  productionToolGate,
} from "~/features/planning-case/planningCaseModel";

import {
  projectToProjectV2,
  migrateProject,
} from "~/domain/project/projectMigration";
import { materializeRobotCycles } from "~/domain/robotics";

const ids = { now: () => 1, createId: (kind: string) => `${kind}-rob` };

const robText = "1200 800 144\n400 300 200\n1\n1\n1 0\n\n0 0 0 1 0 0\n";

function imported(rawRobText?: string) {
  return createProject(
    {
      id: "imported",
      source: {
        kind: "rob-import",
        fileName: "line-7.rob",
        ...(rawRobText ? { rawRobText } : {}),
      },
    },
    ids,
  );
}

function stacked(layerCount: number) {
  return createProject(
    {
      id: "stacked",
      productNumber: "SKU 9",
      solutions: [
        {
          id: "solution-1",
          name: "Stacked",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 100, y: 50 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: Array.from({ length: layerCount }, (_, index) => ({
              id: `layer-${index + 1}`,
              patternId: "pattern-1",
              interlayerBefore: 0,
            })),
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    ids,
  );
}

describe("hasRobPlan", () => {
  it("offers a download for retained imports and saved stacks only", () => {
    expect(hasRobPlan(imported(robText))).toBe(true);
    expect(hasRobPlan(imported())).toBe(false);
    expect(hasRobPlan(stacked(2))).toBe(true);
    expect(hasRobPlan(stacked(0))).toBe(false);
    expect(hasRobPlan(createProject({ id: "empty" }, ids))).toBe(false);
  });
});

describe("libraryRobDownload", () => {
  it("preserves old solutions but blocks changed geometry until the stack is rebuilt", () => {
    const original = stacked(2);
    const changed = updateProject(original, {
      package: {
        ...original.package,
        dimensionsMm: { length: 800, width: 600, height: 200 },
      },
    });
    expect(changed.solutions[0]!.requiresGeometryReview).toBe(true);
    expect(
      migrateProject(projectToProjectV2(changed)).solutions[0]!
        .requiresGeometryReview,
    ).toBe(true);
    expect(
      materializeRobotCycles(changed).diagnostics.some((d) =>
        d.path?.includes("requiresGeometryReview"),
      ),
    ).toBe(true);
    expect(changed.solutions[0]!.patterns).toEqual(
      original.solutions[0]!.patterns,
    );
    expect(changed.solutions[0]!.stack).toEqual(original.solutions[0]!.stack);
    expect(planningStageForProject(changed)).toBe("generate");
    expect(productionToolGate("robotics", changed, 3).ready).toBe(false);
    expect(productionToolGate("simulation", changed, 3).ready).toBe(false);
    expect(libraryRobDownload(changed, translateDe).ok).toBe(false);
    const metadata = updateProject(original, {
      productNumber: "New name",
      package: { ...original.package, weightKg: 5 },
    });
    expect(metadata.solutions).toEqual(original.solutions);
    const source = {
      kind: "rob-import" as const,
      fileName: "original.rob",
      rawRobText: robText,
    };
    const importedChanged = updateProject(
      { ...original, source },
      { package: changed.package },
    );
    expect(importedChanged.source).toEqual(source);
    // The active plan is a calculated stack, not the imported file, so the
    // retained text would be stale; the changed geometry blocks the export.
    expect(libraryRobDownload(importedChanged, translateDe)).toEqual({
      ok: false,
      message: translateDe("project.geometryReview"),
    });
  });

  it("returns the imported file verbatim under its original name", () => {
    expect(libraryRobDownload(imported(robText), translateDe)).toEqual({
      ok: true,
      fileName: "line-7.rob",
      text: robText,
    });
  });

  it("explains why nothing can be downloaded", () => {
    expect(libraryRobDownload(imported(), translateDe)).toEqual({
      ok: false,
      message: "Dieses Projekt enthält keinen .rob-Dateitext.",
    });
    expect(libraryRobDownload(stacked(0), translateDe)).toEqual({
      ok: false,
      message:
        "Speichern Sie einen Stapel für dieses Projekt, bevor Sie einen .rob-Plan herunterladen.",
    });
  });
});

const twoGripRob = [
  "1200 800 144",
  "200 300 150",
  "1",
  "1",
  "0 0",
  "1 0",
  "2",
  "100 50 0 150 200 0 1 0 0",
  "100 50 0 450 200 0 1 0 0",
].join("\n");

function importedTwoGrip(): Project {
  return savedPalletToProject({
    schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
    id: "rob-two-grip",
    name: "two-grip.rob",
    createdAt: 1,
    data: parseRobText(twoGripRob),
    rawText: twoGripRob,
    originalRawText: twoGripRob,
  });
}

/** Persists the edit like the editor's save and reads the saved plan back. */
async function saveAndReload(project: Project): Promise<Project> {
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-saved`,
  });
  await repository.saveProject(project);
  return (await repository.getProject(project.id)).project!;
}

describe("editor saves regenerate derived plan data", () => {
  it("downloads the edited layout instead of the stale imported text", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const pattern = solution.patterns[0]!;
    expect(libraryRobDownload(imported, translateDe)).toEqual({
      ok: true,
      fileName: "two-grip.rob",
      text: twoGripRob,
    });
    expect(editedImportRobDownload(imported, translateDe)).toBeNull();

    const saved = await saveAndReload(
      applyProjectEditorCommand(imported, {
        type: "move-placements",
        mode: "pattern",
        solutionId: solution.id,
        patternId: pattern.id,
        placementIds: [pattern.placements[1]!.id],
        deltaMm: { x: 0, y: 300 },
      }),
    );

    const expected = [
      "1200 800 144",
      "200 300 150 0",
      "1",
      "1",
      "0 0",
      "1 0",
      "2",
      "100 50 0 150 200 0 1 0 0",
      "100 350 0 450 500 0 1 0 0",
    ].join("\n");
    expect(hasRobPlan(saved)).toBe(true);
    expect(libraryRobDownload(saved, translateDe)).toEqual({
      ok: true,
      fileName: "two-grip.rob",
      text: expected,
    });
    expect(editedImportRobDownload(saved, translateDe)).toEqual({
      ok: true,
      fileName: "two-grip.rob",
      text: expected,
    });
    // Robot cycles are regenerated with the layout.
    expect(
      saved.solutions[0]!.robotCycles.map(({ placePose }) => [
        placePose.x,
        placePose.y,
      ]),
    ).toEqual([
      [150, 200],
      [450, 500],
    ]);
    // The retained import is never rewritten.
    expect(saved.source).toEqual(imported.source);
  });

  it("downloads a changed grip order instead of the stale imported text", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const pattern = solution.patterns[0]!;
    const saved = await saveAndReload(
      applyProjectEditorCommand(imported, {
        type: "reorder-group",
        mode: "order",
        solutionId: solution.id,
        patternId: pattern.id,
        gripId: pattern.grips[1]!.id,
        toIndex: 0,
      }),
    );

    expect(libraryRobDownload(saved, translateDe)).toEqual({
      ok: true,
      fileName: "two-grip.rob",
      text: [
        "1200 800 144",
        "200 300 150 0",
        "1",
        "1",
        "0 0",
        "1 0",
        "2",
        "100 50 0 450 200 0 1 0 0",
        "100 50 0 150 200 0 1 0 0",
      ].join("\n"),
    });
    expect(
      saved.solutions[0]!.robotCycles.slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ placePose }) => placePose.x),
    ).toEqual([450, 150]);
  });

  it("refuses grips off the whole millimetres .rob stores instead of rounding silently", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const pattern = solution.patterns[0]!;
    const saved = await saveAndReload(
      applyProjectEditorCommand(imported, {
        type: "move-placements",
        mode: "pattern",
        solutionId: solution.id,
        patternId: pattern.id,
        placementIds: [pattern.placements[1]!.id],
        deltaMm: { x: 0, y: 0.5 },
      }),
    );
    expect(libraryRobDownload(saved, translateDe)).toEqual({
      ok: false,
      message:
        ".rob speichert nur ganze Millimeter, Griff G2 liegt bei X 450 / Y 200.5. Verschieben Sie ihn im Editor auf ganze Millimeter.",
    });
  });

  it("names an off-grid pick point and how to fix it", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const pattern = solution.patterns[0]!;
    const moved = applyProjectEditorCommand(imported, {
      type: "move-placements",
      mode: "pattern",
      solutionId: solution.id,
      patternId: pattern.id,
      placementIds: [pattern.placements[1]!.id],
      deltaMm: { x: 0, y: 100 },
    });
    // A grip whose pick point follows from odd package sizes.
    const offGridPick: Project = {
      ...moved,
      solutions: moved.solutions.map((entry) => ({
        ...entry,
        patterns: entry.patterns.map((candidate) => ({
          ...candidate,
          grips: candidate.grips.map((grip, index) =>
            index === 0 ? { ...grip, pickX: 100.5 } : grip,
          ),
        })),
      })),
    };
    expect(libraryRobDownload(offGridPick, translateDe)).toEqual({
      ok: false,
      message:
        ".rob speichert nur ganze Millimeter, aber der Greifpunkt von Griff G1 liegt bei X 100.5 / Y 50. Er ergibt sich aus Größe und Zusammensetzung des Griffs; bilden Sie den Griff anders, z. B. mit einer anderen Paketanzahl.",
    });
  });

  it("exports a calculated stack of an imported project through the robot export", () => {
    const calculated = {
      ...stacked(2),
      source: {
        kind: "rob-import" as const,
        fileName: "original.rob",
        rawRobText: robText,
      },
    };
    expect(editedImportRobDownload(calculated, translateDe)).toBeNull();
    const regular = exportProjectRobDownload(calculated);
    expect(libraryRobDownload(calculated, translateDe)).toEqual(
      regular.ok && regular.text
        ? { ok: true, fileName: regular.fileName, text: regular.text }
        : {
            ok: false,
            message: regular.diagnostics
              .map(({ message }) => message)
              .join(" "),
          },
    );
    expect(libraryRobDownload(calculated, translateDe)).not.toEqual(
      expect.objectContaining({ text: robText }),
    );
  });

  it("refuses to export packages that no longer belong to a grip", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const pattern = solution.patterns[0]!;
    const saved = await saveAndReload(
      applyProjectEditorCommand(imported, {
        type: "remove-group",
        mode: "order",
        solutionId: solution.id,
        patternId: pattern.id,
        gripId: pattern.grips[1]!.id,
      }),
    );
    expect(libraryRobDownload(saved, translateDe)).toEqual({
      ok: false,
      message:
        "1 Paket(e) gehören zu keinem Griff. Bilden Sie zuerst Griffe für alle Pakete.",
    });
    // Never falls back to the stale imported text.
    expect(hasRobPlan(saved)).toBe(true);
  });

  it("refuses interlayer thicknesses .rob cannot store", async () => {
    const imported = importedTwoGrip();
    const solution = imported.solutions[0]!;
    const withInterlayer = applyProjectEditorCommand(imported, {
      type: "set-interlayer-before",
      mode: "pattern",
      solutionId: solution.id,
      layerId: solution.stack.layers[0]!.id,
      quantity: 1,
    });
    expect(libraryRobDownload(withInterlayer, translateDe)).toEqual({
      ok: true,
      fileName: "two-grip.rob",
      text: [
        "1200 800 144",
        "200 300 150 0",
        "1",
        "1",
        "0 1",
        "1 0",
        "2",
        "100 50 0 150 200 0 1 0 0",
        "100 50 0 450 200 0 1 0 0",
      ].join("\n"),
    });
    const saved = await saveAndReload(
      applyProjectEditorCommand(withInterlayer, {
        type: "set-interlayer-thickness",
        mode: "pattern",
        solutionId: solution.id,
        thicknessMm: 10,
      }),
    );
    expect(libraryRobDownload(saved, translateDe)).toEqual({
      ok: false,
      message:
        ".rob speichert nur die Anzahl der Zwischenlagen (je 3 mm). Zwischenlagen mit anderer Dicke lassen sich nicht als .rob exportieren.",
    });
  });
});
