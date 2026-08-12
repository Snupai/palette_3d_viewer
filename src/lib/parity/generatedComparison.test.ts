import { describe, expect, it } from "vitest";
import {
  envelopePreservingSymmetries,
  transformPlacements,
} from "~/domain/geometry";
import type { SolverCandidate, SolverResult } from "~/domain/solver/types";
import { compareGeneratedSolverResult } from "~/lib/parity/generatedComparison";
import { extractRobCorpusScenarios } from "~/lib/parity/inputExtraction";
import { characterizeRobSource } from "~/lib/parity/sourceCharacterization";
import type { RobCorpusScenario } from "~/lib/parity/types";
import { parseRobText } from "~/lib/robParser";

const SYNTHETIC_PATTERN_ROB = [
  "200 100 10",
  "50 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "25 10 0 50 10 0 2 0 0",
].join("\n");

function syntheticRob(input: {
  pallet: { length: number; width: number };
  package: { length: number; width: number };
  inputDirection?: 0 | 1;
  grips: Array<{
    x: number;
    y: number;
    rotation: 0 | 90 | 180 | 270;
    count?: number;
  }>;
}): string {
  return [
    `${input.pallet.length} ${input.pallet.width} 10`,
    `${input.package.length} ${input.package.width} 10 ${input.inputDirection ?? 0}`,
    "1",
    "1",
    "0 0",
    "1 0",
    `${input.grips.length}`,
    ...input.grips.map(
      ({ x, y, rotation, count = 1 }) =>
        `0 0 0 ${x} ${y} ${rotation} ${count} 0 0`,
    ),
  ].join("\n");
}

function candidate(
  rank: number,
  placements: SolverCandidate["placements"],
): SolverCandidate {
  const packageCount = placements.length;
  return {
    rank,
    id: `candidate-${rank}`,
    geometryId: `geometry-${rank}`,
    identityFingerprint: `identity-${rank}`,
    geometryFingerprint: `geometry-fingerprint-${rank}`,
    orderDependencies: [],
    placements,
    grips: placements.map((placement, sequence) => ({
      id: placement.gripId,
      groupNumber: sequence + 1,
      sequence,
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: placement.positionMm.x,
      y: placement.positionMm.y,
      rotation: placement.rotation,
      numPackages: 1,
      dx: 0,
      dy: 0,
    })),
    provenance: [],
    validation: { valid: true, issues: [] },
    metrics: {
      packageCount,
      occupiedAreaMm2: packageCount * 1_000,
      utilization: 0,
      utilizationPercent: 0,
      boundingBlockLengthMm: 0,
      boundingBlockWidthMm: 0,
      boundingBlockAreaMm2: 0,
      provisionalCycleCount: packageCount,
      provisionalCycleBasis: "generated-grip-groups",
      multiPackBlocks: null,
      multiPackBlocksVerification: "unverified",
    },
    score: {
      value: 0,
      packageCount,
      utilizationMillionths: 0,
      provisionalCycleCount: packageCount,
      boundingBlockAreaMm2: 0,
      boundingBlockPerimeterMm: 0,
      multiPackBlocks: null,
    },
  };
}

function result(candidates: SolverCandidate[]): SolverResult {
  return {
    status: "completed",
    candidates,
    diagnostics: [],
    exclusions: [],
    statistics: {
      generatedDraftCount: candidates.length,
      validDraftCount: candidates.length,
      invalidDraftCount: 0,
      geometricDuplicateCount: 0,
      candidateCount: candidates.length,
      generatedByFamily: {
        row: candidates.length,
        block: 0,
        "justified-grid": 0,
        pinwheel: 0,
        "nested-side": 0,
        "edge-ring": 0,
        "mixed-orientation": 0,
        symmetry: 0,
      },
    },
  };
}

function generatedPlacements(
  placements: readonly {
    positionMm: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
  }[],
): SolverCandidate["placements"] {
  return placements.map((placement, sequence) => ({
    ...placement,
    sequence,
    labelSide: null,
    gripId: `generated-grip:${sequence + 1}`,
  }));
}

function nominalScenario(
  source: ReturnType<typeof characterizeRobSource>,
): RobCorpusScenario & {
  solverInput: NonNullable<RobCorpusScenario["solverInput"]>;
} {
  const scenario = extractRobCorpusScenarios(source, {
    maxCandidatesPerGenerator: 10,
  })[0]!;
  if (!scenario.solverInput) throw new Error("Missing nominal scenario input.");
  return {
    ...scenario,
    solverInput: scenario.solverInput,
  };
}

