import { describe, expect, it } from "vitest";
import { deriveGripDeltasForPlacementOrder } from "~/domain/gripDependencies";
import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import { validateCandidatePlacements } from "~/domain/solver/validation";
import { solveLayer } from "~/domain/solver/solve";
import type {
  GeneratedCandidateDraft,
  LayerSolverInput,
} from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";

describe("generated candidate blue lines", () => {
  const result = solveLayer({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 50 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
  });

  it("leaves the first grip of every candidate without a reference", () => {
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.grips[0]).toMatchObject({ dx: 0, dy: 0 });
    }
  });

  it("keeps every dependency-aware generated approach reproducible", () => {
    const referencing = result.candidates.flatMap((candidate) =>
      candidate.grips.filter((grip) => grip.dx !== 0 || grip.dy !== 0),
    );
    expect(referencing.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      expect(candidate.grips.map(({ sequence }) => sequence)).toEqual(
        candidate.grips.map((_, index) => index),
      );

      const derived = deriveGripDeltasForPlacementOrder(
        candidate.grips,
        100,
        50,
        0,
      );
      expect(candidate.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual(
        derived.deltas,
      );

      const position = new Map(
        candidate.grips.map((grip, index) => [grip.id, index]),
      );
      for (const { beforeGripId, afterGripId } of candidate.orderDependencies) {
        expect(position.get(beforeGripId)).toBeLessThan(
          position.get(afterGripId)!,
        );
      }
    }
  });
});

describe("candidate topology preferences", () => {
  it.each([
    { x: 150, rotation: 0 as const, issue: "placement-out-of-bounds" },
    { x: 50, rotation: 90 as const, issue: "unsupported-rotation" },
  ])(
    "retains a valid fallback after rejecting $issue",
    ({ x, rotation, issue }) => {
      const { normalized } = validateAndNormalizeSolverInput({
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 20, width: 20 },
          clearanceMm: 0,
        },
        envelopeMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        constraints: { allowedRotations: [0] },
      });
      if (!normalized) throw new Error("Expected valid fallback test input.");
      const drafts: GeneratedCandidateDraft[] = [
        {
          placements: [{ positionMm: { x, y: 50 }, rotation }],
          provenance: [{ family: "block", variant: "invalid-preferred" }],
          candidateSelectionPreferences: [{ groupKey: "split", priority: 0 }],
        },
        {
          placements: [{ positionMm: { x: 50, y: 50 }, rotation: 0 }],
          provenance: [{ family: "block", variant: "valid-fallback" }],
          candidateSelectionPreferences: [{ groupKey: "split", priority: 1 }],
        },
      ];
      const result = finalizeGeneratedCandidates(normalized, drafts);
      expect(
        finalizeGeneratedCandidates(normalized, [...drafts].reverse()),
      ).toEqual(result);
      expect(result.candidates).toHaveLength(1);
      expect(
        result.candidates[0]?.placements.map(({ positionMm, rotation }) => ({
          positionMm,
          rotation,
        })),
      ).toEqual([{ positionMm: { x: 50, y: 50 }, rotation: 0 }]);
      expect(result.candidates[0]?.provenance).toEqual(drafts[1]!.provenance);
      expect(result.validDraftCount).toBe(1);
      expect(result.invalidDraftCount).toBe(1);
      expect(result.geometricDuplicateCount).toBe(0);
      expect(result.exclusions).toHaveLength(1);
      expect(result.exclusions[0]).toMatchObject({
        reason: "candidate-invalid",
        issues: [{ code: issue }],
      });

      const cancelled = finalizeGeneratedCandidates(normalized, drafts, {
        checkpoint: (phase) => phase !== "candidate-validation",
      });
      expect(cancelled.cancelled).toBe(true);
      expect(cancelled.candidates).toEqual([]);
    },
  );

  it("keeps the best topology deterministically and reports dominated drafts", () => {
    const rawInput: LayerSolverInput = {
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 20, width: 20 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    };
    const validation = validateAndNormalizeSolverInput(rawInput);
    if (!validation.valid || !validation.normalized) {
      throw new Error("Expected normalized candidate preference input.");
    }
    const draft = (
      x: number,
      y: number,
      variant: string,
      candidateSelectionPreferences?: GeneratedCandidateDraft["candidateSelectionPreferences"],
    ): GeneratedCandidateDraft => ({
      placements: [{ positionMm: { x, y }, rotation: 0 }],
      provenance: [{ family: "block", variant }],
      ...(candidateSelectionPreferences
        ? { candidateSelectionPreferences }
        : {}),
    });
    const drafts = [
      draft(50, 50, "dominated", [{ groupKey: "split", priority: 1 }]),
      draft(140, 80, "preferred", [{ groupKey: "split", priority: 0 }]),
      draft(230, 110, "independent"),
      draft(320, 140, "multi-group", [
        { groupKey: "split", priority: 1 },
        { groupKey: "other", priority: 0 },
      ]),
    ];
    const first = finalizeGeneratedCandidates(validation.normalized, drafts);
    const second = finalizeGeneratedCandidates(
      validation.normalized,
      [...drafts].reverse(),
    );
    const comparable = (result: typeof first) => ({
      candidates: result.candidates.map(
        ({ id, geometryFingerprint, provenance }) => ({
          id,
          geometryFingerprint,
          provenance,
        }),
      ),
      diagnostics: result.diagnostics,
      exclusions: result.exclusions,
    });

    expect(comparable(second)).toEqual(comparable(first));
    expect(
      first.candidates.flatMap(({ provenance }) =>
        provenance.map(({ variant }) => variant),
      ),
    ).toEqual(
      expect.arrayContaining(["preferred", "independent", "multi-group"]),
    );
    expect(
      first.candidates.flatMap(({ provenance }) =>
        provenance.map(({ variant }) => variant),
      ),
    ).not.toContain("dominated");
    expect(first.exclusions).toContainEqual(
      expect.objectContaining({
        reason: "topology-dominated",
        provenance: [expect.objectContaining({ variant: "dominated" })],
      }),
    );
  });

  it("suppresses staggered mixed layouts in exact production runs", () => {
    const result = solveLayer(
      {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 100, width: 50 },
          clearanceMm: 0,
        },
        envelopeMm: { minX: 0, minY: 0, maxX: 350, maxY: 150 },
        constraints: {
          allowedRotations: [0, 90],
          minimumPackageCount: 9,
          maximumPackageCount: 9,
          provisionalPackagesPerCycle: 2,
          maxCandidatesPerGenerator: 500,
        },
      },
      { includeSymmetryVariants: false },
    );

    expect(
      result.candidates.some(
        ({ metrics, provenance }) =>
          metrics.provisionalCycleCount === 6 &&
          metrics.boundingBlockLengthMm === 350 &&
          metrics.boundingBlockWidthMm === 150 &&
          provenance.some(
            ({ family, variant }) =>
              family === "mixed-orientation" && variant.includes("alternate-"),
          ),
      ),
    ).toBe(false);
  });

  it("does not apply exact split dominance to package-count ranges", () => {
    const result = solveLayer(
      {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 100, width: 50 },
          clearanceMm: 0,
        },
        envelopeMm: { minX: 0, minY: 0, maxX: 270, maxY: 220 },
        constraints: {
          allowedRotations: [0, 90],
          minimumPackageCount: 9,
          maximumPackageCount: 10,
          maxCandidatesPerGenerator: 100,
        },
      },
      { includeSymmetryVariants: false },
    );

    expect(
      result.exclusions.filter(
        ({ reason, provenance }) =>
          reason === "topology-dominated" &&
          provenance.some(({ family }) => family === "block"),
      ),
    ).toEqual([]);
  });
});

