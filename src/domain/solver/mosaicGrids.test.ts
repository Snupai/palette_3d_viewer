import { expect, it } from "vitest";
import { materializeGridPlan } from "~/domain/solver/gridPlan";
import { buildRingMosaics } from "~/domain/solver/ringMosaics";
import { searchMosaicGrids } from "~/domain/solver/mosaicGrids";
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

it.each([
  "mosaic",
  "capped-ring",
  "anchored-ring",
  "rounded-slice",
  "nested-edge",
] as const)(
  "keeps %s valid with clearance and independent of rotation enumeration",
  (family) => {
    const normalized = input(2, 140, 100),
      result = generateCandidateFamily(normalized, family);
    const expectedCount = 100;
    expect(result.drafts).toHaveLength(expectedCount);
    expect(
      result.drafts.map(
        (d) => validateCandidatePlacements(normalized, d.placements).valid,
      ),
    ).toEqual(Array<boolean>(expectedCount).fill(true));
    expect(
      generateCandidateFamily(
        {
          ...normalized,
          constraints: { ...normalized.constraints, allowedRotations: [90, 0] },
        },
        family,
      ),
    ).toEqual(result);
  },
);

it("extends the cap beyond the ring without stretching its four arms", () => {
  const normalized = input(0, 180, 130);
  const expected = {
    rotation: 0,
    columns: 3,
    crossColumns: 4,
    rows: 1,
    crossRows: 1,
    capRotation: 0,
    capRows: 4,
    capAtEnd: true,
    sideCols: 0,
    coreRotation: null,
    ringReflectX: false,
    reflectX: false,
    reflectY: false,
  };
  const plan = buildRingMosaics(normalized, () => true, true).find(
    (p) =>
      !p.transpose &&
      Object.entries(expected).every(([k, v]) => p.parameters?.[k] === v),
  );
  expect(plan).toBeDefined();
  expect([plan!.width, plan!.height, plan!.count]).toEqual([180, 130, 38]);
  const placements = materializeGridPlan(
    normalized,
    plan!,
    false,
    "continuous",
  );
  expect(placements).toEqual([
    ...raster([10, 30, 50, 70], [15], 90),
    ...raster([95, 125, 155], [10], 0),
    ...raster([100, 120, 140, 160], [35], 90),
    ...raster([15, 45, 75], [40], 0),
    ...raster([15, 45, 75, 105, 135, 165], [60, 80, 100, 120], 0),
  ]);
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});

it("uses the outer edge of an asymmetric arm to recover the wider center", () => {
  const normalized = input(0, 190, 130);
  const expected = {
    rotation: 0,
    columns: 3,
    rows: 2,
    bottomColumns: 4,
    bottomRows: 3,
    coreRotation: 0,
    coreY: 50,
    reflectX: false,
    reflectY: false,
    stretched: true,
  };
  const plan = buildAsymmetricRings(normalized, () => true, true).find(
    (p) =>
      !p.transpose &&
      p.width === 190 &&
      p.height === 130 &&
      Object.entries(expected).every(([k, v]) => p.parameters?.[k] === v),
  );
  expect(plan).toBeDefined();
  expect(plan!.count).toBe(38);
  const placements = materializeGridPlan(
    normalized,
    plan!,
    false,
    "continuous",
  );
  expect(placements).toEqual([
    ...raster([10, 30, 50, 70, 90], [15, 55], 90),
    ...raster([115, 145, 175], [10, 30], 0),
    ...raster([140, 160, 180], [55, 85, 115], 90),
    ...raster([15, 45, 75, 105], [80, 100, 120], 0),
    ...raster([115], [60], 0),
  ]);
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});

