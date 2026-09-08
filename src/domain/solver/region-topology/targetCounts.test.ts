import { describe, expect, it } from "vitest";
import type {
  NormalizedLayerSolverInput,
  NormalizedSolverConstraints,
} from "~/domain/solver/types";
import {
  normalizeTargetCountPolicy,
  planTargetCounts,
  safeGeometricPackageUpperBound,
} from "~/domain/solver/region-topology/targetCounts";

function constraints(
  overrides: Partial<NormalizedSolverConstraints> = {},
): NormalizedSolverConstraints {
  return {
    allowedRotations: [0],
    edgeClearanceMm: 0,
    minimumPackageCount: 2,
    maximumPackageCount: 10,
    maxPlacements: 10,
    maxBands: 4,
    maxCandidatesPerGenerator: 20,
    provisionalPackagesPerCycle: 1,
    suctionRemainderPolicy: "centered-singleton",
    allowMixedPackageOrientations: true,
    unrotatedPackageLabelSide: null,
    requiredShape: "any",
    rectangularBlockFootprintPolicy: "fill-generation-bounds",
    ...overrides,
  };
}

function normalizedInput(
  overrides: Partial<NormalizedLayerSolverInput> = {},
): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 5, width: 4 },
      clearanceMm: 1,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    generationBoundsMm: { minX: 0, minY: 0, maxX: 30, maxY: 20 },
    constraints: constraints(),
    ...overrides,
  };
}

describe("target count planning", () => {
  it("normalizes omitted exact and range policies from solver constraints", () => {
    expect(
      normalizeTargetCountPolicy(
        constraints({ minimumPackageCount: 6, maximumPackageCount: 6 }),
      ),
    ).toEqual({ valid: true, policy: { kind: "exact", count: 6 } });

    expect(normalizeTargetCountPolicy(constraints())).toEqual({
      valid: true,
      policy: { kind: "range", minimum: 2, maximum: 10 },
    });
  });

  it("accepts bounded explicit policies and fails closed outside constraints", () => {
    expect(
      normalizeTargetCountPolicy(constraints(), {
        kind: "explicit-descending-range",
        minimum: 4,
        maximum: 8,
      }),
    ).toEqual({
      valid: true,
      policy: {
        kind: "explicit-descending-range",
        minimum: 4,
        maximum: 8,
      },
    });

    expect(
      normalizeTargetCountPolicy(constraints(), {
        kind: "exact",
        count: 11,
      }),
    ).toEqual({
      valid: false,
      message:
        "Exact target count must stay within the normalized package-count constraints.",
    });
    expect(
      normalizeTargetCountPolicy(constraints(), {
        kind: "range",
        minimum: 1,
        maximum: 8,
      }),
    ).toEqual({
      valid: false,
      message:
        "Target count range must stay within the normalized package-count constraints.",
    });
  });

  it("computes the safe area bound and respects configured placement limits", () => {
    expect(safeGeometricPackageUpperBound(normalizedInput())).toBe(10);
    expect(
      safeGeometricPackageUpperBound(
        normalizedInput({
          constraints: constraints({
            maximumPackageCount: 30,
            maxPlacements: 30,
          }),
        }),
      ),
    ).toBe(30);
    expect(
      safeGeometricPackageUpperBound(
        normalizedInput({
          generationBoundsMm: { minX: 0, minY: 0, maxX: 12, maxY: 10 },
          constraints: constraints({
            maximumPackageCount: 20,
            maxPlacements: 20,
          }),
        }),
      ),
    ).toBe(6);
  });

  it("plans only descending reachable tiers for a large ordinary range", () => {
    const plan = planTargetCounts(
      { kind: "range", minimum: 1, maximum: 10_000 },
      8_000,
      [9_999, 8, 2, 5, 2],
    );

    expect(plan.searchCountsDescending).toEqual([8, 5, 2]);
    expect(plan.searchCountsDescending).toHaveLength(3);
    expect(plan.provenUnreachableRanges).toEqual([
      { minimum: 1, maximum: 1 },
      { minimum: 3, maximum: 4 },
      { minimum: 6, maximum: 7 },
      { minimum: 9, maximum: 10_000 },
    ]);
  });

  it("keeps exact and explicit plans descending with compressed gaps", () => {
    expect(planTargetCounts({ kind: "exact", count: 7 }, 6, [7])).toEqual({
      policy: { kind: "exact", count: 7 },
      geometricUpperBound: 6,
      searchCountsDescending: [],
      provenUnreachableRanges: [{ minimum: 7, maximum: 7 }],
    });

    expect(
      planTargetCounts(
        {
          kind: "explicit-descending-range",
          minimum: 3,
          maximum: 8,
        },
        6,
        [3, 6, 5],
      ),
    ).toEqual({
      policy: {
        kind: "explicit-descending-range",
        minimum: 3,
        maximum: 8,
      },
      geometricUpperBound: 6,
      searchCountsDescending: [6, 5, 3],
      provenUnreachableRanges: [
        { minimum: 4, maximum: 4 },
        { minimum: 7, maximum: 8 },
      ],
    });
  });

  it("is independent of reachable-count input order and duplicates", () => {
    const policy = { kind: "range", minimum: 2, maximum: 9 } as const;
    const first = planTargetCounts(policy, 9, [9, 4, 2, 7, 4]);
    const second = planTargetCounts(policy, 9, [2, 4, 7, 9]);

    expect(first).toEqual(second);
  });

  it("fails closed for forged normalized inputs and unsafe counts", () => {
    expect(
      normalizeTargetCountPolicy(
        constraints({ maxPlacements: 5, maximumPackageCount: 10 }),
      ),
    ).toEqual({
      valid: false,
      message:
        "constraints.maximumPackageCount must not exceed constraints.maxPlacements.",
    });
    expect(
      safeGeometricPackageUpperBound(
        normalizedInput({
          package: {
            ...normalizedInput().package,
            clearanceMm: Number.NaN,
          },
        }),
      ),
    ).toBe(0);
    expect(() =>
      planTargetCounts({ kind: "range", minimum: 1, maximum: 4 }, 4, [
        1,
        Number.NaN,
      ]),
    ).toThrowError(
      "Every reachable target count must be a non-negative safe integer.",
    );
  });
});
