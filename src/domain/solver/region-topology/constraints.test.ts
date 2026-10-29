import { describe, expect, it } from "vitest";
import { realizeGuillotineConstraints } from "~/domain/solver/region-topology/constraints";
import { createRegionTopologyIdentity } from "~/domain/solver/region-topology/identity";
import type {
  OwnedStructuralRegionGraph,
  RegionSearchBudget,
  RegionShape,
} from "~/domain/solver/region-topology/model";
import { createOrderedGuillotineCutTemplate } from "~/domain/solver/region-topology/topologies/guillotine";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

const budget: RegionSearchBudget = {
  maxWorkUnits: 100,
  maxFrontierStates: 20,
  maxRetainedDrafts: 20,
};

const single: RegionShape = {
  key: "shape-single",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 1,
  rows: 1,
  packageCount: 1,
  naturalSizeMm: { length: 2, width: 1 },
};

const pair: RegionShape = {
  key: "shape-pair",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 2,
  rows: 1,
  packageCount: 2,
  naturalSizeMm: { length: 5, width: 1 },
};

function input(): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 1,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 12, maxY: 5 },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: { minX: 0, minY: 0, maxX: 12, maxY: 5 },
    generationBoundsMm: { minX: 0, minY: 0, maxX: 12, maxY: 5 },
    constraints: {
      allowedRotations: [0],
      edgeClearanceMm: 0,
      minimumPackageCount: 3,
      maximumPackageCount: 3,
      maxPlacements: 3,
      maxBands: 2,
      maxCandidatesPerGenerator: 20,
      provisionalPackagesPerCycle: 1,
      suctionRemainderPolicy: "centered-singleton",
      allowMixedPackageOrientations: false,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "fill-generation-bounds",
    },
  };
}

function topology(): OwnedStructuralRegionGraph {
  const result = createRegionTopologyIdentity(
    {
      template: createOrderedGuillotineCutTemplate("x", 2),
      assignments: [
        { slotId: "zone-0", shape: single },
        { slotId: "zone-1", shape: pair },
      ],
      targetCount: 3,
      frameBoundsMm: input().generationBoundsMm,
      symmetries: ["identity"],
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

describe("guillotine constraints", () => {
  it("pins exact centered natural bounds", () => {
    const result = realizeGuillotineConstraints(
      input(),
      topology(),
      "center-occupied-bounds",
      createRegionWorkLedger(budget),
    );

    expect(result).toEqual({
      status: "completed",
      graph: {
        topology: topology(),
        regionBoundsMm: [
          { minX: 2, minY: 2, maxX: 4, maxY: 3 },
          { minX: 5, minY: 2, maxX: 10, maxY: 3 },
        ],
        residualAssignments: [],
        framePolicy: "center-occupied-bounds",
      },
    });
  });

  it("phases centered guillotine bounds from the first package center", () => {
    const baseInput = input();
    const phaseInput: NormalizedLayerSolverInput = {
      ...baseInput,
      envelopeMm: { ...baseInput.envelopeMm, maxX: 13 },
      usableEnvelopeMm: { ...baseInput.usableEnvelopeMm, maxX: 13 },
      generationBoundsMm: { ...baseInput.generationBoundsMm, maxX: 13 },
    };
    const result = realizeGuillotineConstraints(
      phaseInput,
      topology(),
      "integer-center-occupied-bounds",
      createRegionWorkLedger(budget),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${result.status}.`,
      );
    }
    expect(result.graph.regionBoundsMm).toEqual([
      { minX: 2, minY: 1.5, maxX: 4, maxY: 2.5 },
      { minX: 5, minY: 1.5, maxX: 10, maxY: 2.5 },
    ]);
  });

  it("balances fill-frame residual across ordered children", () => {
    const result = realizeGuillotineConstraints(
      input(),
      topology(),
      "fill-generation-bounds",
      createRegionWorkLedger(budget),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${result.status}.`,
      );
    }
    expect(result.graph.regionBoundsMm).toEqual([
      { minX: 0, minY: 0, maxX: 4, maxY: 5 },
      { minX: 5, minY: 0, maxX: 12, maxY: 5 },
    ]);
    expect(result.graph.residualAssignments).toEqual([
      { sinkKey: "region-0:x", amountMm: 2 },
      { sinkKey: "region-0:y", amountMm: 4 },
      { sinkKey: "region-1:x", amountMm: 2 },
      { sinkKey: "region-1:y", amountMm: 4 },
    ]);
  });

  it("assigns fill-frame residual to the ordered cut seam", () => {
    const result = realizeGuillotineConstraints(
      input(),
      topology(),
      "fill-generation-bounds",
      createRegionWorkLedger(budget),
      [
        { x: "inter-region-seam", y: "compact" },
        { x: "inter-region-seam", y: "compact" },
      ],
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${result.status}.`,
      );
    }
    expect(result.graph.regionBoundsMm).toEqual([
      { minX: 0, minY: 0, maxX: 2, maxY: 5 },
      { minX: 7, minY: 0, maxX: 12, maxY: 5 },
    ]);
    expect(result.graph.residualAssignments).toEqual([
      { sinkKey: "root:x:seam-0", amountMm: 4 },
      { sinkKey: "region-0:y", amountMm: 4 },
      { sinkKey: "region-1:y", amountMm: 4 },
    ]);
  });

  it("returns no metric graph when cancellation is observed", () => {
    const result = realizeGuillotineConstraints(
      input(),
      topology(),
      "fill-generation-bounds",
      createRegionWorkLedger(budget, () => true),
    );

    expect(result).toEqual({ status: "stopped", reason: "cancelled" });
    expect("graph" in result).toBe(false);
  });
});
