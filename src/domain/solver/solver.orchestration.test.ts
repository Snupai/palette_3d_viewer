import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  rectangleBoundsCenter,
} from "~/domain/geometry";
import {
  PRODUCTION_REGION_SEARCH_BUDGET,
  solveLayer,
} from "~/domain/solver/solve";
import {
  BASE_GENERATOR_FAMILIES,
  type LayerSolverInput,
} from "~/domain/solver/types";
import {
  yieldBetweenSolverTests,
  basicInput,
  syntheticRegionInput,
} from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

describe("deterministic solve orchestration", () => {
  it.each([
    { packageCount: 102, candidateCount: 357, groupCapacity: 3 },
    { packageCount: 101, candidateCount: 563, groupCapacity: 2 },
  ])(
    "finds dense 121 × 76 mm layouts with exactly $packageCount packages on a EURO pallet",
    ({ packageCount, candidateCount, groupCapacity }) => {
      const bounds = { minX: 0, minY: 0, maxX: 1_200, maxY: 800 };
      const input: LayerSolverInput = {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 121, width: 76 },
          clearanceMm: 0,
        },
        physicalPalletBoundsMm: bounds,
        envelopeMm: bounds,
        generationBoundsMm: bounds,
        constraints: {
          allowedRotations: [0, 90, 180, 270],
          minimumPackageCount: packageCount,
          maximumPackageCount: packageCount,
          maxCandidatesPerGenerator: 500,
          provisionalPackagesPerCycle: groupCapacity,
          allowMixedPackageOrientations: true,
          requiredShape: "any",
          rectangularBlockFootprintPolicy: "compact-centered",
        },
      };
      const result = solveLayer(input, {
        regionTopologyBudget: PRODUCTION_REGION_SEARCH_BUDGET,
      });

      expect(result.status).toBe("completed");
      expect(result.candidates).toHaveLength(candidateCount);
      expect([
        ...new Set(
          result.candidates.map(({ metrics }) => metrics.packageCount),
        ),
      ]).toEqual([packageCount]);
      expect(
        result.candidates.every(({ validation }) => validation.valid),
      ).toBe(true);
      expect(
        result.candidates.map(({ placements }) =>
          boundingRectangleForPlacements(
            placements,
            input.package.dimensionsMm,
          ),
        ),
      ).toContainEqual({ minX: 0.5, minY: 6, maxX: 1_199.5, maxY: 794 });
    },
    30_000,
  );

  it("restricts compact-centered region frames in the exact production repro", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1_200, maxY: 800 };
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 224 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: bounds,
      envelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        allowedRotations: [0, 90, 180, 270],
        minimumPackageCount: 25,
        maximumPackageCount: 25,
        maxCandidatesPerGenerator: 500,
        provisionalPackagesPerCycle: 1,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    };
    const result = solveLayer(input, {
      includeSymmetryVariants: true,
      regionTopologyBudget: PRODUCTION_REGION_SEARCH_BUDGET,
    });
    const regionCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(({ variant }) => variant.startsWith("region-topology-")),
    );
    const expectedFullGrid = [152, 376, 600, 824, 1_048].flatMap((x) =>
      [88, 244, 400, 556, 712].map((y) => ({
        positionMm: { x, y },
        rotation: 90 as const,
      })),
    );
    const expectedMixedTopology = [
      ...[142, 366].flatMap((x) =>
        [88, 254].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[610, 834, 1_058].flatMap((x) =>
        [88, 244, 400, 556, 712].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[108, 264, 420].flatMap((x) =>
        [444, 678].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
    ];
    const fullGrid = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) ===
        canonicalPlacementGeometryKey(expectedFullGrid),
    );
    const mixedTopology = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) ===
        canonicalPlacementGeometryKey(expectedMixedTopology),
    );

    expect(result.status).toBe("completed");
    expect(result.candidates).toHaveLength(187);
    expect(regionCandidates).toHaveLength(48);
    expect(
      regionCandidates.some(({ provenance }) =>
        provenance.some(
          ({ parameters }) =>
            parameters?.framePolicy === "fill-generation-bounds",
        ),
      ),
    ).toBe(false);
    for (const candidate of regionCandidates) {
      const occupiedBounds = boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      );
      expect(occupiedBounds).not.toBeNull();
      expect(rectangleBoundsCenter(occupiedBounds!)).toEqual({
        x: 600,
        y: 400,
      });
    }
    expect(fullGrid?.rank).toBe(1);
    expect(
      boundingRectangleForPlacements(
        fullGrid?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 40, minY: 10, maxX: 1_160, maxY: 790 });
    expect(mixedTopology?.rank).toBe(2);
    expect(
      boundingRectangleForPlacements(
        mixedTopology?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 30, minY: 10, maxX: 1_170, maxY: 790 });
    expect(
      mixedTopology?.placements.filter(({ rotation }) => rotation % 180 === 0),
    ).toHaveLength(6);
    expect(
      mixedTopology?.placements.filter(({ rotation }) => rotation % 180 === 90),
    ).toHaveLength(19);
  }, 60_000);

  it("includes region symmetries in identity comparisons while respecting rotations and limits", () => {
    const result = solveLayer(syntheticRegionInput(), {
      candidateEquivalence: "identity",
    });
    expect(result.candidates).toHaveLength(48);
    expect(result.statistics.generatedByFamily.symmetry).toBe(20);
    expect(
      result.candidates.filter(
        ({ provenance }) =>
          provenance.some(({ family }) => family === "symmetry") &&
          provenance.some(
            ({ variant }) => variant === "region-topology-guillotine-v1",
          ),
      ),
    ).toHaveLength(20);
    expect([
      ...new Set(
        result.candidates.flatMap(({ placements }) =>
          placements.map(({ rotation }) => rotation),
        ),
      ),
    ]).toEqual([0]);
    expect(result.candidates.every(({ validation }) => validation.valid)).toBe(
      true,
    );
    expect(
      result.diagnostics.filter(
        ({ code, generator }) =>
          code === "generation-limit-reached" && generator === "symmetry",
      ),
    ).toHaveLength(1);
  });

  it("merges synthetic region drafts through the production candidate contracts", () => {
    const result = solveLayer(syntheticRegionInput(), {
      includeSymmetryVariants: true,
      generatorScope: "legacy",
    });
    const regionCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ family, variant }) =>
          family === "block" && variant === "region-topology-guillotine-v1",
      ),
    );

    expect(result.status).toBe("completed");
    expect(regionCandidates).toHaveLength(32);
    expect(result.statistics).toEqual({
      generatedDraftCount: 32,
      validDraftCount: 32,
      invalidDraftCount: 0,
      geometricDuplicateCount: 0,
      candidateCount: 32,
      generatedByFamily: {
        row: 0,
        block: 32,
        "justified-grid": 0,
        pinwheel: 0,
        "nested-side": 0,
        "crossed-strip": 0,
        "stepped-strip": 0,
        "stepped-block": 0,
        "slice-grid": 0,
        "paired-grid": 0,
        mosaic: 0,
        "rounded-slice": 0,
        "anchored-ring": 0,
        "capped-ring": 0,
        "asymmetric-ring": 0,
        "nested-edge": 0,
        "nested-strip": 0,
        staircase: 0,
        "staircase-variable": 0,
        "staircase-exchange": 0,
        "block-plan": 0,
        "edge-ring": 0,
        "mixed-orientation": 0,
        symmetry: 0,
      },
    });
    expect(Object.keys(result.statistics.generatedByFamily)).toEqual([
      ...BASE_GENERATOR_FAMILIES,
      "symmetry",
    ]);
    expect(regionCandidates.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
    expect(
      regionCandidates.every(
        ({ metrics, validation, provenance }) =>
          metrics.packageCount === 2 &&
          validation.valid &&
          provenance.every(
            ({ family, parameters }) =>
              family !== "symmetry" &&
              parameters?.framePolicy === "fill-generation-bounds",
          ),
      ),
    ).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "info",
        phase: "generation",
        code: "region-topology-search-completed",
        count: 32,
      }),
    );
  });

  it("searches the full normalized non-exact count range", () => {
    const result = solveLayer(syntheticRegionInput(1, 2), {
      includeSymmetryVariants: false,
      regionTopologyBudget: {
        maxWorkUnits: 100_000,
        maxFrontierStates: 2_000,
        maxRetainedDrafts: 200,
      },
    });
    const regionPackageCounts = [
      ...new Set(
        result.candidates
          .filter(({ provenance }) =>
            provenance.some(({ variant }) =>
              variant.startsWith("region-topology-"),
            ),
          )
          .map(({ metrics }) => metrics.packageCount),
      ),
    ].sort((left, right) => left - right);

    expect(result.status).toBe("completed");
    expect(regionPackageCounts).toEqual([1, 2]);
    expect(result.statistics.generatedDraftCount).toBe(36);
    expect(result.statistics.generatedByFamily.block).toBe(36);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "info",
        phase: "generation",
        code: "region-topology-search-completed",
        count: 36,
      }),
    );
    expect(result.diagnostics.map(({ code }) => code)).not.toContain(
      "generation-limit-reached",
    );
  });

  it("discards partial region work when cancellation is observed", () => {
    let cancellationChecks = 0;
    const result = solveLayer(syntheticRegionInput(), {
      includeSymmetryVariants: false,
      shouldCancel: () => {
        cancellationChecks += 1;
        return cancellationChecks >= 20;
      },
    });

    expect(cancellationChecks).toBe(20);
    expect(result.status).toBe("cancelled");
    expect(result.candidates).toEqual([]);
    expect(result.statistics.generatedDraftCount).toBe(0);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "region-topology-search-cancelled",
        "solver-cancelled",
      ]),
    );
  });

  it.each([
    {
      limit: "work-unit",
      budget: {
        maxWorkUnits: 1,
        maxFrontierStates: 2_000,
        maxRetainedDrafts: 20,
      },
      expectedCode: "region-topology-work-budget-exhausted",
      expectedMessage:
        "Region topology search used 1 of 1 work units, reached 0 of 2000 frontier states at peak, discovered 0 drafts, retained 0 within the hard storage limit of 20, and did not replace an earlier retained draft. The bounded search was truncated at its work-unit limit; 0 retained drafts were forwarded to candidate finalization.",
    },
    {
      limit: "frontier-state",
      budget: {
        maxWorkUnits: 100_000,
        maxFrontierStates: 1,
        maxRetainedDrafts: 20,
      },
      expectedCode: "region-topology-frontier-budget-exhausted",
      expectedMessage:
        "Region topology search used 1302 of 100000 work units, reached 1 of 1 frontier states at peak, discovered 0 drafts, retained 0 within the hard storage limit of 20, and did not replace an earlier retained draft. The bounded search was truncated at its frontier-state limit; 0 retained drafts were forwarded to candidate finalization.",
    },
  ])(
    "reports the $limit limit when bounded region search truncates",
    ({ budget, expectedCode, expectedMessage }) => {
      const result = solveLayer(syntheticRegionInput(), {
        includeSymmetryVariants: false,
        generatorScope: "legacy",
        regionTopologyBudget: budget,
      });

      expect(result.status).toBe("completed");
      expect(result.candidates).toEqual([]);
      expect(result.statistics.generatedByFamily.block).toBe(0);
      expect(result.diagnostics).toContainEqual({
        severity: "warning",
        phase: "generation",
        code: expectedCode,
        count: 0,
        message: expectedMessage,
      });
    },
  );

  it("reports saturated draft storage as a completed search", () => {
    const result = solveLayer(syntheticRegionInput(), {
      includeSymmetryVariants: false,
      generatorScope: "legacy",
      regionTopologyBudget: {
        maxWorkUnits: 100_000,
        maxFrontierStates: 2_000,
        maxRetainedDrafts: 1,
      },
    });

    expect(result.status).toBe("completed");
    expect(result.candidates).toHaveLength(1);
    expect(result.statistics.generatedByFamily.block).toBe(1);
    expect(
      result.diagnostics.filter(({ code }) =>
        code.startsWith("region-topology-"),
      ),
    ).toEqual([
      {
        severity: "info",
        phase: "generation",
        code: "region-topology-search-completed",
        count: 1,
        message:
          "Region topology search used 2514 of 100000 work units, reached 4 of 2000 frontier states at peak, discovered 32 drafts, retained 1 within the hard storage limit of 1, and did replace an earlier retained draft. Draft storage saturated, but work and frontier processing continued to completion.",
      },
    ]);
  });

  it.each(["pallet-symmetry", "identity"] as const)(
    "is independent of generator order and progress batching with %s",
    (candidateEquivalence) => {
      const input: LayerSolverInput = {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 180, width: 120 },
          clearanceMm: 5,
        },
        envelopeMm: { minX: -10, minY: 5, maxX: 730, maxY: 505 },
        // Exercise every family in both orders while keeping each family to a
        // handful of drafts; order and batching independence does not need
        // hundreds of equivalent spacing variants.
        constraints: { maxCandidatesPerGenerator: 5 },
      };
      const progressA: string[] = [];
      const progressB: string[] = [];
      const first = solveLayer(input, {
        candidateEquivalence,
        generatorOrder: [...BASE_GENERATOR_FAMILIES],
        progressBatchSize: 1,
        onProgress: ({ phase }) => progressA.push(phase),
      });
      const second = solveLayer(input, {
        candidateEquivalence,
        generatorOrder: [...BASE_GENERATOR_FAMILIES].reverse(),
        progressBatchSize: 97,
        onProgress: ({ phase }) => progressB.push(phase),
      });
      const comparable = (result: typeof first) => ({
        status: result.status,
        candidates: result.candidates.map(
          ({ id, geometryFingerprint, metrics, provenance }) => ({
            id,
            geometryFingerprint,
            metrics,
            provenance,
          }),
        ),
        diagnostics: result.diagnostics,
        exclusions: result.exclusions,
        statistics: result.statistics,
      });

      expect(comparable(second)).toEqual(comparable(first));
      expect(progressA.length).toBeGreaterThan(progressB.length);
      // Pin every family's draft count so the candidate cap cannot hollow out
      // coverage unnoticed. staircase-exchange yields no drafts for this
      // geometry at any cap.
      expect(first.statistics.generatedByFamily).toEqual({
        row: 5,
        block: 5,
        "justified-grid": 5,
        pinwheel: 5,
        "nested-side": 4,
        "edge-ring": 5,
        "mixed-orientation": 5,
        "crossed-strip": 5,
        "stepped-strip": 5,
        "stepped-block": 5,
        "slice-grid": 5,
        "paired-grid": 5,
        mosaic: 5,
        "rounded-slice": 5,
        "anchored-ring": 5,
        "capped-ring": 5,
        "asymmetric-ring": 5,
        "nested-edge": 5,
        "nested-strip": 5,
        staircase: 5,
        "staircase-variable": 5,
        "staircase-exchange": 0,
        "block-plan": 5,
        symmetry: 5,
      });
    },
    15_000,
  );

  it("exposes generator provenance, duplicate exclusions, and unverified Blocks", () => {
    const result = solveLayer(
      basicInput({
        constraints: {
          maxCandidatesPerGenerator: 50,
          provisionalPackagesPerCycle: 2,
        },
      }),
      { progressBatchSize: 50 },
    );
    const provenanceFamilies = new Set(
      result.candidates.flatMap(({ provenance }) =>
        provenance.map(({ family }) => family),
      ),
    );

    expect(provenanceFamilies.has("row")).toBe(true);
    expect(provenanceFamilies.has("block")).toBe(true);
    expect(provenanceFamilies.has("justified-grid")).toBe(true);
    expect(provenanceFamilies.has("pinwheel")).toBe(true);
    expect(provenanceFamilies.has("nested-side")).toBe(true);
    expect(provenanceFamilies.has("edge-ring")).toBe(true);
    expect(provenanceFamilies.has("mixed-orientation")).toBe(true);
    expect(provenanceFamilies.has("symmetry")).toBe(true);
    expect(
      result.exclusions.some(({ reason }) => reason === "geometric-duplicate"),
    ).toBe(true);
    for (const candidate of result.candidates) {
      expect(candidate.metrics.provisionalCycleCount).toBe(
        candidate.grips.length,
      );
      expect(candidate.metrics.provisionalCycleBasis).toBe(
        "generated-grip-groups",
      );
      expect(
        candidate.grips.every(
          ({ numPackages }) => numPackages >= 1 && numPackages <= 2,
        ),
      ).toBe(true);
      expect(
        candidate.placements.every(({ gripId }) =>
          candidate.grips.some(({ id }) => id === gripId),
        ),
      ).toBe(true);
    }
  });

  it("reports phases and cooperatively cancels without returning partial candidates", () => {
    let cancel = false;
    const phases: string[] = [];
    const result = solveLayer(basicInput(), {
      progressBatchSize: 1,
      onProgress: (progress) => {
        phases.push(progress.phase);
        if (progress.phase === "generation" && progress.completed >= 2) {
          cancel = true;
        }
      },
      shouldCancel: () => cancel,
    });

    expect(result.status).toBe("cancelled");
    expect(result.candidates).toEqual([]);
    expect(phases).toContain("input-validation");
    expect(phases).toContain("generation");
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "solver-cancelled",
    );
  });
});
