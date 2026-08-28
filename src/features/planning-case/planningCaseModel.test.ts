import { describe, expect, it } from "vitest";
import { transformPlacements, type PlacementGeometry } from "~/domain/geometry";
import { createProject } from "~/domain/project/projectFactory";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import {
  clampPlanningStage,
  comparePatternPreviews,
  planningStageForProject,
  productionToolGate,
  workflowStages,
  ROB_REFERENCE_TOLERANCE_MM,
} from "~/features/planning-case/planningCaseModel";

const palletBoundsMm = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
const packageSize = { length: 100, width: 50 };

function preview(
  id: string,
  placements: readonly PlacementGeometry[],
): LayerPatternPreview {
  return {
    id,
    label: id,
    palletBoundsMm,
    items: placements.map((placement, index) => ({
      id: `${id}-${index}`,
      centerMm: { ...placement.positionMm },
      sizeMm:
        placement.rotation === 90 || placement.rotation === 270
          ? { x: packageSize.width, y: packageSize.length }
          : { x: packageSize.length, y: packageSize.width },
      rotation: placement.rotation,
      labelSide: null,
      groupLabel: null,
    })),
    metadata: {
      source: "solver-candidate",
      sourceId: id,
      rank: 1,
      geometryId: id,
      packageCount: placements.length,
      cycleCount: placements.length,
      utilizationPercent: 10,
    },
  };
}

const referencePlacements: PlacementGeometry[] = [
  { positionMm: { x: 75, y: 50 }, rotation: 0 },
  { positionMm: { x: 220, y: 170 }, rotation: 90 },
];

describe("comparePatternPreviews", () => {
  it("reports an exact identity match", () => {
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", referencePlacements),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "exact",
      acceptedSymmetry: "identity",
      referenceCount: 2,
      currentCount: 2,
      missingCount: 0,
      extraCount: 0,
      maximumAxisDisplacementMm: 0,
    });
  });

  it("accepts an exact pallet-envelope-preserving symmetry", () => {
    const mirrored = transformPlacements(
      referencePlacements,
      palletBoundsMm,
      "mirror-x",
    );
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", mirrored),
      packageSize,
    );

    expect(result.status).toBe("exact");
    expect(result.acceptedSymmetry).toBe("mirror-x");
  });

  it("reports legacy integer-compatible geometry only after exact matching fails", () => {
    const shifted = referencePlacements.map((placement) => ({
      ...placement,
      positionMm: {
        x: placement.positionMm.x + 0.5,
        y: placement.positionMm.y - 0.5,
      },
    }));
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", shifted),
      packageSize,
    );

    expect(result.status).toBe("integer-compatible");
    expect(result.toleranceMm).toBe(ROB_REFERENCE_TOLERANCE_MM);
    expect(result.maximumAxisDisplacementMm).toBeCloseTo(0.5);
  });

  it("reports package-count differences without attempting geometry matching", () => {
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", referencePlacements.slice(0, 1)),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "count-mismatch",
      referenceCount: 2,
      currentCount: 1,
      missingCount: 1,
      extraCount: 0,
      acceptedSymmetry: null,
    });
  });

  it("reports no match when equal counts differ beyond every accepted symmetry", () => {
    const shifted = referencePlacements.map((placement) => ({
      ...placement,
      positionMm: {
        x: placement.positionMm.x + 3,
        y: placement.positionMm.y + 4,
      },
    }));
    const result = comparePatternPreviews(
      preview("reference", referencePlacements),
      preview("current", shifted),
      packageSize,
    );

    expect(result.status).toBe("no-match");
    expect(result.acceptedSymmetry).toBeNull();
  });

  it("blocks comparison when either proof surface is unavailable", () => {
    const result = comparePatternPreviews(
      null,
      preview("current", referencePlacements),
      packageSize,
    );

    expect(result).toMatchObject({
      status: "unavailable",
      referenceCount: 0,
      currentCount: 2,
    });
  });
});

