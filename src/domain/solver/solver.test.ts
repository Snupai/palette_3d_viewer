import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  createCenteredEffectivePalletEnvelope,
  placementRectangleBounds,
  placementWithinBounds,
  placementsOverlap,
  rectangleBoundsCenter,
  transformPlacements,
} from "~/domain/geometry";
import { createProject } from "~/domain/project/projectFactory";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { compareSolverCandidates } from "~/domain/solver/metrics";
import { packageOrientationClass } from "~/domain/solver/orientationPolicy";
import { createLayerSolverInputFromProject } from "~/domain/solver/projectInput";
import { solveLayer } from "~/domain/solver/solve";
import type {
  GeneratedCandidateDraft,
  LayerSolverInput,
  SolverCandidate,
} from "~/domain/solver/types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import observedAp5006 from "~/lib/__fixtures__/parity/ap5006-1329-00004.observed.parity.json";

function basicInput(
  overrides: Partial<LayerSolverInput> = {},
): LayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 50 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    ...overrides,
  };
}

function normalized(input: LayerSolverInput) {
  const result = validateAndNormalizeSolverInput(input);
  expect(result.valid).toBe(true);
  expect(result.normalized).not.toBeNull();
  return result.normalized!;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("solver input and candidate validation", () => {
  it("adapts ProjectV2-compatible per-side underhang without touching legacy geometry", () => {
    const project = createProject(
      {
        id: "solver-project",
        package: { inletOrientation: "crosswise" },
        pallet: {
          id: "underhang-pallet",
          name: "Underhang pallet",
          kind: "custom",
          dimensionsMm: { length: 1200, width: 800, height: 144 },
          storageEnvelopeMm: null,
          allowedOverhangMm: { length: -34, width: -11 },
          tareKg: null,
          maxGrossKg: null,
          subPalletPattern: "none",
        },
      },
      {
        createId: (kind) => `${kind}-fixed`,
        now: () => 0,
      },
    );

    const input = createLayerSolverInputFromProject(project);
    expect(input.package.inletOrientation).toBe("crosswise");
    expect(input.physicalPalletBoundsMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    });
    expect(input.envelopeMm).toEqual({
      minX: 34,
      minY: 11,
      maxX: 1166,
      maxY: 789,
    });
  });

  it("rejects unsupported shape and invalid constraints with explicit diagnostics", () => {
    const result = solveLayer({
      package: {
        shape: "round",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: -1,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
      constraints: {
        allowedRotations: [0, 0],
        minimumPackageCount: 3,
        maximumPackageCount: 2,
      },
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unsupported-package-shape",
        "invalid-clearance",
        "duplicate-allowed-rotation",
        "invalid-input-constraint",
      ]),
    );
  });

  it("rejects runtime null allowed rotations instead of broadening authorization", () => {
    const result = validateAndNormalizeSolverInput({
      ...basicInput(),
      constraints: { allowedRotations: null as never },
    });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-input-constraint",
        message: "allowedRotations must be an array of orthogonal rotations.",
      }),
    );
  });

  it("defaults omitted inlet orientation and rectangular block footprint policy", () => {
    const result = validateAndNormalizeSolverInput(basicInput());

    expect(result.valid).toBe(true);
    expect(result.normalized?.package.inletOrientation).toBe("lengthwise");
    expect(result.normalized?.constraints.rectangularBlockFootprintPolicy).toBe(
      "fill-generation-bounds",
    );
  });

  it("rejects an invalid runtime inlet orientation", () => {
    const result = validateAndNormalizeSolverInput({
      ...basicInput(),
      package: {
        ...basicInput().package,
        inletOrientation: "diagonal" as never,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
    expect(result.issues).toContainEqual({
      code: "invalid-input-constraint",
      message: 'Package inletOrientation must be "lengthwise" or "crosswise".',
    });
  });

  it("rejects unknown rectangular block footprint policies", () => {
    const result = validateAndNormalizeSolverInput({
      ...basicInput(),
      constraints: {
        rectangularBlockFootprintPolicy: "compact-ish" as never,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-input-constraint",
        message:
          'rectangularBlockFootprintPolicy must be "fill-generation-bounds" or "compact-centered".',
      }),
    );
  });

  it("requires physical pallet bounds when nearest-edge label preference is enabled", () => {
    const result = validateAndNormalizeSolverInput({
      ...basicInput(),
      constraints: { unrotatedPackageLabelSide: "right" },
    });

    expect(result.valid).toBe(false);
    expect(result.normalized).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-physical-pallet-bounds",
      }),
    );
  });

  it("validates bounds, exact clearance, overlap, rotations, and count limits", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 10,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 300, maxY: 100 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 2,
        maximumPackageCount: 2,
      },
    });

    expect(
      validateCandidatePlacements(input, [
        { positionMm: { x: 50, y: 25 }, rotation: 0 },
        { positionMm: { x: 160, y: 25 }, rotation: 0 },
      ]).valid,
    ).toBe(true);

    const invalid = validateCandidatePlacements(input, [
      { positionMm: { x: 49, y: 25 }, rotation: 0 },
      { positionMm: { x: 159, y: 25 }, rotation: 90 },
      { positionMm: { x: 260, y: 25 }, rotation: 0 },
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "package-count-above-maximum",
        "placement-out-of-bounds",
        "unsupported-rotation",
      ]),
    );
  });

  it("tolerates floating drift but rejects a material clearance violation", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 98, width: 100 },
        clearanceMm: 0.1,
      },
      envelopeMm: {
        minX: 0,
        minY: 0,
        maxX: 392.40000000000003,
        maxY: 100,
      },
      generationBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 392.40000000000003,
        maxY: 100,
      },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 2,
        maximumPackageCount: 2,
      },
    });
    const centered = [
      { positionMm: { x: 147.15000000000003, y: 50 }, rotation: 0 as const },
      { positionMm: { x: 245.25, y: 50 }, rotation: 0 as const },
    ];

    expect(validateCandidatePlacements(input, centered).valid).toBe(true);
    const materialViolation = [
      centered[0]!,
      {
        ...centered[1]!,
        positionMm: { ...centered[1]!.positionMm, x: 245.249 },
      },
    ];
    expect(
      validateCandidatePlacements(input, materialViolation).issues.map(
        ({ code }) => code,
      ),
    ).toContain("placement-overlap");
  });

  it("constructs exact-count rectangular blocks without cutting a source row", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 20, minY: 10, maxX: 380, maxY: 290 },
      generationBoundsMm: { minX: 100, minY: 100, maxX: 300, maxY: 200 },
      constraints: {
        minimumPackageCount: 4,
        maximumPackageCount: 4,
        maxCandidatesPerGenerator: 100,
        requiredShape: "rectangular-block",
      },
    };

    const first = solveLayer(input);
    const second = solveLayer(input);
    const targetCenter = rectangleBoundsCenter(input.generationBoundsMm!);

    expect(second).toEqual(first);
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(
      first.candidates.some(({ provenance }) =>
        provenance.some(
          ({ variant }) => variant === "exact-rectangular-grid-space-between",
        ),
      ),
    ).toBe(true);
    expect(
      first.candidates.some(({ provenance }) =>
        provenance.some(({ variant }) => variant === "exact-count-prefix"),
      ),
    ).toBe(false);
    for (const candidate of first.candidates) {
      const occupiedBounds = boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      )!;
      const occupiedCenter = rectangleBoundsCenter(occupiedBounds);

      expect(candidate.metrics.packageCount).toBe(4);
      expect(candidate.metrics.utilizationPercent).toBe(100);
      expect(occupiedBounds).toEqual(input.generationBoundsMm);
      expect(Math.abs(occupiedCenter.x - targetCenter.x)).toBeLessThanOrEqual(
        SOLVER_GEOMETRY_EPSILON_MM,
      );
      expect(Math.abs(occupiedCenter.y - targetCenter.y)).toBeLessThanOrEqual(
        SOLVER_GEOMETRY_EPSILON_MM,
      );
      expect(
        candidate.provenance.some(
          ({ variant }) => variant === "occupied-bounds-center-v1",
        ),
      ).toBe(true);
    }
  });

  it("keeps exact rectangular grids available when other shapes are allowed", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 6,
        maximumPackageCount: 6,
        allowMixedPackageOrientations: false,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
        maxCandidatesPerGenerator: 100,
      },
    };

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const exactGridCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ family, variant }) =>
          family === "row" && variant === "exact-rectangular-grid-compact",
      ),
    );

    expect(exactGridCandidates).toHaveLength(2);
    expect(
      exactGridCandidates
        .map(({ placements }) =>
          boundingRectangleForPlacements(
            placements,
            input.package.dimensionsMm,
          ),
        )
        .sort((left, right) => left!.minX - right!.minX),
    ).toEqual([
      { minX: 50, minY: 50, maxX: 350, maxY: 250 },
      { minX: 100, minY: 0, maxX: 300, maxY: 300 },
    ]);
    expect(
      exactGridCandidates.every(
        ({ metrics, validation }) =>
          metrics.packageCount === 6 && validation.valid,
      ),
    ).toBe(true);
  });

  it("generates an exact asymmetric pinwheel with independently sized opposite regions", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 112, width: 76 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1168, maxY: 756 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 103,
        maximumPackageCount: 103,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 1_000,
      },
    };
    const expectedPlacements = [
      ...[38, 114, 190, 266, 342, 418, 494, 570].flatMap((x) =>
        [56, 168].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[664, 776, 888, 1_000, 1_112].flatMap((x) =>
        [38, 115, 193, 270].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[56, 168, 280, 392, 504].flatMap((x) =>
        [262, 338, 414, 490, 566, 642, 718].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[598, 674, 750, 826, 902, 978, 1_054, 1_130].flatMap((x) =>
        [364, 476, 588, 700].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const geometry = (
      placements: readonly {
        positionMm: { x: number; y: number };
        rotation: number;
      }[],
    ) =>
      placements
        .map(
          ({ positionMm, rotation }) =>
            `${positionMm.x},${positionMm.y},${rotation}`,
        )
        .sort();

    const first = solveLayer(input, {
      generatorOrder: [
        "pinwheel",
        "row",
        "block",
        "justified-grid",
        "nested-side",
        "edge-ring",
        "mixed-orientation",
      ],
      includeSymmetryVariants: false,
    });
    const second = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "nested-side",
        "justified-grid",
        "block",
        "row",
        "pinwheel",
      ],
      includeSymmetryVariants: false,
    });
    const expectedGeometry = geometry(expectedPlacements);
    const candidate = first.candidates.find(
      ({ placements }) =>
        JSON.stringify(geometry(placements)) ===
        JSON.stringify(expectedGeometry),
    );

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(103);
    expect(candidate).toBeDefined();
    expect(candidate?.metrics.packageCount).toBe(103);
    expect(candidate?.validation.valid).toBe(true);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 1168, maxY: 756 });
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "lengthwise",
      ),
    ).toHaveLength(55);
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "crosswise",
      ),
    ).toHaveLength(48);

    let overlapCount = 0;
    const placements = candidate?.placements ?? [];
    for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < placements.length;
        rightIndex += 1
      ) {
        if (
          placementsOverlap(
            placements[leftIndex]!,
            placements[rightIndex]!,
            input.package.dimensionsMm,
            input.package.clearanceMm,
          )
        ) {
          overlapCount += 1;
        }
      }
    }
    expect(overlapCount).toBe(0);
  }, 30_000);

  it("splits asymmetric pinwheel residual height across opposite regions", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 112, width: 76 },
        clearanceMm: 2,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 652, maxY: 574 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 41,
        maximumPackageCount: 41,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 10_000,
      },
    };
    const expectedPlacements = [
      ...[38, 116, 194, 272].flatMap((x) =>
        [56, 180].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[368, 482, 596].flatMap((x) =>
        [38, 116, 194].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[56, 170, 284].flatMap((x) =>
        [276, 362.666666667, 449.333333333, 536].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[380, 458, 536, 614].flatMap((x) =>
        [290, 404, 518].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );

    expect(expectedPlacements).toHaveLength(41);
    expect(candidate).toBeDefined();
    expect(candidate?.metrics.packageCount).toBe(41);
    expect(candidate?.validation.valid).toBe(true);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual(input.envelopeMm);
  }, 30_000);

  it("fills a pinwheel center to reach an exact package count", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 177, width: 123 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1_200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 42,
        maximumPackageCount: 42,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 1_000,
      },
    };
    const expectedPlacements = [
      ...[61.5, 184.5, 307.5, 430.5].flatMap((x) =>
        [100, 277, 454].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[580.5, 757.5, 934.5, 1_111.5].flatMap((x) =>
        [73, 196].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[88.5, 265.5, 442.5, 619.5].flatMap((x) =>
        [604, 727].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[769.5, 892.5, 1_015.5, 1_138.5].flatMap((x) =>
        [346, 523, 700].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[338.5, 461.5].map((y) => ({
        positionMm: { x: 600, y },
        rotation: 0 as const,
      })),
    ];
    const geometry = (
      placements: readonly {
        positionMm: { x: number; y: number };
        rotation: number;
      }[],
    ) =>
      placements
        .map(
          ({ positionMm, rotation }) =>
            `${positionMm.x},${positionMm.y},${rotation}`,
        )
        .sort();

    const first = solveLayer(input, {
      generatorOrder: [
        "pinwheel",
        "row",
        "block",
        "justified-grid",
        "nested-side",
        "edge-ring",
        "mixed-orientation",
      ],
      includeSymmetryVariants: false,
    });
    const second = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "nested-side",
        "justified-grid",
        "block",
        "row",
        "pinwheel",
      ],
      includeSymmetryVariants: false,
    });
    const expectedGeometry = geometry(expectedPlacements);
    const candidate = first.candidates.find(
      ({ placements }) =>
        JSON.stringify(geometry(placements)) ===
        JSON.stringify(expectedGeometry),
    );

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(42);
    expect(candidate).toBeDefined();
    expect(candidate?.metrics.packageCount).toBe(42);
    expect(candidate?.validation.valid).toBe(true);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 11.5, maxX: 1_200, maxY: 788.5 });
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "lengthwise",
      ),
    ).toHaveLength(18);
    expect(
      candidate?.placements.filter(
        ({ rotation }) => packageOrientationClass(rotation) === "crosswise",
      ),
    ).toHaveLength(24);

    let overlapCount = 0;
    const placements = candidate?.placements ?? [];
    for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < placements.length;
        rightIndex += 1
      ) {
        if (
          placementsOverlap(
            placements[leftIndex]!,
            placements[rightIndex]!,
            input.package.dimensionsMm,
            input.package.clearanceMm,
          )
        ) {
          overlapCount += 1;
        }
      }
    }
    expect(overlapCount).toBe(0);
  }, 30_000);

  it("generates an exact five-block corner-chain mosaic", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 177, width: 123 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1_200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 42,
        maximumPackageCount: 42,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 10_000,
      },
    };
    const expectedPlacements = [
      ...[61.5, 184.5, 307.5, 430.5].flatMap((x) =>
        [346, 523, 700].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[88.5, 265.5, 442.5].flatMap((x) =>
        [73, 196].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[592.5, 715.5, 838.5, 961.5].flatMap((x) =>
        [100, 277, 454].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[580.5, 757.5, 934.5, 1_111.5].flatMap((x) =>
        [604, 727].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[73, 196, 319, 442].map((y) => ({
        positionMm: { x: 1_111.5, y },
        rotation: 0 as const,
      })),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
      includeExperimentalIncompleteBlocks: true,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );

    expect(expectedPlacements).toHaveLength(42);
    expect(candidate).toBeDefined();
    expect(candidate?.validation.valid).toBe(true);
    expect(candidate?.metrics.packageCount).toBe(42);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 11.5, maxX: 1_200, maxY: 788.5 });
  }, 30_000);

  it("generates an exact five-block offset-bridge mosaic", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 177, width: 123 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1_200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 42,
        maximumPackageCount: 42,
        allowMixedPackageOrientations: true,
        maxCandidatesPerGenerator: 10_000,
      },
    };
    const expectedPlacements = [
      ...[96, 273, 450].flatMap((x) =>
        [242.5, 365.5, 488.5, 611.5, 734.5].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[69, 192, 315, 438, 561].map((x) => ({
        positionMm: { x, y: 92.5 },
        rotation: 90 as const,
      })),
      ...[311.5, 488.5].map((y) => ({
        positionMm: { x: 600, y },
        rotation: 90 as const,
      })),
      ...[750, 927, 1_104].flatMap((x) =>
        [65.5, 188.5, 311.5, 434.5, 557.5].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[639, 762, 885, 1_008, 1_131].map((x) => ({
        positionMm: { x, y: 707.5 },
        rotation: 90 as const,
      })),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
      includeExperimentalIncompleteBlocks: true,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );

    expect(expectedPlacements).toHaveLength(42);
    expect(candidate).toBeDefined();
    expect(candidate?.validation.valid).toBe(true);
    expect(candidate?.metrics.packageCount).toBe(42);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 7.5, minY: 4, maxX: 1_192.5, maxY: 796 });
  }, 30_000);

  it("distributes compact mixed-strip slack only between generated grip rows", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 154, width: 107 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1_200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 54,
        maximumPackageCount: 54,
        allowMixedPackageOrientations: true,
        provisionalPackagesPerCycle: 2,
        rectangularBlockFootprintPolicy: "compact-centered",
        requiredShape: "any",
        maxCandidatesPerGenerator: 500,
      },
    };
    const leftRowYCenters = [68.5, 179, 289.5, 400, 510.5, 621, 731.5];
    const expectedPlacements = [
      ...[95, 249].flatMap((x) =>
        leftRowYCenters.map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[379.5, 486.5, 593.5, 700.5, 807.5, 914.5, 1_021.5, 1_128.5].flatMap(
        (x) =>
          [92, 246, 400, 554, 708].map((y) => ({
            positionMm: { x, y },
            rotation: 90 as const,
          })),
      ),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );
    const matchingTopology = result.candidates.filter(({ placements }) => {
      const bands = new Map<number, { rotation: number; count: number }>();
      for (const placement of placements) {
        const existing = bands.get(placement.positionMm.x);
        if (existing && existing.rotation !== placement.rotation % 180) {
          return false;
        }
        bands.set(placement.positionMm.x, {
          rotation: placement.rotation % 180,
          count: (existing?.count ?? 0) + 1,
        });
      }
      return (
        [...bands.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, band]) => `${band.rotation}:${band.count}`)
          .join("|") ===
        ["0:7", "0:7", ...Array.from({ length: 8 }, () => "90:5")].join("|")
      );
    });

    expect(expectedPlacements).toHaveLength(54);
    expect(candidate).toBeDefined();
    expect(matchingTopology).toHaveLength(1);
    expect(candidate?.validation.valid).toBe(true);
    expect(candidate?.metrics).toMatchObject({
      packageCount: 54,
      provisionalCycleCount: 31,
      boundingBlockLengthMm: 1_164,
      boundingBlockWidthMm: 770,
    });
    expect(candidate?.grips).toHaveLength(31);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 18, minY: 15, maxX: 1_182, maxY: 785 });
    expect(
      candidate?.provenance.some(
        ({ family, variant }) =>
          family === "mixed-orientation" &&
          variant.endsWith("exact-rectangular-compact"),
      ),
    ).toBe(true);

    const leftRowGripIds = leftRowYCenters.map((y) => {
      const row = candidate?.placements
        .filter(
          (placement) =>
            placement.rotation === 0 && placement.positionMm.y === y,
        )
        .sort((left, right) => left.positionMm.x - right.positionMm.x);
      expect(row?.map(({ positionMm }) => positionMm.x)).toEqual([95, 249]);
      expect(new Set(row?.map(({ gripId }) => gripId)).size).toBe(1);
      return row?.[0]?.gripId;
    });
    expect(new Set(leftRowGripIds).size).toBe(7);
    expect(
      leftRowYCenters
        .slice(1)
        .map((center, index) => center - leftRowYCenters[index]!),
    ).toEqual([110.5, 110.5, 110.5, 110.5, 110.5, 110.5]);
  }, 30_000);

  it("distributes inline slack between complete suction groups", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 65 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 165, maxY: 520 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 13,
        maximumPackageCount: 13,
        allowMixedPackageOrientations: true,
        provisionalPackagesPerCycle: 2,
        rectangularBlockFootprintPolicy: "compact-centered",
        requiredShape: "any",
        maxCandidatesPerGenerator: 100,
      },
    };
    const expectedPlacements = [
      ...[50, 150, 260, 370, 470].map((y) => ({
        positionMm: { x: 32.5, y },
        rotation: 90 as const,
      })),
      ...[32.5, 97.5, 162.5, 227.5, 292.5, 357.5, 422.5, 487.5].map((y) => ({
        positionMm: { x: 115, y },
        rotation: 0 as const,
      })),
    ];
    const expectedGeometry = canonicalPlacementGeometryKey(expectedPlacements);

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometry,
    );

    expect(expectedPlacements).toHaveLength(13);
    expect(candidate).toBeDefined();
    expect(candidate?.validation.valid).toBe(true);
    expect(candidate?.metrics).toMatchObject({
      packageCount: 13,
      provisionalCycleCount: 11,
      boundingBlockLengthMm: 165,
      boundingBlockWidthMm: 520,
    });
    expect(candidate?.grips).toHaveLength(11);
    expect(
      boundingRectangleForPlacements(
        candidate?.placements ?? [],
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 165, maxY: 520 });

    const crosswise = candidate?.placements
      .filter(({ rotation }) => rotation === 90)
      .sort((left, right) => left.positionMm.y - right.positionMm.y);
    expect(crosswise?.map(({ positionMm }) => positionMm.y)).toEqual([
      50, 150, 260, 370, 470,
    ]);
    expect(
      crosswise
        ?.slice(1)
        .map(
          ({ positionMm }, index) =>
            positionMm.y - crosswise[index]!.positionMm.y,
        ),
    ).toEqual([100, 110, 110, 100]);
    const crosswiseGripIds = crosswise?.map(({ gripId }) => gripId) ?? [];
    expect(crosswiseGripIds[0]).toBe(crosswiseGripIds[1]);
    expect(crosswiseGripIds[1]).not.toBe(crosswiseGripIds[2]);
    expect(crosswiseGripIds[2]).not.toBe(crosswiseGripIds[3]);
    expect(crosswiseGripIds[3]).toBe(crosswiseGripIds[4]);
    expect(new Set(crosswiseGripIds).size).toBe(3);
  }, 30_000);

  it("keeps forced rectangular mixed strips uniformly spaced", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 65 },
        clearanceMm: 0,
        inletOrientation: "lengthwise",
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 165, maxY: 520 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 13,
        maximumPackageCount: 13,
        allowMixedPackageOrientations: true,
        provisionalPackagesPerCycle: 2,
        rectangularBlockFootprintPolicy: "compact-centered",
        requiredShape: "rectangular-block",
        maxCandidatesPerGenerator: 100,
      },
    };

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates.find(({ placements }) => {
      const crosswiseY = placements
        .filter(({ rotation }) => rotation === 90)
        .map(({ positionMm }) => positionMm.y)
        .sort((left, right) => left - right);
      return (
        JSON.stringify(crosswiseY) === JSON.stringify([50, 155, 260, 365, 470])
      );
    });

    expect(candidate?.metrics).toMatchObject({
      packageCount: 13,
      boundingBlockLengthMm: 165,
      boundingBlockWidthMm: 520,
    });
    expect(candidate?.validation.valid).toBe(true);
  }, 30_000);

  it("does not let overlapping outer pinwheels starve an exact center fill", () => {
    for (const maxCandidatesPerGenerator of [1, 2]) {
      const result = solveLayer(
        {
          package: {
            shape: "cuboid",
            dimensionsMm: { length: 54, width: 30 },
            clearanceMm: 5,
          },
          envelopeMm: { minX: 0, minY: 0, maxX: 296, maxY: 251 },
          constraints: {
            allowedRotations: [0, 90],
            minimumPackageCount: 32,
            maximumPackageCount: 32,
            allowMixedPackageOrientations: true,
            maxCandidatesPerGenerator,
          },
        },
        { includeSymmetryVariants: false },
      );
      const candidate = result.candidates.find(({ provenance }) =>
        provenance.some(
          ({ family, variant }) =>
            family === "pinwheel" && variant.endsWith("-center-fill"),
        ),
      );

      expect(candidate?.metrics.packageCount).toBe(32);
      expect(candidate?.validation.valid).toBe(true);
    }
  });

  it("compacts an exact zero-allowance block before selecting nearest-edge label yaws", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: { minX: 0, minY: 0, maxX: 420, maxY: 220 },
      envelopeMm: { minX: 0, minY: 0, maxX: 420, maxY: 220 },
      generationBoundsMm: { minX: 0, minY: 0, maxX: 420, maxY: 220 },
      constraints: {
        allowedRotations: [0, 180],
        minimumPackageCount: 16,
        maximumPackageCount: 16,
        maxCandidatesPerGenerator: 20,
        unrotatedPackageLabelSide: "right",
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    };

    const result = solveLayer(input, {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates[0]!;
    const occupied = boundingRectangleForPlacements(
      candidate.placements,
      input.package.dimensionsMm,
    );

    expect(candidate.validation.valid).toBe(true);
    expect(candidate.placements).toHaveLength(16);
    expect(occupied).toEqual({ minX: 10, minY: 10, maxX: 410, maxY: 210 });
    expect(
      candidate.placements
        .filter(({ positionMm }) => positionMm.x < 210)
        .every(({ rotation }) => rotation === 180),
    ).toBe(true);
    expect(
      candidate.placements
        .filter(({ positionMm }) => positionMm.x > 210)
        .every(({ rotation }) => rotation === 0),
    ).toBe(true);
  });

  it("rejects block dimensions outside the physical pallet envelope", () => {
    const result = validateAndNormalizeSolverInput({
      ...basicInput(),
      generationBoundsMm: { minX: -1, minY: 0, maxX: 400, maxY: 300 },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "invalid-envelope",
        message:
          "The requested generation envelope must fit inside the project-authorized pallet envelope.",
      }),
    );
  });

  it("keeps every candidate valid across seeded package and envelope dimensions", () => {
    const random = seededRandom(0x5017e2);
    for (let caseIndex = 0; caseIndex < 8; caseIndex += 1) {
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
        for (const placement of candidate.placements) {
          expect(
            placementWithinBounds(placement, dimensionsMm, input.envelopeMm),
          ).toBe(true);
        }
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
            expect(
              placementsOverlap(
                candidate.placements[leftIndex]!,
                candidate.placements[rightIndex]!,
                dimensionsMm,
                clearanceMm,
              ),
            ).toBe(false);
          }
        }
      }
    }
  }, 30_000);
});

