import { describe, expect, it } from "vitest";
import {
  canonicalPlacementGeometryKey,
  createCenteredEffectivePalletEnvelope,
} from "~/domain/geometry";
import { solveLayer } from "~/domain/solver/solve";
import { type LayerSolverInput } from "~/domain/solver/types";
import observedAp5006 from "~/lib/__fixtures__/parity/ap5006-1329-00004.observed.parity.json";
import { yieldBetweenSolverTests } from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

describe("AP5006 reference geometry", () => {
  it("generates the observed 55-package balanced capped strip", () => {
    const values = observedAp5006.input.values;
    const envelopeMm = createCenteredEffectivePalletEnvelope(
      {
        length: values.pallet.lengthMm,
        width: values.pallet.widthMm,
      },
      {
        length: values.pallet.underhangLengthMm,
        width: values.pallet.underhangWidthMm,
      },
    );
    const expectedPlacements = [
      ...[95.5, 1104.5].flatMap((x) =>
        [58.5, 164.5, 270.5].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[229, 335, 441, 547, 653, 759, 865, 971].flatMap((x) =>
        [84, 245].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[70, 176, 282, 388, 494, 600, 706, 812, 918, 1024, 1130].flatMap((x) =>
        [402, 559, 716].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const expectedGeometryKey =
      canonicalPlacementGeometryKey(expectedPlacements);
    const result = solveLayer({
      package: {
        shape: values.package.shape,
        dimensionsMm: {
          length: values.package.lengthMm,
          width: values.package.widthMm,
        },
        clearanceMm: values.package.clearanceMm,
      },
      envelopeMm,
      constraints: { maxCandidatesPerGenerator: 200 },
    });
    const maximum = result.candidates[0]?.metrics.packageCount;
    const maximumCandidates = result.candidates.filter(
      ({ metrics }) => metrics.packageCount === maximum,
    );
    const observedCandidate = maximumCandidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometryKey,
    );

    expect(maximum).toBe(55);
    expect(maximumCandidates).toHaveLength(144);
    expect(
      maximumCandidates.filter(({ provenance }) =>
        provenance.some(({ variant }) => variant === "balanced-capped-block"),
      ),
    ).toHaveLength(2);
    expect(observedCandidate).toBeDefined();
    expect(observedCandidate?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 55,
        boundingBlockLengthMm: 1166,
        boundingBlockWidthMm: 789,
      }),
    );
    const observedProvenance = observedCandidate?.provenance.find(
      ({ family, variant }) =>
        family === "nested-side" && variant === "balanced-capped-strip",
    );
    expect(observedProvenance?.parameters?.topology).toBe(
      "balanced-capped-strip-v1",
    );
    expect(
      maximumCandidates.filter(
        ({ metrics }) =>
          metrics.boundingBlockLengthMm === 1166 &&
          metrics.boundingBlockWidthMm === 785,
      ),
    ).toHaveLength(1);
    expect(maximumCandidates.every(({ validation }) => validation.valid)).toBe(
      true,
    );
    // CI runners take about 2.2x the local time (52 s of 60 s before grip
    // access planning); the budget only guards against hangs.
  }, 90_000);

  it("keeps the observed 53-package four-block layout after finalization", () => {
    const envelopeMm = createCenteredEffectivePalletEnvelope(
      { length: 1200, width: 800 },
      { length: -12, width: -20 },
    );
    const expectedPlacements = [
      ...[60, 168, 276, 384, 492, 600, 708, 816, 924, 1032, 1140].flatMap((x) =>
        [556, 712].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[84, 240, 960, 1116].flatMap((x) =>
        [64, 184, 304, 424].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[372, 486, 600, 714, 828].flatMap((x) =>
        [88, 244, 400].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm,
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 200,
      },
    };
    const result = solveLayer(input, {
      generatorOrder: [
        "nested-side",
        "row",
        "block",
        "justified-grid",
        "pinwheel",
        "edge-ring",
        "mixed-orientation",
      ],
      progressBatchSize: 1,
    });
    const reordered = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "pinwheel",
        "justified-grid",
        "block",
        "row",
        "nested-side",
      ],
      progressBatchSize: 97,
    });
    const candidate = result.candidates.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "balanced-capped-block" &&
          parameters?.topology === "balanced-capped-block-v1" &&
          parameters.capColumns === 2 &&
          parameters.capRows === 4 &&
          parameters.coreColumns === 5 &&
          parameters.coreRows === 3,
      ),
    );

    expect(reordered).toEqual(result);
    expect(result.status).toBe("completed");
    expect(candidate).toBeDefined();
    expect(candidate?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 53,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(canonicalPlacementGeometryKey(candidate?.placements ?? [])).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      candidate?.provenance.find(
        ({ variant }) => variant === "balanced-capped-block",
      )?.parameters,
    ).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 36,
        coreInlineResidualMm: 24,
        coreCrossResidualMm: 0,
      }),
    );
    expect(candidate?.validation.valid).toBe(true);
  }, 15_000);

  it("keeps the clean production block inventory", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        provisionalPackagesPerCycle: 2,
        maxCandidatesPerGenerator: 500,
      },
    });
    const crossedCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(({ family }) => family === "crossed-strip"),
    );
    expect(result.candidates).toHaveLength(157);
    expect(crossedCandidates).toHaveLength(58);
    // Preserve the exact pre-existing clean-block inventory alongside the new family.
    const legacyCandidates = result.candidates.filter(
      (candidate) =>
        !crossedCandidates.includes(candidate) &&
        candidate.provenance.some(
          ({ family }) =>
            family !== "stepped-strip" &&
            family !== "stepped-block" &&
            family !== "slice-grid" &&
            family !== "paired-grid" &&
            family !== "mosaic" &&
            family !== "asymmetric-ring" &&
            family !== "anchored-ring" &&
            family !== "capped-ring" &&
            family !== "nested-strip" &&
            family !== "nested-edge" &&
            family !== "staircase" &&
            family !== "staircase-variable" &&
            family !== "staircase-exchange" &&
            family !== "rounded-slice" &&
            family !== "symmetry" &&
            family !== "block-plan",
        ),
    );
    const threeBlockCandidates = legacyCandidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "three-block-split-v1",
      ),
    );
    const distributedThreeBlockCandidates = legacyCandidates.filter(
      ({ provenance }) =>
        provenance.some(
          ({ parameters }) =>
            parameters?.topology === "three-block-split-distributed-v1",
        ),
    );
    const cFrameCandidates = legacyCandidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "four-block-c-frame-v1",
      ),
    );
    const sideCoreCandidates = legacyCandidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) =>
          parameters?.topology === "side-core-corner-bands-v1",
      ),
    );
    const cappedBlockCandidates = legacyCandidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "balanced-capped-block-v1",
      ),
    );
    const notchCandidates = legacyCandidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
      ),
    );
    const mixedOnlyCandidates = legacyCandidates.filter(({ provenance }) => {
      const baseFamilies = new Set(
        provenance
          .filter(
            ({ family, variant }) =>
              family !== "symmetry" && variant !== "occupied-bounds-center-v1",
          )
          .map(({ family }) => family),
      );
      return (
        baseFamilies.has("mixed-orientation") &&
        [...baseFamilies].every((family) => family === "mixed-orientation")
      );
    });
    const genericTwoBlockCandidates = legacyCandidates.filter(
      ({ provenance }) =>
        provenance.some(
          ({ family, variant }) =>
            family === "block" && variant.startsWith("vertical-split-"),
        ),
    );
    const splitSignatures = threeBlockCandidates
      .map(({ provenance }) => {
        const parameters = provenance.find(
          ({ parameters }) => parameters?.topology === "three-block-split-v1",
        )?.parameters;
        return [
          parameters?.outerRotation,
          parameters?.leftOuterColumns,
          parameters?.middleColumns,
          parameters?.rightOuterColumns,
        ].join(":");
      })
      .sort();
    const topologyHistogram = legacyCandidates.reduce<Record<string, number>>(
      (histogram, candidate) => {
        const topologies = new Set(
          candidate.provenance.flatMap(({ parameters }) =>
            typeof parameters?.topology === "string"
              ? [parameters.topology]
              : [],
          ),
        );
        let category = "other";
        if (topologies.has("dense-edge-notch-v1")) category = "notch";
        else if (topologies.has("balanced-capped-block-v1")) {
          category = "cappedBlock";
        } else if (topologies.has("four-block-c-frame-v1")) {
          category = "cFrame";
        } else if (topologies.has("side-core-corner-bands-v1")) {
          category = "sideCore";
        } else if (topologies.has("three-block-split-distributed-v1")) {
          category = "distributedThree";
        } else if (topologies.has("three-block-split-v1")) {
          category = "compactThree";
        } else if (
          candidate.provenance.some(
            ({ family, variant }) =>
              family === "block" && variant === "vertical-split-start",
          )
        ) {
          category = "twoBlock";
        } else if (
          candidate.provenance.some(
            ({ family, variant }) =>
              family === "mixed-orientation" &&
              variant !== "occupied-bounds-center-v1",
          )
        ) {
          category = "genericMixed";
        }
        histogram[category] = (histogram[category] ?? 0) + 1;
        return histogram;
      },
      {},
    );

    expect(result.status).toBe("completed");
    expect(legacyCandidates).toHaveLength(7);
    expect(topologyHistogram).toEqual({
      twoBlock: 1,
      compactThree: 4,
      cFrame: 1,
      cappedBlock: 1,
    });
    expect(
      legacyCandidates
        .map(({ metrics }) => metrics.provisionalCycleCount)
        .sort((left, right) => left - right),
    ).toEqual([29, 29, 29, 29, 29, 35, 36]);
    expect(
      legacyCandidates
        .map(({ metrics }) => metrics.boundingBlockLengthMm)
        .sort((left, right) => left - right),
    ).toEqual([1164, 1188, 1188, 1188, 1188, 1188, 1188]);
    expect(
      result.diagnostics.some(
        ({ code }) =>
          code === "five-block-mosaic-search-limit-reached" ||
          code === "five-block-offset-bridge-search-limit-reached",
      ),
    ).toBe(false);
    expect(mixedOnlyCandidates).toEqual([]);
    expect(genericTwoBlockCandidates).toHaveLength(1);
    expect(
      genericTwoBlockCandidates[0]?.provenance.some(
        ({ variant }) => variant === "vertical-split-start",
      ),
    ).toBe(true);
    expect(genericTwoBlockCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        provisionalCycleCount: 29,
        boundingBlockLengthMm: 1164,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(cappedBlockCandidates).toHaveLength(1);
    expect(cappedBlockCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        provisionalCycleCount: 29,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(notchCandidates).toEqual([]);
    expect(distributedThreeBlockCandidates).toEqual([]);
    expect(sideCoreCandidates).toEqual([]);
    expect(threeBlockCandidates).toHaveLength(4);
    expect(splitSignatures).toEqual([
      "0:1:5:3",
      "0:2:5:2",
      "90:1:4:4",
      "90:2:4:3",
    ]);
    expect(
      threeBlockCandidates
        .map(({ metrics }) => metrics.provisionalCycleCount)
        .sort((left, right) => left - right),
    ).toEqual([29, 29, 29, 36]);
    expect(cFrameCandidates).toHaveLength(1);
    expect(cFrameCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 53,
        provisionalCycleCount: 35,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(cFrameCandidates[0]?.validation.valid).toBe(true);
    expect(
      threeBlockCandidates.every(
        ({ metrics, validation }) =>
          metrics.packageCount === 53 &&
          metrics.boundingBlockLengthMm === 1188 &&
          metrics.boundingBlockWidthMm === 780 &&
          validation.valid,
      ),
    ).toBe(true);
  }, 15_000);

  it("keeps incomplete edge-notch layouts out of production", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        provisionalPackagesPerCycle: 2,
        maxCandidatesPerGenerator: 500,
      },
    });

    expect(result.status).toBe("completed");
    expect(
      result.candidates.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      ),
    ).toEqual([]);
  }, 15_000);
});