describe("planning workflow stages", () => {
  it("uses a three-step generation path and a single imported plan step", () => {
    expect(workflowStages(false).map(([id]) => id)).toEqual([
      "inputs",
      "generate",
      "stack",
    ]);
    expect(workflowStages(true).map(([id, label]) => [id, label])).toEqual([
      ["inputs", "Plan"],
    ]);
  });

  it("clamps generate/stack away when the project already has a .rob", () => {
    expect(clampPlanningStage("generate", true)).toBe("inputs");
    expect(clampPlanningStage("stack", true)).toBe("inputs");
    expect(clampPlanningStage("validate", true)).toBe("inputs");
    expect(clampPlanningStage("generate", false)).toBe("generate");
  });

  it("opens a finished stack on Stack and a generated pattern on Generate", () => {
    const empty = createProject(
      { id: "empty-stage", projectNumber: "EMPTY" },
      { now: () => 1, createId: (kind) => `${kind}-empty` },
    );
    const generated = createProject(
      {
        id: "generated-stage",
        projectNumber: "GENERATED",
        solutions: [
          {
            id: "solution-1",
            name: "Generated",
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
              layers: [],
              trailingInterlayer: 0,
            },
            robotCycles: [],
          },
        ],
        activeSolutionId: "solution-1",
      },
      { now: () => 1, createId: (kind) => `${kind}-generated` },
    );
    const stacked = createProject(
      {
        id: "stacked-stage",
        projectNumber: "STACKED",
        solutions: [
          {
            id: "solution-1",
            name: "Stacked",
            origin: "calculated",
            patterns: generated.solutions[0]!.patterns,
            stack: {
              interlayerThicknessMm: 3,
              layers: [
                {
                  id: "layer-1",
                  patternId: "pattern-1",
                  interlayerBefore: 0,
                },
              ],
              trailingInterlayer: 0,
            },
            robotCycles: [],
          },
        ],
        activeSolutionId: "solution-1",
      },
      { now: () => 1, createId: (kind) => `${kind}-stacked` },
    );
    const imported = createProject(
      {
        id: "imported-stage",
        projectNumber: "IMPORTED",
        source: { kind: "rob-import", fileName: "plan.rob" },
        solutions: stacked.solutions,
        activeSolutionId: "solution-1",
      },
      { now: () => 1, createId: (kind) => `${kind}-imported` },
    );

    expect(planningStageForProject(empty)).toBe("inputs");
    expect(planningStageForProject(generated)).toBe("generate");
    expect(planningStageForProject(stacked)).toBe("stack");
    expect(planningStageForProject(imported)).toBe("inputs");
    expect(planningStageForProject(null)).toBe("inputs");
  });
});

describe("productionToolGate", () => {
  const freshProject = () =>
    createProject(
      {},
      { now: () => 1, createId: (kind) => `${kind}-gate` },
    );

  const projectWithStack = () => {
    const project = freshProject();
    const solution = project.solutions[0]!;
    return {
      ...project,
      solutions: [
        {
          ...solution,
          stack: {
            ...solution.stack,
            layers: [
              { id: "layer-1", patternId: "pattern-1", interlayerBefore: 0 },
            ],
          },
        },
      ],
    };
  };

  it("points every tool at the project inputs when no project is selected", () => {
    const gate = productionToolGate("editor", null, 0);
    expect(gate).toEqual({
      ready: false,
      missing: "No project is selected.",
      actionLabel: "Go to project inputs",
      action: { kind: "stage", stage: "inputs" },
    });
  });

  it("blocks the editor and robotics until a stack exists and names the way back", () => {
    const project = freshProject();
    for (const tool of ["editor", "robotics"]) {
      expect(productionToolGate(tool, project, 0)).toMatchObject({
        ready: false,
        actionLabel: "Build the stack",
        action: { kind: "stage", stage: "stack" },
      });
    }
    expect(productionToolGate("simulation", project, 0)).toMatchObject({
      ready: false,
      actionLabel: "Open Robotics preflight",
      action: { kind: "tool", tool: "robotics" },
    });
    expect(productionToolGate("report", project, 0)).toEqual({ ready: true });
  });

  it("opens the editor, robotics, and simulation once their prerequisites exist", () => {
    const project = projectWithStack();
    expect(productionToolGate("editor", project, 0)).toEqual({
      ready: true,
    });
    expect(productionToolGate("robotics", project, 0)).toEqual({
      ready: true,
    });
    expect(productionToolGate("simulation", project, 0)).toMatchObject({
      ready: false,
    });
    expect(productionToolGate("simulation", project, 3)).toEqual({
      ready: true,
    });
    expect(productionToolGate("candidate-browser", project, 0)).toEqual({
      ready: true,
    });
  });
});
