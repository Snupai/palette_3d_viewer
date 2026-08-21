import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  rectangleBoundsCenter,
  transformPlacements,
} from "~/domain/geometry";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import {
  generateCandidateFamily,
  generateSymmetryCandidateDrafts,
} from "~/domain/solver/generators";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import type {
  GeneratedCandidateDraft,
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
    throw new Error("Expected a valid solver input.");
  }
  return validation.normalized;
}

function provenanceParameters(draft: GeneratedCandidateDraft) {
  return draft.provenance[0]?.parameters ?? {};
}

function matchingDraft(
  drafts: readonly GeneratedCandidateDraft[],
  expected: Record<string, string | number>,
): GeneratedCandidateDraft {
  const draft = drafts.find((candidate) => {
    const parameters = provenanceParameters(candidate);
    return Object.entries(expected).every(
      ([key, value]) => parameters[key] === value,
    );
  });
  if (!draft)
    throw new Error(`Missing justified draft ${JSON.stringify(expected)}.`);
  return draft;
}

describe("justified split-grid generator", () => {
  it("generates a dense field plus integer-balanced side strip", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 132, width: 110 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "justified-grid");
    const draft = matchingDraft(output.drafts, {
      splitAxis: "x",
      denseRotation: 0,
      sparseRotation: 90,
      denseColumns: 8,
      denseRows: 7,
      sparseCount: 5,
      spacingPolicy: "integer-balanced-space-between",
    });
    const sparse = draft.placements.filter(({ rotation }) => rotation === 90);

    expect(draft.placements).toHaveLength(61);
    expect(sparse.map(({ positionMm }) => positionMm)).toEqual([
      { x: 1128, y: 81 },
      { x: 1128, y: 240 },
      { x: 1128, y: 400 },
      { x: 1128, y: 559 },
      { x: 1128, y: 719 },
    ]);
    expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
      true,
    );
  });

  it("generates a dense field plus integer-balanced end cap", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 205, width: 98 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1180, maxY: 770 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "justified-grid");
    const draft = matchingDraft(output.drafts, {
      splitAxis: "y",
      denseRotation: 90,
      sparseRotation: 0,
      denseColumns: 12,
      denseRows: 3,
      sparseCount: 5,
      spacingPolicy: "integer-balanced-space-between",
    });
    const sparse = draft.placements.filter(({ rotation }) => rotation === 0);

    expect(draft.placements).toHaveLength(41);
    expect(sparse.map(({ positionMm }) => positionMm.x)).toEqual([
      104.25, 347.25, 589.25, 832.25, 1075.25,
    ]);
    expect(
      rectangleBoundsCenter(
        boundingRectangleForPlacements(
          draft.placements,
          input.package.dimensionsMm,
        )!,
      ),
    ).toEqual(rectangleBoundsCenter(input.generationBoundsMm));
    expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
      true,
    );
  });

  it("generates a centered four-region pinwheel from dimension-derived grid counts", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 136, width: 94 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "pinwheel");
    const draft = matchingDraft(output.drafts, {
      lengthwiseRotation: 0,
      crosswiseRotation: 90,
      lengthwiseColumns: 6,
      crosswiseColumns: 4,
      lengthwiseRows: 4,
      crosswiseRows: 3,
      chirality: "cross-bottom-left",
    });

    expect(draft.placements).toHaveLength(72);
    expect(
      draft.placements.filter(({ rotation }) => rotation === 0),
    ).toHaveLength(48);
    expect(
      draft.placements.filter(({ rotation }) => rotation === 90),
    ).toHaveLength(24);
    expect(
      boundingRectangleForPlacements(
        draft.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 4, minY: 8, maxX: 1196, maxY: 792 });
    expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
      true,
    );
  });

  it("cancels during five-block offset-bridge preparation and matching", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 1 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 16, maxY: 16 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 257,
        maximumPackageCount: 257,
        maxPlacements: 257,
        maxBands: 16,
        maxCandidatesPerGenerator: 1,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
      },
    });
    let cancellationPolls = 0;

    const output = generateCandidateFamily(input, "pinwheel", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return cancellationPolls >= 5_000;
      },
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toEqual([]);
    expect(cancellationPolls).toBe(5_000);
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "five-block-offset-bridge-search-limit-reached",
      }),
    );
  });

  it("hard-bounds all five-block offset-bridge search work", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 1 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 4_097,
        maximumPackageCount: 4_097,
        maxPlacements: 4_097,
        maxBands: 64,
        maxCandidatesPerGenerator: 1,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
      },
    });

    const output = generateCandidateFamily(input, "pinwheel");
    const offsetBridgeLimit = output.diagnostics.find(
      ({ code }) => code === "five-block-offset-bridge-search-limit-reached",
    );

    expect(output.cancelled).toBe(false);
    expect(output.drafts).toEqual([]);
    expect(offsetBridgeLimit).toEqual(
      expect.objectContaining({
        generator: "pinwheel",
        count: 100_000,
      }),
    );
  });

  it("preserves the synthetic 42-package offset-bridge candidate and provenance", () => {
    const input = normalized({
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
    });
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

    const first = generateCandidateFamily(input, "pinwheel");
    const second = generateCandidateFamily(input, "pinwheel");
    const candidate = first.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "five-block-offset-bridge" &&
          parameters?.topology === "offset-bridge-v1" &&
          parameters.leftMainRotation === 0 &&
          parameters.leftMainColumns === 3 &&
          parameters.leftMainRows === 5 &&
          parameters.bottomBandRotation === 90 &&
          parameters.bottomBandColumns === 5 &&
          parameters.bottomBandRows === 1 &&
          parameters.bridgeRotation === 90 &&
          parameters.bridgeColumns === 1 &&
          parameters.bridgeRows === 2 &&
          parameters.rightMainRotation === 0 &&
          parameters.rightMainColumns === 3 &&
          parameters.rightMainRows === 5 &&
          parameters.topBandRotation === 90 &&
          parameters.topBandColumns === 5 &&
          parameters.topBandRows === 1 &&
          parameters.occupiedLengthMm === 1_185 &&
          parameters.occupiedWidthMm === 792,
      ),
    );

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(42);
    expect(candidate).toBeDefined();
    expect(candidate?.placements).toHaveLength(42);
    expect(canonicalPlacementGeometryKey(candidate?.placements ?? [])).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      validateCandidatePlacements(input, candidate?.placements ?? []).valid,
    ).toBe(true);
  });

  it("preserves offset-bridge joins across metric rounding boundaries", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 0.1 },
        clearanceMm: 5e-10,
      },
      envelopeMm: {
        minX: 0,
        minY: 0,
        maxX: 3.000000001,
        maxY: 1.0000000045,
      },
      generationBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 3.000000001,
        maxY: 1.0000000045,
      },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 21,
        maximumPackageCount: 21,
        maxPlacements: 21,
        maxBands: 9,
        maxCandidatesPerGenerator: 500,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
      },
    });
    const expectedPlacements = [
      ...[
        0.150000001, 0.250000001, 0.350000001, 0.450000002, 0.550000003,
        0.650000003, 0.750000004, 0.850000004, 0.950000005,
      ].map((y) => ({
        positionMm: { x: 0.5, y },
        rotation: 0 as const,
      })),
      {
        positionMm: { x: 0.5, y: 0.05 },
        rotation: 0 as const,
      },
      {
        positionMm: { x: 1.500000001, y: 0.150000001 },
        rotation: 0 as const,
      },
      ...[
        0.05, 0.150000001, 0.250000001, 0.350000002, 0.450000002, 0.550000003,
        0.650000003, 0.750000004, 0.850000004, 0.950000005,
      ].map((y) => ({
        positionMm: { x: 2.500000001, y },
        rotation: 0 as const,
      })),
    ];

    const output = generateCandidateFamily(input, "pinwheel");
    const candidate = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "five-block-offset-bridge" &&
          parameters?.topology === "offset-bridge-v1" &&
          parameters.leftMainRotation === 0 &&
          parameters.leftMainColumns === 1 &&
          parameters.leftMainRows === 9 &&
          parameters.bottomBandRotation === 0 &&
          parameters.bottomBandColumns === 1 &&
          parameters.bottomBandRows === 1 &&
          parameters.bridgeRotation === 0 &&
          parameters.bridgeColumns === 1 &&
          parameters.bridgeRows === 1 &&
          parameters.rightMainRotation === 0 &&
          parameters.rightMainColumns === 1 &&
          parameters.rightMainRows === 2 &&
          parameters.topBandRotation === 0 &&
          parameters.topBandColumns === 1 &&
          parameters.topBandRows === 8 &&
          parameters.occupiedLengthMm === 3.000000001 &&
          parameters.occupiedWidthMm === 1.0000000045,
      ),
    );

    expect(expectedPlacements).toHaveLength(21);
    expect(candidate).toBeDefined();
    expect(candidate?.placements).toHaveLength(21);
    expect(canonicalPlacementGeometryKey(candidate?.placements ?? [])).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      validateCandidatePlacements(input, candidate?.placements ?? []).valid,
    ).toBe(true);
  });

  it("generates a nested side region with top and bottom bands around a dense core", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 232, width: 155 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const draft = matchingDraft(output.drafts, {
      lengthwiseRotation: 0,
      crosswiseRotation: 90,
      mainColumns: 3,
      mainRows: 5,
      crosswiseColumns: 3,
      coreColumns: 2,
      coreRows: 2,
    });
    const crosswise = draft.placements.filter(
      ({ rotation }) => rotation === 90,
    );

    expect(draft.placements).toHaveLength(25);
    expect(crosswise.map(({ positionMm }) => positionMm)).toEqual([
      { x: 793, y: 128.5 },
      { x: 948, y: 128.5 },
      { x: 1103, y: 128.5 },
      { x: 793, y: 671.5 },
      { x: 948, y: 671.5 },
      { x: 1103, y: 671.5 },
    ]);
    expect(
      boundingRectangleForPlacements(
        draft.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 19.5, minY: 12.5, maxX: 1180.5, maxY: 787.5 });
    expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
      true,
    );
  });

  it("is deterministic, cooperatively cancellable, and reports only true truncation", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 132, width: 110 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const first = generateCandidateFamily(input, "justified-grid");
    const second = generateCandidateFamily(input, "justified-grid");

    expect(second).toEqual(first);
    expect(first.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "generation-limit-reached" }),
    );
    expect(
      first.drafts.every(
        ({ placements }) =>
          validateCandidatePlacements(input, placements).valid,
      ),
    ).toBe(true);

    const cancelled = generateCandidateFamily(input, "justified-grid", {
      checkpoint: () => false,
    });
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.drafts).toHaveLength(1);

    const limitedInput = normalized({
      ...input,
      physicalPalletBoundsMm: input.physicalPalletBoundsMm ?? undefined,
      constraints: { maxCandidatesPerGenerator: 1 },
    });
    const limited = generateCandidateFamily(limitedInput, "justified-grid");
    expect(limited.drafts).toHaveLength(1);
    expect(limited.diagnostics).toEqual([
      expect.objectContaining({
        phase: "generation",
        generator: "justified-grid",
        code: "generation-limit-reached",
        count: 1,
      }),
    ]);
    expect(limited.exclusions).toEqual([
      expect.objectContaining({ reason: "generation-limit" }),
    ]);
  });

  it("keeps decimal-clearance row drafts valid and centered", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 98, width: 100 },
        clearanceMm: 0.1,
      },
      envelopeMm: { minX: 0.1, minY: 0, maxX: 196.2, maxY: 100 },
      generationBoundsMm: {
        minX: 0.1,
        minY: 0,
        maxX: 196.2,
        maxY: 100,
      },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 2,
        maximumPackageCount: 2,
        maxCandidatesPerGenerator: 100,
      },
    });
    const output = generateCandidateFamily(input, "row");
    const targetCenter = rectangleBoundsCenter(input.generationBoundsMm);

    expect(output.drafts.length).toBeGreaterThan(0);
    for (const draft of output.drafts) {
      const occupiedCenter = rectangleBoundsCenter(
        boundingRectangleForPlacements(
          draft.placements,
          input.package.dimensionsMm,
        )!,
      );
      expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
        true,
      );
      expect(Math.abs(occupiedCenter.x - targetCenter.x)).toBeLessThanOrEqual(
        SOLVER_GEOMETRY_EPSILON_MM,
      );
      expect(Math.abs(occupiedCenter.y - targetCenter.y)).toBeLessThanOrEqual(
        SOLVER_GEOMETRY_EPSILON_MM,
      );
    }
  });

  it("falls back to singleton spacing when one suction group cannot span the shared strip", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 53 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 212, maxY: 153 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 6,
        maximumPackageCount: 6,
        maxBands: 2,
        maxCandidatesPerGenerator: 100,
        provisionalPackagesPerCycle: 2,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const draft = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant }) =>
          variant ===
          "horizontal-grouped-lengthwise-first-exact-rectangular-compact",
      ),
    );

    expect(
      draft?.placements
        .filter(({ rotation }) => rotation === 0)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([50, 162]);
    expect(draft?.placements).toHaveLength(6);
  });

  it("keeps alternating mixed strips alongside compact rectangles when any shape is allowed", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 220 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10,
        maximumPackageCount: 10,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const compact = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant }) =>
          variant ===
          "vertical-grouped-lengthwise-first-exact-rectangular-compact",
      ),
    );
    const alternating = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ parameters }) =>
          parameters?.axis === "vertical" &&
          parameters.order === "grouped-lengthwise-first" &&
          parameters.inlinePolicy === "alternate-start-end",
      ),
    );

    expect(
      compact?.placements
        .filter(({ rotation }) => rotation === 0)
        .map(({ positionMm }) => positionMm.y),
    ).toEqual([35, 85, 135, 185]);
    expect(
      alternating?.placements
        .filter(({ rotation }) => rotation === 0)
        .map(({ positionMm }) => positionMm.y),
    ).toEqual([25, 75, 125, 175]);
    expect(
      alternating?.placements
        .filter(
          ({ positionMm, rotation }) => rotation === 90 && positionMm.x === 135,
        )
        .map(({ positionMm }) => positionMm.y),
    ).toEqual([70, 170]);
  });

  it("enumerates exact mixed band counts below per-band capacity when any shape is allowed", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 50, width: 30 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 130 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 22,
        maximumPackageCount: 22,
        maxBands: 3,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const draft = output.drafts.find(
      ({ placements, provenance }) =>
        placements.length === 22 &&
        provenance.some(
          ({ variant, parameters }) =>
            variant ===
              "horizontal-grouped-lengthwise-first-exact-rectangular-compact" &&
            parameters?.lengthwiseBandCount === 1 &&
            parameters.crosswiseBandCount === 2,
        ),
    );
    const packageCountsByBand = [
      ...(
        draft?.placements.reduce((counts, { positionMm }) => {
          counts.set(positionMm.y, (counts.get(positionMm.y) ?? 0) + 1);
          return counts;
        }, new Map<number, number>()) ?? new Map<number, number>()
      ).values(),
    ].sort((left, right) => left - right);

    expect(packageCountsByBand).toEqual([5, 8, 9]);
  });

  it("keeps aligned block splits alongside compact rectangles when any shape is allowed", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 220 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10,
        maximumPackageCount: 10,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "block");
    const compact = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "vertical-split-exact-rectangular-compact" &&
          parameters?.firstRotation === 0 &&
          parameters.firstColumns === 1,
      ),
    );
    const centered = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant, parameters }) =>
          variant === "vertical-split-center" &&
          parameters?.firstRotation === 0 &&
          parameters.firstColumns === 1,
      ),
    );

    expect(
      compact?.placements
        .filter(({ rotation }) => rotation === 0)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([60, 60, 60, 60]);
    expect(
      centered?.placements
        .filter(({ rotation }) => rotation === 0)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([55, 55, 55, 55]);
    expect(
      centered?.placements
        .filter(({ rotation }) => rotation === 90)
        .map(({ positionMm }) => positionMm.x)
        .sort((left, right) => left - right),
    ).toEqual([140, 140, 190, 190, 240, 240]);
  });

  it("bounds compact block materialization before constructing band arrays", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1e-10, width: 2e-10 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 1,
        maximumPackageCount: 1,
        maxPlacements: 2,
        maxBands: 2,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "block");

    expect(
      output.drafts.every(({ placements }) => placements.length <= 2),
    ).toBe(true);
  });

  it("cancels compact block generation before band arrays are materialized", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 220 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10,
        maximumPackageCount: 10,
        maxCandidatesPerGenerator: 100,
        allowMixedPackageOrientations: true,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "block", {
      shouldCancel: () => true,
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toEqual([]);
  });

  it("merges translation-only alignments before consuming the family limit", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 350, maxY: 120 },
      constraints: {
        allowedRotations: [0],
        maxCandidatesPerGenerator: 9,
      },
    });
    const output = generateCandidateFamily(input, "row");
    const allAligned = output.drafts.find(({ provenance }) =>
      provenance.some(({ parameters }) => parameters?.inlinePolicy === "start"),
    );
    const allAlignedPolicies = new Set(
      allAligned?.provenance
        .map(({ parameters }) => parameters?.inlinePolicy)
        .filter((value): value is string => typeof value === "string"),
    );

    expect(allAlignedPolicies).toEqual(new Set(["start", "center", "end"]));
    expect(
      output.drafts.some(({ provenance }) =>
        provenance.some(
          ({ parameters }) =>
            parameters?.inlinePolicy === "alternate-start-end",
        ),
      ),
    ).toBe(true);
  });

  it("keeps staggered row layouts alongside exact grids when any shape is allowed", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 350, maxY: 200 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 6,
        maximumPackageCount: 6,
        maxCandidatesPerGenerator: 100,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "row");
    const exactGrid = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ variant }) => variant === "exact-rectangular-grid-compact",
      ),
    );
    const staggered = output.drafts.find(({ provenance }) =>
      provenance.some(
        ({ parameters }) =>
          parameters?.axis === "horizontal" &&
          parameters.inlinePolicy === "alternate-start-end",
      ),
    );

    expect(
      exactGrid?.placements
        .filter(({ positionMm }) => positionMm.y === 50)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([75, 175, 275]);
    expect(
      staggered?.placements
        .filter(({ positionMm }) => positionMm.y === 50)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([50, 150, 250]);
    expect(
      staggered?.placements
        .filter(({ positionMm }) => positionMm.y === 150)
        .map(({ positionMm }) => positionMm.x),
    ).toEqual([100, 200, 300]);
  });

  it("preserves opposite provisional yaws on a nearest-edge tie", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      constraints: {
        allowedRotations: [0, 90, 180, 270],
        minimumPackageCount: 1,
        maximumPackageCount: 1,
        maxCandidatesPerGenerator: 3,
        unrotatedPackageLabelSide: "top",
        requiredShape: "rectangular-block",
      },
    });

    const output = generateCandidateFamily(input, "row");

    expect(output.drafts).toHaveLength(3);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({ code: "generation-limit-reached" }),
    );
  });

  it("merges opposite provisional yaws that resolve to the same nearer edge", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 300,
        maxY: 300,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      constraints: {
        allowedRotations: [0, 90, 180, 270],
        minimumPackageCount: 1,
        maximumPackageCount: 1,
        maxCandidatesPerGenerator: 3,
        unrotatedPackageLabelSide: "top",
        requiredShape: "rectangular-block",
      },
    });

    const output = generateCandidateFamily(input, "row");

    expect(output.drafts).toHaveLength(2);
    expect(
      new Set(
        output.drafts.map(({ placements }) => placements[0]!.rotation % 180),
      ),
    ).toEqual(new Set([0, 90]));
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "generation-limit-reached" }),
    );
  });

  it("does not let unauthorized symmetry drafts consume the family limit", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 40, width: 20 },
        clearanceMm: 0,
      },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 200,
        maxY: 200,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
      constraints: {
        allowedRotations: [0],
        maxCandidatesPerGenerator: 1,
        unrotatedPackageLabelSide: "top",
      },
    });
    const source: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 40, y: 90 }, rotation: 0 },
        { positionMm: { x: 80, y: 90 }, rotation: 0 },
        { positionMm: { x: 160, y: 110 }, rotation: 0 },
      ],
      provenance: [{ family: "row", variant: "authorized-after-rotation" }],
    };

    const output = generateSymmetryCandidateDrafts(input, [source]);
    const finalized = finalizeGeneratedCandidates(input, output.drafts);

    expect(output.drafts).toHaveLength(1);
    expect(
      output.drafts[0]?.provenance.some(
        ({ symmetry }) => symmetry === "rotate-180",
      ),
    ).toBe(true);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unauthorized-yaw-source-rejected" }),
    );
    expect(finalized.candidates).toHaveLength(1);
    expect(
      finalized.candidates[0]?.placements.every(
        ({ rotation }) => rotation === 0,
      ),
    ).toBe(true);
  });

  it("builds a tight centered exact grid with clearance-only spacing", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 420, maxY: 220 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 16,
        maximumPackageCount: 16,
        maxCandidatesPerGenerator: 10,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const first = generateCandidateFamily(input, "row");
    const second = generateCandidateFamily(input, "row");
    const draft = first.drafts[0]!;

    expect(second).toEqual(first);
    expect(draft.placements).toHaveLength(16);
    expect(
      boundingRectangleForPlacements(
        draft.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 10, minY: 10, maxX: 410, maxY: 210 });
    expect([
      ...new Set(draft.placements.map(({ positionMm }) => positionMm.x)),
    ]).toEqual([60, 160, 260, 360]);
    expect([
      ...new Set(draft.placements.map(({ positionMm }) => positionMm.y)),
    ]).toEqual([35, 85, 135, 185]);
    expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
      true,
    );
    expect(
      draft.provenance.some(
        ({ variant }) => variant === "exact-rectangular-grid-compact",
      ),
    ).toBe(true);
  });

  it("keeps every compact row draft tight in a frame with unusable residual width", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 407, maxY: 200 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 16,
        maximumPackageCount: 16,
        maxCandidatesPerGenerator: 20,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "row");

    expect(output.drafts.length).toBeGreaterThan(0);
    for (const draft of output.drafts) {
      const occupied = boundingRectangleForPlacements(
        draft.placements,
        input.package.dimensionsMm,
      )!;
      expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
        true,
      );
      expect(occupied.maxX - occupied.minX).toBe(400);
      expect(occupied.maxY - occupied.minY).toBe(200);
      expect(rectangleBoundsCenter(occupied)).toEqual(
        rectangleBoundsCenter(input.generationBoundsMm),
      );
    }
  });

  it("allocates different inline counts to same-orientation compact bands", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 50, width: 30 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 130 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 22,
        maximumPackageCount: 22,
        maxBands: 3,
        maxCandidatesPerGenerator: 20,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "mixed-orientation");
    const draft = output.drafts.find(({ placements }) => {
      const rotations = new Set(placements.map(({ rotation }) => rotation));
      return placements.length === 22 && rotations.size === 2;
    });
    const bands = new Map<number, number>();
    for (const placement of draft?.placements ?? []) {
      bands.set(
        placement.positionMm.y,
        (bands.get(placement.positionMm.y) ?? 0) + 1,
      );
    }

    expect(draft).toBeDefined();
    expect(validateCandidatePlacements(input, draft!.placements).valid).toBe(
      true,
    );
    expect([...bands.values()].sort((left, right) => left - right)).toEqual([
      5, 8, 9,
    ]);
    expect(
      boundingRectangleForPlacements(
        draft!.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual(input.generationBoundsMm);
  });

  it("cancels compact mixed descriptor enumeration before placements are materialized", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 1 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10_000,
        maximumPackageCount: 10_000,
        maxPlacements: 10_000,
        maxBands: 64,
        maxCandidatesPerGenerator: 1,
        allowMixedPackageOrientations: true,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });
    let cancellationPolls = 0;

    const output = generateCandidateFamily(input, "mixed-orientation", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return cancellationPolls >= 5;
      },
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toEqual([]);
    expect(cancellationPolls).toBe(5);
  });

  it("polls cancellation between compact descriptor materializations", () => {
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
    let cancelRequested = false;
    let cancellationPolls = 0;

    const output = generateCandidateFamily(input, "mixed-orientation", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return cancelRequested;
      },
      checkpoint: (_family, generatedCount) => {
        cancelRequested = generatedCount >= 1;
        return true;
      },
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toHaveLength(1);
    expect(cancellationPolls).toBeGreaterThan(1);
  });

  it("prioritizes the smallest-perimeter compact factor pair before the family limit", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 650, maxY: 250 },
      constraints: {
        allowedRotations: [0],
        minimumPackageCount: 12,
        maximumPackageCount: 12,
        maxCandidatesPerGenerator: 1,
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "compact-centered",
      },
    });

    const output = generateCandidateFamily(input, "row");
    const occupied = boundingRectangleForPlacements(
      output.drafts[0]!.placements,
      input.package.dimensionsMm,
    )!;

    expect(output.drafts).toHaveLength(1);
    expect(occupied.maxX - occupied.minX).toBe(300);
    expect(occupied.maxY - occupied.minY).toBe(200);
    expect(rectangleBoundsCenter(occupied)).toEqual(
      rectangleBoundsCenter(input.generationBoundsMm),
    );
  });

  it("applies solver symmetries around the configured generation block", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 50, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 500, maxY: 300 },
      generationBoundsMm: {
        minX: 100,
        minY: 100,
        maxX: 300,
        maxY: 200,
      },
      constraints: {
        allowedRotations: [0, 180],
        maxCandidatesPerGenerator: 20,
      },
    });
    const source: GeneratedCandidateDraft = {
      placements: [
        { positionMm: { x: 125, y: 150 }, rotation: 0 },
        { positionMm: { x: 175, y: 150 }, rotation: 0 },
        { positionMm: { x: 275, y: 150 }, rotation: 0 },
      ],
      provenance: [{ family: "row", variant: "source" }],
    };
    const output = generateSymmetryCandidateDrafts(input, [source]);
    const mirrored = output.drafts.find(({ provenance }) =>
      provenance.some(({ symmetry }) => symmetry === "mirror-x"),
    )!;
    const expected = transformPlacements(
      source.placements,
      input.generationBoundsMm,
      "mirror-x",
    );

    expect(
      mirrored.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(
      expected.map(({ positionMm, rotation }) => ({ positionMm, rotation })),
    );
    expect(
      rectangleBoundsCenter(
        boundingRectangleForPlacements(
          mirrored.placements,
          input.package.dimensionsMm,
        )!,
      ),
    ).toEqual(rectangleBoundsCenter(input.generationBoundsMm));
    expect(
      mirrored.provenance.some(
        ({ parameters }) => parameters?.frame === "generationBoundsMm",
      ),
    ).toBe(true);
  });
});
