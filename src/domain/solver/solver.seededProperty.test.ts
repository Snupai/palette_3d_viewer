import { describe, expect, it } from "vitest";
import { placementWithinBounds, placementsOverlap } from "~/domain/geometry";
import { solveLayer } from "~/domain/solver/solve";
import { type LayerSolverInput } from "~/domain/solver/types";
import {
  yieldBetweenSolverTests,
  seededRandom,
} from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

// Pull-request CI runs the first two seeded cases (same seed stream, so they
// are a prefix of the full run); pushes to main and local runs check all eight.
const SEEDED_CASE_COUNT =
  process.env.SOLVER_SEEDED_CASES === undefined
    ? 8
    : Number(process.env.SOLVER_SEEDED_CASES);

describe("solver input and candidate validation", () => {
  it("keeps every candidate valid across seeded package and envelope dimensions", () => {
    const random = seededRandom(0x5017e2);
    for (let caseIndex = 0; caseIndex < SEEDED_CASE_COUNT; caseIndex += 1) {
      const dimensionsMm = {
        length: 40 + Math.floor(random() * 80),
        width: 30 + Math.floor(random() * 70),
      };
      const clearanceMm = Math.floor(random() * 6);
      const input: LayerSolverInput = {
        package: { shape: "cuboid", dimensionsMm, clearanceMm },
        envelopeMm: {
          minX: -20,
          minY: 10,
          maxX: 300 + Math.floor(random() * 180),
          maxY: 260 + Math.floor(random() * 160),
        },
        constraints: {
          maxBands: 12,
          maxCandidatesPerGenerator: 25,
        },
      };
      const result = solveLayer(input, {
        includeSymmetryVariants: false,
      });

      expect(result.status).toBe("completed");
      for (const candidate of result.candidates) {
        expect(
          candidate.placements.filter(
            (placement) =>
              !placementWithinBounds(placement, dimensionsMm, input.envelopeMm),
          ),
        ).toEqual([]);
        const overlappingPairs: Array<[number, number]> = [];
        for (
          let leftIndex = 0;
          leftIndex < candidate.placements.length;
          leftIndex += 1
        ) {
          for (
            let rightIndex = leftIndex + 1;
            rightIndex < candidate.placements.length;
            rightIndex += 1
          ) {
            if (
              placementsOverlap(
                candidate.placements[leftIndex]!,
                candidate.placements[rightIndex]!,
                dimensionsMm,
                clearanceMm,
              )
            )
              overlappingPairs.push([leftIndex, rightIndex]);
          }
        }
        expect(overlappingPairs).toEqual([]);
      }
    }
    // Eight seeded solves take 18-32 s; keep a wide margin.
  }, 120_000);
});