it("places a nested crosswise raster between two edge caps with grouped rounding", () => {
  const normalized = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 14 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 150 },
    constraints: { allowedRotations: [0, 90], provisionalPackagesPerCycle: 2 },
  }).normalized!;
  const expected = {
    rotation: 90,
    rows: 10,
    crossRows: 2,
    stripRotation: 0,
    columns: 2,
    insertedColumns: 4,
    split: 1,
    seam: 10,
    transpose: true,
    width: 150,
    height: 200,
    grouped: true,
    quantization: "floor-step",
  };
  let actual: readonly GeneratedPlacement[] | undefined;
  searchMosaicGrids(
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
    300000,
    "nested-edge",
  );
  expect(actual).toHaveLength(70);
  const key = (ps: readonly GeneratedPlacement[]) =>
    ps.map((p) => `${p.positionMm.x}:${p.positionMm.y}:${p.rotation}`).sort();
  expect(key(actual!)).toEqual(
    key([
      ...raster(
        [7, 21, 35, 49, 63, 77, 91, 105, 119, 133],
        [15, 45, 75, 105, 135],
        90,
      ),
      ...raster([155, 185], [7, 143], 0),
      ...raster([147, 162, 177, 192], [29, 59, 90, 120], 90),
    ]),
  );
  expect(validateCandidatePlacements(normalized, actual!)).toEqual({
    valid: true,
    issues: [],
  });
});

it("keeps a shorter ring aligned to the far edge of a taller side raster", () => {
  const normalized = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 14 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 150 },
    constraints: { allowedRotations: [0, 90] },
  }).normalized!;
  const expected = {
    transpose: true,
    width: 150,
    height: 198,
    rotation: 90,
    columns: 3,
    crossColumns: 4,
    rows: 2,
    crossRows: 1,
    capRotation: 90,
    capRows: 10,
    capAtEnd: false,
    reflectX: true,
    reflectY: true,
    ringReflectX: false,
    grouped: false,
    quantization: "floor-clamped",
  };
  let actual: readonly GeneratedPlacement[] | undefined;
  searchMosaicGrids(
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
    300000,
    "capped-ring",
  );
  expect(actual).toEqual([
    ...raster([44], [101, 115, 129, 143], 0),
    ...raster([38, 52], [19, 49, 79], 90),
    ...raster([16], [11, 25, 39, 53], 0),
    ...raster([8, 22], [75, 105, 135], 90),
    ...raster(
      [66, 80, 94, 108, 122, 136, 150, 164, 178, 192],
      [15, 45, 75, 105, 135],
      90,
    ),
  ]);
  expect(actual).toHaveLength(70);
  expect(validateCandidatePlacements(normalized, actual!)).toEqual({
    valid: true,
    issues: [],
  });
});

it("quantizes distribution pitch in fractions of a pickup before rounding centers", () => {
  const normalized = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 11, width: 2 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 100, maxY: 2 },
    constraints: { provisionalPackagesPerCycle: 3 },
  }).normalized!;
  const placements = materializeGridPlan(
    normalized,
    {
      transpose: false,
      width: 100,
      height: 2,
      count: 5,
      parameters: {},
      grids: [
        {
          x: 0,
          y: 0,
          cols: 5,
          rows: 1,
          dx: 11,
          dy: 2,
          rotation: 0,
          width: 100,
        },
      ],
    },
    false,
    "floor-pick-step",
  );
  expect(placements).toEqual(raster([5.5, 27, 49, 71, 93], [1], 0));
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});

it("rounds a shared pickup center upward without separating its packages", () => {
  const normalized = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 14 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 14, maxY: 92 },
    constraints: { provisionalPackagesPerCycle: 2 },
  }).normalized!;
  const placements = materializeGridPlan(
    normalized,
    {
      transpose: false,
      width: 14,
      height: 92,
      count: 3,
      parameters: {},
      grids: [
        {
          x: 0,
          y: 0,
          cols: 1,
          rows: 3,
          dx: 14,
          dy: 30,
          rotation: 90,
          width: 14,
          height: 92,
        },
      ],
    },
    true,
    "nearest",
  );
  expect(placements).toEqual(raster([7], [16, 46, 77], 90));
  expect(validateCandidatePlacements(normalized, placements)).toEqual({
    valid: true,
    issues: [],
  });
});
