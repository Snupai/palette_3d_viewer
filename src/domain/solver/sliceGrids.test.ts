import { describe, expect, it } from "vitest";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { searchSliceGrids } from "~/domain/solver/sliceGrids";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
} from "~/domain/solver/types";

function input(gap = 0) {
  return validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 20 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 180, maxY: 110 },
    constraints: { allowedRotations: [0, 90], maxCandidatesPerGenerator: 150 },
  }).normalized!;
}
const raster = (
  xs: number[],
  ys: number[],
  rotation: 0 | 90,
): GeneratedPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ positionMm: { x, y }, rotation })));

function find(
  family: "slice-grid" | "paired-grid",
  parameters: GeneratorProvenance["parameters"],
  normalized = input(),
) {
  let found: readonly GeneratedPlacement[] | undefined;
  searchSliceGrids(
    normalized,
    (placements, provenance) => {
      if (
        Object.entries(parameters!).every(
          ([k, v]) => provenance.parameters?.[k] === v,
        )
      ) {
        found = placements;
        return false;
      }
      return true;
    },
    () => true,
    2_000_000,
    family,
  );
  return found;
}

describe("sliced and opposed-cap grids", () => {
  it("can truncate the distribution step without moving compact rows beyond the boundary", () => {
    const normalized = validateAndNormalizeSolverInput({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 31, width: 20 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 186, maxY: 111 },
      constraints: { allowedRotations: [0, 90] },
    }).normalized!;
    const placements = find(
      "slice-grid",
      {
        rotation: 0,
        rows: 4,
        crossRows: 1,
        split: 1,
        transpose: false,
        width: 186,
        grouped: false,
        quantization: "floor-step",
      },
      normalized,
    );
    expect(placements).toEqual([
      ...raster([15.5, 46.5, 77.5, 108.5, 139.5, 170.5], [10], 0),
      ...raster([10, 30, 50, 70, 90, 110, 130, 150, 170], [35.5], 90),
      ...raster([15.5, 46.5, 77.5, 108.5, 139.5, 170.5], [61, 81, 101], 0),
    ]);
    expect(validateCandidatePlacements(normalized, placements!)).toEqual({
      valid: true,
      issues: [],
    });
  });
  it("inserts a crosswise band at each of the five seams", () => {
    for (let split = 0; split <= 4; split++) {
      const placements = find("slice-grid", {
        rotation: 0,
        rows: 4,
        crossRows: 1,
        split,
        transpose: false,
        width: 180,
        grouped: false,
        quantization: "continuous",
      });
      expect(placements).toEqual([
        ...raster(
          [15, 45, 75, 105, 135, 165],
          Array.from({ length: split }, (_, i) => 10 + i * 20),
          0,
        ),
        ...raster(
          [10, 30, 50, 70, 90, 110, 130, 150, 170],
          [split * 20 + 15],
          90,
        ),
        ...raster(
          [15, 45, 75, 105, 135, 165],
          Array.from({ length: 4 - split }, (_, i) => split * 20 + 40 + i * 20),
          0,
        ),
      ]);
      expect(placements).toHaveLength(33);
    }
  });

  it("shortens the shared column between overlapping opposed caps", () => {
    const placements = find("paired-grid", {
      rotation: 90,
      rows: 3,
      crossRows: 1,
      left: 5,
      right: 5,
      alignment: "end",
      compactLeft: true,
      compactRight: false,
      reflectX: false,
      transpose: false,
      grouped: false,
      quantization: "continuous",
    });
    expect(placements).toEqual([
      ...raster([10, 30, 50, 70], [15, 45, 75], 90),
      ...raster([90], [45, 75], 90),
      ...raster([110, 130, 150, 170], [35, 65, 95], 90),
      ...raster([15, 45, 75], [100], 0),
      ...raster([95, 130, 165], [10], 0),
    ]);
    expect(validateCandidatePlacements(input(), placements!)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each(["slice-grid", "paired-grid"] as const)(
    "keeps %s deterministic, bounded and clear of collisions with a positive gap",
    (family) => {
      const normalized = input(2);
      const result = generateCandidateFamily(normalized, family);
      expect(result.drafts).toHaveLength(150);
      expect(
        result.drafts.map(
          (d) => validateCandidatePlacements(normalized, d.placements).valid,
        ),
      ).toEqual(Array<boolean>(150).fill(true));
      expect(
        generateCandidateFamily(
          {
            ...normalized,
            constraints: {
              ...normalized.constraints,
              allowedRotations: [90, 0],
            },
          },
          family,
        ),
      ).toEqual(result);
      let emitted = 0;
      expect(
        searchSliceGrids(
          normalized,
          () => {
            emitted++;
            return true;
          },
          () => false,
          100,
          family,
        ),
      ).toEqual({ workUsed: 0, limited: false });
      expect(
        searchSliceGrids(
          normalized,
          () => {
            emitted++;
            return true;
          },
          () => true,
          0,
          family,
        ),
      ).toEqual({ workUsed: 0, limited: true });
      expect(emitted).toBe(0);
    },
  );
});
