import { describe, expect, it } from "vitest";
import { createRegionTopologyIdentity } from "~/domain/solver/region-topology/identity";
import { materializeRegionTopologyDraft } from "~/domain/solver/region-topology/materialization";
import type {
  OwnedStructuralRegionGraph,
  RegionSearchBudget,
  RegionShape,
  SpacedRegionGraph,
} from "~/domain/solver/region-topology/model";
import {
  createFullGridGuillotineTemplate,
  createOrderedGuillotineCutTemplate,
} from "~/domain/solver/region-topology/topologies/guillotine";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

const generousBudget: RegionSearchBudget = {
  maxWorkUnits: 100,
  maxFrontierStates: 20,
  maxRetainedDrafts: 20,
};

function input(
  packageCount: number,
  frameLength = 9,
): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: frameLength, maxY: 1 },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: {
      minX: 0,
      minY: 0,
      maxX: frameLength,
      maxY: 1,
    },
    generationBoundsMm: {
      minX: 0,
      minY: 0,
      maxX: frameLength,
      maxY: 1,
    },
    constraints: {
      allowedRotations: [0],
      edgeClearanceMm: 0,
      minimumPackageCount: packageCount,
      maximumPackageCount: packageCount,
      maxPlacements: packageCount,
      maxBands: 1,
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

function shape(columns: number): RegionShape {
  return {
    key: `shape-${columns}`,
    footprintClass: "lengthwise",
    representativeRotation: 0,
    columns,
    rows: 1,
    packageCount: columns,
    naturalSizeMm: { length: columns * 2, width: 1 },
  };
}

function fullGridTopology(): OwnedStructuralRegionGraph {
  const result = createRegionTopologyIdentity(
    {
      template: createFullGridGuillotineTemplate(),
      assignments: [{ slotId: "zone-0", shape: shape(3) }],
      targetCount: 3,
      frameBoundsMm: input(3).generationBoundsMm,
      symmetries: ["identity"],
    },
    createRegionWorkLedger(generousBudget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

function fullGridGraph(): SpacedRegionGraph {
  return {
    topology: fullGridTopology(),
    regionBoundsMm: [{ minX: 0, minY: 0, maxX: 9, maxY: 1 }],
    residualAssignments: [{ sinkKey: "region-0:x", amountMm: 3 }],
    framePolicy: "fill-generation-bounds",
    spacingByRegion: [
      {
        x: "continuous-space-between",
        y: "continuous-space-between",
        quantization: "continuous",
        xCentersMm: [1, 4.5, 8],
        yCentersMm: [0.5],
      },
    ],
    physicalMergeGroups: [[0]],
  };
}

describe("region topology materialization", () => {
  it("materializes exact row-major centers after reserving all placements", () => {
    const result = materializeRegionTopologyDraft(
      input(3),
      fullGridGraph(),
      createRegionWorkLedger(generousBudget),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed materialization, received ${result.status}.`,
      );
    }
    expect(result.draft.placements).toEqual([
      { positionMm: { x: 1, y: 0.5 }, rotation: 0 },
      { positionMm: { x: 4.5, y: 0.5 }, rotation: 0 },
      { positionMm: { x: 8, y: 0.5 }, rotation: 0 },
    ]);
    expect(result.draft.provenance).toEqual([
      {
        family: "block",
        variant: "region-topology-guillotine-v1",
        parameters: {
          source: "region-topology-v1",
          ownerFamily: "guillotine",
          framePolicy: "fill-generation-bounds",
        },
      },
    ]);
    expect(result.draft.regionFramePolicy).toBe("fill-generation-bounds");
    expect(result.draft.topologyFingerprint).toMatch(/^topology-v1:/);
    expect(result.draft.realizationKey).toMatch(/^realization-v1:/);
    expect(result.validation).toEqual({ valid: true, issues: [] });
  });

  it("reserves materialization work atomically before placement allocation", () => {
    const ledger = createRegionWorkLedger({
      maxWorkUnits: 2,
      maxFrontierStates: 1,
      maxRetainedDrafts: 1,
    });
    const result = materializeRegionTopologyDraft(
      input(3),
      fullGridGraph(),
      ledger,
    );

    expect(result).toEqual({
      status: "stopped",
      reason: "work-budget-exhausted",
    });
    expect(ledger.snapshot().usedByKind["materialize-placement"]).toBe(0);
    expect("draft" in result).toBe(false);
  });

  it("reports a broken spaced-graph center contract before reserving work", () => {
    const graph = fullGridGraph();
    const ledger = createRegionWorkLedger(generousBudget);
    const result = materializeRegionTopologyDraft(
      input(3),
      {
        ...graph,
        spacingByRegion: [
          {
            ...graph.spacingByRegion[0]!,
            xCentersMm: [1, 8],
          },
        ],
      },
      ledger,
    );

    expect(result).toEqual({
      status: "invalid",
      reason: "Region 0 center counts do not match its grid counts.",
    });
    expect(ledger.snapshot().usedByKind["materialize-placement"]).toBe(0);
  });

  it("returns no draft when cancellation precedes the reservation", () => {
    const result = materializeRegionTopologyDraft(
      input(3),
      fullGridGraph(),
      createRegionWorkLedger(generousBudget, () => true),
    );

    expect(result).toEqual({ status: "stopped", reason: "cancelled" });
    expect("draft" in result).toBe(false);
  });

  it("observes cancellation while materializing reserved placements", () => {
    let checks = 0;
    const ledger = createRegionWorkLedger(generousBudget, () => {
      checks += 1;
      return checks === 3;
    });

    const result = materializeRegionTopologyDraft(
      input(3),
      fullGridGraph(),
      ledger,
    );

    expect(result).toEqual({ status: "stopped", reason: "cancelled" });
    expect(ledger.snapshot().usedByKind["materialize-placement"]).toBe(3);
    expect(ledger.snapshot().cancellationObserved).toBe(true);
    expect("draft" in result).toBe(false);
  });

  it("rejects overlapping cross-region placements through candidate validation", () => {
    const twoZoneIdentity = createRegionTopologyIdentity(
      {
        template: createOrderedGuillotineCutTemplate("x", 2),
        assignments: [
          { slotId: "zone-0", shape: shape(1) },
          { slotId: "zone-1", shape: shape(1) },
        ],
        targetCount: 2,
        frameBoundsMm: input(2, 4).generationBoundsMm,
        symmetries: ["identity"],
      },
      createRegionWorkLedger(generousBudget),
    );
    if (twoZoneIdentity.status !== "completed") {
      throw new Error("Expected completed two-zone identity.");
    }
    const overlapping: SpacedRegionGraph = {
      topology: twoZoneIdentity.graph,
      regionBoundsMm: [
        { minX: 0, minY: 0, maxX: 2, maxY: 1 },
        { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      ],
      residualAssignments: [],
      framePolicy: "fill-generation-bounds",
      spacingByRegion: [
        {
          x: "compact",
          y: "compact",
          quantization: "continuous",
          xCentersMm: [1],
          yCentersMm: [0.5],
        },
        {
          x: "compact",
          y: "compact",
          quantization: "continuous",
          xCentersMm: [1],
          yCentersMm: [0.5],
        },
      ],
      physicalMergeGroups: [[0], [1]],
    };

    const result = materializeRegionTopologyDraft(
      input(2, 4),
      overlapping,
      createRegionWorkLedger(generousBudget),
    );
    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") {
      throw new Error(
        `Expected infeasible materialization, received ${result.status}.`,
      );
    }
    expect(result.validation.issues).toEqual([
      {
        code: "placement-overlap",
        message: "Placements 0 and 1 overlap or violate clearance.",
        placementIndices: [0, 1],
      },
    ]);
    expect("draft" in result).toBe(false);

    let checks = 0;
    const cancelled = materializeRegionTopologyDraft(
      input(2, 4),
      overlapping,
      createRegionWorkLedger(generousBudget, () => {
        checks += 1;
        return checks === 5;
      }),
    );
    expect(cancelled).toEqual({ status: "stopped", reason: "cancelled" });
  });
});
