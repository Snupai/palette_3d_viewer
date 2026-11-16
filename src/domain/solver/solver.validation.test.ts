import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  placementsOverlap,
  rectangleBoundsCenter,
} from "~/domain/geometry";
import { createProject } from "~/domain/project/projectFactory";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import { generateCandidateFamily } from "~/domain/solver/generators";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { packageOrientationClass } from "~/domain/solver/orientationPolicy";
import { createLayerSolverInputFromProject } from "~/domain/solver/projectInput";
import { solveLayer } from "~/domain/solver/solve";
import {
  BASE_GENERATOR_FAMILIES,
  type LayerSolverInput,
} from "~/domain/solver/types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import {
  yieldBetweenSolverTests,
  basicInput,
  normalized,
} from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

describe("solver input and candidate validation", () => {
  it("adapts ProjectV2-compatible per-side underhang without touching legacy geometry", () => {
    const project = createProject(
      {
        id: "solver-project",
        package: {
          inletOrientation: "crosswise",
          labelSidesAtPickup: ["bottom"],
        },
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
    expect(input.constraints?.suctionRemainderPolicy).toBe(
      "centered-singleton",
    );
    expect(
      createLayerSolverInputFromProject({
        ...project,
        package: { ...project.package, inletOrientation: "lengthwise" },
      }).constraints?.suctionRemainderPolicy,
    ).toBe("axis-ends");
    expect(input.package.inletOrientation).toBe("crosswise");
    expect(input.constraints?.unrotatedPackageLabelSide).toBe("bottom");
    expect(
      createLayerSolverInputFromProject(project, {
        unrotatedPackageLabelSide: null,
      }).constraints?.unrotatedPackageLabelSide,
    ).toBeNull();
    expect(
      createLayerSolverInputFromProject({
        ...project,
        package: { ...project.package, labelSidesAtPickup: ["top", "bottom"] },
      }).constraints?.unrotatedPackageLabelSide,
    ).toBeNull();
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

    // The all-family order contract is covered by the orchestration tests below.
    // This regression verifies the pinwheel geometry and its finalization.
    const normalizedInput = normalized(input);
    const drafts = generateCandidateFamily(normalizedInput, "pinwheel").drafts;
    const first = finalizeGeneratedCandidates(normalizedInput, drafts);
    const second = finalizeGeneratedCandidates(
      normalizedInput,
      [...drafts].reverse(),
    );
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

    const normalizedInput = normalized(input);
    const generated = generateCandidateFamily(normalizedInput, "pinwheel", {
      includeExperimentalIncompleteBlocks: true,
    });
    const result = finalizeGeneratedCandidates(
      normalizedInput,
      generated.drafts,
    );
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

    const normalizedInput = normalized(input);
    const generated = generateCandidateFamily(normalizedInput, "pinwheel", {
      includeExperimentalIncompleteBlocks: true,
    });
    const result = finalizeGeneratedCandidates(
      normalizedInput,
      generated.drafts,
    );
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

    const normalizedInput = normalized(input);
    const generated = generateCandidateFamily(
      normalizedInput,
      "mixed-orientation",
    );
    const result = finalizeGeneratedCandidates(
      normalizedInput,
      generated.drafts,
    );
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
});

it("groups generated grips like the editor whatever the remainder policy", () => {
  const input: LayerSolverInput = {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 50 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 500, maxY: 50 },
    constraints: {
      allowedRotations: [0],
      minimumPackageCount: 5,
      maximumPackageCount: 5,
      provisionalPackagesPerCycle: 2,
      suctionRemainderPolicy: "axis-ends",
    },
  };
  const first = solveLayer(input, {
    generatorOrder: BASE_GENERATOR_FAMILIES,
    progressBatchSize: 1,
  });
  const second = solveLayer(input, {
    generatorOrder: [...BASE_GENERATOR_FAMILIES].reverse(),
    progressBatchSize: 97,
  });
  expect(first.candidates).toEqual(second.candidates);
  expect(first.candidates).toHaveLength(1);
  const candidate = first.candidates[0]!;
  expect(candidate.grips).toHaveLength(3);
  expect(
    candidate.grips
      .map((grip) =>
        candidate.placements
          .filter((p) => p.gripId === grip.id)
          .map((p) => p.positionMm.x)
          .sort((a, b) => a - b),
      )
      .sort((a, b) => a[0]! - b[0]!),
  ).toEqual([[50, 150], [250], [350, 450]]);
  // The policy still shapes generator layouts but no longer the grips: the
  // shared grip optimizer keeps the single grip at the centre of the row.
  const centered = solveLayer({
    ...input,
    constraints: {
      ...input.constraints,
      suctionRemainderPolicy: "centered-singleton",
    },
  });
  expect(centered.candidates.map(({ grips }) => grips)).toEqual(
    first.candidates.map(({ grips }) => grips),
  );
  expect(
    validateAndNormalizeSolverInput({
      ...input,
      constraints: {
        ...input.constraints,
        suctionRemainderPolicy: "invalid" as never,
      },
    }).valid,
  ).toBe(false);
});
