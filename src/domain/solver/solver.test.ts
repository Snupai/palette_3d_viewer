import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  createCenteredEffectivePalletEnvelope,
  placementRectangleBounds,
  placementWithinBounds,
  placementsOverlap,
  rectangleBoundsCenter,
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

  it("defaults omitted rectangular block footprint policy to frame filling", () => {
    const result = validateAndNormalizeSolverInput(basicInput());

    expect(result.valid).toBe(true);
    expect(result.normalized?.constraints.rectangularBlockFootprintPolicy).toBe(
      "fill-generation-bounds",
    );
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

    const result = solveLayer(input, { includeSymmetryVariants: false });
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
      const result = solveLayer(input, { includeSymmetryVariants: false });

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
  it("merges only exact geometry while ignoring draft order and transient ids", () => {
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
        { positionMm: { x: 150, y: 50 }, rotation: 0 },
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
        .find(({ placements }) =>
          placements.some(({ positionMm }) => positionMm.x === 50),
        )
        ?.provenance.map(({ family }) => family),
    ).toEqual(["block", "row"]);
    expect(
      result.exclusions.some(({ reason }) => reason === "geometric-duplicate"),
    ).toBe(true);
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
      ["generated-grip:1", 1],
      ["generated-grip:2", 1],
      ["generated-grip:3", 1],
    ]);
    expect(
      multipick.grips.map(({ id, numPackages }) => [id, numPackages]),
    ).toEqual([
      ["generated-grip:1+2", 2],
      ["generated-grip:3", 1],
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
      generatorOrder: ["row", "block", "edge-ring", "mixed-orientation"],
      progressBatchSize: 1,
      onProgress: ({ phase }) => progressA.push(phase),
    });
    const second = solveLayer(input, {
      generatorOrder: ["mixed-orientation", "edge-ring", "block", "row"],
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
  });

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

describe("observed AP5006 geometry", () => {
  it("reaches 55 from the committed dimensions when the effective envelope supports it", () => {
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

    expect(maximum).toBe(55);
    expect(maximumCandidates.length).toBeGreaterThan(1);
    expect(
      maximumCandidates.filter(
        ({ metrics }) =>
          metrics.boundingBlockLengthMm === 1166 &&
          metrics.boundingBlockWidthMm === 785,
      ).length,
    ).toBeGreaterThan(1);
    expect(maximumCandidates.every(({ validation }) => validation.valid)).toBe(
      true,
    );
  }, 15_000);
});
