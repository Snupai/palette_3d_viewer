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
  if (!draft) throw new Error(`Missing draft ${JSON.stringify(expected)}.`);
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

  it("rejects enclosed same-orientation holes while preserving edge notches", () => {
    const input = normalized({
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
        maxCandidatesPerGenerator: 1_500,
      },
    });
    const fullGrid = [88, 244, 400, 556, 712].flatMap((y, row) =>
      [60, 168, 276, 384, 492, 600, 708, 816, 924, 1032, 1140].map(
        (x, column) => ({
          column,
          row,
          placement: { positionMm: { x, y }, rotation: 90 as const },
        }),
      ),
    );
    const geometryWithout = (missing: ReadonlySet<string>) =>
      canonicalPlacementGeometryKey(
        fullGrid
          .filter(({ column, row }) => !missing.has(`${column}:${row}`))
          .map(({ placement }) => placement),
      );
    const forbiddenGeometryKeys = [
      new Set(["1:2", "10:2"]),
      new Set(["1:2", "1:3"]),
      new Set(["2:2", "2:3"]),
    ].map(geometryWithout);
    const edgeNotchGeometryKey = geometryWithout(new Set(["10:2", "10:3"]));

    const output = generateCandidateFamily(input, "pinwheel");
    const generatedGeometryKeys = new Set(
      output.drafts.map(({ placements }) =>
        canonicalPlacementGeometryKey(placements),
      ),
    );

    expect(
      forbiddenGeometryKeys.every(
        (geometryKey) => !generatedGeometryKeys.has(geometryKey),
      ),
    ).toBe(true);
    expect(generatedGeometryKeys.has(edgeNotchGeometryKey)).toBe(true);
  }, 15_000);

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

  it("generates the observed 55-package balanced capped strip", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 157, width: 106 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 17, minY: 5.5, maxX: 1183, maxY: 794.5 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
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

    const first = generateCandidateFamily(input, "nested-side");
    const second = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(first.drafts, {
      topology: "balanced-capped-strip-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 11,
      mainRows: 3,
      capRows: 3,
      coreColumns: 8,
      coreRows: 2,
    });

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(55);
    expect(candidate.placements).toHaveLength(55);
    expect(canonicalPlacementGeometryKey(candidate.placements)).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      candidate.placements.filter(({ rotation }) => rotation === 0),
    ).toHaveLength(6);
    expect(
      candidate.placements.filter(({ rotation }) => rotation === 90),
    ).toHaveLength(49);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 17, minY: 5.5, maxX: 1183, maxY: 794.5 });
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
    expect(provenanceParameters(candidate)).toEqual({
      topology: "balanced-capped-strip-v1",
      splitAxis: "y",
      mainSide: "end",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 11,
      mainRows: 3,
      capColumns: 1,
      capRows: 3,
      coreRotation: 90,
      coreColumns: 8,
      coreRows: 2,
      spacingPolicy: "continuous-space-between",
      coreInlineResidualMm: 4,
      coreCrossResidualMm: 4,
      occupiedLengthMm: 1166,
      occupiedWidthMm: 789,
    });
    const centeredProvenance = candidate.provenance.find(
      ({ variant }) => variant === "occupied-bounds-center-v1",
    );
    expect(centeredProvenance?.parameters).toEqual(
      expect.objectContaining({ dxMm: 0, dyMm: 0 }),
    );
  });

  it("generates the observed 53-package balanced capped block", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
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
      ...[384, 492, 600, 708, 816].flatMap((x) =>
        [88, 244, 400].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
    ];

    const first = generateCandidateFamily(input, "nested-side");
    const second = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(first.drafts, {
      topology: "balanced-capped-block-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 11,
      mainRows: 2,
      capColumns: 2,
      capRows: 4,
      coreColumns: 5,
      coreRows: 3,
    });

    expect(second).toEqual(first);
    expect(expectedPlacements).toHaveLength(53);
    expect(candidate.placements).toHaveLength(53);
    expect(canonicalPlacementGeometryKey(candidate.placements)).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      candidate.placements.filter(({ rotation }) => rotation === 0),
    ).toHaveLength(16);
    expect(
      candidate.placements.filter(({ rotation }) => rotation === 90),
    ).toHaveLength(37);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 6, minY: 10, maxX: 1194, maxY: 790 });
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 36,
        coreInlineResidualMm: 24,
        coreCrossResidualMm: 0,
        occupiedLengthMm: 1188,
        occupiedWidthMm: 780,
      }),
    );
  });

  it("derives balanced capped regions from other package dimensions", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 120, width: 85 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 595, maxY: 495 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-strip-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 7,
      mainRows: 2,
      capRows: 3,
      coreColumns: 4,
      coreRows: 2,
    });
    const blockCandidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-block-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 7,
      mainRows: 2,
      capColumns: 2,
      capRows: 3,
      coreColumns: 1,
      coreRows: 2,
    });

    expect(candidate.placements).toHaveLength(28);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 595, maxY: 495 });
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        coreInlineResidualMm: 15,
        coreCrossResidualMm: 15,
        occupiedLengthMm: 595,
        occupiedWidthMm: 495,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
    expect(blockCandidate.placements).toHaveLength(28);
    expect(
      boundingRectangleForPlacements(
        blockCandidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 0, minY: 0, maxX: 595, maxY: 495 });
    expect(provenanceParameters(blockCandidate)).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 0,
        coreInlineResidualMm: 30,
        coreCrossResidualMm: 15,
        occupiedLengthMm: 595,
        occupiedWidthMm: 495,
      }),
    );
    expect(
      validateCandidatePlacements(input, blockCandidate.placements).valid,
    ).toBe(true);
  });

  it("derives multi-column cap gaps from non-zero clearance", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 120, width: 85 },
        clearanceMm: 3,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 613, maxY: 507 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const expectedPlacements = [
      ...[42.5, 130.5, 218.5, 306.5, 394.5, 482.5, 570.5].flatMap((x) =>
        [324, 447].map((y) => ({
          positionMm: { x, y },
          rotation: 90 as const,
        })),
      ),
      ...[60, 183, 430, 553].flatMap((x) =>
        [42.5, 130.5, 218.5].map((y) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[60, 201].map((y) => ({
        positionMm: { x: 306.5, y },
        rotation: 90 as const,
      })),
    ];
    const output = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-block-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 7,
      mainRows: 2,
      capColumns: 2,
      capRows: 3,
      coreColumns: 1,
      coreRows: 2,
    });

    expect(expectedPlacements).toHaveLength(28);
    expect(canonicalPlacementGeometryKey(candidate.placements)).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 0,
        coreInlineResidualMm: 36,
        coreCrossResidualMm: 18,
        occupiedLengthMm: 613,
        occupiedWidthMm: 507,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("falls back from infeasible maximal rows during non-exact generation", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 80, width: 40 },
        clearanceMm: 5,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 600, maxY: 500 },
      constraints: { maxCandidatesPerGenerator: 2_000 },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-block-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 13,
      mainRows: 1,
      capColumns: 2,
      capRows: 8,
      coreColumns: 5,
      coreRows: 4,
    });

    expect(candidate.placements).toHaveLength(65);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 10, minY: 30, maxX: 590, maxY: 470 });
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        blockCount: 4,
        capCrossResidualMm: 0,
        coreInlineResidualMm: 20,
        coreCrossResidualMm: 20,
        occupiedLengthMm: 580,
        occupiedWidthMm: 440,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("keeps exact capped geometries when the count range is widened", () => {
    const packageInput = {
      shape: "cuboid" as const,
      dimensionsMm: { length: 30, width: 18 },
      clearanceMm: 0,
    };
    const exactInput = normalized({
      package: packageInput,
      envelopeMm: { minX: 0, minY: 0, maxX: 175, maxY: 125 },
      constraints: {
        minimumPackageCount: 31,
        maximumPackageCount: 31,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const rangeInput = normalized({
      package: packageInput,
      envelopeMm: exactInput.envelopeMm,
      constraints: {
        minimumPackageCount: 30,
        maximumPackageCount: 31,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const exactCandidate = matchingDraft(
      generateCandidateFamily(exactInput, "nested-side").drafts,
      {
        topology: "balanced-capped-block-v1",
        mainColumns: 8,
        coreColumns: 1,
      },
    );
    const rangeGeometryKeys = new Set(
      generateCandidateFamily(rangeInput, "nested-side").drafts.map(
        ({ placements }) => canonicalPlacementGeometryKey(placements),
      ),
    );

    expect(
      rangeGeometryKeys.has(
        canonicalPlacementGeometryKey(exactCandidate.placements),
      ),
    ).toBe(true);
  });

  it("derives non-maximal capped-strip regions for an exact count", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 110, width: 100 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 70,
        maximumPackageCount: 70,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-strip-v1",
      mainRotation: 0,
      capRotation: 90,
      mainColumns: 10,
      mainRows: 2,
      capRows: 5,
      coreColumns: 8,
      coreRows: 5,
    });

    expect(candidate.placements).toHaveLength(70);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 50, minY: 25, maxX: 1150, maxY: 775 });
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        coreInlineResidualMm: 20,
        coreCrossResidualMm: 50,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("includes the highest main-row count when maxBands is binding", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 60, width: 40 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 500, maxY: 600 },
      constraints: {
        allowedRotations: [0, 90],
        maxBands: 6,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const candidate = matchingDraft(output.drafts, {
      topology: "balanced-capped-strip-v1",
      mainRotation: 90,
      capRotation: 0,
      mainColumns: 6,
      mainRows: 6,
      capRows: 6,
      coreColumns: 3,
      coreRows: 4,
    });

    expect(candidate.placements).toHaveLength(60);
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 130, minY: 0, maxX: 370, maxY: 600 });
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("bounds exact capped-region placement materialization", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 20, width: 40 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 500,
        maximumPackageCount: 500,
        maxPlacements: 10_000,
        maxBands: 64,
        maxCandidatesPerGenerator: 500,
      },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const cappedRegions = output.drafts.filter(({ provenance }) =>
      provenance.some(
        ({ variant }) =>
          variant === "balanced-capped-strip" ||
          variant === "balanced-capped-block",
      ),
    );
    const cappedStrips = cappedRegions.filter(({ provenance }) =>
      provenance.some(({ variant }) => variant === "balanced-capped-strip"),
    );

    expect(cappedRegions).toHaveLength(20);
    expect(cappedStrips).toHaveLength(20);
    expect(
      cappedRegions.reduce((sum, { placements }) => sum + placements.length, 0),
    ).toBe(10_000);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "balanced-capped-strip-materialization-limit-reached",
        generator: "nested-side",
        count: 10_000,
      }),
    );
  });

  it("applies the placement budget across strips and multi-column blocks", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 100,
        maximumPackageCount: 100,
        maxPlacements: 10_000,
        maxBands: 16,
        maxCandidatesPerGenerator: 100,
      },
    });
    const output = generateCandidateFamily(input, "nested-side");
    const cappedStrips = output.drafts.filter(({ provenance }) =>
      provenance.some(({ variant }) => variant === "balanced-capped-strip"),
    );
    const cappedBlocks = output.drafts.filter(({ provenance }) =>
      provenance.some(({ variant }) => variant === "balanced-capped-block"),
    );
    const blockCapColumnCounts = cappedBlocks.reduce<Record<number, number>>(
      (counts, draft) => {
        const capColumns = provenanceParameters(draft).capColumns;
        if (typeof capColumns === "number") {
          counts[capColumns] = (counts[capColumns] ?? 0) + 1;
        }
        return counts;
      },
      {},
    );

    expect(output.cancelled).toBe(false);
    expect(output.drafts).toHaveLength(100);
    expect(cappedStrips).toHaveLength(50);
    expect(cappedBlocks).toHaveLength(50);
    expect(blockCapColumnCounts).toEqual({ 2: 44, 3: 6 });
    expect(
      output.drafts.reduce((sum, { placements }) => sum + placements.length, 0),
    ).toBe(10_000);
    expect(
      cappedBlocks.every(
        (draft) =>
          provenanceParameters(draft).topology === "balanced-capped-block-v1" &&
          provenanceParameters(draft).blockCount === 4,
      ),
    ).toBe(true);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "balanced-capped-strip-materialization-limit-reached",
        generator: "nested-side",
        count: 10_000,
      }),
    );
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "balanced-capped-strip-search-limit-reached",
      }),
    );
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "generation-limit-reached" }),
    );
  });

  it("cancels after entering the multi-column block search", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 30, width: 22 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 150, maxY: 112 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 25,
        maximumPackageCount: 25,
        maxPlacements: 25,
        maxBands: 5,
        maxCandidatesPerGenerator: 2,
      },
    });
    let cancellationPolls = 0;
    const output = generateCandidateFamily(input, "nested-side", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return cancellationPolls >= 18;
      },
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toEqual([]);
    expect(output.exclusions).toEqual([]);
    expect(cancellationPolls).toBe(18);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        code: "exact-count-source-rejected",
        generator: "nested-side",
        count: 4,
      }),
    ]);
  });

  it("hard-bounds exact capped-strip search work", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 7_000,
        maximumPackageCount: 7_000,
        maxPlacements: 10_000,
        maxBands: 64,
        maxCandidatesPerGenerator: 1,
      },
    });
    const output = generateCandidateFamily(input, "nested-side");

    expect(output.cancelled).toBe(false);
    expect(output.drafts).toEqual([]);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "balanced-capped-strip-search-limit-reached",
        generator: "nested-side",
        count: 100_000,
      }),
    );
  });

  it("rejects impossible exact capped-strip counts before searching", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10_000,
        maximumPackageCount: 10_000,
        maxPlacements: 10_000,
        maxBands: 64,
        maxCandidatesPerGenerator: 1,
      },
    });
    let cancellationPolls = 0;
    const output = generateCandidateFamily(input, "nested-side", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return false;
      },
    });

    expect(output.drafts).toEqual([]);
    expect(cancellationPolls).toBe(0);
    expect(output.diagnostics).not.toContainEqual(
      expect.objectContaining({
        code: "balanced-capped-strip-search-limit-reached",
      }),
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

  it("generates the observed 53-package three-block split family", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const first = generateCandidateFamily(input, "block");
    const second = generateCandidateFamily(input, "block");
    const symmetricLengthwiseCaps = matchingDraft(first.drafts, {
      topology: "three-block-split-v1",
      outerRotation: 0,
      middleRotation: 90,
      leftOuterColumns: 2,
      middleColumns: 5,
      rightOuterColumns: 2,
    });
    const asymmetricLengthwiseCaps = matchingDraft(first.drafts, {
      topology: "three-block-split-v1",
      outerRotation: 0,
      middleRotation: 90,
      leftOuterColumns: 1,
      middleColumns: 5,
      rightOuterColumns: 3,
    });
    const twoCrosswiseLeftCaps = matchingDraft(first.drafts, {
      topology: "three-block-split-v1",
      outerRotation: 90,
      middleRotation: 0,
      leftOuterColumns: 2,
      middleColumns: 4,
      rightOuterColumns: 3,
    });
    const oneCrosswiseLeftCap = matchingDraft(first.drafts, {
      topology: "three-block-split-v1",
      outerRotation: 90,
      middleRotation: 0,
      leftOuterColumns: 1,
      middleColumns: 4,
      rightOuterColumns: 4,
    });
    const distributedTwoCrosswiseLeftCaps = matchingDraft(first.drafts, {
      topology: "three-block-split-distributed-v1",
      outerRotation: 90,
      middleRotation: 0,
      leftOuterColumns: 2,
      middleColumns: 4,
      rightOuterColumns: 3,
    });
    const distributedOneCrosswiseLeftCap = matchingDraft(first.drafts, {
      topology: "three-block-split-distributed-v1",
      outerRotation: 90,
      middleRotation: 0,
      leftOuterColumns: 1,
      middleColumns: 4,
      rightOuterColumns: 4,
    });
    const lengthwiseY = [64, 172, 280, 388, 496, 604, 712];
    const crosswiseY = [88, 244, 400, 556, 712];
    const placements = (
      rotation: 0 | 90,
      xCenters: readonly number[],
      yCenters: readonly number[],
    ) =>
      yCenters.flatMap((y) =>
        xCenters.map((x) => ({ positionMm: { x, y }, rotation })),
      );

    expect(second).toEqual(first);
    expect(
      canonicalPlacementGeometryKey(symmetricLengthwiseCaps.placements),
    ).toBe(
      canonicalPlacementGeometryKey([
        ...placements(0, [96, 252, 948, 1104], lengthwiseY),
        ...placements(90, [384, 492, 600, 708, 816], crosswiseY),
      ]),
    );
    expect(
      canonicalPlacementGeometryKey(asymmetricLengthwiseCaps.placements),
    ).toBe(
      canonicalPlacementGeometryKey([
        ...placements(0, [96, 792, 948, 1104], lengthwiseY),
        ...placements(90, [228, 336, 444, 552, 660], crosswiseY),
      ]),
    );
    expect(canonicalPlacementGeometryKey(twoCrosswiseLeftCaps.placements)).toBe(
      canonicalPlacementGeometryKey([
        ...placements(90, [72, 180, 912, 1020, 1128], crosswiseY),
        ...placements(0, [312, 468, 624, 780], lengthwiseY),
      ]),
    );
    expect(canonicalPlacementGeometryKey(oneCrosswiseLeftCap.placements)).toBe(
      canonicalPlacementGeometryKey([
        ...placements(90, [72, 804, 912, 1020, 1128], crosswiseY),
        ...placements(0, [204, 360, 516, 672], lengthwiseY),
      ]),
    );
    expect(
      canonicalPlacementGeometryKey(distributedTwoCrosswiseLeftCaps.placements),
    ).toBe(
      canonicalPlacementGeometryKey([
        ...placements(90, [60, 168, 924, 1032, 1140], crosswiseY),
        ...placements(0, [312, 468, 624, 780], lengthwiseY),
      ]),
    );
    expect(
      canonicalPlacementGeometryKey(distributedOneCrosswiseLeftCap.placements),
    ).toBe(
      canonicalPlacementGeometryKey([
        ...placements(90, [60, 816, 924, 1032, 1140], crosswiseY),
        ...placements(0, [204, 360, 516, 672], lengthwiseY),
      ]),
    );
    for (const draft of [
      symmetricLengthwiseCaps,
      asymmetricLengthwiseCaps,
      twoCrosswiseLeftCaps,
      oneCrosswiseLeftCap,
    ]) {
      expect(draft.placements).toHaveLength(53);
      expect(
        boundingRectangleForPlacements(
          draft.placements,
          input.package.dimensionsMm,
        ),
      ).toEqual({ minX: 18, minY: 10, maxX: 1182, maxY: 790 });
      expect(provenanceParameters(draft)).toEqual(
        expect.objectContaining({
          topology: "three-block-split-v1",
          blockCount: 3,
          occupiedLengthMm: 1164,
          occupiedWidthMm: 780,
        }),
      );
      expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
        true,
      );
    }
    for (const draft of [
      distributedTwoCrosswiseLeftCaps,
      distributedOneCrosswiseLeftCap,
    ]) {
      expect(draft.placements).toHaveLength(53);
      expect(
        boundingRectangleForPlacements(
          draft.placements,
          input.package.dimensionsMm,
        ),
      ).toEqual({ minX: 6, minY: 10, maxX: 1194, maxY: 790 });
      expect(provenanceParameters(draft)).toEqual(
        expect.objectContaining({
          topology: "three-block-split-distributed-v1",
          blockCount: 3,
          regionGapResidualMm: 24,
          occupiedLengthMm: 1188,
          occupiedWidthMm: 780,
        }),
      );
      expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
        true,
      );
    }
  });

  it("generates the observed 53-package side-core corner bands", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const output = generateCandidateFamily(input, "block");
    const candidate = matchingDraft(output.drafts, {
      topology: "side-core-corner-bands-v1",
      coreRotation: 90,
      sideRotation: 0,
      coreColumns: 5,
      coreRows: 5,
      sideColumns: 2,
      leftLowerRows: 4,
      leftUpperRows: 3,
      rightLowerRows: 3,
      rightUpperRows: 4,
    });
    const placements = (
      rotation: 0 | 90,
      xCenters: readonly number[],
      yCenters: readonly number[],
    ) =>
      yCenters.flatMap((y) =>
        xCenters.map((x) => ({ positionMm: { x, y }, rotation })),
      );
    const expectedPlacements = [
      ...placements(90, [384, 492, 600, 708, 816], [88, 244, 400, 556, 712]),
      ...placements(0, [90, 246], [64, 172, 280, 388, 520, 628, 736]),
      ...placements(0, [954, 1110], [64, 172, 280, 412, 520, 628, 736]),
    ];

    expect(expectedPlacements).toHaveLength(53);
    expect(canonicalPlacementGeometryKey(candidate.placements)).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 12, minY: 10, maxX: 1188, maxY: 790 });
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        topology: "side-core-corner-bands-v1",
        blockCount: 5,
        horizontalGapMm: 6,
        verticalGapMm: 24,
        occupiedLengthMm: 1176,
        occupiedWidthMm: 780,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("generates the observed 53-package four-block C-frame", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const output = generateCandidateFamily(input, "block");
    const candidate = matchingDraft(output.drafts, {
      topology: "four-block-c-frame-v1",
      frameRotation: 90,
      coreRotation: 0,
      frameColumns: 11,
      stemColumns: 5,
      stemRows: 3,
      coreColumns: 4,
      coreRows: 4,
    });
    const placements = (
      rotation: 0 | 90,
      xCenters: readonly number[],
      yCenters: readonly number[],
    ) =>
      yCenters.flatMap((y) =>
        xCenters.map((x) => ({ positionMm: { x, y }, rotation })),
      );
    const expectedPlacements = [
      ...placements(
        90,
        [60, 168, 276, 384, 492, 600, 708, 816, 924, 1032, 1140],
        [88, 712],
      ),
      ...placements(90, [60, 168, 276, 384, 492], [244, 400, 556]),
      ...placements(0, [624, 788, 952, 1116], [220, 328, 436, 544]),
    ];

    expect(expectedPlacements).toHaveLength(53);
    expect(canonicalPlacementGeometryKey(candidate.placements)).toBe(
      canonicalPlacementGeometryKey(expectedPlacements),
    );
    expect(
      boundingRectangleForPlacements(
        candidate.placements,
        input.package.dimensionsMm,
      ),
    ).toEqual({ minX: 6, minY: 10, maxX: 1194, maxY: 790 });
    expect(provenanceParameters(candidate)).toEqual(
      expect.objectContaining({
        topology: "four-block-c-frame-v1",
        blockCount: 4,
        coreInlineResidualMm: 24,
        coreCrossResidualMm: 36,
        occupiedLengthMm: 1188,
        occupiedWidthMm: 780,
      }),
    );
    expect(validateCandidatePlacements(input, candidate.placements).valid).toBe(
      true,
    );
  });

  it("centers C-frame and side-core composites inside residual envelopes", () => {
    const basePackage = {
      shape: "cuboid" as const,
      dimensionsMm: { length: 156, width: 108 },
      clearanceMm: 0,
    };
    const cFrameInput = normalized({
      package: basePackage,
      envelopeMm: { minX: 6, minY: 10, maxX: 1195, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const sideCoreInput = normalized({
      package: basePackage,
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 791 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const cFrame = matchingDraft(
      generateCandidateFamily(cFrameInput, "block").drafts,
      {
        topology: "four-block-c-frame-v1",
        frameRotation: 90,
        coreRotation: 0,
        stemColumns: 5,
        coreColumns: 4,
      },
    );
    const sideCore = matchingDraft(
      generateCandidateFamily(sideCoreInput, "block").drafts,
      {
        topology: "side-core-corner-bands-v1",
        coreRotation: 90,
        sideRotation: 0,
        coreColumns: 5,
        sideColumns: 2,
      },
    );

    expect(
      boundingRectangleForPlacements(
        cFrame.placements,
        cFrameInput.package.dimensionsMm,
      ),
    ).toEqual({ minX: 6.5, minY: 10, maxX: 1194.5, maxY: 790 });
    expect(provenanceParameters(cFrame)).toEqual(
      expect.objectContaining({
        envelopeInlineResidualMm: 1,
        occupiedLengthMm: 1188,
      }),
    );
    expect(
      boundingRectangleForPlacements(
        sideCore.placements,
        sideCoreInput.package.dimensionsMm,
      ),
    ).toEqual({ minX: 12, minY: 10.5, maxX: 1188, maxY: 790.5 });
    expect(provenanceParameters(sideCore)).toEqual(
      expect.objectContaining({
        envelopeCrossResidualMm: 1,
        occupiedWidthMm: 780,
      }),
    );
    expect(
      validateCandidatePlacements(cFrameInput, cFrame.placements).valid,
    ).toBe(true);
    expect(
      validateCandidatePlacements(sideCoreInput, sideCore.placements).valid,
    ).toBe(true);

    const collapsedInput = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 30, width: 18 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 102, maxY: 90 },
      constraints: {
        minimumPackageCount: 16,
        maximumPackageCount: 16,
        maxCandidatesPerGenerator: 100,
      },
    });
    expect(
      generateCandidateFamily(collapsedInput, "block").drafts.filter(
        ({ provenance }) =>
          provenance.some(
            ({ parameters }) =>
              parameters?.topology === "side-core-corner-bands-v1",
          ),
      ),
    ).toEqual([]);
  });

  it("keeps exact block geometries when the package-count range is widened", () => {
    const packageInput = {
      shape: "cuboid" as const,
      dimensionsMm: { length: 156, width: 108 },
      clearanceMm: 0,
    };
    const exactInput = normalized({
      package: packageInput,
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const rangeInput = normalized({
      package: packageInput,
      envelopeMm: exactInput.envelopeMm,
      constraints: {
        minimumPackageCount: 52,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const exactDrafts = generateCandidateFamily(exactInput, "block").drafts;
    const rangeDrafts = generateCandidateFamily(rangeInput, "block").drafts;
    const topologies = [
      "three-block-split-v1",
      "three-block-split-distributed-v1",
      "four-block-c-frame-v1",
      "side-core-corner-bands-v1",
      "dense-edge-notch-v1",
    ];

    for (const topology of topologies) {
      const exactGeometryKeys = exactDrafts
        .filter(({ provenance }) =>
          provenance.some(
            ({ parameters }) => parameters?.topology === topology,
          ),
        )
        .map(({ placements }) => canonicalPlacementGeometryKey(placements));
      const rangeGeometryKeys = new Set(
        rangeDrafts
          .filter(({ provenance }) =>
            provenance.some(
              ({ parameters }) => parameters?.topology === topology,
            ),
          )
          .map(({ placements }) => canonicalPlacementGeometryKey(placements)),
      );
      expect(exactGeometryKeys.length).toBeGreaterThan(0);
      expect(
        exactGeometryKeys.every((geometryKey) =>
          rangeGeometryKeys.has(geometryKey),
        ),
      ).toBe(true);
    }
  });

  it("generates the observed nine dense edge-notch geometry classes", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 2_000,
      },
    });
    const output = generateCandidateFamily(input, "block");
    const notchDrafts = output.drafts.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
      ),
    );
    const deficitSignatures = notchDrafts
      .map((draft) => String(provenanceParameters(draft).rowDeficits))
      .sort();

    expect(notchDrafts).toHaveLength(15);
    expect(new Set(deficitSignatures)).toHaveLength(15);
    expect(
      notchDrafts.every((draft) => {
        const parameters = provenanceParameters(draft);
        const deficits = String(parameters.rowDeficits).split(",").map(Number);
        return (
          draft.placements.length === 53 &&
          deficits.length === 5 &&
          deficits.reduce((sum, deficit) => sum + deficit, 0) === 2 &&
          !("blockCount" in parameters) &&
          validateCandidatePlacements(input, draft.placements).valid
        );
      }),
    ).toBe(true);
    expect(
      notchDrafts.every((draft) => {
        const deficits = String(provenanceParameters(draft).rowDeficits)
          .split(",")
          .map(Number);
        const rowCounts = [
          ...draft.placements.reduce((counts, placement) => {
            counts.set(
              placement.positionMm.y,
              (counts.get(placement.positionMm.y) ?? 0) + 1,
            );
            return counts;
          }, new Map<number, number>()),
        ]
          .sort(([leftY], [rightY]) => leftY - rightY)
          .map(([, count]) => count);
        return (
          draft.placements.every(({ rotation }) => rotation === 90) &&
          JSON.stringify(rowCounts) ===
            JSON.stringify(deficits.map((deficit) => 11 - deficit))
        );
      }),
    ).toBe(true);
    expect(
      notchDrafts.every(
        (draft) =>
          JSON.stringify(
            boundingRectangleForPlacements(
              draft.placements,
              input.package.dimensionsMm,
            ),
          ) === JSON.stringify({ minX: 6, minY: 10, maxX: 1194, maxY: 790 }),
      ),
    ).toBe(true);
  });

  it("generates edge notches with one allowed footprint orientation", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 156, width: 108 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 6, minY: 10, maxX: 1194, maxY: 790 },
      constraints: {
        allowedRotations: [90],
        minimumPackageCount: 53,
        maximumPackageCount: 53,
        maxCandidatesPerGenerator: 100,
      },
    });
    const output = generateCandidateFamily(input, "block");

    expect(
      output.drafts.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      ),
    ).toHaveLength(15);
  });

  it("does not mislabel a two-row rectangle as an edge notch", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 30, width: 17 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 85, maxY: 68 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 8,
        maximumPackageCount: 8,
        maxCandidatesPerGenerator: 100,
      },
    });
    const output = generateCandidateFamily(input, "block");
    const notchDrafts = output.drafts.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
      ),
    );

    expect(notchDrafts).toHaveLength(2);
    expect(
      notchDrafts
        .map((draft) => provenanceParameters(draft).rowDeficits)
        .sort(),
    ).toEqual(["0,2", "2,0"]);
    expect(
      notchDrafts.every(
        ({ placements }) =>
          boundingRectangleForPlacements(placements, input.package.dimensionsMm)
            ?.maxX === 85,
      ),
    ).toBe(true);
  });

  it("bounds and cancels dense edge-notch materialization before allocation", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 3, maxY: 500 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 748,
        maximumPackageCount: 748,
        maxPlacements: 748,
        maxBands: 250,
        maxCandidatesPerGenerator: 100,
      },
    });
    const output = generateCandidateFamily(input, "block");
    const notchDrafts = output.drafts.filter(({ provenance }) =>
      provenance.some(
        ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
      ),
    );

    expect(notchDrafts).toHaveLength(13);
    expect(
      notchDrafts.reduce((sum, { placements }) => sum + placements.length, 0),
    ).toBe(9_724);
    expect(output.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "dense-edge-notch-materialization-limit-reached",
        generator: "block",
        count: 9_724,
      }),
    );

    const oversizedInput = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 101, maxY: 202 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 10_199,
        maximumPackageCount: 10_199,
        maxPlacements: 10_199,
        maxBands: 101,
        maxCandidatesPerGenerator: 10,
      },
    });
    const oversized = generateCandidateFamily(oversizedInput, "block");
    expect(
      oversized.drafts.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      ),
    ).toEqual([]);
    expect(oversized.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "dense-edge-notch-materialization-limit-reached",
        generator: "block",
        count: 0,
      }),
    );

    const exactMaximumInput = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 25 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 73,
        maximumPackageCount: 73,
        maxPlacements: 73,
        maxBands: 25,
        maxCandidatesPerGenerator: 500,
      },
    });
    const rangedMaximumInput = normalized({
      ...exactMaximumInput,
      physicalPalletBoundsMm:
        exactMaximumInput.physicalPalletBoundsMm ?? undefined,
      constraints: {
        ...exactMaximumInput.constraints,
        minimumPackageCount: 70,
        maximumPackageCount: 73,
        maxPlacements: 73,
      },
    });
    const exactMaximumGeometryKeys = generateCandidateFamily(
      exactMaximumInput,
      "block",
    )
      .drafts.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      )
      .map(({ placements }) => canonicalPlacementGeometryKey(placements));
    const rangedMaximumGeometryKeys = new Set(
      generateCandidateFamily(rangedMaximumInput, "block")
        .drafts.filter(({ provenance }) =>
          provenance.some(
            ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
          ),
        )
        .map(({ placements }) => canonicalPlacementGeometryKey(placements)),
    );
    expect(exactMaximumGeometryKeys).toHaveLength(136);
    expect(
      exactMaximumGeometryKeys.every((geometryKey) =>
        rangedMaximumGeometryKeys.has(geometryKey),
      ),
    ).toBe(true);

    let cancellationPolls = 0;
    const cancelled = generateCandidateFamily(input, "block", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return true;
      },
    });
    expect(cancelled.cancelled).toBe(true);
    expect(
      cancelled.drafts.filter(({ provenance }) =>
        provenance.some(
          ({ parameters }) => parameters?.topology === "dense-edge-notch-v1",
        ),
      ),
    ).toEqual([]);
    expect(cancellationPolls).toBe(1);
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

  it("polls cancellation before impossible high-band block searches", () => {
    const input = normalized({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 1, width: 2 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 },
      constraints: {
        allowedRotations: [0, 90],
        minimumPackageCount: 1,
        maximumPackageCount: 2,
        maxPlacements: 2,
        maxBands: 10_000,
        maxCandidatesPerGenerator: 1,
      },
    });
    let cancellationPolls = 0;
    const output = generateCandidateFamily(input, "block", {
      shouldCancel: () => {
        cancellationPolls += 1;
        return true;
      },
    });

    expect(output.cancelled).toBe(true);
    expect(output.drafts).toEqual([]);
    expect(cancellationPolls).toBe(1);
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
