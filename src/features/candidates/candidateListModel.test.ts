import { describe, expect, it } from "vitest";
import type { SolverCandidate } from "~/domain/solver";
import { solveLayer } from "~/domain/solver";
import {
  candidateLayoutKey,
  candidateLayoutsMatch,
  candidateRankReason,
  selectDistinctCandidateLayouts,
} from "~/features/candidates/candidateListModel";

function candidate(
  rank: number,
  placements: SolverCandidate["placements"],
  provisionalCycleCount = placements.length,
): SolverCandidate {
  const packageCount = placements.length;
  return {
    rank,
    id: `candidate-${rank}`,
    geometryId: `geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-fingerprint-${rank}`,
    orderDependencies: [],
    placements,
    grips: [],
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount,
      occupiedAreaMm2: packageCount * 800,
      utilization: packageCount / 10,
      utilizationPercent: packageCount * 10,
      boundingBlockLengthMm: 100,
      boundingBlockWidthMm: 100,
      boundingBlockAreaMm2: 10_000,
      provisionalCycleCount,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: packageCount,
      packageCount,
      utilizationMillionths: packageCount * 100_000,
      provisionalCycleCount,
      boundingBlockAreaMm2: 10_000,
      boundingBlockPerimeterMm: 400,
      multiPackBlocks: null,
    },
  };
}

describe("candidate list model", () => {
  it("groups nearby physical footprints without mutating raw candidates", () => {
    const packageSize = { length: 40, width: 20 };
    const best = candidate(1, [
      {
        sequence: 0,
        positionMm: { x: 60, y: 50.0001 },
        rotation: 0,
        labelSide: "top",
        gripId: "best-1",
      },
      {
        sequence: 1,
        positionMm: { x: 160, y: 50.0004 },
        rotation: 90,
        labelSide: "right",
        gripId: "best-2",
      },
    ]);
    const duplicate = candidate(2, [
      {
        sequence: 0,
        positionMm: { x: 60, y: 50.0004 },
        rotation: 180,
        labelSide: "top",
        gripId: "duplicate-1",
      },
      {
        sequence: 1,
        positionMm: { x: 160, y: 50.0001 },
        rotation: 270,
        labelSide: "right",
        gripId: "duplicate-2",
      },
    ]);
    const distinctCrosswise = candidate(3, [
      {
        sequence: 0,
        positionMm: { x: 60, y: 50 },
        rotation: 90,
        labelSide: null,
        gripId: "crosswise-1",
      },
      {
        sequence: 1,
        positionMm: { x: 160, y: 50 },
        rotation: 0,
        labelSide: null,
        gripId: "crosswise-2",
      },
    ]);
    const differentLabel = candidate(
      4,
      best.placements.map((placement) => ({
        ...placement,
        labelSide: "bottom",
      })),
    );

    const rawCandidates = [distinctCrosswise, duplicate, best];
    const rawSnapshot = rawCandidates.map(({ id, rank, placements }) => ({
      id,
      rank,
      placements: placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    }));
    const distinct = selectDistinctCandidateLayouts(rawCandidates, packageSize);

    expect(selectDistinctCandidateLayouts(rawCandidates, packageSize)).toBe(
      distinct,
    );
    expect(candidateLayoutsMatch(best, duplicate, packageSize)).toBe(true);
    expect(candidateLayoutsMatch(distinctCrosswise, best, packageSize)).toBe(
      false,
    );
    expect(candidateLayoutsMatch(differentLabel, best, packageSize)).toBe(
      false,
    );
    expect(distinct.map(({ id, rank }) => ({ id, rank }))).toEqual([
      { id: "candidate-1", rank: 1 },
      { id: "candidate-3", rank: 3 },
    ]);
    expect(
      rawCandidates.map(({ id, rank, placements }) => ({
        id,
        rank,
        placements: placements.map(({ positionMm, rotation }) => ({
          positionMm,
          rotation,
        })),
      })),
    ).toEqual(rawSnapshot);
  });

  it("uses a real one-to-one 0.001 mm position tolerance", () => {
    const packageSize = { length: 40, width: 20 };
    const placementAt = (rank: number, x: number) =>
      candidate(rank, [
        {
          sequence: 0,
          positionMm: { x, y: 50 },
          rotation: 0,
          labelSide: null,
          gripId: `grip-${rank}`,
        },
      ]);
    const left = placementAt(1, 9.99951);
    const nearbyAcrossRoundingBoundary = placementAt(2, 10.00049);
    const muchCloserAcrossRoundingBoundary = placementAt(3, 10.00051);
    const outsideTolerance = placementAt(4, 10.0016);

    expect(
      candidateLayoutsMatch(left, nearbyAcrossRoundingBoundary, packageSize),
    ).toBe(true);
    expect(
      candidateLayoutsMatch(
        nearbyAcrossRoundingBoundary,
        muchCloserAcrossRoundingBoundary,
        packageSize,
      ),
    ).toBe(true);
    expect(candidateLayoutsMatch(left, outsideTolerance, packageSize)).toBe(
      false,
    );
    expect(
      candidateLayoutsMatch(
        placementAt(5, 0.009),
        placementAt(6, 0.01),
        packageSize,
      ),
    ).toBe(true);
    expect(
      selectDistinctCandidateLayouts(
        [outsideTolerance, nearbyAcrossRoundingBoundary, left],
        packageSize,
      ).map(({ id }) => id),
    ).toEqual(["candidate-1", "candidate-4"]);
  });

  it("keeps the best-ranked operational square-yaw variant", () => {
    const packageSize = { length: 40, width: 40 };
    const worseTwoCycleVariant = candidate(
      2,
      [
        {
          sequence: 0,
          positionMm: { x: 100, y: 80 },
          rotation: 0,
          labelSide: null,
          gripId: "worse-1",
        },
        {
          sequence: 1,
          positionMm: { x: 100, y: 120 },
          rotation: 0,
          labelSide: null,
          gripId: "worse-2",
        },
      ],
      2,
    );
    const betterOneCycleVariant = candidate(
      1,
      [
        {
          sequence: 0,
          positionMm: { x: 100, y: 80 },
          rotation: 90,
          labelSide: null,
          gripId: "better-1",
        },
        {
          sequence: 1,
          positionMm: { x: 100, y: 120 },
          rotation: 90,
          labelSide: null,
          gripId: "better-2",
        },
      ],
      1,
    );

    const distinct = selectDistinctCandidateLayouts(
      [worseTwoCycleVariant, betterOneCycleVariant],
      packageSize,
    );

    expect(distinct).toHaveLength(1);
    expect(distinct[0]?.id).toBe("candidate-1");
    expect(distinct[0]?.metrics.provisionalCycleCount).toBe(1);
  });

  it("reduces the observed square-package UI case from 27 candidates to 4 layouts", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
    const result = solveLayer(
      {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 100, width: 100 },
          clearanceMm: 0,
          inletOrientation: "lengthwise",
        },
        physicalPalletBoundsMm: bounds,
        envelopeMm: bounds,
        generationBoundsMm: bounds,
        constraints: {
          allowedRotations: [0, 90, 180, 270],
          minimumPackageCount: 6,
          maximumPackageCount: 6,
          maxCandidatesPerGenerator: 500,
          provisionalPackagesPerCycle: 2,
          allowMixedPackageOrientations: true,
          unrotatedPackageLabelSide: null,
          requiredShape: "any",
          rectangularBlockFootprintPolicy: "compact-centered",
        },
      },
      {
        includeSymmetryVariants: true,
        includeExperimentalIncompleteBlocks: true,
        progressBatchSize: 25,
      },
    );

    const packageSize = { length: 100, width: 100 };
    const distinct = selectDistinctCandidateLayouts(
      result.candidates,
      packageSize,
    );
    const rawLayoutKeys = new Set(
      result.candidates.map((item) => candidateLayoutKey(item, packageSize)),
    );
    const distinctLayoutKeys = new Set(
      distinct.map((item) => candidateLayoutKey(item, packageSize)),
    );

    expect(result.candidates).toHaveLength(27);
    expect(rawLayoutKeys.size).toBe(4);
    expect(distinct).toHaveLength(4);
    expect(distinctLayoutKeys).toEqual(rawLayoutKeys);
    expect(distinct.map(({ rank }) => rank)).toEqual([1, 3, 4, 5]);
    for (const representative of distinct) {
      const peerRanks = result.candidates
        .filter((item) =>
          candidateLayoutsMatch(representative, item, packageSize),
        )
        .map(({ rank }) => rank);
      expect(representative.rank).toBe(Math.min(...peerRanks));
    }
  });
});

