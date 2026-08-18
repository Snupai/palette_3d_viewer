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

function persistedGripId(patternId: string, index: number): string {
  return `${patternId}-grip-${index}`;
}

function executionOrderProject(options: {
  patternId: string;
  gripPlanningSource?: "solver-generated" | "manual";
  legacyManualWithoutMarker?: boolean;
}) {
  const leftGripId = persistedGripId(options.patternId, 1);
  const rightGripId = persistedGripId(options.patternId, 2);
  const manuallyOrdered =
    options.gripPlanningSource === "manual" ||
    options.legacyManualWithoutMarker === true;
  const storedOrder = manuallyOrdered
    ? [rightGripId, leftGripId]
    : [leftGripId, rightGripId];
  const gripById = new Map([
    [
      leftGripId,
      {
        id: leftGripId,
        groupNumber: 1,
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
    [
      rightGripId,
      {
        id: rightGripId,
        groupNumber: 2,
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
    ],
  ]);
  const placementIdByGripId = new Map([
    [leftGripId, `${options.patternId}-placement-1`],
    [rightGripId, `${options.patternId}-placement-2`],
  ]);
  const pattern = {
    id: options.patternId,
    name: "Persisted order",
    grips: storedOrder.map((gripId, index) => ({
      ...gripById.get(gripId)!,
      groupNumber: index + 1,
    })),
    placements: [
      {
        id: placementIdByGripId.get(leftGripId)!,
        sequence: 0,
        positionMm: { x: 150, y: 100 },
        rotation: 0 as const,
        gripId: leftGripId,
        labelSide: null,
      },
      {
        id: placementIdByGripId.get(rightGripId)!,
        sequence: 1,
        positionMm: { x: 1050, y: 100 },
        rotation: 0 as const,
        gripId: rightGripId,
        labelSide: null,
      },
    ],
    groupOrder: [...storedOrder],
    orderDependencies: [],
    ...(options.gripPlanningSource === undefined
      ? {}
      : { gripPlanningSource: options.gripPlanningSource }),
  };
  const robotCycles =
    options.gripPlanningSource === "manual"
      ? storedOrder.map((gripId, sequence) => {
          const grip = gripById.get(gripId)!;
          return {
            id: `cycle-${sequence + 1}`,
            patternId: pattern.id,
            sequence,
            gripId,
            placementIds: [placementIdByGripId.get(gripId)!],
            gripperId: null,
            pickPose: { x: 0, y: 0, z: null, rotation: 0 as const },
            placePose: {
              x: grip.x,
              y: grip.y,
              z: null,
              rotation: grip.rotation,
            },
            labelOffset: { x: grip.dx, y: grip.dy },
          };
        })
      : [];
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
          robotCycles,
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

  it("repairs persisted solver grip order by choosing the rightmost ready grip first", () => {
    const patternId = "solver-pattern-1-identity-legacy-candidate";
    const leftGripId = persistedGripId(patternId, 1);
    const rightGripId = persistedGripId(patternId, 2);
    const materialized = materializeProjectSolutionStack(
      executionOrderProject({ patternId }),
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
      { sourceGripId: rightGripId, groupNumber: 1, sequence: 0 },
      { sourceGripId: leftGripId, groupNumber: 2, sequence: 1 },
    ]);
    expect(materialized.packageLayers[0]?.groupOrder).toEqual([
      rightGripId,
      leftGripId,
    ]);
  });

  it.each([
    {
      name: "marked manual",
      options: { gripPlanningSource: "manual" as const },
    },
    {
      name: "unmarked legacy manual",
      options: { legacyManualWithoutMarker: true },
    },
  ])("preserves a $name order between dependency-free grips", ({ options }) => {
    const patternId = "solver-pattern-1-identity-edited-candidate";
    const leftGripId = persistedGripId(patternId, 1);
    const rightGripId = persistedGripId(patternId, 2);
    const materialized = materializeProjectSolutionStack(
      executionOrderProject({ patternId, ...options }),
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
      { sourceGripId: rightGripId, groupNumber: 1, sequence: 0 },
      { sourceGripId: leftGripId, groupNumber: 2, sequence: 1 },
    ]);
    expect(materialized.packageLayers[0]?.groupOrder).toEqual([
      rightGripId,
      leftGripId,
    ]);
  });
});