describe("candidate canonicalization and geometric deduplication", () => {
  it("merges exact geometry while retaining a non-equivalent layout", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 300, maxY: 100 },
      constraints: { allowedRotations: [0], maximumPackageCount: 2 },
    });
    const first: GeneratedCandidateDraft = {
      placements: [
        {
          transientId: "first-a",
          positionMm: { x: 50, y: 50 },
          rotation: 0,
        },
        {
          transientId: "first-b",
          positionMm: { x: 150, y: 50 },
          rotation: 0,
        },
      ],
      provenance: [{ family: "row", variant: "first" }],
    };
    const reordered: GeneratedCandidateDraft = {
      placements: [...first.placements].reverse().map((placement, index) => ({
        ...placement,
        transientId: `renamed-${index}`,
      })),
      provenance: [{ family: "block", variant: "same-geometry" }],
    };
    const shifted: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 50, y: 50 }, rotation: 0 },
        { positionMm: { x: 250, y: 50 }, rotation: 0 },
      ],
      provenance: [{ family: "row", variant: "shifted" }],
    };

    const result = finalizeGeneratedCandidates(input, [
      shifted,
      reordered,
      first,
    ]);

    expect(result.candidates).toHaveLength(2);
    expect(result.geometricDuplicateCount).toBe(1);
    expect(
      result.candidates
        .find(({ provenance }) =>
          provenance.some(({ variant }) => variant === "first"),
        )
        ?.provenance.map(({ family }) => family),
    ).toEqual(["block", "row"]);
    expect(
      result.exclusions.some(({ reason }) => reason === "geometric-duplicate"),
    ).toBe(true);
  });

  it("merges mirrored and 180-degree variants into one base layout deterministically", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 40, width: 20 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 200 },
      constraints: { provisionalPackagesPerCycle: 1 },
    });
    const basePlacements = [
      { positionMm: { x: 40, y: 30 }, rotation: 0 as const },
      { positionMm: { x: 125, y: 70 }, rotation: 90 as const },
      { positionMm: { x: 275, y: 145 }, rotation: 0 as const },
    ];
    const baseDraft: GeneratedCandidateDraft = {
      placements: basePlacements,
      provenance: [{ family: "row", variant: "base-layout" }],
    };
    const symmetryDrafts = (
      ["mirror-x", "mirror-y", "rotate-180"] as const
    ).map(
      (symmetry): GeneratedCandidateDraft => ({
        placements: transformPlacements(
          basePlacements,
          input.generationBoundsMm,
          symmetry,
        ),
        provenance: [
          { family: "row", variant: "base-layout" },
          { family: "symmetry", variant: symmetry, symmetry },
        ],
      }),
    );
    const oppositeDirectedYawDraft: GeneratedCandidateDraft = {
      placements: basePlacements.map((placement) => ({
        ...placement,
        rotation: ((placement.rotation + 180) % 360) as 0 | 90 | 180 | 270,
      })),
      provenance: [{ family: "row", variant: "opposite-directed-yaw" }],
    };
    const distinctDraft: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 45, y: 35 }, rotation: 0 },
        { positionMm: { x: 175, y: 80 }, rotation: 90 },
        { positionMm: { x: 320, y: 150 }, rotation: 0 },
      ],
      provenance: [{ family: "block", variant: "distinct-layout" }],
    };
    const drafts = [
      baseDraft,
      oppositeDirectedYawDraft,
      ...symmetryDrafts,
      distinctDraft,
    ];

    const forward = finalizeGeneratedCandidates(input, drafts);
    const reversed = finalizeGeneratedCandidates(input, [...drafts].reverse());
    const snapshot = (result: typeof forward) =>
      result.candidates.map((candidate) => ({
        id: candidate.id,
        geometryFingerprint: candidate.geometryFingerprint,
        placements: candidate.placements.map(
          ({ positionMm, rotation, labelSide }) => ({
            positionMm,
            rotation,
            labelSide,
          }),
        ),
        provenance: candidate.provenance,
        metrics: candidate.metrics,
        score: candidate.score,
      }));

    expect(forward.candidates).toHaveLength(2);
    expect(forward.geometricDuplicateCount).toBe(4);
    expect(snapshot(reversed)).toEqual(snapshot(forward));
    const baseCandidate = forward.candidates.find(({ provenance }) =>
      provenance.some(({ variant }) => variant === "base-layout"),
    );
    expect(
      baseCandidate?.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(basePlacements);
    expect(
      baseCandidate?.provenance
        .filter(({ family }) => family === "symmetry")
        .map(({ symmetry }) => symmetry),
    ).toEqual(["mirror-x", "mirror-y", "rotate-180"]);
    expect(
      baseCandidate?.provenance.some(
        ({ variant }) => variant === "opposite-directed-yaw",
      ),
    ).toBe(true);
    expect(
      forward.exclusions.filter(
        ({ reason }) => reason === "geometric-duplicate",
      ),
    ).toHaveLength(4);
  });

  it("derives candidate deltas from the normalized inlet orientation", () => {
    const draft: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 50, y: 50 }, rotation: 0 },
        { positionMm: { x: 90, y: 110 }, rotation: 0 },
      ],
      provenance: [{ family: "row", variant: "orientation-sensitive-delta" }],
    };
    const input = {
      package: {
        shape: "cuboid" as const,
        dimensionsMm: { length: 100, width: 40 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 140, maxY: 160 },
      constraints: {
        allowedRotations: [0] as const,
        minimumPackageCount: 2,
        maximumPackageCount: 2,
      },
    };
    const lengthwise = finalizeGeneratedCandidates(normalized(input), [draft])
      .candidates[0]!;
    const crosswise = finalizeGeneratedCandidates(
      normalized({
        ...input,
        package: { ...input.package, inletOrientation: "crosswise" },
      }),
      [draft],
    ).candidates[0]!;

    expect(lengthwise.geometryFingerprint).toBe(crosswise.geometryFingerprint);
    expect(lengthwise.geometryId).toBe(crosswise.geometryId);
    expect(lengthwise.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 1 },
    ]);
    const verticalDependency = {
      beforeGripId: "generated-grip:1",
      afterGripId: "generated-grip:2",
    };
    expect(lengthwise.orderDependencies).toEqual([verticalDependency]);
    expect(crosswise.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual([
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ]);
    expect(crosswise.orderDependencies).toEqual([verticalDependency]);
    expect(lengthwise.identityFingerprint).not.toBe(
      crosswise.identityFingerprint,
    );
    expect(lengthwise.id).not.toBe(crosswise.id);
  });

  it("changes operational grouping without changing candidate geometry", () => {
    const draft: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 50, y: 25 }, rotation: 0 },
        { positionMm: { x: 150, y: 25 }, rotation: 0 },
        { positionMm: { x: 250, y: 25 }, rotation: 0 },
      ],
      provenance: [{ family: "row", variant: "three-adjacent" }],
    };
    const input = {
      package: {
        shape: "cuboid" as const,
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 300, maxY: 50 },
      constraints: {
        allowedRotations: [0] as const,
        minimumPackageCount: 3,
        maximumPackageCount: 3,
      },
    };
    const singleton = finalizeGeneratedCandidates(
      normalized({
        ...input,
        constraints: {
          ...input.constraints,
          provisionalPackagesPerCycle: 1,
        },
      }),
      [draft],
    ).candidates[0]!;
    const multipick = finalizeGeneratedCandidates(
      normalized({
        ...input,
        constraints: {
          ...input.constraints,
          provisionalPackagesPerCycle: 2,
        },
      }),
      [draft],
    ).candidates[0]!;

    expect(singleton.geometryFingerprint).toBe(multipick.geometryFingerprint);
    expect(singleton.geometryId).toBe(multipick.geometryId);
    expect(singleton.identityFingerprint).not.toBe(
      multipick.identityFingerprint,
    );
    expect(singleton.id).not.toBe(multipick.id);
    expect(
      singleton.grips.map(({ id, numPackages }) => [id, numPackages]),
    ).toEqual([
      ["generated-grip:3", 1],
      ["generated-grip:2", 1],
      ["generated-grip:1", 1],
    ]);
    expect(
      multipick.grips.map(({ id, numPackages }) => [id, numPackages]),
    ).toEqual([
      ["generated-grip:3", 1],
      ["generated-grip:1+2", 2],
    ]);
    expect(multipick.placements.map(({ gripId }) => gripId)).toEqual([
      "generated-grip:1+2",
      "generated-grip:1+2",
      "generated-grip:3",
    ]);
    expect(
      multipick.placements.every(({ gripId }) =>
        multipick.grips.some(({ id }) => id === gripId),
      ),
    ).toBe(true);
    expect(singleton.metrics).toMatchObject({
      provisionalCycleCount: 3,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    });
    expect(multipick.metrics).toMatchObject({
      provisionalCycleCount: 2,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    });
  });

  it("retains multiple geometrically different candidates at the same maximum count", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 300, width: 200 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 700, maxY: 500 },
      constraints: { maxCandidatesPerGenerator: 1_000 },
    });
    const maximum = result.candidates[0]?.metrics.packageCount;
    const maximumCandidates = result.candidates.filter(
      ({ metrics }) => metrics.packageCount === maximum,
    );

    expect(maximum).toBeGreaterThan(0);
    expect(maximumCandidates.length).toBeGreaterThan(1);
    expect(
      new Set(
        maximumCandidates.map(({ geometryFingerprint }) => geometryFingerprint),
      ).size,
    ).toBe(maximumCandidates.length);
  });

  it("assigns nearest-edge exact yaws without changing a mixed rectangular block", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 200,
        maxY: 250,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 250 },
      generationBoundsMm: { minX: 0, minY: 0, maxX: 200, maxY: 250 },
      constraints: {
        allowedRotations: [0, 90, 180, 270],
        minimumPackageCount: 10,
        maximumPackageCount: 10,
        allowMixedPackageOrientations: true,
        unrotatedPackageLabelSide: "right",
        requiredShape: "rectangular-block",
      },
    });
    const placements: GeneratedCandidateDraft["placements"] = [
      { positionMm: { x: 25, y: 50 }, rotation: 90 },
      { positionMm: { x: 75, y: 50 }, rotation: 90 },
      { positionMm: { x: 125, y: 50 }, rotation: 90 },
      { positionMm: { x: 175, y: 50 }, rotation: 90 },
      { positionMm: { x: 50, y: 125 }, rotation: 0 },
      { positionMm: { x: 150, y: 125 }, rotation: 0 },
      { positionMm: { x: 25, y: 200 }, rotation: 90 },
      { positionMm: { x: 75, y: 200 }, rotation: 90 },
      { positionMm: { x: 125, y: 200 }, rotation: 90 },
      { positionMm: { x: 175, y: 200 }, rotation: 90 },
    ];
    const draft: GeneratedCandidateDraft = {
      placements,
      provenance: [{ family: "mixed-orientation", variant: "test-block" }],
    };

    const first = finalizeGeneratedCandidates(input, [draft]);
    const second = finalizeGeneratedCandidates(input, [draft]);
    const candidate = first.candidates[0]!;
    const sourceByPosition = new Map(
      placements.map((placement) => [
        `${placement.positionMm.x},${placement.positionMm.y}`,
        placement,
      ]),
    );
    const expectedRotationByPosition = new Map([
      ["25,50", 270],
      ["75,50", 270],
      ["125,50", 270],
      ["175,50", 270],
      ["50,125", 180],
      ["150,125", 0],
      ["25,200", 90],
      ["75,200", 90],
      ["125,200", 90],
      ["175,200", 90],
    ]);

    expect(second).toEqual(first);
    expect(candidate.validation.valid).toBe(true);
    expect(candidate.placements).toHaveLength(10);
    expect(
      new Set(candidate.placements.map(({ rotation }) => rotation)),
    ).toEqual(new Set([0, 90, 180, 270]));
    for (const placement of candidate.placements) {
      const positionKey = `${placement.positionMm.x},${placement.positionMm.y}`;
      const source = sourceByPosition.get(positionKey)!;
      expect(placement.rotation).toBe(
        expectedRotationByPosition.get(positionKey),
      );
      expect(input.constraints.allowedRotations).toContain(placement.rotation);
      expect(packageOrientationClass(placement.rotation)).toBe(
        packageOrientationClass(source.rotation),
      );
      expect(
        placementRectangleBounds(placement, input.package.dimensionsMm),
      ).toEqual(placementRectangleBounds(source, input.package.dimensionsMm));
      expect(placement.positionMm).toEqual(source.positionMm);
      expect(placement.labelSide).not.toBeNull();
    }

    const mixedDisabled = finalizeGeneratedCandidates(
      normalized({
        ...input,
        physicalPalletBoundsMm: input.physicalPalletBoundsMm ?? undefined,
        constraints: {
          ...input.constraints,
          allowMixedPackageOrientations: false,
        },
      }),
      [draft],
    );
    expect(mixedDisabled.candidates).toEqual([]);
    expect(mixedDisabled.exclusions[0]?.issues).toContainEqual(
      expect.objectContaining({
        code: "mixed-package-orientations-disallowed",
      }),
    );
  });

  it("keeps a non-central generated yaw when opposite pallet edges are equally near", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 200,
        maxY: 100,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      constraints: {
        allowedRotations: [0, 180],
        minimumPackageCount: 1,
        maximumPackageCount: 1,
        unrotatedPackageLabelSide: "right",
      },
    });
    const result = finalizeGeneratedCandidates(input, [
      {
        placements: [{ positionMm: { x: 100, y: 75 }, rotation: 0 }],
        provenance: [{ family: "row", variant: "edge-distance-tie" }],
      },
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.placements[0]).toEqual(
      expect.objectContaining({ rotation: 0, labelSide: "right" }),
    );
    expect(result.invalidDraftCount).toBe(0);
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "outward-label-yaw-unavailable" }),
    );
  });

  it("rejects a candidate when neither yaw in its footprint class is authorized", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 200,
        maxY: 100,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      constraints: {
        allowedRotations: [90, 270],
        minimumPackageCount: 1,
        maximumPackageCount: 1,
        unrotatedPackageLabelSide: "right",
      },
    });
    const result = finalizeGeneratedCandidates(input, [
      {
        placements: [{ positionMm: { x: 100, y: 50 }, rotation: 0 }],
        provenance: [{ family: "row", variant: "unauthorized-footprint-yaw" }],
      },
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.invalidDraftCount).toBe(1);
    expect(result.exclusions[0]?.issues).toContainEqual(
      expect.objectContaining({
        code: "outward-label-yaw-unavailable",
        placementIndices: [0],
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "outward-label-yaw-unavailable",
        count: 1,
      }),
    );
  });
});

