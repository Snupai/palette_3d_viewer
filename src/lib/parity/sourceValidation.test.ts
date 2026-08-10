import { describe, expect, it } from "vitest";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import { extractRobCorpusScenarios } from "~/lib/parity/inputExtraction";
import { characterizeRobSource } from "~/lib/parity/sourceCharacterization";
import { sourceGeometryValidationCheck } from "~/lib/parity/sourceValidation";
import { parseRobText } from "~/lib/robParser";

const HALF_MILLIMETER_OVERLAP_ROB = [
  "100 100 10",
  "51 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "2",
  "0 0 0 26 50 0 1 0 0",
  "0 0 0 61 50 90 1 0 0",
].join("\n");

const HALF_MILLIMETER_BOUNDARY_ROB = [
  "100 100 10",
  "51 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "0 0 0 25 50 0 1 0 0",
].join("\n");

const OVER_TOLERANCE_BOUNDARY_ROB = HALF_MILLIMETER_BOUNDARY_ROB.replace(
  "0 0 0 25 50",
  "0 0 0 24 50",
);

const OBSERVED_ENVELOPE_ONLY_ROB = [
  "100 100 10",
  "20 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "0 0 0 101 50 0 1 0 0",
].join("\n");

type GeometryProfileEvidence = {
  solverValidationToleranceMm: number;
  sourceOnlyRobIntegerToleranceMm: number;
  profileCounts: Record<string, number>;
  patterns: Array<{
    profile: string;
    nominal: {
      strictValid: boolean;
      robIntegerCompatible: boolean;
      maximumOverlapPenetrationMm: number;
      maximumBoundaryOverflowMm: number;
    };
    observed: {
      strictValid: boolean;
      robIntegerCompatible: boolean;
      maximumBoundaryOverflowMm: number;
    };
  }>;
};

function evidenceFor(text: string): GeometryProfileEvidence {
  const source = characterizeRobSource(parseRobText(text));
  const scenarios = extractRobCorpusScenarios(source, {
    maxCandidatesPerGenerator: 10,
  });
  return sourceGeometryValidationCheck(source, scenarios)
    .evidence as GeometryProfileEvidence;
}

describe("source .rob geometry validation profiles", () => {
  it("classifies half-millimeter integer overlap quantization without weakening solver validation", () => {
    const source = characterizeRobSource(
      parseRobText(HALF_MILLIMETER_OVERLAP_ROB),
    );
    const scenarios = extractRobCorpusScenarios(source, {
      maxCandidatesPerGenerator: 10,
    });
    const check = sourceGeometryValidationCheck(source, scenarios);
    const evidence = check.evidence as GeometryProfileEvidence;
    const nominal = scenarios[0]!;
    if (!nominal.solverInput) throw new Error("Missing nominal solver input.");
    const normalized = validateAndNormalizeSolverInput(nominal.solverInput);
    if (!normalized.normalized)
      throw new Error("Invalid nominal solver input.");

    const strictValidation = validateCandidatePlacements(
      normalized.normalized,
      source.patterns[0]!.placements.map((placement, sequence) => ({
        ...placement,
        sequence,
      })),
    );

    expect(strictValidation).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "placement-overlap" })],
    });
    expect(evidence).toMatchObject({
      solverValidationToleranceMm: 0,
      sourceOnlyRobIntegerToleranceMm: 0.500_001,
      profileCounts: { "nominal-rob-integer-compatible": 1 },
      patterns: [
        {
          profile: "nominal-rob-integer-compatible",
          nominal: {
            strictValid: false,
            robIntegerCompatible: true,
            maximumOverlapPenetrationMm: 0.5,
            maximumBoundaryOverflowMm: 0,
          },
          observed: {
            strictValid: false,
            robIntegerCompatible: true,
          },
        },
      ],
    });
  });

  it("classifies exactly half-millimeter nominal boundary overflow as ROB integer compatible", () => {
    const evidence = evidenceFor(HALF_MILLIMETER_BOUNDARY_ROB);

    expect(evidence.profileCounts).toMatchObject({
      "nominal-rob-integer-compatible": 1,
    });
    expect(evidence.patterns[0]).toMatchObject({
      profile: "nominal-rob-integer-compatible",
      nominal: {
        strictValid: false,
        robIntegerCompatible: true,
        maximumBoundaryOverflowMm: 0.5,
      },
    });
  });

  it("rejects boundary overflow above the ROB integer tolerance", () => {
    const evidence = evidenceFor(OVER_TOLERANCE_BOUNDARY_ROB);

    expect(evidence.patterns[0]).toMatchObject({
      profile: "observed-strict-only",
      nominal: {
        strictValid: false,
        robIntegerCompatible: false,
        maximumBoundaryOverflowMm: 1.5,
      },
      observed: {
        strictValid: true,
        robIntegerCompatible: true,
        maximumBoundaryOverflowMm: 0,
      },
    });
  });

  it("separates observed source extents from encoded nominal pallet policy", () => {
    const evidence = evidenceFor(OBSERVED_ENVELOPE_ONLY_ROB);

    expect(evidence.profileCounts).toMatchObject({
      "observed-strict-only": 1,
    });
    expect(evidence.patterns[0]).toMatchObject({
      profile: "observed-strict-only",
      nominal: {
        strictValid: false,
        robIntegerCompatible: false,
      },
      observed: {
        strictValid: true,
        robIntegerCompatible: true,
      },
    });
  });
});
