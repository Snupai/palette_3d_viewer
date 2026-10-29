import { placementRectangleBounds } from "~/domain/geometry";
import type { PlacementGeometry } from "~/domain/geometry";
import type {
  NormalizedLayerSolverInput,
  SolverIssue,
} from "~/domain/solver/types";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";
import { createCorpusCheck } from "~/lib/parity/status";
import type {
  CorpusCheck,
  RobCorpusScenario,
  SourceCharacterization,
  SourcePatternCharacterization,
} from "~/lib/parity/types";

/**
 * Imported .rob coordinates are integer-valued even when odd package dimensions
 * make an exact edge-touching center land on a half millimeter. This tolerance
 * is observational only; generated solver candidates continue to use exact
 * validation with zero tolerance.
 */
export const ROB_SOURCE_INTEGER_TOLERANCE_MM = 0.500_001;

export const SOURCE_GEOMETRY_PROFILES = [
  "nominal-strict",
  "nominal-rob-integer-compatible",
  "observed-strict-only",
  "observed-rob-integer-compatible-only",
  "invalid-source-geometry",
  "unavailable",
] as const;

export type SourceGeometryProfile = (typeof SOURCE_GEOMETRY_PROFILES)[number];

export type SourceGeometryValidationSummary = {
  available: boolean;
  strictValid: boolean;
  robIntegerCompatible: boolean;
  strictIssueCodes: string[];
  robIntegerIssueCodes: string[];
  strictIssueCount: number;
  robIntegerIssueCount: number;
  maximumOverlapPenetrationMm: number;
  maximumBoundaryOverflowMm: number;
};

export type SourcePatternGeometryValidation = {
  sourcePatternOrdinal: number;
  profile: SourceGeometryProfile;
  nominal: SourceGeometryValidationSummary;
  observed: SourceGeometryValidationSummary;
};

export type SourceGeometryValidation = {
  profileCounts: Record<SourceGeometryProfile, number>;
  patterns: SourcePatternGeometryValidation[];
};

function unavailableSummary(): SourceGeometryValidationSummary {
  return {
    available: false,
    strictValid: false,
    robIntegerCompatible: false,
    strictIssueCodes: [],
    robIntegerIssueCodes: [],
    strictIssueCount: 0,
    robIntegerIssueCount: 0,
    maximumOverlapPenetrationMm: 0,
    maximumBoundaryOverflowMm: 0,
  };
}

function generatedPlacements(
  pattern: SourcePatternCharacterization,
): Array<PlacementGeometry & { sequence: number }> {
  return pattern.placements.map((placement, sequence) => ({
    positionMm: { ...placement.positionMm },
    rotation: placement.rotation,
    sequence,
  }));
}

function sortedUniqueIssueCodes(issues: readonly SolverIssue[]): string[] {
  return [...new Set(issues.map(({ code }) => code))].sort();
}

function packageSize(source: SourceCharacterization): {
  length: number;
  width: number;
} {
  return {
    length: source.encodedInput.packageDimensionsMm.length,
    width: source.encodedInput.packageDimensionsMm.width,
  };
}

function overlapPenetrationMm(
  source: SourceCharacterization,
  pattern: SourcePatternCharacterization,
  issue: SolverIssue,
): number | null {
  if (issue.code !== "placement-overlap") return null;
  const [leftIndex, rightIndex] = issue.placementIndices ?? [];
  const left = pattern.placements[leftIndex ?? -1];
  const right = pattern.placements[rightIndex ?? -1];
  if (!left || !right) return null;

  const leftBounds = placementRectangleBounds(left, packageSize(source));
  const rightBounds = placementRectangleBounds(right, packageSize(source));
  const overlapX =
    Math.min(leftBounds.maxX, rightBounds.maxX) -
    Math.max(leftBounds.minX, rightBounds.minX);
  const overlapY =
    Math.min(leftBounds.maxY, rightBounds.maxY) -
    Math.max(leftBounds.minY, rightBounds.minY);
  return overlapX > 0 && overlapY > 0 ? Math.min(overlapX, overlapY) : 0;
}

function boundaryOverflowMm(
  source: SourceCharacterization,
  pattern: SourcePatternCharacterization,
  input: NormalizedLayerSolverInput,
  issue: SolverIssue,
): number | null {
  if (issue.code !== "placement-out-of-bounds") return null;
  const [placementIndex] = issue.placementIndices ?? [];
  const placement = pattern.placements[placementIndex ?? -1];
  if (!placement) return null;

  const bounds = placementRectangleBounds(placement, packageSize(source));
  const envelope = input.usableEnvelopeMm;
  return Math.max(
    0,
    envelope.minX - bounds.minX,
    envelope.minY - bounds.minY,
    bounds.maxX - envelope.maxX,
    bounds.maxY - envelope.maxY,
  );
}

