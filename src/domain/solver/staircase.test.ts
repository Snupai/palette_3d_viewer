import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
} from "~/domain/geometry";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { searchStaircasePatterns } from "~/domain/solver/staircase";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";

function input(
  count: number,
  clearanceMm = 0,
  rotations: readonly (0 | 90 | 180 | 270)[] = [0, 90],
) {
  return validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 3, width: 2 },
      clearanceMm,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 22, maxY: 10 },
    constraints: {
      allowedRotations: rotations,
      minimumPackageCount: count,
      maximumPackageCount: count,
      allowMixedPackageOrientations: true,
      maxCandidatesPerGenerator: 500,
      rectangularBlockFootprintPolicy: "compact-centered",
    },
  }).normalized!;
}

describe("staircase patterns", () => {
  it("bounds search work before allocation and observes cancellation", () => {
    let emitted = 0;
    const emit = () => {
      emitted++;
      return true;
    };
    expect(searchStaircasePatterns(input(36), emit, () => true, 1)).toEqual({
      workUsed: 1,
      limited: true,
    });
    expect(searchStaircasePatterns(input(36), emit, () => false)).toEqual({
      workUsed: 0,
      limited: false,
    });
    expect(emitted).toBe(0);
    expect(
      searchStaircasePatterns(input(36, 0, [0]), emit, () => true),
    ).toEqual({ workUsed: 0, limited: false });
  });

  it("honors a positive package clearance in staggered blocks", () => {
    const normalized = input(33, 1);
    normalized.generationBoundsMm = { minX: 0, minY: 0, maxX: 35, maxY: 16 };
    normalized.envelopeMm = normalized.generationBoundsMm;
    normalized.usableEnvelopeMm = normalized.generationBoundsMm;
    const drafts = generateCandidateFamily(
      normalized,
      "mixed-orientation",
    ).drafts.filter(({ provenance }) =>
      provenance.some(({ variant }) => variant === "staircase-v1"),
    );
    expect([
      ...new Set(drafts.map(({ placements }) => placements.length)),
    ]).toEqual([33]);
    for (const { placements } of drafts)
      expect(validateCandidatePlacements(normalized, placements).valid).toBe(
        true,
      );
  });
  it.each([33, 36])(
    "finds exactly %i packages in staggered blocks and a side corridor",
    (count) => {
      const normalized = input(count);
      const drafts = generateCandidateFamily(
        normalized,
        "mixed-orientation",
      ).drafts.filter(({ provenance }) =>
        provenance.some(({ variant }) => variant === "staircase-v1"),
      );
      expect([
        ...new Set(drafts.map(({ placements }) => placements.length)),
      ]).toEqual([count]);
      expect(
        drafts.map(({ placements }) =>
          boundingRectangleForPlacements(
            placements,
            normalized.package.dimensionsMm,
          ),
        ),
      ).toContainEqual({
        minX: count === 33 ? 1 : 0,
        minY: 0,
        maxX: count === 33 ? 21 : 22,
        maxY: 10,
      });
      for (const { placements } of drafts)
        expect(validateCandidatePlacements(normalized, placements).valid).toBe(
          true,
        );
      if (count === 36) {
        expect(
          drafts.some(
            ({ placements }) =>
              canonicalPlacementGeometryKey(
                placements.filter(({ positionMm }) => positionMm.x === 21),
              ) ===
              canonicalPlacementGeometryKey(
                [1.5, 5, 8.5].map((y) => ({
                  positionMm: { x: 21, y },
                  rotation: 90 as const,
                })),
              ),
          ),
        ).toBe(true);
      }
      const reversed = generateCandidateFamily(
        input(count, 0, [90, 0]),
        "mixed-orientation",
      ).drafts.filter(({ provenance }) =>
        provenance.some(({ variant }) => variant === "staircase-v1"),
      );
      expect(reversed).toEqual(drafts);
    },
  );
});