describe("candidateRankReason", () => {
  const placement = {
    sequence: 0,
    positionMm: { x: 0, y: 0 },
    rotation: 0 as const,
    labelSide: null,
    gripId: "grip-1",
  };

  it("returns null without a following candidate", () => {
    expect(candidateRankReason(candidate(1, [placement]), null)).toBeNull();
  });

  it("names the first differing score component in ranker order", () => {
    const six = candidate(1, [placement, placement, placement]);
    const five = candidate(2, [placement, placement]);
    expect(candidateRankReason(six, five)).toBe(
      "More packages per layer (3 vs 2)",
    );
  });

  it("compares utilization when the package count ties", () => {
    const best = candidate(1, [placement, placement]);
    const worse = candidate(2, [placement, placement]);
    worse.score = { ...worse.score, utilizationMillionths: 150_000 };
    expect(candidateRankReason(best, worse)).toBe(
      "Higher area utilization (20.0% vs 15.0%)",
    );
  });

  it("compares cycle counts when utilization ties", () => {
    const best = candidate(1, [placement, placement], 3);
    const worse = candidate(2, [placement, placement], 4);
    expect(candidateRankReason(best, worse)).toBe(
      "Fewer robot cycles (3 vs 4)",
    );
  });

  it("compares the bounding block when cycles tie", () => {
    const best = candidate(1, [placement, placement]);
    const worse = candidate(2, [placement, placement]);
    worse.score = { ...worse.score, boundingBlockAreaMm2: 12_000 };
    worse.metrics = {
      ...worse.metrics,
      boundingBlockLengthMm: 120,
      boundingBlockAreaMm2: 12_000,
    };
    expect(candidateRankReason(best, worse)).toBe(
      "Smaller bounding block (100 × 100 mm vs 120 × 100 mm)",
    );
  });

  it("compares the perimeter when the bounding block area ties", () => {
    const best = candidate(1, [placement, placement]);
    const worse = candidate(2, [placement, placement]);
    worse.score = { ...worse.score, boundingBlockPerimeterMm: 440 };
    expect(candidateRankReason(best, worse)).toBe(
      "Tighter bounding block perimeter (400 mm vs 440 mm)",
    );
  });

  it("labels full ties as an equivalent score with a deterministic tie-break", () => {
    const best = candidate(1, [placement, placement]);
    const tied = candidate(2, [placement, placement]);
    expect(candidateRankReason(best, tied)).toBe(
      "Equivalent score — ranked ahead by the deterministic identity tie-break",
    );
  });
});