describe("candidate grip planning", () => {
  it("merges drafts that slide into the same layout", () => {
    // p2 starts 5 or 10 mm away from p1; grip planning slides it against p1
    // in both drafts, so they are one candidate, not two with one geometry.
    const { normalized } = validateAndNormalizeSolverInput({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 350, maxY: 50 },
      constraints: { allowedRotations: [0], provisionalPackagesPerCycle: 2 },
    });
    if (!normalized) throw new Error("Expected valid sliding test input.");
    const draft = (x: number): GeneratedCandidateDraft => ({
      placements: [50, x, 300].map((positionX) => ({
        positionMm: { x: positionX, y: 25 },
        rotation: 0,
      })),
      provenance: [{ family: "block", variant: `p2-at-${x}` }],
    });
    const result = finalizeGeneratedCandidates(normalized, [
      draft(155),
      draft(160),
    ]);

    expect(result.diagnostics.map(({ code }) => code)).not.toContain(
      "geometry-id-hash-collision",
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.geometricDuplicateCount).toBe(1);
    expect(
      result.candidates[0]!.placements.map(({ positionMm }) => positionMm.x),
    ).toEqual([50, 150, 300]);
  });

  it("keeps the generated spacing when sliding would break a required shape", () => {
    const result = solveLayer({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 60 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 420, maxY: 160 },
      constraints: {
        provisionalPackagesPerCycle: 2,
        requiredShape: "rectangular-block",
      },
    });
    const { normalized } = validateAndNormalizeSolverInput({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 60 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 420, maxY: 160 },
      constraints: {
        provisionalPackagesPerCycle: 2,
        requiredShape: "rectangular-block",
      },
    });
    if (!normalized) throw new Error("Expected valid shape test input.");

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(
        validateCandidatePlacements(normalized, candidate.placements).valid,
      ).toBe(true);
    }
  });
});
