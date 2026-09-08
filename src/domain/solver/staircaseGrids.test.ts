import { expect, it } from "vitest";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { searchStaircaseGrids } from "~/domain/solver/staircaseGrids";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import type { GeneratedPlacement } from "~/domain/solver/types";

const raster = (
  xs: number[],
  ys: number[],
  rotation: 0 | 90,
): GeneratedPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ positionMm: { x, y }, rotation })));
const key = (p: readonly GeneratedPlacement[]) =>
  p.map((p) => `${p.rotation}:${p.positionMm.x}:${p.positionMm.y}`).sort();
function input(height: number, gap = 0) {
  return validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 14 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 208, maxY: height },
    constraints: { allowedRotations: [0, 90], maxCandidatesPerGenerator: 100 },
  }).normalized!;
}

it("constructs a five-step 70-package chain from grid counts", () => {
  const normalized = input(142);
  let found: readonly GeneratedPlacement[] | undefined;
  searchStaircaseGrids(
    normalized,
    (placements, provenance) => {
      if (
        provenance.parameters?.steps === "6:0/3:2/2:4/1:6/0:8" &&
        provenance.parameters.rotation === 0 &&
        provenance.parameters.transpose === false &&
        provenance.parameters.reflectX === false &&
        provenance.parameters.reflectY === false
      )
        found = placements;
      return !found;
    },
    () => true,
  );
  expect(found).toHaveLength(70);
  expect(key(found!)).toEqual(
    key([
      ...raster([187, 201], [15], 90),
      ...raster([97, 111], [43], 90),
      ...raster([67, 81], [71], 90),
      ...raster([37, 51], [99], 90),
      ...raster([7, 21], [127], 90),
      ...raster([15, 45, 75, 105, 135, 165], [7, 21], 0),
      ...raster([133, 163, 193], [37, 51], 0),
      ...raster([15, 45, 75], [35, 49], 0),
      ...raster([103, 133, 163, 193], [65, 79], 0),
      ...raster([15, 45], [63, 77], 0),
      ...raster([73, 103, 133, 163, 193], [93, 107], 0),
      ...raster([15], [91, 105], 0),
      ...raster([43, 73, 103, 133, 163, 193], [121, 135], 0),
    ]),
  );
  expect(validateCandidatePlacements(normalized, found!).valid).toBe(true);
});

it("exchanges opposed crosswise arms for a 70-package inner fill", () => {
  const normalized = input(144);
  let found: readonly GeneratedPlacement[] | undefined;
  searchStaircaseGrids(
    normalized,
    (placements, provenance) => {
      const p = provenance.parameters!;
      if (
        p.steps === "6:0/5:4/0:6" &&
        p.rotation === 0 &&
        p.transpose === false &&
        p.reflectX === false &&
        p.reflectY === false &&
        p.exchangeIndex === 1 &&
        p.exchangeRows === 1 &&
        p.upperColumns === 1 &&
        p.lowerColumns === 1
      )
        found = placements;
      return !found;
    },
    () => true,
    300_000,
    "staircase-exchange",
  );
  expect(found).toHaveLength(70);
  expect(key(found!)).toEqual(
    key([
      ...raster([187, 201], [15, 45], 90),
      ...raster([15, 45, 75, 105, 135, 165], [7, 21, 35, 49], 0),
      ...raster([193], [67, 81, 95, 109], 0),
      ...raster([15, 45, 75, 105, 135], [63, 77], 0),
      ...raster([43, 73, 103, 133, 163, 193], [123, 137], 0),
      ...raster([157, 171], [71], 90),
      ...raster([171], [101], 90),
      ...raster([7], [99], 90),
      ...raster([7, 21], [129], 90),
      ...raster([29, 59, 89, 119, 149], [93, 107], 0),
    ]),
  );
  expect(validateCandidatePlacements(normalized, found!).valid).toBe(true);
});

it.each(["staircase", "staircase-exchange"] as const)(
  "keeps %s valid with clearance and independent of rotation order",
  (family) => {
    const normalized = input(150, 1);
    const first = generateCandidateFamily(normalized, family);
    expect(first.drafts).toHaveLength(100);
    expect(
      first.drafts.map(
        (d) => validateCandidatePlacements(normalized, d.placements).valid,
      ),
    ).toEqual(Array<boolean>(100).fill(true));
    expect(
      generateCandidateFamily(
        {
          ...normalized,
          constraints: { ...normalized.constraints, allowedRotations: [90, 0] },
        },
        family,
      ),
    ).toEqual(first);
  },
);

it("honors cancellation before enumerating or emitting any steps", () => {
  let emitted = 0;
  const result = searchStaircaseGrids(
    input(142),
    () => {
      emitted++;
      return true;
    },
    () => false,
  );
  expect(result).toEqual({ workUsed: 0, limited: false });
  expect(emitted).toBe(0);
});
