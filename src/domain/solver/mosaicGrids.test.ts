import { expect, it } from "vitest";
import { materializeGridPlan } from "~/domain/solver/gridPlan";
import { buildRingMosaics } from "~/domain/solver/ringMosaics";
import { buildAsymmetricRings } from "~/domain/solver/asymmetricRings";
import { generateCandidateFamily } from "~/domain/solver/generators";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import type { GeneratedPlacement } from "~/domain/solver/types";

const input = (gap = 0, width = 200, height = 130) =>
  validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 20 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: width, maxY: height },
    constraints: { allowedRotations: [0, 90], maxCandidatesPerGenerator: 100 },
  }).normalized!;
const raster = (
  xs: number[],
  ys: number[],
  rotation: 0 | 90,
): GeneratedPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ positionMm: { x, y }, rotation })));

it("constructs a 42-package ring with a separate, evenly distributed side corridor", () => {
  const normalized = input();
  const expected = {
    transpose: false,
    rotation: 0,
    columns: 3,
    crossColumns: 4,
    rows: 2,
    crossRows: 3,
    capRows: 0,
    sideRotation: 0,
    sideCols: 1,
    coreRotation: null,
    ringReflectX: true,
    reflectX: false,
    reflectY: false,
  };
  const plan = buildRingMosaics(normalized, () => true).find((p) =>
    Object.entries(expected).every(
      ([k, v]) => (k === "transpose" ? p.transpose : p.parameters?.[k]) === v,
    ),
  );
  expect(plan).toBeDefined();
  const placements = materializeGridPlan(
    normalized,
    plan!,
    false,
    "continuous",
  );
  expect(placements).toEqual([
    ...raster([100, 120, 140, 160], [15, 45, 75], 90),
    ...raster([15, 45, 75], [10, 30], 0),
    ...raster([10, 30, 50, 70], [55, 85, 115], 90),
    ...raster([95, 125, 155], [100, 120], 0),
    ...raster([185], [10, 32, 54, 76, 98, 120], 0),
  ]);
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});

it("clamps a rounded boundary center while retaining valid rounded interior centers", () => {
  const normalized = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 3, width: 2 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 10, maxY: 2 },
  }).normalized!;
  const placements = materializeGridPlan(
    normalized,
    {
      transpose: false,
      width: 10,
      height: 2,
      count: 3,
      parameters: {},
      grids: [
        { x: 0, y: 0, cols: 3, rows: 1, dx: 3, dy: 2, rotation: 0, width: 10 },
      ],
    },
    false,
    "floor-clamped",
  );
  expect(placements).toEqual(raster([1.5, 5, 8], [1], 0));
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});

it.each([false, true])(
  "fills an asymmetric ring with stretched arms = %s",
  (stretched) => {
    const normalized = input();
    const wanted = {
      rotation: 0,
      columns: 3,
      crossColumns: 5,
      rows: 2,
      crossRows: 3,
      bottomColumns: 4,
      bottomRows: 3,
      coreRotation: 90,
      reflectX: false,
      reflectY: false,
      stretched,
    };
    const plan = buildAsymmetricRings(normalized, () => true).find(
      (p) =>
        !p.transpose &&
        p.width === 190 &&
        p.height === 130 &&
        Object.entries(wanted).every(([k, v]) => p.parameters?.[k] === v),
    );
    expect(plan).toBeDefined();
    const placements = materializeGridPlan(
      normalized,
      plan!,
      false,
      "continuous",
    );
    expect(placements).toEqual([
      ...raster([15, 35, 55, 75, 95], stretched ? [15, 55] : [15, 45], 90),
      ...raster([120, 150, 180], [10, 30], 0),
      ...raster(
        stretched ? [135, 160, 185] : [135, 155, 175],
        [55, 85, 115],
        90,
      ),
      ...raster([20, 50, 80, 110], [80, 100, 120], 0),
      ...raster([115], [55], 90),
    ]);
    expect(validateCandidatePlacements(normalized, placements)).toEqual({
      valid: true,
      issues: [],
    });
  },
);

it("keeps mosaics valid with clearance and independent of rotation enumeration", () => {
  const normalized = input(2, 140, 100),
    result = generateCandidateFamily(normalized, "mosaic");
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
      "mosaic",
    ),
  ).toEqual(result);
});