describe("generated solver geometry comparison", () => {
  it("matches exact physical geometry independently of placement order and reports rank", () => {
    const source = characterizeRobSource(parseRobText(SYNTHETIC_PATTERN_ROB));
    const scenario = nominalScenario(source);
    const reversed = generatedPlacements(
      [...source.patterns[0]!.placements].reverse(),
    );

    const comparison = compareGeneratedSolverResult(
      source,
      scenario,
      result([candidate(7, reversed)]),
    );
    const pattern = comparison.patterns[0]!;

    expect(pattern.physicalFootprintExact).toMatchObject({
      matched: true,
      candidateRank: 7,
      candidateId: "candidate-7",
      symmetry: null,
    });
    expect(pattern.physicalFootprintRobIntegerCompatible.matched).toBe(true);
    expect(pattern.operationalDirectedYawExact.matched).toBe(true);
    expect(pattern.acceptedMatchKind).toBe("physical-footprint-exact");
    expect(pattern.matchedCandidateRank).toBe(7);
    expect(pattern.matchedCandidateBoundsMm).toEqual(pattern.sourceBoundsMm);
    expect(pattern.matchedCandidateOrientations).toEqual(
      pattern.sourceOrientations,
    );
    expect(pattern.generatedMaximumRelationToSource).toBe("equal");
    expect(
      pattern.checks.find(({ id }) => id.endsWith("accepted-geometry-match"))
        ?.status,
    ).toBe("PASS");
  });

  it("accepts an explicit non-identity physical symmetry-orbit match", () => {
    const source = characterizeRobSource(parseRobText(SYNTHETIC_PATTERN_ROB));
    const scenario = nominalScenario(source);
    const transformed = transformPlacements(
      source.patterns[0]!.placements,
      scenario.solverInput.envelopeMm,
      "rotate-180",
    );

    const comparison = compareGeneratedSolverResult(
      source,
      scenario,
      result([candidate(3, generatedPlacements(transformed))]),
    );
    const pattern = comparison.patterns[0]!;

    expect(pattern.physicalFootprintExact).toMatchObject({
      matched: true,
      candidateRank: 3,
      symmetry: "rotate-180",
    });
    expect(pattern.acceptedMatchKind).toBe("physical-footprint-exact");
    expect(pattern.acceptedSymmetry).toBe("rotate-180");
    expect(pattern.status).toBe("PASS");
  });

  it("normalizes antiparallel ROB place yaw to physical footprint geometry", () => {
    const xValues = [90, 260, 430, 600, 770, 940, 1110];
    const yValues = [151, 400, 649];
    const source = characterizeRobSource(
      parseRobText(
        syntheticRob({
          pallet: { length: 1200, width: 800 },
          package: { length: 249, width: 170 },
          inputDirection: 1,
          grips: yValues.flatMap((y) =>
            xValues.map((x, column) => ({
              x,
              y,
              rotation: column < 4 ? (180 as const) : (0 as const),
            })),
          ),
        }),
      ),
    );
    const scenario = nominalScenario(source);
    const candidatePlacements = source.patterns[0]!.placements.map(
      ({ positionMm }) => ({ positionMm, rotation: 90 as const }),
    );

    const pattern = compareGeneratedSolverResult(
      source,
      scenario,
      result([candidate(1, generatedPlacements(candidatePlacements))]),
    ).patterns[0]!;

    expect(pattern.sourcePlaceOrientations).toEqual({
      0: 9,
      90: 0,
      180: 12,
      270: 0,
    });
    expect(pattern.sourceOrientations).toEqual({
      0: 0,
      90: 9,
      180: 0,
      270: 12,
    });
    expect(pattern.sourcePhysicalFootprintOrientations).toEqual({
      lengthwise: 0,
      crosswise: 21,
      square: 0,
    });
    expect(pattern.physicalFootprintExact.matched).toBe(true);
    expect(pattern.operationalDirectedYawExact.matched).toBe(false);
    expect(pattern.acceptedMatchKind).toBe("physical-footprint-exact");
  });

  it("matches half-millimeter ROB group-center quantization without weakening generated validation", () => {
    const source = characterizeRobSource(
      parseRobText(
        syntheticRob({
          pallet: { length: 200, width: 800 },
          package: { length: 109, width: 109 },
          grips: [
            { x: 100, y: 127, rotation: 90, count: 2 },
            { x: 100, y: 400, rotation: 90, count: 3 },
            { x: 100, y: 672, rotation: 90, count: 2 },
          ],
        }),
      ),
    );
    const scenario = nominalScenario(source);
    const candidatePlacements = [73, 182, 291, 400, 509, 618, 727].map((y) => ({
      positionMm: { x: 100, y },
      rotation: 90 as const,
    }));

    const pattern = compareGeneratedSolverResult(
      source,
      scenario,
      result([candidate(1, generatedPlacements(candidatePlacements))]),
    ).patterns[0]!;

    expect(pattern.physicalFootprintExact.matched).toBe(false);
    expect(pattern.physicalFootprintRobIntegerCompatible.matched).toBe(true);
    expect(pattern.acceptedMatchKind).toBe(
      "physical-footprint-rob-integer-compatible",
    );
    expect(pattern.maximumCenterDisplacementMm).toBe(0.5);
    expect(pattern.maximumBoundsDifferenceMm).toBe(0.5);
    expect(pattern.checks.find(({ id }) => id.endsWith("bounds"))?.status).toBe(
      "PASS",
    );
  });

  it("treats every directed yaw of a square package as one physical footprint", () => {
    const source = characterizeRobSource(
      parseRobText(
        syntheticRob({
          pallet: { length: 200, width: 200 },
          package: { length: 100, width: 100 },
          grips: [
            { x: 50, y: 50, rotation: 0 },
            { x: 150, y: 50, rotation: 90 },
            { x: 50, y: 150, rotation: 180 },
            { x: 150, y: 150, rotation: 270 },
          ],
        }),
      ),
    );
    const candidatePlacements = source.patterns[0]!.placements.map(
      ({ positionMm }) => ({ positionMm, rotation: 0 as const }),
    );
    const pattern = compareGeneratedSolverResult(
      source,
      nominalScenario(source),
      result([candidate(1, generatedPlacements(candidatePlacements))]),
    ).patterns[0]!;

    expect(pattern.sourcePhysicalFootprintOrientations).toEqual({
      lengthwise: 0,
      crosswise: 0,
      square: 4,
    });
    expect(pattern.physicalFootprintExact.matched).toBe(true);
    expect(pattern.operationalDirectedYawExact.matched).toBe(false);
  });

  it("normalizes physical orientation after every explicit square-envelope symmetry", () => {
    const source = characterizeRobSource(
      parseRobText(
        syntheticRob({
          pallet: { length: 400, width: 400 },
          package: { length: 120, width: 80 },
          grips: [
            { x: 70, y: 60, rotation: 0 },
            { x: 240, y: 125, rotation: 90 },
            { x: 325, y: 310, rotation: 180 },
          ],
        }),
      ),
    );
    const scenario = nominalScenario(source);

    for (const symmetry of envelopePreservingSymmetries(
      scenario.solverInput.envelopeMm,
      false,
    )) {
      const transformed = transformPlacements(
        source.patterns[0]!.placements,
        scenario.solverInput.envelopeMm,
        symmetry,
      );
      const pattern = compareGeneratedSolverResult(
        source,
        scenario,
        result([candidate(1, generatedPlacements(transformed))]),
      ).patterns[0]!;
      expect(pattern.physicalFootprintExact.matched, symmetry).toBe(true);
      expect(pattern.acceptedSymmetry, symmetry).not.toBeNull();
    }
  });

  it("emits physical mismatch paths when generated candidates miss feasible source geometry and count", () => {
    const source = characterizeRobSource(parseRobText(SYNTHETIC_PATTERN_ROB));
    const unrelated = generatedPlacements([
      { positionMm: { x: 150, y: 50 }, rotation: 90 },
    ]);

    const comparison = compareGeneratedSolverResult(
      source,
      nominalScenario(source),
      result([candidate(1, unrelated)]),
    );
    const mismatches = comparison.patterns[0]!.checks.flatMap(
      ({ mismatches }) => mismatches,
    );

    expect(mismatches.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "patterns[0].physicalFootprintGeometry",
        "patterns[0].generatedMaximumPackageCount",
      ]),
    );
    expect(comparison.patterns[0]!.status).toBe("BLOCKED");
  });
});
