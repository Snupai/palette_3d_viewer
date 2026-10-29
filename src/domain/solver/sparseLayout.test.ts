import { describe, expect, it } from "vitest";
import { finalizeGeneratedCandidates } from "./candidates";
import { solveLayer } from "./solve";
import { sparseLayoutReason } from "./sparseLayout";
import type {
  GeneratedCandidateDraft,
  GeneratedPlacement,
  LayerSolverInput,
} from "./types";
import { validateAndNormalizeSolverInput } from "./validation";

const input: LayerSolverInput = {
  package: {
    shape: "cuboid",
    dimensionsMm: { length: 10, width: 6 },
    clearanceMm: 0,
  },
  envelopeMm: { minX: 10, minY: -20, maxX: 40, maxY: -2 },
  constraints: { allowedRotations: [0, 90] },
};
const grid = (ys: number[]): GeneratedPlacement[] =>
  ys.flatMap((y) =>
    [15, 25, 35].map((x) => ({ positionMm: { x, y }, rotation: 0 as const })),
  );

describe("sparse free-count layouts", () => {
  it("rejects whole unused strips but keeps small residual margins and enclosed cores", () => {
    const normalized = validateAndNormalizeSolverInput(input).normalized!;
    expect(sparseLayoutReason(normalized, grid([-11]))).toBe(
      "unused-edge-strip",
    );
    expect(sparseLayoutReason(normalized, grid([-14, -8]))).toBeNull();
    expect(sparseLayoutReason(normalized, grid([-17, -11, -5]))).toBeNull();
    const ringInput = validateAndNormalizeSolverInput({
      ...input,
      package: { ...input.package, dimensionsMm: { length: 10, width: 10 } },
      envelopeMm: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
    }).normalized!;
    const ring = [5, 15, 25].flatMap((y) =>
      [5, 15, 25].flatMap((x) =>
        x === 15 && y === 15
          ? []
          : [{ positionMm: { x, y }, rotation: 0 as const }],
      ),
    );
    expect(ring).toHaveLength(8);
    expect(sparseLayoutReason(ringInput, ring)).toBeNull();
  });

  it("requires an authorized footprint and both clearances in a separating corridor", () => {
    const corridorInput = validateAndNormalizeSolverInput({
      ...input,
      package: { ...input.package, clearanceMm: 1 },
      envelopeMm: { minX: 0, minY: 0, maxX: 18, maxY: 10 },
      constraints: { allowedRotations: [90] },
    }).normalized!;
    const separated: GeneratedPlacement[] = [3, 15].map((x) => ({
      positionMm: { x, y: 5 },
      rotation: 90,
    }));
    // Six millimetres of free space cannot fit a 6-mm box with 1 mm on each side.
    expect(sparseLayoutReason(corridorInput, separated)).toBeNull();
    const wider = {
      ...corridorInput,
      generationBoundsMm: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    };
    separated[1] = { positionMm: { x: 17, y: 5 }, rotation: 90 };
    expect(sparseLayoutReason(wider, separated)).toBe("separating-corridor");
    const restricted = {
      ...corridorInput,
      generationBoundsMm: { minX: 0, minY: 0, maxX: 28, maxY: 16 },
      constraints: {
        ...corridorInput.constraints,
        allowedRotations: [0] as const,
      },
    };
    const horizontalBoxes: GeneratedPlacement[] = [3, 13].flatMap((y) =>
      [5, 23].map((x) => ({ positionMm: { x, y }, rotation: 0 })),
    );
    expect(sparseLayoutReason(restricted, horizontalBoxes)).toBeNull();
    const mixed = {
      ...restricted,
      constraints: {
        ...restricted.constraints,
        allowedRotations: [0, 90] as const,
      },
    };
    expect(sparseLayoutReason(mixed, horizontalBoxes)).toBe(
      "separating-corridor",
    );
    expect(
      sparseLayoutReason(
        {
          ...mixed,
          constraints: {
            ...mixed.constraints,
            allowMixedPackageOrientations: false,
          },
        },
        horizontalBoxes,
      ),
    ).toBeNull();
    const transposed = {
      ...wider,
      generationBoundsMm: { minX: 100, minY: -30, maxX: 110, maxY: -10 },
      constraints: { ...wider.constraints, allowedRotations: [0] as const },
    };
    expect(
      sparseLayoutReason(
        transposed,
        separated.map((p) => ({
          positionMm: { x: p.positionMm.y + 100, y: p.positionMm.x - 30 },
          rotation: 0,
        })),
      ),
    ).toBe("separating-corridor");
  });

  it("omits sparse alternatives deterministically, reports them and preserves the best bounded result", () => {
    const normalized = validateAndNormalizeSolverInput(input).normalized!;
    const drafts: GeneratedCandidateDraft[] = [
      grid([-11]),
      grid([-14, -8]),
      grid([-17, -11, -5]),
    ].map((placements) => ({
      placements,
      provenance: [{ family: "row", variant: "synthetic-grid" }],
    }));
    const result = finalizeGeneratedCandidates(normalized, drafts, {
      filterSparseLayouts: true,
    });
    expect(
      result.candidates.map((c) => [c.rank, c.metrics.packageCount]),
    ).toEqual([
      [1, 9],
      [2, 6],
    ]);
    expect(result.validDraftCount).toBe(3);
    expect(result.invalidDraftCount).toBe(0);
    expect(result.exclusions.map((e) => e.reason)).toEqual(["sparse-layout"]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "sparse-layouts-omitted", count: 1 }),
    );
    expect(
      finalizeGeneratedCandidates(normalized, [...drafts].reverse(), {
        filterSparseLayouts: true,
      }),
    ).toEqual(result);
    expect(
      finalizeGeneratedCandidates(normalized, [drafts[0]!], {
        filterSparseLayouts: true,
      }).candidates.map((c) => c.metrics.packageCount),
    ).toEqual([3]);
    expect(
      finalizeGeneratedCandidates(normalized, drafts, {
        filterSparseLayouts: true,
        checkpoint: (phase) => phase !== "metrics",
      }),
    ).toMatchObject({ candidates: [], cancelled: true });
  });

  it("applies the screen to free search while honoring explicit count ranges and exact counts", () => {
    const options = { includeSymmetryVariants: false };
    const free = solveLayer(input, options);
    const explicitRange = solveLayer(
      {
        ...input,
        constraints: {
          ...input.constraints,
          minimumPackageCount: 1,
          maximumPackageCount: 9,
        },
      },
      options,
    );
    const exact = solveLayer(
      {
        ...input,
        constraints: {
          ...input.constraints,
          minimumPackageCount: 3,
          maximumPackageCount: 3,
        },
      },
      options,
    );
    expect(free.status).toBe("completed");
    expect(free.exclusions.some((e) => e.reason === "sparse-layout")).toBe(
      true,
    );
    expect(
      explicitRange.exclusions.filter((e) => e.reason === "sparse-layout"),
    ).toEqual([]);
    expect(
      exact.exclusions.filter((e) => e.reason === "sparse-layout"),
    ).toEqual([]);
    expect(
      new Set(exact.candidates.map((c) => c.metrics.packageCount)),
    ).toEqual(new Set([3]));
  });
});
