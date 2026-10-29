import { describe, expect, it } from "vitest";
import { generateCandidateFamily } from "./generators";
import { searchSteppedStripPatterns } from "./steppedStrip";
import { solveLayer } from "./solve";
import type { LayerSolverInput, GeneratedPlacement } from "./types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "./validation";

function input(clearanceMm = 0): LayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 30, width: 21 },
      clearanceMm,
    },
    envelopeMm: { minX: 10, minY: -20, maxX: 214, maxY: 115 },
    constraints: { allowedRotations: [0, 90], maxCandidatesPerGenerator: 500 },
  };
}

describe("stepped strips", () => {
  it("emits only the fullest feasible base for each crossbar arrangement", () => {
    const normalized = validateAndNormalizeSolverInput(input()).normalized!;
    const selectedBaseRows = (maximumPackageCount: number) => {
      const rows: number[] = [];
      searchSteppedStripPatterns(
        {
          ...normalized,
          constraints: { ...normalized.constraints, maximumPackageCount },
        },
        (_, { parameters: p }) => {
          if (
            p?.transpose === false &&
            p.crossColumns === 4 &&
            p.topColumns === 4 &&
            p.leftColumns === 3 &&
            p.sideColumns === 1
          )
            rows.push(p.baseRows as number);
          return true;
        },
        () => true,
      );
      return rows;
    };
    expect(selectedBaseRows(100)).toEqual([4, 4, 4, 4]);
    // A count cap must search down to a feasible base, not discard the layout.
    expect(selectedBaseRows(36)).toEqual([3, 3, 3, 3]);
    expect(selectedBaseRows(35)).toEqual([2, 2, 2, 2]);
    expect(
      generateCandidateFamily(
        {
          ...normalized,
          generationBoundsMm: { minX: 0, minY: 0, maxX: 204, maxY: 40 },
        },
        "stepped-strip",
      ).drafts,
    ).toEqual([]);
  });

  it("constructs all 43 positions of interlocking crossbars and a spaced side corridor", () => {
    const normalized = validateAndNormalizeSolverInput(input()).normalized!;
    const output = generateCandidateFamily(normalized, "stepped-strip");
    const draft = output.drafts.find(({ provenance }) => {
      const p = provenance[0]?.parameters;
      return (
        p?.transpose === false &&
        p.rotation === 0 &&
        p.mirrorX === false &&
        p.mirrorY === false &&
        p.crossColumns === 4 &&
        p.topColumns === 4 &&
        p.leftColumns === 3 &&
        p.sideColumns === 1 &&
        p.baseColumns === 6 &&
        p.baseRows === 4
      );
    })!;
    const expected: GeneratedPlacement[] = [
      ...[-9.5, 11.5, 32.5, 53.5].flatMap((y) =>
        [25, 55, 85, 115, 145, 175].map((x) => ({
          positionMm: { x, y },
          rotation: 0 as const,
        })),
      ),
      ...[20.5, 41.5, 62.5, 83.5].map((x) => ({
        positionMm: { x, y: 100 },
        rotation: 90 as const,
      })),
      ...[109, 139, 169, 199].map((x) => ({
        positionMm: { x, y: 104.5 },
        rotation: 0 as const,
      })),
      ...[25, 55, 85].map((x) => ({
        positionMm: { x, y: 74.5 },
        rotation: 0 as const,
      })),
      ...[110.5, 131.5, 152.5, 173.5].map((x) => ({
        positionMm: { x, y: 79 },
        rotation: 90 as const,
      })),
      { positionMm: { x: 199, y: 83.5 }, rotation: 0 },
      ...[-5, 26.5, 58].map((y) => ({
        positionMm: { x: 203.5, y },
        rotation: 90 as const,
      })),
    ];
    expect(draft.placements).toHaveLength(43);
    expect(
      draft.placements.map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(expected);
    expect(validateCandidatePlacements(normalized, draft.placements)).toEqual({
      valid: true,
      issues: [],
    });
    // The normal solver must reach this density without an exact-count query.
    const value = input();
    const result = solveLayer(
      {
        ...value,
        constraints: { ...value.constraints, maxCandidatesPerGenerator: 20 },
      },
      {
        candidateEquivalence: "identity",
        generatorOrder: ["stepped-strip"],
      },
    );
    expect(result.candidates[0]?.metrics.packageCount).toBe(43);
    expect(
      result.candidates.some((c) =>
        c.provenance.some((p) => p.family === "stepped-strip"),
      ),
    ).toBe(true);
  }, 15_000);

  it("preserves clearance, both axes, directed rotation authorization and input-order independence", () => {
    const normalized = validateAndNormalizeSolverInput({
      ...input(1),
      envelopeMm: { minX: 10, minY: -20, maxX: 221, maxY: 120 },
    }).normalized!;
    const output = generateCandidateFamily(normalized, "stepped-strip");
    expect(output.drafts[0]?.placements).toHaveLength(43);
    for (const draft of output.drafts) {
      expect(validateCandidatePlacements(normalized, draft.placements)).toEqual(
        { valid: true, issues: [] },
      );
    }
    expect(
      new Set(output.drafts.map((d) => d.provenance[0]?.parameters?.transpose)),
    ).toEqual(new Set([false, true]));
    const reversed = {
      ...normalized,
      constraints: {
        ...normalized.constraints,
        allowedRotations: [90, 0] as const,
      },
    };
    expect(generateCandidateFamily(reversed, "stepped-strip")).toEqual(output);
    const directed = {
      ...normalized,
      constraints: {
        ...normalized.constraints,
        allowedRotations: [270, 180] as const,
      },
    };
    const directedOutput = generateCandidateFamily(directed, "stepped-strip");
    expect(
      directedOutput.drafts.map((d) => d.placements.map((p) => p.positionMm)),
    ).toEqual(output.drafts.map((d) => d.placements.map((p) => p.positionMm)));
    expect(
      new Set(
        directedOutput.drafts.flatMap((d) =>
          d.placements.map((p) => p.rotation),
        ),
      ),
    ).toEqual(new Set([180, 270]));
  });

  it("bounds planning and materialization and obeys cancellation, counts, shape and family limits", () => {
    const normalized = validateAndNormalizeSolverInput(input()).normalized!;
    let emitted = 0;
    const emit = () => {
      emitted++;
      return true;
    };
    expect(
      searchSteppedStripPatterns(normalized, emit, () => true, {
        descriptorAttempts: 1,
        materializedPlacements: 100_000,
      }),
    ).toEqual({
      descriptorAttempts: 1,
      materializedPlacements: 0,
      limitReached: "descriptorAttempts",
    });
    expect(searchSteppedStripPatterns(normalized, emit, () => false)).toEqual({
      descriptorAttempts: 0,
      materializedPlacements: 0,
      limitReached: null,
    });
    const limited = searchSteppedStripPatterns(normalized, emit, () => true, {
      descriptorAttempts: 10_000,
      materializedPlacements: 1,
    });
    expect(limited.materializedPlacements).toBe(0);
    expect(limited.limitReached).toBe("materializedPlacements");
    expect(emitted).toBe(0);
    normalized.constraints.maxCandidatesPerGenerator = 3;
    normalized.constraints.minimumPackageCount = 43;
    normalized.constraints.maximumPackageCount = 43;
    const output = generateCandidateFamily(normalized, "stepped-strip");
    expect(output.drafts.map((d) => d.placements.length)).toEqual([43, 43, 43]);
    expect(
      output.diagnostics.some((d) => d.code === "generation-limit-reached"),
    ).toBe(true);
    for (const constraints of [
      { allowMixedPackageOrientations: false },
      { allowedRotations: [0] as const },
      { requiredShape: "rectangular-block" as const },
    ]) {
      expect(
        generateCandidateFamily(
          {
            ...normalized,
            constraints: { ...normalized.constraints, ...constraints },
          },
          "stepped-strip",
        ).drafts,
      ).toEqual([]);
    }
    expect(
      generateCandidateFamily(normalized, "stepped-strip", {
        shouldCancel: () => true,
      }).cancelled,
    ).toBe(true);
  });
});
