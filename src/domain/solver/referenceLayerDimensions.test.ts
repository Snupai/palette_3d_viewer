import { expect, it } from "vitest";
import { boundingRectangleForPlacements } from "~/domain/geometry";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { BASE_GENERATOR_FAMILIES } from "~/domain/solver/types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";

// Geometric observations from the supplied packing sheets, without product data.
// These check counts and outer bounds, not identity of the photographed layouts.
it.each([
  [147, 104, 1176, 771, 59],
  [158, 82, 1148, 790, 70],
  [172, 130, 1162, 780, 40],
  [148, 148, 1184, 740, 40],
  [256, 173, 1197, 775, 20],
  [380, 250, 1130, 760, 9],
  [245, 98, 1078, 735, 32],
  [157, 110, 1178, 785, 53],
  [249, 170, 1190, 747, 21],
  [157, 106, 1166, 789, 55],
  [308, 220, 1144, 660, 11],
  [135, 91, 1183, 766, 73],
  [154, 107, 1164, 770, 54],
  [177, 123, 1200, 777, 42],
  [230, 157, 1077, 785, 23],
])(
  "fits %s × %s cartons in the observed %s × %s block with %s placements",
  (length, width, blockLength, blockWidth, count) => {
    const dimensionsMm = { length, width };
    const envelopeMm = {
      minX: 0,
      minY: 0,
      maxX: blockLength,
      maxY: blockWidth,
    };
    const input = validateAndNormalizeSolverInput({
      package: { shape: "cuboid", dimensionsMm, clearanceMm: 0 },
      envelopeMm,
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: count,
        maximumPackageCount: count,
        maxCandidatesPerGenerator: 500,
      },
    }).normalized!;
    let matched = false;
    for (const family of BASE_GENERATOR_FAMILIES) {
      matched = generateCandidateFamily(input, family).drafts.some((d) => {
        if (
          d.placements.length !== count ||
          !validateCandidatePlacements(input, d.placements).valid
        )
          return false;
        const bounds = boundingRectangleForPlacements(
          d.placements,
          dimensionsMm,
        );
        return (
          bounds !== null &&
          Math.abs(bounds.maxX - bounds.minX - blockLength) < 1e-6 &&
          Math.abs(bounds.maxY - bounds.minY - blockWidth) < 1e-6
        );
      });
      if (matched) break;
    }
    expect(matched).toBe(true);
  },
);
