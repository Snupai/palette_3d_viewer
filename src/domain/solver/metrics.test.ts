import { describe, expect, it } from "vitest";
import {
  calculateCandidateMetrics,
  scoreCandidateMetrics,
} from "~/domain/solver/metrics";
import type {
  LayerSolverInput,
  NormalizedLayerSolverInput,
  SolverCandidatePlacement,
} from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";

function normalized(input: LayerSolverInput): NormalizedLayerSolverInput {
  const validation = validateAndNormalizeSolverInput(input);
  if (!validation.valid || !validation.normalized) {
    throw new Error("Expected a valid solver input.");
  }
  return validation.normalized;
}

describe("solver geometry metrics", () => {
  it("normalizes translated bounding geometry before candidate ranking", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 5, width: 3 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0.1, minY: 0.2, maxX: 20.1, maxY: 6.2 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 8,
        maximumPackageCount: 8,
      },
    });
    const placements: SolverCandidatePlacement[] = [1.7, 4.7].flatMap(
      (y, row) =>
        [2.6, 7.6, 12.6, 17.6].map((x, column) => ({
          sequence: row * 4 + column + 1,
          positionMm: { x, y },
          rotation: 0 as const,
          labelSide: null,
          gripId: null,
        })),
    );

    const metrics = calculateCandidateMetrics(input, placements);
    const score = scoreCandidateMetrics(metrics);

    expect(metrics.boundingBlockLengthMm).toBe(20);
    expect(metrics.boundingBlockWidthMm).toBe(6);
    expect(metrics.boundingBlockAreaMm2).toBe(120);
    expect(score.boundingBlockPerimeterMm).toBe(52);
  });
});