describe("deterministic solve orchestration", () => {
  it("is independent of generator order and progress batching", () => {
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 180, width: 120 },
        clearanceMm: 5,
      },
      envelopeMm: { minX: -10, minY: 5, maxX: 890, maxY: 605 },
      constraints: { maxCandidatesPerGenerator: 300 },
    };
    const progressA: string[] = [];
    const progressB: string[] = [];
    const first = solveLayer(input, {
      generatorOrder: [
        "nested-side",
        "row",
        "block",
        "justified-grid",
        "pinwheel",
        "edge-ring",
        "mixed-orientation",
      ],
      progressBatchSize: 1,
      onProgress: ({ phase }) => progressA.push(phase),
    });
    const second = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "pinwheel",
        "justified-grid",
        "block",
        "row",
        "nested-side",
      ],
      progressBatchSize: 97,
      onProgress: ({ phase }) => progressB.push(phase),
    });
    const comparable = (result: typeof first) => ({
      status: result.status,
      candidates: result.candidates.map(
        ({ id, geometryFingerprint, metrics, provenance }) => ({
          id,
          geometryFingerprint,
          metrics,
          provenance,
        }),
      ),
      diagnostics: result.diagnostics,
      exclusions: result.exclusions,
      statistics: result.statistics,
    });

    expect(comparable(second)).toEqual(comparable(first));
    expect(progressA.length).toBeGreaterThan(progressB.length);
  }, 15_000);

  it("exposes generator provenance, duplicate exclusions, and unverified Blocks", () => {
    const result = solveLayer(
      basicInput({
        constraints: {
          maxCandidatesPerGenerator: 200,
          provisionalPackagesPerCycle: 2,
        },
      }),
      { progressBatchSize: 50 },
    );
    const provenanceFamilies = new Set(
      result.candidates.flatMap(({ provenance }) =>
        provenance.map(({ family }) => family),
      ),
    );

    expect(provenanceFamilies.has("row")).toBe(true);
    expect(provenanceFamilies.has("block")).toBe(true);
    expect(provenanceFamilies.has("justified-grid")).toBe(true);
    expect(provenanceFamilies.has("pinwheel")).toBe(true);
    expect(provenanceFamilies.has("nested-side")).toBe(true);
    expect(provenanceFamilies.has("edge-ring")).toBe(true);
    expect(provenanceFamilies.has("mixed-orientation")).toBe(true);
    expect(provenanceFamilies.has("symmetry")).toBe(true);
    expect(
      result.exclusions.some(({ reason }) => reason === "geometric-duplicate"),
    ).toBe(true);
    for (const candidate of result.candidates) {
      expect(candidate.metrics.multiPackBlocks).toBeNull();
      expect(candidate.metrics.multiPackBlocksVerification).toBe("unverified");
      expect(candidate.metrics.provisionalCycleCount).toBe(
        candidate.grips.length,
      );
      expect(candidate.metrics.provisionalCycleBasis).toBe(
        "generated-grip-groups",
      );
      expect(
        candidate.grips.every(
          ({ numPackages }) => numPackages >= 1 && numPackages <= 2,
        ),
      ).toBe(true);
      expect(
        candidate.placements.every(({ gripId }) =>
          candidate.grips.some(({ id }) => id === gripId),
        ),
      ).toBe(true);
      expect(candidate.score.multiPackBlocks).toBeNull();
    }
  });

  it("does not use an unknown MultiPack Blocks value in ranking", () => {
    const result = solveLayer(basicInput(), {
      includeSymmetryVariants: false,
    });
    const candidate = result.candidates[0]!;
    const left = {
      ...candidate,
      score: { ...candidate.score, multiPackBlocks: 1 },
    } as unknown as Omit<SolverCandidate, "rank">;
    const right = {
      ...candidate,
      score: { ...candidate.score, multiPackBlocks: 999 },
    } as unknown as Omit<SolverCandidate, "rank">;

    expect(compareSolverCandidates(left, right)).toBe(0);
  });

  it("reports phases and cooperatively cancels without returning partial candidates", () => {
    let cancel = false;
    const phases: string[] = [];
    const result = solveLayer(basicInput(), {
      progressBatchSize: 1,
      onProgress: (progress) => {
        phases.push(progress.phase);
        if (progress.phase === "generation" && progress.completed >= 2) {
          cancel = true;
        }
      },
      shouldCancel: () => cancel,
    });

    expect(result.status).toBe("cancelled");
    expect(result.candidates).toEqual([]);
    expect(phases).toContain("input-validation");
    expect(phases).toContain("generation");
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "solver-cancelled",
    );
  });
});

