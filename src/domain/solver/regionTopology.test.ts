import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION_TOPOLOGY_CATALOG_LIMITS,
  generateRegionTopologyDrafts,
  type RegionTopologyGenerationOptions,
} from "~/domain/solver/regionTopology";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

function input(): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    generationBoundsMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    constraints: {
      allowedRotations: [0],
      edgeClearanceMm: 0,
      minimumPackageCount: 2,
      maximumPackageCount: 2,
      maxPlacements: 2,
      maxBands: 2,
      maxCandidatesPerGenerator: 20,
      provisionalPackagesPerCycle: 1,
      allowMixedPackageOrientations: false,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "fill-generation-bounds",
    },
  };
}

function broadConstraintInput(): NormalizedLayerSolverInput {
  const base = input();
  const bounds = { minX: 0, minY: 0, maxX: 200, maxY: 1 };
  return {
    ...base,
    envelopeMm: bounds,
    usableEnvelopeMm: bounds,
    generationBoundsMm: bounds,
    constraints: {
      ...base.constraints,
      minimumPackageCount: 1,
      maximumPackageCount: 100,
      maxPlacements: 100,
      maxBands: 1,
    },
  };
}

function options(
  overrides: Partial<RegionTopologyGenerationOptions> = {},
): RegionTopologyGenerationOptions {
  return {
    targetCountPolicy: { kind: "exact", count: 2 },
    budget: {
      maxWorkUnits: 1_000,
      maxFrontierStates: 50,
      maxRetainedDrafts: 20,
    },
    catalogLimits: {
      maxRegionsPerTopology: 1,
    },
    framePolicies: ["fill-generation-bounds"],
    spacingSelections: [{ x: "compact", y: "compact" }],
    symmetries: ["identity"],
    ...overrides,
  };
}

