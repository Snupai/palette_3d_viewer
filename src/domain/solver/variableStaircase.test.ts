import { expect, it } from "vitest";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { searchVariableStaircase } from "~/domain/solver/variableStaircase";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import type { GeneratedPlacement } from "~/domain/solver/types";

const input = (gap = 0) =>
  validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 14 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 206, maxY: 144 },
    constraints: { allowedRotations: [0, 90], maxCandidatesPerGenerator: 100 },
  }).normalized!;
const raster = (
  xs: number[],
  ys: number[],
  rotation: 0 | 90,
): GeneratedPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ positionMm: { x, y }, rotation })));

it("fills the height difference below a shorter first arm with 70 packages", () => {
  const normalized = input();
  const expected = {
    transpose: false,
    rotation: 0,
    columns: 5,
    crossColumns: 4,
    rows: 6,
    crossRows: 2,
    firstColumns: 5,
    firstCrossRows: 1,
    firstRows: 2,
    middleColumns: 3,
    reflectX: false,
    reflectY: false,
    grouped: false,
    quantization: "floor-clamped",
  };
  let actual: readonly GeneratedPlacement[] | undefined;
  searchVariableStaircase(
    normalized,
    (placements, provenance) => {
      if (
        !Object.entries(expected).every(
          ([k, v]) => provenance.parameters?.[k] === v,
        )
      )
        return true;
      actual = placements;
      return false;
    },
    () => true,
  );
  expect(actual).toEqual([
    ...raster([157, 171, 185, 199], [15], 90),
    ...raster([97, 111, 125, 139], [43, 73], 90),
    ...raster([7, 21, 35, 49], [99, 129], 90),
    ...raster([15, 45, 75, 105, 135], [7, 21], 0),
    ...raster([15, 45, 75], [35, 49, 63, 77], 0),
    ...raster([161, 191], [39, 53, 67, 81], 0),
    ...raster([71, 101, 131, 161, 191], [95, 109, 123, 137], 0),
  ]);
  expect(actual).toHaveLength(70);
  expect(validateCandidatePlacements(normalized, actual!)).toEqual({
    valid: true,
    issues: [],
  });
});

it("derives a wider first arm and distributes its shared right column", () => {
  const normalized = {
    ...input(),
    generationBoundsMm: { minX: 0, minY: 0, maxX: 206, maxY: 150 },
    envelopeMm: { minX: 0, minY: 0, maxX: 206, maxY: 150 },
  };
  let actual: readonly GeneratedPlacement[] | undefined;
  const expected = {
    transpose: false,
    rotation: 90,
    width: 202,
    height: 148,
    columns: 10,
    crossColumns: 2,
    rows: 4,
    crossRows: 2,
    firstColumns: 8,
    firstCrossRows: 2,
    firstRows: 1,
    middleColumns: 4,
    reflectX: false,
    reflectY: false,
    grouped: false,
    quantization: "floor-clamped",
  };
  searchVariableStaircase(
    normalized,
    (placements, provenance) => {
      if (
        !Object.entries(expected).every(
          ([k, v]) => provenance.parameters?.[k] === v,
        )
      )
        return true;
      actual = placements;
      return false;
    },
    () => true,
  );
  expect(actual).toEqual([
    ...raster([129, 159, 189], [8, 22], 0),
    ...raster([73, 103], [38, 52], 0),
    ...raster([17, 47], [128, 142], 0),
    ...raster([9, 23, 37, 51, 65, 79, 93, 107], [16], 90),
    ...raster([9, 23, 37, 51], [46, 76, 106], 90),
    ...raster([125, 139, 153, 168, 182, 197], [44, 74, 104, 134], 90),
    ...raster([69, 83, 97, 111], [74, 104, 134], 90),
  ]);
  expect(actual).toHaveLength(70);
  expect(validateCandidatePlacements(normalized, actual!)).toEqual({
    valid: true,
    issues: [],
  });
});

it("respects clearance and rotation enumeration independently", () => {
  const normalized = input(2),
    result = generateCandidateFamily(normalized, "staircase-variable");
  expect(result.drafts).toHaveLength(100);
  expect(
    result.drafts.map(
      (d) => validateCandidatePlacements(normalized, d.placements).valid,
    ),
  ).toEqual(Array<boolean>(100).fill(true));
  expect(
    generateCandidateFamily(
      {
        ...normalized,
        constraints: { ...normalized.constraints, allowedRotations: [90, 0] },
      },
      "staircase-variable",
    ),
  ).toEqual(result);
});

it("stops before emitting when cancelled or when its discovery budget is spent", () => {
  let emitted = 0;
  const emit = () => {
    emitted++;
    return true;
  };
  expect(searchVariableStaircase(input(), emit, () => false)).toEqual({
    workUsed: 0,
    limited: false,
  });
  expect(searchVariableStaircase(input(), emit, () => true, 1)).toEqual({
    workUsed: 0,
    limited: true,
  });
  expect(emitted).toBe(0);
});
