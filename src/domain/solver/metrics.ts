import {
  boundingRectangleForPlacements,
  rectangleBoundsArea,
  rectangleBoundsLength,
  rectangleBoundsWidth,
} from "~/domain/geometry";
import { normalizeGeneratedGeometryMetric } from "~/domain/solver/geometryPolicy";
import type {
  CandidateMetrics,
  CandidateScore,
  NormalizedLayerSolverInput,
  SolverCandidate,
  SolverCandidatePlacement,
} from "~/domain/solver/types";

export function calculateCandidateMetrics(
  input: NormalizedLayerSolverInput,
  placements: readonly SolverCandidatePlacement[],
  generatedGripCount: number,
): CandidateMetrics {
  const packageCount = placements.length;
  const occupiedAreaMm2 =
    packageCount *
    input.package.dimensionsMm.length *
    input.package.dimensionsMm.width;
  const envelopeArea = rectangleBoundsArea(input.generationBoundsMm);
  const utilization = envelopeArea === 0 ? 0 : occupiedAreaMm2 / envelopeArea;
  const bounding = boundingRectangleForPlacements(
    placements,
    input.package.dimensionsMm,
  );
  const boundingBlockLengthMm = bounding
    ? normalizeGeneratedGeometryMetric(
        rectangleBoundsLength(bounding),
        "metrics.boundingBlockLengthMm",
      )
    : 0;
  const boundingBlockWidthMm = bounding
    ? normalizeGeneratedGeometryMetric(
        rectangleBoundsWidth(bounding),
        "metrics.boundingBlockWidthMm",
      )
    : 0;
  const boundingBlockAreaMm2 = normalizeGeneratedGeometryMetric(
    boundingBlockLengthMm * boundingBlockWidthMm,
    "metrics.boundingBlockAreaMm2",
  );

  return {
    packageCount,
    occupiedAreaMm2,
    utilization,
    utilizationPercent: utilization * 100,
    boundingBlockLengthMm,
    boundingBlockWidthMm,
    boundingBlockAreaMm2,
    provisionalCycleCount: generatedGripCount,
    provisionalCycleBasis: "generated-grip-groups",
    multiPackBlocks: null,
    multiPackBlocksVerification: "unverified",
  };
}

export function scoreCandidateMetrics(
  metrics: CandidateMetrics,
): CandidateScore {
  const utilizationMillionths = Math.round(metrics.utilization * 1_000_000);
  return {
    value:
      metrics.packageCount * 1_000_000_000 +
      utilizationMillionths * 1_000 -
      metrics.provisionalCycleCount,
    packageCount: metrics.packageCount,
    utilizationMillionths,
    provisionalCycleCount: metrics.provisionalCycleCount,
    boundingBlockAreaMm2: metrics.boundingBlockAreaMm2,
    boundingBlockPerimeterMm: normalizeGeneratedGeometryMetric(
      2 * (metrics.boundingBlockLengthMm + metrics.boundingBlockWidthMm),
      "score.boundingBlockPerimeterMm",
    ),
    multiPackBlocks: null,
  };
}

/**
 * Deterministic lexicographic ranking. The unknown MultiPack Blocks value is
 * intentionally absent from every comparison.
 */
export function compareSolverCandidates(
  left: Omit<SolverCandidate, "rank">,
  right: Omit<SolverCandidate, "rank">,
): number {
  if (left.score.packageCount !== right.score.packageCount) {
    return right.score.packageCount - left.score.packageCount;
  }
  if (left.score.utilizationMillionths !== right.score.utilizationMillionths) {
    return right.score.utilizationMillionths - left.score.utilizationMillionths;
  }
  if (left.score.provisionalCycleCount !== right.score.provisionalCycleCount) {
    return left.score.provisionalCycleCount - right.score.provisionalCycleCount;
  }
  if (left.score.boundingBlockAreaMm2 !== right.score.boundingBlockAreaMm2) {
    return left.score.boundingBlockAreaMm2 - right.score.boundingBlockAreaMm2;
  }
  if (
    left.score.boundingBlockPerimeterMm !== right.score.boundingBlockPerimeterMm
  ) {
    return (
      left.score.boundingBlockPerimeterMm - right.score.boundingBlockPerimeterMm
    );
  }
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  if (left.identityFingerprint !== right.identityFingerprint) {
    return left.identityFingerprint < right.identityFingerprint ? -1 : 1;
  }
  return 0;
}