export function sourceScenarioGeometryValidation(
  source: SourceCharacterization,
  pattern: SourcePatternCharacterization,
  scenario: RobCorpusScenario | undefined,
): SourceGeometryValidationSummary {
  if (!scenario?.solverInput) return unavailableSummary();

  const inputValidation = validateAndNormalizeSolverInput(scenario.solverInput);
  if (!inputValidation.valid || !inputValidation.normalized) {
    const issueCodes = sortedUniqueIssueCodes(inputValidation.issues);
    return {
      ...unavailableSummary(),
      available: true,
      strictIssueCodes: issueCodes,
      robIntegerIssueCodes: issueCodes,
      strictIssueCount: inputValidation.issues.length,
      robIntegerIssueCount: inputValidation.issues.length,
    };
  }

  const strictIssues = validateCandidatePlacements(
    inputValidation.normalized,
    generatedPlacements(pattern),
  ).issues;
  let maximumOverlapPenetrationMm = 0;
  let maximumBoundaryOverflowMm = 0;
  const robIntegerIssues = strictIssues.filter((issue) => {
    const penetration = overlapPenetrationMm(source, pattern, issue);
    if (penetration !== null) {
      maximumOverlapPenetrationMm = Math.max(
        maximumOverlapPenetrationMm,
        penetration,
      );
      return penetration > ROB_SOURCE_INTEGER_TOLERANCE_MM;
    }

    const overflow = boundaryOverflowMm(
      source,
      pattern,
      inputValidation.normalized!,
      issue,
    );
    if (overflow !== null) {
      maximumBoundaryOverflowMm = Math.max(maximumBoundaryOverflowMm, overflow);
      return overflow > ROB_SOURCE_INTEGER_TOLERANCE_MM;
    }
    return true;
  });

  return {
    available: true,
    strictValid: strictIssues.length === 0,
    robIntegerCompatible: robIntegerIssues.length === 0,
    strictIssueCodes: sortedUniqueIssueCodes(strictIssues),
    robIntegerIssueCodes: sortedUniqueIssueCodes(robIntegerIssues),
    strictIssueCount: strictIssues.length,
    robIntegerIssueCount: robIntegerIssues.length,
    maximumOverlapPenetrationMm,
    maximumBoundaryOverflowMm,
  };
}

function profileFor(
  nominal: SourceGeometryValidationSummary,
  observed: SourceGeometryValidationSummary,
): SourceGeometryProfile {
  if (!nominal.available && !observed.available) return "unavailable";
  if (nominal.strictValid) return "nominal-strict";
  if (nominal.robIntegerCompatible) {
    return "nominal-rob-integer-compatible";
  }
  if (observed.strictValid) return "observed-strict-only";
  if (observed.robIntegerCompatible) {
    return "observed-rob-integer-compatible-only";
  }
  return "invalid-source-geometry";
}

export function characterizeSourceGeometryValidation(
  source: SourceCharacterization,
  scenarios: readonly RobCorpusScenario[],
): SourceGeometryValidation {
  const nominalScenario = scenarios.find(
    ({ id }) => id === "nominal-strict-v1",
  );
  const observedScenario = scenarios.find(
    ({ id }) => id === "observed-envelope-v1",
  );
  const patterns = source.patterns.map((pattern) => {
    const nominal = sourceScenarioGeometryValidation(
      source,
      pattern,
      nominalScenario,
    );
    const observed = sourceScenarioGeometryValidation(
      source,
      pattern,
      observedScenario,
    );
    return {
      sourcePatternOrdinal: pattern.ordinal,
      profile: profileFor(nominal, observed),
      nominal,
      observed,
    };
  });
  const profileCounts = Object.fromEntries(
    SOURCE_GEOMETRY_PROFILES.map((profile) => [
      profile,
      patterns.filter((pattern) => pattern.profile === profile).length,
    ]),
  ) as Record<SourceGeometryProfile, number>;
  return { profileCounts, patterns };
}

export function sourceGeometryValidationCheck(
  source: SourceCharacterization,
  scenarios: readonly RobCorpusScenario[],
): CorpusCheck {
  const validation = characterizeSourceGeometryValidation(source, scenarios);
  return createCorpusCheck({
    id: "source.geometry-validation-profiles",
    status: "OBSERVED",
    summary:
      "Source patterns were profiled with exact solver validation and a separate read-only .rob integer-coordinate compatibility tolerance for overlap and boundary quantization; solver validation remains exact.",
    evidence: {
      solverValidationToleranceMm: 0,
      sourceOnlyRobIntegerToleranceMm: ROB_SOURCE_INTEGER_TOLERANCE_MM,
      profileCounts: validation.profileCounts,
      patterns: validation.patterns,
    },
  });
}
