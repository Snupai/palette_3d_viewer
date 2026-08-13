import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { materializeProjectSolutionStack } from "~/domain/stack";
import {
  materializedStackToPalletData,
  savedPalletToProjectV2,
} from "~/lib/projectAdapters";
import { semanticRobPlanFingerprint } from "~/lib/parityGoldenCase";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText } from "~/lib/robParser";

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
const sourceData = parseRobText(rawText);

function savedPallet(): SavedPallet {
  return {
    schemaVersion: 1,
    id: "stack-integration",
    name: "stack-integration.rob",
    createdAt: 10,
    data: sourceData,
    rawText,
    originalRawText: rawText,
  };
}

function executionOrderProject(options: {
  patternId: string;
  gripPlanningSource?: "solver-generated" | "manual";
}) {
  const pattern = {
    id: options.patternId,
    name: "Persisted order",
    grips: [
      {
        id: "right",
        groupNumber: 1,
        pickX: 0,
        pickY: 0,
        pickRotation: 0 as const,
        x: 1050,
        y: 100,
        rotation: 0 as const,
        numPackages: 1,
        dx: 0,
        dy: 0,
      },
      {
        id: "left",
        groupNumber: 2,
        pickX: 0,
        pickY: 0,
        pickRotation: 0 as const,
        x: 150,
        y: 100,
        rotation: 0 as const,
        numPackages: 1,
        dx: 0,
        dy: 0,
      },
    ],
    placements: [
      {
        id: "right-placement",
        sequence: 0,
        positionMm: { x: 1050, y: 100 },
        rotation: 0 as const,
        gripId: "right",
        labelSide: null,
      },
      {
        id: "left-placement",
        sequence: 1,
        positionMm: { x: 150, y: 100 },
        rotation: 0 as const,
        gripId: "left",
        labelSide: null,
      },
    ],
    groupOrder: ["right", "left"],
    orderDependencies: [],
    ...(options.gripPlanningSource === undefined
      ? {}
      : { gripPlanningSource: options.gripPlanningSource }),
  };
  return createProject(
    {
      id: `project-${options.patternId}`,
      package: {
        dimensionsMm: { length: 100, width: 100, height: 100 },
      },
      solutions: [
        {
          id: "solution",
          name: "Calculated solution",
          origin: "calculated",
          patterns: [pattern],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer",
                patternId: pattern.id,
                interlayerBefore: 0,
              },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution",
    },
    { now: () => 1, createId: (kind) => `${kind}-order` },
  );
}

describe("ProjectV2 materialized stack integration", () => {
  it("feeds preview, robotics, and report metrics from one physical result", () => {
    const projectV2 = savedPalletToProjectV2(savedPallet());
    const materialized = materializeProjectSolutionStack(projectV2);
    const preview = materializedStackToPalletData(materialized);

    expect(materialized.packageLayers).toHaveLength(3);
    expect(materialized.metrics.packages.perPhysicalLayer).toEqual([1, 3, 1]);
    expect(materialized.metrics.packages.totalPackageCount).toBe(5);
    expect(materialized.metrics.cycles.perPhysicalLayer).toEqual([1, 2, 1]);
    expect(materialized.metrics.cycles.totalCycleCount).toBe(4);
    expect(materialized.robotCycles).toHaveLength(4);
    expect(
      materialized.packageLayers.flatMap(({ robotCycles }) => robotCycles),
    ).toEqual(materialized.robotCycles);
    expect(
      materialized.packageLayers.flatMap(({ robotCycles }) =>
        robotCycles.map(({ placePose }) => placePose.z),
      ),
    ).toEqual(
      materialized.packageLayers.flatMap((layer) =>
        layer.robotCycles.map(() => layer.zTopMm),
      ),
    );

    expect(preview.layer_count).toBe(materialized.packageLayers.length);
    expect(preview.total_boxes).toBe(
      materialized.metrics.packages.totalPackageCount,
    );
    expect(semanticRobPlanFingerprint(preview)).toBe(
      semanticRobPlanFingerprint(sourceData),
    );
    expect(materialized.packageLayers[0]?.patternProvenance).toMatchObject({
      kind: "project-pattern",
      projectId: projectV2.id,
      solutionOrigin: "imported",
    });
  });

  it("repairs persisted solver grip order from bottom to top and left to right", () => {
    const materialized = materializeProjectSolutionStack(
      executionOrderProject({
        patternId: "solver-pattern-1-identity-legacy-candidate",
      }),
    );

    expect(
      materialized.packageLayers[0]?.grips.map(
        ({ sourceGripId, groupNumber, sequence }) => ({
          sourceGripId,
          groupNumber,
          sequence,
        }),
      ),
    ).toEqual([
      { sourceGripId: "left", groupNumber: 1, sequence: 0 },
      { sourceGripId: "right", groupNumber: 2, sequence: 1 },
    ]);
    expect(materialized.packageLayers[0]?.groupOrder).toEqual([
      "left",
      "right",
    ]);
  });

  it("preserves a manually edited order between dependency-free grips", () => {
    const materialized = materializeProjectSolutionStack(
      executionOrderProject({
        patternId: "solver-pattern-1-identity-edited-candidate",
        gripPlanningSource: "manual",
      }),
    );

    expect(
      materialized.packageLayers[0]?.grips.map(
        ({ sourceGripId, groupNumber, sequence }) => ({
          sourceGripId,
          groupNumber,
          sequence,
        }),
      ),
    ).toEqual([
      { sourceGripId: "right", groupNumber: 1, sequence: 0 },
      { sourceGripId: "left", groupNumber: 2, sequence: 1 },
    ]);
    expect(materialized.packageLayers[0]?.groupOrder).toEqual([
      "right",
      "left",
    ]);
  });
});
