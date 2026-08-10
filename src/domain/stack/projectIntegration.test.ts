import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
});
