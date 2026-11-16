import { describe, expect, it } from "vitest";
import {
  placementRectangleBounds,
  transformPlacements,
} from "~/domain/geometry";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import { candidateGeometryFingerprint } from "~/domain/solver/candidateIdentity";
import { packageOrientationClass } from "~/domain/solver/orientationPolicy";
import { solveLayer } from "~/domain/solver/solve";
import { type GeneratedCandidateDraft } from "~/domain/solver/types";
import {
  yieldBetweenSolverTests,
  normalized,
} from "~/domain/solver/solverTestSupport";

yieldBetweenSolverTests();

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
    const directed = finalizeGeneratedCandidates(
      input,
      [...drafts, baseDraft],
      {
        candidateEquivalence: "identity",
      },
    );
    const directedReversed = finalizeGeneratedCandidates(
      input,
      [baseDraft, ...drafts].reverse(),
      { candidateEquivalence: "identity" },
    );
    expect(directed.candidates).toHaveLength(6);
    expect(directed.geometricDuplicateCount).toBe(1);
    expect(snapshot(directedReversed)).toEqual(snapshot(directed));
    expect(
      directed.candidates
        .map(({ geometryFingerprint }) => geometryFingerprint)
        .sort(),
    ).toEqual(
      drafts
        .map(({ placements }) => candidateGeometryFingerprint({ placements }))
        .sort(),
    );
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
    });
    expect(multipick.metrics).toMatchObject({
      provisionalCycleCount: 2,
      provisionalCycleBasis: "generated-grip-groups",
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