describe("region topology facade", () => {
  it("defaults compact-centered footprints to occupied-bounds frame policies", () => {
    const base = input();
    const result = generateRegionTopologyDrafts(
      {
        ...base,
        constraints: {
          ...base.constraints,
          rectangularBlockFootprintPolicy: "compact-centered",
        },
      },
      options({
        budget: {
          maxWorkUnits: 100_000,
          maxFrontierStates: 2_000,
          maxRetainedDrafts: 1_000,
        },
        catalogLimits: {
          maxRegionsPerTopology: 1,
          maxPinwheelCoreDepth: 0,
        },
        framePolicies: undefined,
      }),
    );

    expect(result.status).toBe("completed");
    expect(
      [
        ...new Set(
          result.drafts.map(
            ({ provenance }) => provenance[0]?.parameters?.framePolicy,
          ),
        ),
      ],
    ).toEqual([
      "center-occupied-bounds",
      "integer-center-occupied-bounds",
    ]);
  });

  it("restricts explicit frame policies to the compact-centered footprint policy", () => {
    const base = input();
    const result = generateRegionTopologyDrafts(
      {
        ...base,
        constraints: {
          ...base.constraints,
          rectangularBlockFootprintPolicy: "compact-centered",
        },
      },
      options({
        budget: {
          maxWorkUnits: 100_000,
          maxFrontierStates: 2_000,
          maxRetainedDrafts: 1_000,
        },
        catalogLimits: {
          maxRegionsPerTopology: 1,
          maxPinwheelCoreDepth: 0,
        },
        framePolicies: [
          "center-occupied-bounds",
          "fill-generation-bounds",
        ],
      }),
    );

    expect(result.status).toBe("completed");
    expect(
      [
        ...new Set(
          result.drafts.map(
            ({ provenance }) => provenance[0]?.parameters?.framePolicy,
          ),
        ),
      ],
    ).toEqual(["center-occupied-bounds"]);
  });

  it("defaults fill-generation-bounds footprints to only the fill frame policy", () => {
    const result = generateRegionTopologyDrafts(
      input(),
      options({ framePolicies: undefined }),
    );

    expect(result.status).toBe("completed");
    expect(
      [
        ...new Set(
          result.drafts.map(
            ({ provenance }) => provenance[0]?.parameters?.framePolicy,
          ),
        ),
      ],
    ).toEqual(["fill-generation-bounds"]);
  });

  it("keeps experimental bridge-chain templates behind explicit catalog opt-in", () => {
    expect(DEFAULT_REGION_TOPOLOGY_CATALOG_LIMITS.includeBridgeChain).toBe(
      false,
    );

    const base = input();
    const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
    const bridgeInput: NormalizedLayerSolverInput = {
      ...base,
      package: {
        ...base.package,
        dimensionsMm: { length: 2, width: 1 },
      },
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...base.constraints,
        allowedRotations: [0, 90],
        minimumPackageCount: 5,
        maximumPackageCount: 5,
        maxPlacements: 5,
        maxBands: 10,
        maxCandidatesPerGenerator: 1_000,
        allowMixedPackageOrientations: true,
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    };
    const generationOptions: RegionTopologyGenerationOptions = {
      targetCountPolicy: { kind: "exact", count: 5 },
      budget: {
        maxWorkUnits: 100_000,
        maxFrontierStates: 2_000,
        maxRetainedDrafts: 1_000,
      },
      catalogLimits: {
        maxRegionsPerTopology: 1,
      },
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    };
    const production = generateRegionTopologyDrafts(
      bridgeInput,
      generationOptions,
    );
    const experimental = generateRegionTopologyDrafts(bridgeInput, {
      ...generationOptions,
      catalogLimits: {
        maxRegionsPerTopology: 1,
        includeBridgeChain: true,
      },
    });

    expect(production.status).toBe("completed");
    expect(production.drafts).toHaveLength(4);
    expect(
      production.drafts.map(
        ({ provenance }) => provenance[0]?.parameters?.ownerFamily,
      ),
    ).toEqual(["guillotine", "guillotine", "guillotine", "guillotine"]);
    expect(experimental.status).toBe("completed");
    expect(experimental.drafts).toHaveLength(16);
    expect(
      experimental.drafts.filter(
        ({ provenance }) =>
          provenance[0]?.parameters?.ownerFamily === "bridge-chain",
      ),
    ).toHaveLength(12);
  });

  it("runs the bounded guillotine pipeline without solver integration", () => {
    const result = generateRegionTopologyDrafts(input(), options());

    expect(result.status).toBe("completed");
    expect(result.targetCountPlan).toEqual({
      policy: { kind: "exact", count: 2 },
      geometricUpperBound: 2,
      searchCountsDescending: [2],
      provenUnreachableRanges: [],
    });
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map(({ placements }) => placements.length)).toEqual([
      2, 2,
    ]);
    expect(result.work.usedByKind["count-dp-word"]).toBe(4);
    expect(result.work.usedByKind["spacing-realization"]).toBe(6);
    expect(
      result.drafts.every(
        ({ topologyFingerprint, realizationKey }) =>
          topologyFingerprint.startsWith("topology-v1:") &&
          realizationKey.startsWith("realization-v1:"),
      ),
    ).toBe(true);
  });

  it("caps catalog work at the requested target-policy maximum", () => {
    const result = generateRegionTopologyDrafts(
      broadConstraintInput(),
      options({
        targetCountPolicy: { kind: "exact", count: 2 },
        budget: {
          maxWorkUnits: 30,
          maxFrontierStates: 10,
          maxRetainedDrafts: 10,
        },
      }),
    );

    expect(result.status).toBe("completed");
    expect(result.targetCountPlan).toEqual({
      policy: { kind: "exact", count: 2 },
      geometricUpperBound: 100,
      searchCountsDescending: [2],
      provenUnreachableRanges: [],
    });
    expect(result.drafts.map(({ placements }) => placements.length)).toEqual([
      2,
    ]);
    expect(result.work.totalUsed).toBe(25);
  });

  it("includes pinwheel topology drafts when the catalog enables the family", () => {
    const base = input();
    const bounds = { minX: 0, minY: 0, maxX: 9, maxY: 7 };
    const result = generateRegionTopologyDrafts(
      {
        ...base,
        envelopeMm: bounds,
        usableEnvelopeMm: bounds,
        generationBoundsMm: bounds,
        constraints: {
          ...base.constraints,
          allowedRotations: [0, 90],
          minimumPackageCount: 8,
          maximumPackageCount: 8,
          maxPlacements: 8,
          maxBands: 4,
          allowMixedPackageOrientations: true,
          rectangularBlockFootprintPolicy: "compact-centered",
        },
      },
      options({
        targetCountPolicy: { kind: "exact", count: 8 },
        budget: {
          maxWorkUnits: 100_000,
          maxFrontierStates: 2_000,
          maxRetainedDrafts: 1_000,
        },
        catalogLimits: {
          maxRegionsPerTopology: 1,
          maxPinwheelCoreDepth: 0,
        },
        framePolicies: ["center-occupied-bounds"],
        spacingSelections: [{ x: "compact", y: "compact" }],
      }),
    );

    expect(result.status).toBe("completed");
    const pinwheelDraft = result.drafts.find(({ topologyFingerprint }) =>
      topologyFingerprint.includes('"kind":"four-arm-cycle"'),
    );
    expect(pinwheelDraft?.provenance).toEqual([
      {
        family: "pinwheel",
        variant: "region-topology-pinwheel-v1",
        parameters: {
          source: "region-topology-v1",
          ownerFamily: "pinwheel",
          framePolicy: "center-occupied-bounds",
        },
      },
    ]);
  });

  it("returns no drafts when cancellation stops catalog construction", () => {
    const result = generateRegionTopologyDrafts(
      input(),
      options({ shouldCancel: () => true }),
    );

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(
        `Expected stopped generation, received ${result.status}.`,
      );
    }
    expect(result.reason).toBe("cancelled");
    expect(result.drafts).toEqual([]);
    expect(result.work.cancellationObserved).toBe(true);
  });
});
