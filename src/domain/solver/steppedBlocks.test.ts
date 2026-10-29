import { describe, expect, it } from "vitest";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { searchSteppedBlocks } from "~/domain/solver/steppedBlocks";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import type { GeneratedPlacement } from "~/domain/solver/types";

function input(gap = 0) {
  return validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 20 },
      clearanceMm: gap,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 130 },
    constraints: {
      allowedRotations: [0, 90],
      provisionalPackagesPerCycle: 2,
      suctionRemainderPolicy: "axis-ends",
      maxCandidatesPerGenerator: 500,
    },
  }).normalized!;
}

const raster = (
  xs: number[],
  ys: number[],
  rotation: 0 | 90,
): GeneratedPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ positionMm: { x, y }, rotation })));

describe("stepped block generation", () => {
  it("reserves materialization work when topology discovery saturates its budget", () => {
    const normalized = validateAndNormalizeSolverInput({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 158, width: 78 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1148, maxY: 790 },
      constraints: {
        allowedRotations: [0, 90],
        maxCandidatesPerGenerator: 500,
      },
    }).normalized!;
    const result = generateCandidateFamily(normalized, "stepped-block");
    expect(result.drafts).toHaveLength(500);
    const ring = result.drafts.find(
      (d) =>
        d.placements.length === 70 &&
        d.provenance.some((p) => p.variant === "filled-five-grid-ring"),
    );
    expect(ring).toBeDefined();
    expect(validateCandidatePlacements(normalized, ring!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });
  it("constructs all 43 centers in a seven-grid ring with a side corridor", () => {
    const normalized = input();
    const output = generateCandidateFamily(normalized, "stepped-block");
    const expected = [
      ...raster([15, 45, 75, 105, 135, 165], [10, 30, 50, 70], 0),
      ...raster([190], [15, 45, 75], 90),
      ...raster([15, 45, 75], [90], 0),
      ...raster([100, 120, 140, 160], [95], 90),
      ...raster([185], [100], 0),
      ...raster([10, 30, 50, 70], [115], 90),
      ...raster([95, 125, 155, 185], [120], 0),
    ];
    const draft = output.drafts.find((d) =>
      d.provenance.some(
        (p) =>
          p.variant === "seven-grid-ring" &&
          p.parameters?.rotation === 0 &&
          p.parameters.mainRows === 4 &&
          p.parameters.mainColumns === 6 &&
          p.parameters.columns === 4 &&
          p.parameters.crossColumns === 4 &&
          p.parameters.leftColumns === 3 &&
          p.parameters.transpose === false &&
          p.parameters.reflectX === false &&
          p.parameters.reflectY === false,
      ),
    );
    expect(
      draft?.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(expected);
    expect(validateCandidatePlacements(normalized, draft!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("constructs 43 centers in a nine-grid staircase with a continuous side column", () => {
    const normalized = input();
    const output = generateCandidateFamily(normalized, "stepped-block");
    const expected = [
      ...raster([15, 45, 75, 105, 135, 165], [10], 0),
      ...raster([190], [15, 48.333333333, 81.666666667, 115], 90),
      ...raster([10, 30, 50], [35], 90),
      ...raster([70, 90, 110], [75], 90),
      ...raster([130, 150, 170], [115], 90),
      ...raster([15, 45], [60, 80, 100, 120], 0),
      ...raster([75, 105], [100, 120], 0),
      ...raster([75, 105, 135, 165], [30, 50], 0),
      ...raster([135, 165], [70, 90], 0),
    ];
    const draft = output.drafts.find((d) =>
      d.provenance.some(
        (p) =>
          p.variant === "nine-grid-staircase" &&
          p.parameters?.rotation === 0 &&
          p.parameters.mainRows === 2 &&
          p.parameters.mainColumns === 2 &&
          p.parameters.crossColumns === 3 &&
          p.parameters.crossRows === 1 &&
          p.parameters.rows === 1 &&
          p.parameters.sideColumns === 1 &&
          p.parameters.transpose === false &&
          p.parameters.reflectX === false &&
          p.parameters.reflectY === false,
      ),
    );
    expect(
      draft?.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(expected);
    expect(validateCandidatePlacements(normalized, draft!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("joins six grids with a taller side block and an offset lower band", () => {
    const normalized = input();
    const draft = generateCandidateFamily(
      normalized,
      "stepped-block",
    ).drafts.find((d) =>
      d.provenance.some(
        (p) =>
          p.variant === "six-grid-ring" &&
          p.parameters?.rotation === 0 &&
          p.parameters.columns === 4 &&
          p.parameters.rows === 2 &&
          p.parameters.crossColumns === 4 &&
          p.parameters.crossRows === 1 &&
          p.parameters.mainColumns === 4 &&
          p.parameters.mainRows === 3 &&
          p.parameters.sideColumns === 4 &&
          p.parameters.leftColumns === 1 &&
          p.parameters.transpose === false &&
          p.parameters.reflectX === false &&
          p.parameters.reflectY === false,
      ),
    );
    const expected = [
      ...raster([15, 45, 75, 105], [10, 30, 50], 0),
      ...raster([130, 150, 170, 190], [15, 45, 75], 90),
      ...raster([15], [70, 90], 0),
      ...raster([40, 60, 80, 100], [75], 90),
      ...raster([10, 30, 50, 70], [115], 90),
      ...raster([95, 125, 155, 185], [100, 120], 0),
    ];
    expect(draft?.placements).toHaveLength(42);
    expect(
      draft?.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(expect.arrayContaining(expected));
    expect(validateCandidatePlacements(normalized, draft!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("retains valid clearances, respects family limits, rotations, shape and cancellation", () => {
    const normalized = input(1);
    normalized.constraints.maxCandidatesPerGenerator = 20;
    const output = generateCandidateFamily(normalized, "stepped-block");
    expect(output.drafts).toHaveLength(20);
    expect(
      output.drafts.map((d) =>
        validateCandidatePlacements(normalized, d.placements),
      ),
    ).toEqual(Array.from({ length: 20 }, () => ({ valid: true, issues: [] })));
    const emit = () => {
      throw new Error("No draft expected");
    };
    expect(searchSteppedBlocks(normalized, emit, () => false)).toEqual({
      workUsed: 0,
      limited: false,
    });
    expect(searchSteppedBlocks(normalized, emit, () => true, 1)).toEqual({
      workUsed: 0,
      limited: true,
    });
    normalized.constraints.allowedRotations = [0];
    expect(generateCandidateFamily(normalized, "stepped-block").drafts).toEqual(
      [],
    );
    normalized.constraints.allowedRotations = [0, 90];
    normalized.constraints.requiredShape = "rectangular-block";
    expect(generateCandidateFamily(normalized, "stepped-block").drafts).toEqual(
      [],
    );
  });

  it("fills an offset ring core without requiring an exact requested count", () => {
    const normalized = input();
    const draft = generateCandidateFamily(
      normalized,
      "stepped-block",
    ).drafts.find((d) =>
      d.provenance.some(
        (p) =>
          p.variant === "filled-five-grid-ring" &&
          p.parameters?.rotation === 0 &&
          p.parameters.coreRotation === 0 &&
          p.parameters.columns === 4 &&
          p.parameters.rows === 2 &&
          p.parameters.crossColumns === 4 &&
          p.parameters.crossRows === 3 &&
          p.parameters.leftColumns === 7 &&
          p.parameters.transpose === false &&
          p.parameters.reflectX === false &&
          p.parameters.reflectY === false,
      ),
    );
    expect(draft?.placements).toHaveLength(42);
    expect(
      draft?.placements
        .slice(-2)
        .sort((a, b) => a.positionMm.y - b.positionMm.y)
        .map(({ positionMm, rotation }) => ({ positionMm, rotation })),
    ).toEqual(raster([95], [60, 80], 0));
    expect(validateCandidatePlacements(normalized, draft!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("quantizes pickup centers inside a cap without spending the required clearance", () => {
    const normalized = input();
    normalized.package.dimensionsMm.length = 29;
    normalized.generationBoundsMm.maxX =
      normalized.envelopeMm.maxX =
      normalized.usableEnvelopeMm.maxX =
        196;
    const draft = generateCandidateFamily(
      normalized,
      "stepped-block",
    ).drafts.find((d) =>
      d.provenance.some(
        (p) =>
          p.variant === "nine-grid-staircase" &&
          p.parameters?.rotation === 0 &&
          p.parameters.mainRows === 2 &&
          p.parameters.mainColumns === 2 &&
          p.parameters.crossColumns === 3 &&
          p.parameters.crossRows === 1 &&
          p.parameters.rows === 1 &&
          p.parameters.sideColumns === 1 &&
          p.parameters.transpose === false &&
          p.parameters.reflectX === false &&
          p.parameters.reflectY === false,
      ),
    );
    expect(draft?.placements.slice(0, 6).map((p) => p.positionMm)).toEqual(
      [14.5, 43.5, 73.5, 102.5, 131.5, 160.5].map((x) => ({ x, y: 10.5 })),
    );
    expect(validateCandidatePlacements(normalized, draft!.placements)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("is independent of permitted rotation order and progress batching", () => {
    const normalized = input();
    normalized.constraints.maxCandidatesPerGenerator = 20;
    const first = generateCandidateFamily(normalized, "stepped-block");
    normalized.constraints.allowedRotations = [90, 0];
    const second = generateCandidateFamily(normalized, "stepped-block", {
      checkpoint: () => true,
    });
    expect(second).toEqual(first);
  });
});
