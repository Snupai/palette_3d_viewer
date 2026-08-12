import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectSolutionToPalletData,
  savedPalletToProject,
  savedPalletToProjectV2,
} from "~/lib/projectAdapters";
import {
  applyProjectEditorCommand,
  projectEditorOrderModel,
} from "~/features/editor/editorModel";
import { updateProject } from "~/domain/project/projectFactory";
import { semanticRobPlanFingerprint } from "~/lib/parityGoldenCase";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText, serializeRobText } from "~/lib/robParser";

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
const data = parseRobText(rawText);

function savedPallet(): SavedPallet {
  return {
    schemaVersion: 1,
    id: "saved-pallet-1",
    name: "example-product.rob",
    createdAt: 1234,
    data,
    rawText,
    originalRawText: rawText,
  };
}

describe("project v2 adapters", () => {
  it("lifts an existing saved ROB plan into the full project model", () => {
    const project = savedPalletToProjectV2(savedPallet());

    expect(project.schemaVersion).toBe(2);
    expect(project.productNumber).toBe("example-product");
    expect(project.package.dimensionsMm).toEqual({
      length: 200,
      width: 300,
      height: 150,
    });
    expect(project.package.multiPickAllowed).toBe(false);
    expect(project.package.inletOrientation).toBe("crosswise");
    expect(project.pallet?.dimensionsMm).toEqual({
      length: 1200,
      width: 800,
      height: 144,
    });
    expect(project.solutions[0]?.patterns).toHaveLength(2);
    expect(
      project.solutions[0]?.stack.layers.map(({ patternId }) => patternId),
    ).toEqual([
      "imported-pattern-1",
      "imported-pattern-2",
      "imported-pattern-1",
    ]);
  });

  it("converts the imported project solution back without semantic loss", () => {
    const project = savedPalletToProjectV2(savedPallet());
    const projected = projectSolutionToPalletData(project);

    expect(semanticRobPlanFingerprint(projected)).toBe(
      semanticRobPlanFingerprint(data),
    );
    expect(projected.interlayer).toEqual({ width: 1200, length: 800 });
    expect(projected.planner).toMatchObject({
      projectId: project.id,
      solutionId: project.activeSolutionId,
      metrics: { packageCount: 5, cycleCount: 4 },
    });
    expect(projected.planner?.layers.map(({ id }) => id)).toEqual([
      "imported-layer-1",
      "imported-layer-2",
      "imported-layer-3",
    ]);
  });

  it("accepts a report-only interlayer footprint without changing stack geometry", () => {
    const project = savedPalletToProjectV2(savedPallet());
    project.pallet!.dimensionsMm.height = 180;

    const projected = projectSolutionToPalletData(
      project,
      project.activeSolutionId,
      { interlayerDimensions: { width: 1100, length: 700 } },
    );

    expect(projected.pallet?.height).toBe(180);
    expect(projected.interlayer).toEqual({ width: 1100, length: 700 });
    expect(projected.layers[0]?.interlayerDimensions).toEqual({
      width: 1100,
      length: 700,
    });
    expect(projected.trailingInterlayerDimensions).toEqual({
      width: 1100,
      length: 700,
    });
  });

  it("maps upper-corner placement labels to the opposite descent side in preview fallbacks", () => {
    const baseProject = savedPalletToProject(savedPallet());
    const solution = baseProject.solutions[0]!;
    const pattern = solution.patterns[0]!;
    const project = updateProject(baseProject, {
      solutions: [
        {
          ...solution,
          patterns: [
            {
              ...pattern,
              grips: [],
              groupOrder: [],
              orderDependencies: [],
              placements: [
                {
                  id: "top-left-placement",
                  sequence: 0,
                  positionMm: { x: 100, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: "top_left",
                },
                {
                  id: "top-right-placement",
                  sequence: 1,
                  positionMm: { x: 300, y: 100 },
                  rotation: 0,
                  gripId: null,
                  labelSide: "top_right",
                },
              ],
            },
          ],
          stack: {
            ...solution.stack,
            layers: [
              {
                ...solution.stack.layers[0]!,
                patternId: pattern.id,
              },
            ],
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: solution.id,
    });

    const projected = projectSolutionToPalletData(project);

    expect(projected.uniqueLayers[1]?.map(({ blueLine }) => blueLine)).toEqual([
      "top_left",
      "top_right",
    ]);
    expect(projected.layers[0]?.boxes.map(({ blueLine }) => blueLine)).toEqual([
      "top_left",
      "top_right",
    ]);
  });

  it("keeps retained legacy text untouched while editor order remains serializable", () => {
    const project = savedPalletToProject(savedPallet());
    const solution = project.solutions[0]!;
    const pattern = solution.patterns.reduce((largest, candidate) =>
      candidate.grips.length > largest.grips.length ? candidate : largest,
    );
    const model = projectEditorOrderModel(project, solution.id, pattern.id);
    expect(model.groups.length).toBeGreaterThan(1);

    const edited = applyProjectEditorCommand(project, {
      type: "reorder-group",
      mode: "order",
      solutionId: solution.id,
      patternId: pattern.id,
      gripId: model.groups[0]!.id,
      toIndex: model.groups.length - 1,
    });
    const projected = projectSolutionToPalletData(edited);
    const reparsed = parseRobText(serializeRobText(projected));

    expect(edited.source).toEqual(project.source);
    expect(
      edited.source.kind === "rob-import" && edited.source.rawRobText,
    ).toBe(rawText);
    expect(semanticRobPlanFingerprint(reparsed)).toBe(
      semanticRobPlanFingerprint(projected),
    );
    expect(
      edited.solutions[0]?.robotCycles
        .filter(({ patternId }) => patternId === pattern.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map(({ gripId }) => gripId),
    ).toEqual(
      edited.solutions[0]?.patterns.find(({ id }) => id === pattern.id)
        ?.groupOrder,
    );
  });

  it("fails clearly when a requested solution does not exist", () => {
    const project = savedPalletToProjectV2(savedPallet());

    expect(() =>
      projectSolutionToPalletData(project, "missing-solution"),
    ).toThrow('Project solution "missing-solution" does not exist.');
  });
});
