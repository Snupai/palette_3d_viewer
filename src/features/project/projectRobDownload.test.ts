// @vitest-environment node
import { describe, expect, it } from "vitest";
import { translateDe } from "~/i18n";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import {
  hasRobPlan,
  libraryRobDownload,
} from "~/features/project/projectRobDownload";

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
    expect(libraryRobDownload(importedChanged, translateDe)).toEqual({
      ok: true,
      fileName: "original.rob",
      text: robText,
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
