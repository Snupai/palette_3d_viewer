import { describe, expect, it } from "vitest";
import { boundingRectangleForPlacements } from "~/domain/geometry";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { placementsUseMixedPackageOrientations } from "~/domain/solver/orientationPolicy";
import { solveLayer } from "~/domain/solver/solve";
import type {
  LayerSolverInput,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";

function normalized(input: LayerSolverInput): NormalizedLayerSolverInput {
  const validation = validateAndNormalizeSolverInput(input);
  if (!validation.valid || !validation.normalized) {
    throw new Error(
      validation.issues.map(({ message }) => message).join("\n") ||
        "Expected valid solver input.",
    );
  }
  return validation.normalized;
}

describe("rectangular block generation", () => {
  it("rejects an exact-count L shape with a missing corner", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 3,
        maximumPackageCount: 3,
        requiredShape: "rectangular-block",
      },
    });

    const validation = validateCandidatePlacements(input, [
      { positionMm: { x: 50, y: 25 }, rotation: 0 },
      { positionMm: { x: 150, y: 25 }, rotation: 0 },
      { positionMm: { x: 50, y: 75 }, rotation: 0 },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "non-rectangular-block" }),
    );
  });

  it("rejects gaps that exceed the bounded spacing policy", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 300, maxY: 100 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 2,
        maximumPackageCount: 2,
        requiredShape: "rectangular-block",
      },
    });

    const validation = validateCandidatePlacements(input, [
      { positionMm: { x: 50, y: 50 }, rotation: 0 },
      { positionMm: { x: 250, y: 50 }, rotation: 0 },
    ]);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "non-rectangular-block" }),
    );
  });

  it("builds a 73-package mixed-orientation rectangle with distributed spacing", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 135, width: 90 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 73,
        maximumPackageCount: 73,
        maxBands: 16,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const draft = output.drafts.find(
      ({ placements }) =>
        placements.length === 73 &&
        placementsUseMixedPackageOrientations(placements),
    );

    expect(draft).toBeDefined();
    expect(validateCandidatePlacements(input, draft!.placements).valid).toBe(
      true,
    );
    expect(
      boundingRectangleForPlacements(
        draft!.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual(input.generationBoundsMm);
    expect(
      draft!.provenance.some(({ variant }) =>
        variant.endsWith("exact-rectangular-space-between"),
      ),
    ).toBe(true);
  });

  it("builds a centered compact mixed-orientation rectangle without pallet-wide row gaps", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 135, width: 90 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 73,
        maximumPackageCount: 73,
        maxBands: 16,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const draft = output.drafts.find(({ placements }) =>
      placementsUseMixedPackageOrientations(placements),
    );
    const occupied = boundingRectangleForPlacements(
      draft!.placements,
      input.package.dimensionsMm,
    )!;

    expect(draft).toBeDefined();
    expect(validateCandidatePlacements(input, draft!.placements).valid).toBe(
      true,
    );
    expect(occupied).not.toEqual(input.generationBoundsMm);
    expect(occupied.maxX - occupied.minX).toBeLessThanOrEqual(1200);
    expect(occupied.maxY - occupied.minY).toBeLessThanOrEqual(800);
    expect((occupied.minX + occupied.maxX) / 2).toBe(600);
    expect((occupied.minY + occupied.maxY) / 2).toBe(400);
    expect(
      draft!.provenance.some(({ variant }) =>
        variant.endsWith("exact-rectangular-compact"),
      ),
    ).toBe(true);
  });

  it("rejects compact alternating rows that only cover opposite exterior strips", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 407, maxY: 200 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 16,
        maximumPackageCount: 16,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });
    const placements = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) => ({
        positionMm: {
          x: 50 + column * 100 + (row % 2 === 0 ? 0 : 7),
          y: 25 + row * 50,
        },
        rotation: 0 as const,
      })),
    ).flat();

    const validation = validateCandidatePlacements(input, placements);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: "non-rectangular-block" }),
    );
  });

  it("accepts an exact zero-clearance rectangular union with T-junctions", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 200, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 6,
        maximumPackageCount: 6,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });
    const placements = [
      { positionMm: { x: 100, y: 50 }, rotation: 0 as const },
      { positionMm: { x: 300, y: 50 }, rotation: 0 as const },
      { positionMm: { x: 100, y: 150 }, rotation: 0 as const },
      { positionMm: { x: 250, y: 200 }, rotation: 90 as const },
      { positionMm: { x: 350, y: 200 }, rotation: 90 as const },
      { positionMm: { x: 100, y: 250 }, rotation: 0 as const },
    ];

    expect(validateCandidatePlacements(input, placements).valid).toBe(true);
  });

  it("rejects centered compact blocks with a missing corner or internal hole", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        allowedRotations: [0],
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });
    const missingCorner = [
      { positionMm: { x: 150, y: 125 }, rotation: 0 as const },
      { positionMm: { x: 250, y: 125 }, rotation: 0 as const },
      { positionMm: { x: 150, y: 175 }, rotation: 0 as const },
    ];
    const internalHole = [
      { positionMm: { x: 100, y: 100 }, rotation: 0 as const },
      { positionMm: { x: 200, y: 100 }, rotation: 0 as const },
      { positionMm: { x: 300, y: 100 }, rotation: 0 as const },
      { positionMm: { x: 100, y: 150 }, rotation: 0 as const },
      { positionMm: { x: 300, y: 150 }, rotation: 0 as const },
      { positionMm: { x: 100, y: 200 }, rotation: 0 as const },
      { positionMm: { x: 200, y: 200 }, rotation: 0 as const },
      { positionMm: { x: 300, y: 200 }, rotation: 0 as const },
    ];

    expect(validateCandidatePlacements(input, missingCorner).valid).toBe(false);
    expect(validateCandidatePlacements(input, internalHole).valid).toBe(false);
  });

  it("keeps homogeneous exact yaw candidates when mixing is disabled", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 100, maxY: 200 },
      constraints: {
        allowedRotations: [270],
        minimumPackageCount: 4,
        maximumPackageCount: 4,
        maxCandidatesPerGenerator: 20,
        allowMixedPackageOrientations: false,
        requiredShape: "rectangular-block",
      },
    });

    const output = generateCandidateFamily(input, "row");

    expect(output.drafts.length).toBeGreaterThan(0);
    for (const draft of output.drafts) {
      expect(draft.placements).toHaveLength(4);
      expect(draft.placements.every(({ rotation }) => rotation === 270)).toBe(
        true,
      );
      expect(placementsUseMixedPackageOrientations(draft.placements)).toBe(
        false,
      );
    }
  });

  it("returns an explicit diagnostic instead of a ragged fallback", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 3,
        maximumPackageCount: 3,
        maxCandidatesPerGenerator: 50,
        requiredShape: "rectangular-block",
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "exact-rectangular-block-unavailable" }),
    );
    expect(
      result.diagnostics.some(({ code }) => code === "no-valid-candidates"),
    ).toBe(false);
  });
});