describe("observed MultiPack geometry", () => {
  it("generates the observed 55-package balanced capped strip", () => {
    const values = observedAp5006.input.values;
    const envelopeMm = createCenteredEffectivePalletEnvelope(
      {
        length: values.pallet.lengthMm,
        width: values.pallet.widthMm,
      },
      {
        length: values.pallet.underhangLengthMm,
        width: values.pallet.underhangWidthMm,
      },
    );
    const expectedPlacements = [
      ...[95.5, 1104.5].flatMap((x) =>
        [58.5, 164.5, 270.5].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[229, 335, 441, 547, 653, 759, 865, 971].flatMap((x) =>
        [84, 245].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[70, 176, 282, 388, 494, 600, 706, 812, 918, 1024, 1130].flatMap((x) =>
        [402, 559, 716].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const expectedGeometryKey =
      canonicalPlacementGeometryKey(expectedPlacements);
    const result = solveLayer({
      package: {
        shape: values.package.shape,
        dimensionsMm: {
          length: values.package.lengthMm,
          width: values.package.widthMm,
        },
        clearanceMm: values.package.clearanceMm,
      },
      envelopeMm,
      constraints: { maxCandidatesPerGenerator: 200 },
    });
    const maximum = result.candidates[0]?.metrics.packageCount;
    const maximumCandidates = result.candidates.filter(
      ({ metrics }) => metrics.packageCount === maximum,
    );
    const observedCandidate = maximumCandidates.find(
      ({ placements }) =>
        canonicalPlacementGeometryKey(placements) === expectedGeometryKey,
    );

    expect(maximum).toBe(55);
    expect(maximumCandidates).toHaveLength(7);
    expect(
      maximumCandidates.filter(({ provenance }) =>
        provenance.some(({ variant }) => variant === "balanced-capped-block"),
      ),
    ).toHaveLength(2);
    expect(observedCandidate).toBeDefined();
    expect(observedCandidate?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 55,
        boundingBlockLengthMm: 1166,
        boundingBlockWidthMm: 789,
      }),
    );
    const observedProvenance = observedCandidate?.provenance.find(
      ({ family, variant }) =>
        family === "nested-side" && variant === "balanced-capped-strip",
    );
    expect(observedProvenance?.parameters?.topology).toBe(
      "balanced-capped-strip-v1",
    );
    expect(
      maximumCandidates.filter(
        ({ metrics }) =>
          metrics.boundingBlockLengthMm === 1166 &&
          metrics.boundingBlockWidthMm === 785,
      ),
    ).toHaveLength(1);
    expect(maximumCandidates.every(({ validation }) => validation.valid)).toBe(
      true,
    );
  }, 15_000);

  it("keeps the observed 53-package four-block layout after finalization", () => {
    const envelopeMm = createCenteredEffectivePalletEnvelope(
      { length: 1200, width: 800 },
      { length: -12, width: -20 },
    );
    const expectedPlacements = [
      ...[60, 168, 276, 384, 492, 600, 708, 816, 924, 1032, 1140].flatMap((x) =>
        [556, 712].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[84, 240, 960, 1116].flatMap((x) =>
        [64, 184, 304, 424].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[372, 486, 600, 714, 828].flatMap((x) =>
        [88, 244, 400].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];
    const input: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm,
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 200,
      },
    };
    const result = solveLayer(input, {
      generatorOrder: [
        "nested-side",
        "row",
        "block",
        "justified-grid",
        "pinwheel",
        "edge-ring",
        "mixed-orientation",
      ],
      progressBatchSize: 1,
    });
    const reordered = solveLayer(input, {
      generatorOrder: [
        "mixed-orientation",
        "edge-ring",
        "pinwheel",
        "justified-grid",
        "block",
        "row",
        "nested-side",
      ],
      progressBatchSize: 97,
    });
    const candidate = result.candidates.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "balanced-capped-block" &&
          parameters?.topology === "balanced-capped-block-v1" &&
          parameters.capColumns === 2 &&
          parameters.capRows === 4 &&
          parameters.coreColumns === 5 &&
          parameters.coreRows === 3,
      ),
    );

    expect(reordered).toEqual(result);
    expect(result.status).toBe("completed");
    expect(candidate).toBeDefined();
    expect(candidate?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 53,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(canonicalPlacementGeometryKey(candidate?.placements ?? [])).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      candidate?.provenance.find(
        ({ variant }) => variant === "balanced-capped-block",
      )?.parameters,
    ).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 36,
        coreInlineResidualMm: 24,
        coreCrossResidualMm: 0,
      }),
    );
    expect(candidate?.validation.valid).toBe(true);
  }, 15_000);

  it("keeps the clean production block inventory", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        provisionalPackagesPerCycle: 2,
        maxCandidatesPerGenerator: 500,
      },
    });
    const threeBlockCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "three-block-split-v1",
      ),
    );
    const distributedThreeBlockCandidates = result.candidates.filter(
      ({ provenance }) =>
        provenance.some(
          ({ parameters }) =>
            parameters?.topology === "three-block-split-distributed-v1",
        ),
    );
    const cFrameCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "four-block-c-frame-v1",
      ),
    );
    const sideCoreCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) =>
          parameters?.topology === "side-core-corner-bands-v1",
      ),
    );
    const cappedBlockCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "balanced-capped-block-v1",
      ),
    );
    const notchCandidates = result.candidates.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
      ),
    );
    const mixedOnlyCandidates = result.candidates.filter(({ provenance }) => {
      const baseFamilies = new Set(
        provenance
          .filter(
            ({ family, variant }) =>
              family !== "symmetry" && variant !== "occupied-bounds-center-v1",
          )
          .map(({ family }) => family),
      );
      return (
        baseFamilies.has("mixed-orientation") &&
        [...baseFamilies].every((family) => family === "mixed-orientation")
      );
    });
    const genericTwoBlockCandidates = result.candidates.filter(
      ({ provenance }) =>
        provenance.some(
          ({ family, variant }) =>
            family === "block" && variant.startsWith("vertical-split-"),
        ),
    );
    const splitSignatures = threeBlockCandidates
      .map(({ provenance }) => {
        const parameters = provenance.find(
          ({ parameters }) => parameters?.topology === "three-block-split-v1",
        )?.parameters;
        return [
          parameters?.outerRotation,
          parameters?.leftOuterColumns,
          parameters?.middleColumns,
          parameters?.rightOuterColumns,
        ].join(":");
      })
      .sort();
    const topologyHistogram = result.candidates.reduce<Record<string, number>>(
      (histogram, candidate) => {
        const topologies = new Set(
          candidate.provenance.flatMap(({ parameters }) =>
            typeof parameters?.topology === "string"
              ? [parameters.topology]
              : [],
          ),
        );
        let category = "other";
        if (topologies.has("dense-edge-notch-v1")) category = "notch";
        else if (topologies.has("balanced-capped-block-v1")) {
          category = "cappedBlock";
        } else if (topologies.has("four-block-c-frame-v1")) {
          category = "cFrame";
        } else if (topologies.has("side-core-corner-bands-v1")) {
          category = "sideCore";
        } else if (topologies.has("three-block-split-distributed-v1")) {
          category = "distributedThree";
        } else if (topologies.has("three-block-split-v1")) {
          category = "compactThree";
        } else if (
          candidate.provenance.some(
            ({ family, variant }) =>
              family === "block" && variant === "vertical-split-start",
          )
        ) {
          category = "twoBlock";
        } else if (
          candidate.provenance.some(
            ({ family, variant }) =>
              family === "mixed-orientation" &&
              variant !== "occupied-bounds-center-v1",
          )
        ) {
          category = "genericMixed";
        }
        histogram[category] = (histogram[category] ?? 0) + 1;
        return histogram;
      },
      {},
    );

    expect(result.status).toBe("completed");
    expect(result.candidates).toHaveLength(7);
    expect(topologyHistogram).toEqual({
      twoBlock: 1,
      compactThree: 4,
      cFrame: 1,
      cappedBlock: 1,
    });
    expect(
      result.candidates
        .map(({ metrics }) => metrics.provisionalCycleCount)
        .sort((left, right) => left - right),
    ).toEqual([29, 29, 29, 36, 43, 43, 43]);
    expect(
      result.candidates
        .map(({ metrics }) => metrics.boundingBlockLengthMm)
        .sort((left, right) => left - right),
    ).toEqual([1164, 1188, 1188, 1188, 1188, 1188, 1188]);
    expect(
      result.diagnostics.some(
        ({ code }) =>
          code === "five-block-mosaic-search-limit-reached" ||
          code === "five-block-offset-bridge-search-limit-reached",
      ),
    ).toBe(false);
    expect(mixedOnlyCandidates).toEqual([]);
    expect(genericTwoBlockCandidates).toHaveLength(1);
    expect(
      genericTwoBlockCandidates[0]?.provenance.some(
        ({ variant }) => variant === "vertical-split-start",
      ),
    ).toBe(true);
    expect(genericTwoBlockCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        provisionalCycleCount: 29,
        boundingBlockLengthMm: 1164,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(cappedBlockCandidates).toHaveLength(1);
    expect(cappedBlockCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        provisionalCycleCount: 29,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(notchCandidates).toEqual([]);
    expect(distributedThreeBlockCandidates).toEqual([]);
    expect(sideCoreCandidates).toEqual([]);
    expect(threeBlockCandidates).toHaveLength(4);
    expect(splitSignatures).toEqual([
      "0:1:5:3",
      "0:2:5:2",
      "90:1:4:4",
      "90:2:4:3",
    ]);
    expect(
      threeBlockCandidates
        .map(({ metrics }) => metrics.provisionalCycleCount)
        .sort((left, right) => left - right),
    ).toEqual([29, 36, 43, 43]);
    expect(cFrameCandidates).toHaveLength(1);
    expect(cFrameCandidates[0]?.metrics).toEqual(
      expect.objectContaining({
        packageCount: 53,
        provisionalCycleCount: 43,
        boundingBlockLengthMm: 1188,
        boundingBlockWidthMm: 780,
      }),
    );
    expect(cFrameCandidates[0]?.validation.valid).toBe(true);
    expect(
      threeBlockCandidates.every(
        ({ metrics, validation }) =>
          metrics.packageCount === 53 &&
          metrics.boundingBlockLengthMm === 1188 &&
          metrics.boundingBlockWidthMm === 780 &&
          validation.valid,
      ),
    ).toBe(true);
  }, 15_000);

  it("keeps incomplete edge-notch layouts out of production", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        provisionalPackagesPerCycle: 2,
        maxCandidatesPerGenerator: 500,
      },
    });

    expect(result.status).toBe("completed");
    expect(
      result.candidates.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      ),
    ).toEqual([]);
  }, 15_000);
});
