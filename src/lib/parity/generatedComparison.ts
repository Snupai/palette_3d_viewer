import {
  boundingRectangleForPlacements,
  envelopePreservingSymmetries,
  transformPlacements,
  type LayerSymmetry,
  type PlacementGeometry,
} from "~/domain/geometry";
import { candidateGeometryFingerprint } from "~/domain/solver/candidateIdentity";
import type { SolverCandidate, SolverResult } from "~/domain/solver/types";
import {
  matchPhysicalFootprintPlacements,
  physicalFootprintCoarseKey,
  physicalFootprintGeometryFingerprint,
  physicalFootprintOrientationHistogram,
  rectangleBoundsMaximumDifferenceMm,
  rectangleBoundsWithinTolerance,
} from "~/lib/parity/physicalGeometry";
import { orientationHistogram } from "~/lib/parity/sourceCharacterization";
import {
  ROB_SOURCE_INTEGER_TOLERANCE_MM,
  sourceScenarioGeometryValidation,
} from "~/lib/parity/sourceValidation";
import { combineStatuses, createCorpusCheck } from "~/lib/parity/status";
import type {
  CandidateGeometryMatch,
  CorpusCheck,
  PatternGeneratedComparison,
  RobCorpusScenario,
  ScenarioComparisonReport,
  SourceCharacterization,
  SourcePatternCharacterization,
} from "~/lib/parity/types";

type RunnableScenario = RobCorpusScenario & {
  solverInput: NonNullable<RobCorpusScenario["solverInput"]>;
};

type RelationMatch = {
  candidate: SolverCandidate;
  symmetry: LayerSymmetry | null;
  sourcePlacements: PlacementGeometry[];
  maximumCenterDisplacementMm: number;
};

function geometryFingerprint(placements: readonly PlacementGeometry[]): string {
  return candidateGeometryFingerprint({ placements });
}

function firstRanked(
  candidates: readonly SolverCandidate[],
): SolverCandidate | null {
  return (
    [...candidates].sort(
      (left, right) =>
        left.rank - right.rank || left.id.localeCompare(right.id),
    )[0] ?? null
  );
}

function matchRecord(match: RelationMatch | null): CandidateGeometryMatch {
  return {
    matched: match !== null,
    candidateRank: match?.candidate.rank ?? null,
    candidateId: match?.candidate.id ?? null,
    symmetry: match?.symmetry ?? null,
  };
}

function relationToSource(
  generatedMaximum: number,
  sourceCount: number,
): PatternGeneratedComparison["generatedMaximumRelationToSource"] {
  if (generatedMaximum < sourceCount) return "below";
  if (generatedMaximum > sourceCount) return "above";
  return "equal";
}

function maximumCheck(
  path: string,
  generatedMaximum: number,
  sourceCount: number,
  generationIncomplete: boolean,
): CorpusCheck {
  if (generatedMaximum < sourceCount) {
    return createCorpusCheck({
      id: `${path}.generated-maximum-vs-source-feasible-count`,
      status: "BLOCKED",
      summary: generationIncomplete
        ? "The returned candidates do not reach the source feasible count, and configured generation limits prevent a complete conclusion."
        : "The implemented generator vocabulary does not reach the source feasible count; broader layout-vocabulary completeness remains open.",
      evidence: {
        sourceCountRole: "feasible-reference-not-asserted-maximum",
        generationIncomplete,
        generatorVocabularyCompleteness: "Open",
      },
      mismatches: [
        {
          path: `${path}.generatedMaximumPackageCount`,
          expected: sourceCount,
          actual: generatedMaximum,
          detail: "Expected at least the source feasible package count.",
        },
      ],
    });
  }
  if (generatedMaximum > sourceCount) {
    return createCorpusCheck({
      id: `${path}.generated-maximum-vs-source-feasible-count`,
      status: "OBSERVED",
      summary:
        "The solver generated a higher-count candidate; the source count remains a feasible reference, not an asserted maximum.",
      evidence: {
        sourceFeasiblePackageCount: sourceCount,
        generatedMaximumPackageCount: generatedMaximum,
        sourceCountRole: "feasible-reference-not-asserted-maximum",
      },
    });
  }
  return createCorpusCheck({
    id: `${path}.generated-maximum-vs-source-feasible-count`,
    status: "PASS",
    summary:
      "The generated maximum equals the source feasible package count without treating the source as an asserted optimum.",
    evidence: {
      sourceFeasiblePackageCount: sourceCount,
      generatedMaximumPackageCount: generatedMaximum,
      sourceCountRole: "feasible-reference-not-asserted-maximum",
    },
  });
}

function addCandidateToIndex(
  index: Map<string, SolverCandidate[]>,
  key: string,
  candidate: SolverCandidate,
): void {
  const entries = index.get(key) ?? [];
  entries.push(candidate);
  index.set(key, entries);
}

function sortedCandidateIndex(
  index: Map<string, SolverCandidate[]>,
): Map<string, SolverCandidate[]> {
  for (const [key, candidates] of index) {
    index.set(
      key,
      [...candidates].sort(
        (left, right) =>
          left.rank - right.rank || left.id.localeCompare(right.id),
      ),
    );
  }
  return index;
}

function transformedSourceVariants(
  pattern: SourcePatternCharacterization,
  scenario: RunnableScenario,
): Array<{
  symmetry: LayerSymmetry | null;
  placements: PlacementGeometry[];
}> {
  return [
    { symmetry: null, placements: [...pattern.placements] },
    ...envelopePreservingSymmetries(scenario.solverInput.envelopeMm, false).map(
      (symmetry) => ({
        symmetry,
        placements: transformPlacements(
          pattern.placements,
          scenario.solverInput.envelopeMm,
          symmetry,
        ),
      }),
    ),
  ];
}

function findDirectedYawMatch(
  variants: ReturnType<typeof transformedSourceVariants>,
  candidatesByFingerprint: ReadonlyMap<string, readonly SolverCandidate[]>,
): RelationMatch | null {
  for (const variant of variants) {
    const candidate = firstRanked(
      candidatesByFingerprint.get(geometryFingerprint(variant.placements)) ??
        [],
    );
    if (candidate) {
      return {
        candidate,
        symmetry: variant.symmetry,
        sourcePlacements: variant.placements,
        maximumCenterDisplacementMm: 0,
      };
    }
  }
  return null;
}

function findExactPhysicalFootprintMatch(
  variants: ReturnType<typeof transformedSourceVariants>,
  candidatesByFingerprint: ReadonlyMap<string, readonly SolverCandidate[]>,
  packageSize: { length: number; width: number },
): RelationMatch | null {
  for (const variant of variants) {
    const fingerprint = physicalFootprintGeometryFingerprint(
      variant.placements,
      packageSize,
    );
    const candidate = firstRanked(
      candidatesByFingerprint.get(fingerprint) ?? [],
    );
    if (candidate) {
      return {
        candidate,
        symmetry: variant.symmetry,
        sourcePlacements: variant.placements,
        maximumCenterDisplacementMm: 0,
      };
    }
  }
  return null;
}

function findRobIntegerCompatiblePhysicalMatch(
  variants: ReturnType<typeof transformedSourceVariants>,
  candidatesByCoarseKey: ReadonlyMap<string, readonly SolverCandidate[]>,
  packageSize: { length: number; width: number },
): RelationMatch | null {
  for (const variant of variants) {
    const sourceBounds = boundingRectangleForPlacements(
      variant.placements,
      packageSize,
    );
    const candidates =
      candidatesByCoarseKey.get(
        physicalFootprintCoarseKey(variant.placements, packageSize),
      ) ?? [];
    for (const candidate of candidates) {
      const candidateBounds = boundingRectangleForPlacements(
        candidate.placements,
        packageSize,
      );
      if (
        !rectangleBoundsWithinTolerance(
          sourceBounds,
          candidateBounds,
          ROB_SOURCE_INTEGER_TOLERANCE_MM,
        )
      ) {
        continue;
      }
      const placementMatch = matchPhysicalFootprintPlacements(
        variant.placements,
        candidate.placements,
        packageSize,
        ROB_SOURCE_INTEGER_TOLERANCE_MM,
      );
      if (placementMatch.matched) {
        return {
          candidate,
          symmetry: variant.symmetry,
          sourcePlacements: variant.placements,
          maximumCenterDisplacementMm:
            placementMatch.maximumAxisDisplacementMm ?? 0,
        };
      }
    }
  }
  return null;
}

function comparePattern(
  source: SourceCharacterization,
  pattern: SourcePatternCharacterization,
  scenario: RunnableScenario,
  result: SolverResult,
  generatedMaximum: number,
  generationIncomplete: boolean,
): PatternGeneratedComparison {
  const path = `patterns[${pattern.ordinal - 1}]`;
  const packageSize = {
    length: source.encodedInput.packageDimensionsMm.length,
    width: source.encodedInput.packageDimensionsMm.width,
  };
  const candidatesByDirectedFingerprint = new Map<string, SolverCandidate[]>();
  const candidatesByPhysicalFingerprint = new Map<string, SolverCandidate[]>();
  const candidatesByPhysicalCoarseKey = new Map<string, SolverCandidate[]>();
  for (const candidate of result.candidates) {
    addCandidateToIndex(
      candidatesByDirectedFingerprint,
      geometryFingerprint(candidate.placements),
      candidate,
    );
    addCandidateToIndex(
      candidatesByPhysicalFingerprint,
      physicalFootprintGeometryFingerprint(candidate.placements, packageSize),
      candidate,
    );
    addCandidateToIndex(
      candidatesByPhysicalCoarseKey,
      physicalFootprintCoarseKey(candidate.placements, packageSize),
      candidate,
    );
  }
  sortedCandidateIndex(candidatesByDirectedFingerprint);
  sortedCandidateIndex(candidatesByPhysicalFingerprint);
  sortedCandidateIndex(candidatesByPhysicalCoarseKey);

  const variants = transformedSourceVariants(pattern, scenario);
  const operationalDirectedYawExact = findDirectedYawMatch(
    variants,
    candidatesByDirectedFingerprint,
  );
  const physicalFootprintExact = findExactPhysicalFootprintMatch(
    variants,
    candidatesByPhysicalFingerprint,
    packageSize,
  );
  const sourceValidation = sourceScenarioGeometryValidation(
    source,
    pattern,
    scenario,
  );
  const physicalFootprintRobIntegerCompatible =
    sourceValidation.robIntegerCompatible
      ? findRobIntegerCompatiblePhysicalMatch(
          variants,
          candidatesByPhysicalCoarseKey,
          packageSize,
        )
      : null;
  const acceptedMatch =
    physicalFootprintExact ?? physicalFootprintRobIntegerCompatible;
  const acceptedMatchKind = physicalFootprintExact
    ? ("physical-footprint-exact" as const)
    : physicalFootprintRobIntegerCompatible
      ? ("physical-footprint-rob-integer-compatible" as const)
      : null;
  const matchedCandidate = acceptedMatch?.candidate ?? null;
  const acceptedSourcePlacements = acceptedMatch?.sourcePlacements ?? null;
  const matchedBounds = matchedCandidate
    ? boundingRectangleForPlacements(matchedCandidate.placements, packageSize)
    : null;
  const expectedMatchedBounds = acceptedSourcePlacements
    ? boundingRectangleForPlacements(acceptedSourcePlacements, packageSize)
    : null;
  const maximumBoundsDifferenceMm = acceptedMatch
    ? rectangleBoundsMaximumDifferenceMm(matchedBounds, expectedMatchedBounds)
    : null;
  const boundsToleranceMm =
    acceptedMatchKind === "physical-footprint-rob-integer-compatible"
      ? ROB_SOURCE_INTEGER_TOLERANCE_MM
      : 0;
  const matchedOrientations = matchedCandidate
    ? orientationHistogram(matchedCandidate.placements)
    : null;
  const expectedMatchedOrientations = acceptedSourcePlacements
    ? orientationHistogram(acceptedSourcePlacements)
    : null;
  const matchedPhysicalFootprintOrientations = matchedCandidate
    ? physicalFootprintOrientationHistogram(
        matchedCandidate.placements,
        packageSize,
      )
    : null;
  const expectedPhysicalFootprintOrientations = acceptedSourcePlacements
    ? physicalFootprintOrientationHistogram(
        acceptedSourcePlacements,
        packageSize,
      )
    : null;
  const packageCountMatches =
    matchedCandidate !== null &&
    matchedCandidate.metrics.packageCount === pattern.packageCount;
  const boundsMatch =
    matchedCandidate !== null &&
    rectangleBoundsWithinTolerance(
      matchedBounds,
      expectedMatchedBounds,
      boundsToleranceMm,
    );
  const physicalFootprintsMatch =
    matchedCandidate !== null &&
    JSON.stringify(matchedPhysicalFootprintOrientations) ===
      JSON.stringify(expectedPhysicalFootprintOrientations);
  const orientationsMatch =
    matchedCandidate !== null &&
    JSON.stringify(matchedOrientations) ===
      JSON.stringify(expectedMatchedOrientations);
  const exactPhysicalSummary = physicalFootprintExact
    ? `A generated candidate matches the source physical footprint geometry${physicalFootprintExact.symmetry ? ` after ${physicalFootprintExact.symmetry}` : " in the identity frame"}.`
    : "No exact-center physical footprint match was observed; ROB integer compatibility is evaluated separately.";
  const checks: CorpusCheck[] = [
    createCorpusCheck({
      id: `${path}.physical-footprint-exact`,
      status: physicalFootprintExact ? "PASS" : "OBSERVED",
      summary: exactPhysicalSummary,
      evidence: {
        geometryEquality:
          "exact-centers-and-rotated-footprint-dimensions-order-independent",
        directedYawRequired: false,
        symmetry: physicalFootprintExact?.symmetry ?? null,
        candidateRank: physicalFootprintExact?.candidate.rank ?? null,
      },
    }),
    createCorpusCheck({
      id: `${path}.physical-footprint-rob-integer-compatible`,
      status: !sourceValidation.robIntegerCompatible
        ? "SKIPPED"
        : physicalFootprintRobIntegerCompatible
          ? "PASS"
          : "OBSERVED",
      summary: !sourceValidation.robIntegerCompatible
        ? "The source pattern is not valid under the bounded ROB integer-coordinate compatibility profile."
        : physicalFootprintRobIntegerCompatible
          ? "A generated candidate matches the physical source footprints within the bounded ROB integer-coordinate tolerance."
          : "No generated physical footprint match was observed within the bounded ROB integer-coordinate tolerance.",
      evidence: {
        sourceRobIntegerCompatible: sourceValidation.robIntegerCompatible,
        sourceStrictValid: sourceValidation.strictValid,
        toleranceMm: ROB_SOURCE_INTEGER_TOLERANCE_MM,
        symmetry: physicalFootprintRobIntegerCompatible?.symmetry ?? null,
        candidateRank:
          physicalFootprintRobIntegerCompatible?.candidate.rank ?? null,
        maximumCenterDisplacementMm:
          physicalFootprintRobIntegerCompatible?.maximumCenterDisplacementMm ??
          null,
      },
    }),
    createCorpusCheck({
      id: `${path}.operational-directed-yaw-exact`,
      status: operationalDirectedYawExact ? "PASS" : "OBSERVED",
      summary: operationalDirectedYawExact
        ? "A generated candidate also preserves exact directed package yaw in the accepted source symmetry orbit."
        : "No exact directed-yaw match was observed; this is retained as operational evidence and does not reject physical footprint parity.",
      evidence: {
        parityScope: "operational-observation-not-robotics-pass",
        geometryEquality:
          "exact-centers-and-directed-package-yaw-order-independent",
        rawRobPlaceYawRetainedSeparately: true,
        symmetry: operationalDirectedYawExact?.symmetry ?? null,
        candidateRank: operationalDirectedYawExact?.candidate.rank ?? null,
      },
    }),
    createCorpusCheck({
      id: `${path}.accepted-geometry-match`,
      status: matchedCandidate ? "PASS" : "BLOCKED",
      summary: matchedCandidate
        ? `The source physical footprint geometry is represented by a generated candidate using ${acceptedMatchKind === "physical-footprint-exact" ? "exact centers" : "the bounded ROB integer-coordinate compatibility relation"}.`
        : generationIncomplete
          ? "No physical footprint match is present in the returned candidates, and configured generation limits block a complete geometry conclusion."
          : "No generated candidate represents the source physical footprint geometry under the implemented families; broader generator-vocabulary completeness remains open.",
      evidence: {
        acceptedMatchKind,
        acceptedSymmetry: acceptedMatch?.symmetry ?? null,
        matchedCandidateRank: matchedCandidate?.rank ?? null,
        directedYawRequired: false,
        generationIncomplete,
        generatorVocabularyCompleteness: "Open",
      },
      mismatches: matchedCandidate
        ? []
        : [
            {
              path: `${path}.physicalFootprintGeometry`,
              expected: "source physical footprint orbit",
              actual: null,
              detail:
                "No exact-center or ROB-integer-compatible physical footprint match was generated.",
            },
          ],
    }),
    createCorpusCheck({
      id: `${path}.package-count`,
      status: !matchedCandidate
        ? "SKIPPED"
        : packageCountMatches
          ? "PASS"
          : "FAIL",
      summary: !matchedCandidate
        ? "Package-count identity is deferred because no physical geometry candidate matched."
        : packageCountMatches
          ? "The matched generated candidate has the source pattern package count."
          : "The matched candidate package count differs from the source pattern.",
      evidence: {
        sourcePackageCount: pattern.packageCount,
        matchedCandidatePackageCount:
          matchedCandidate?.metrics.packageCount ?? null,
      },
      mismatches:
        matchedCandidate && !packageCountMatches
          ? [
              {
                path: `${path}.packageCount`,
                expected: pattern.packageCount,
                actual: matchedCandidate.metrics.packageCount,
              },
            ]
          : [],
    }),
    createCorpusCheck({
      id: `${path}.bounds`,
      status: !matchedCandidate ? "SKIPPED" : boundsMatch ? "PASS" : "FAIL",
      summary: !matchedCandidate
        ? "Bounds comparison is deferred because no physical geometry candidate matched."
        : boundsMatch
          ? "Matched candidate bounds equal the corresponding source bounds within the accepted relation tolerance."
          : "Matched candidate bounds exceed the accepted relation tolerance.",
      evidence: {
        expectedBoundsMm: expectedMatchedBounds,
        matchedCandidateBoundsMm: matchedBounds,
        toleranceMm: boundsToleranceMm,
        maximumDifferenceMm: maximumBoundsDifferenceMm,
      },
      mismatches:
        matchedCandidate && !boundsMatch
          ? [
              {
                path: `${path}.boundsMm`,
                expected: expectedMatchedBounds,
                actual: matchedBounds,
              },
            ]
          : [],
    }),
    createCorpusCheck({
      id: `${path}.physical-footprint-orientations`,
      status: !matchedCandidate
        ? "SKIPPED"
        : physicalFootprintsMatch
          ? "PASS"
          : "FAIL",
      summary: !matchedCandidate
        ? "Physical footprint orientation comparison is deferred because no geometry candidate matched."
        : physicalFootprintsMatch
          ? "Matched candidate footprint classes equal the corresponding source footprint classes."
          : "Matched candidate footprint classes differ from the source.",
      evidence: {
        expectedPhysicalFootprintOrientations,
        matchedCandidatePhysicalFootprintOrientations:
          matchedPhysicalFootprintOrientations,
      },
      mismatches:
        matchedCandidate && !physicalFootprintsMatch
          ? [
              {
                path: `${path}.physicalFootprintOrientations`,
                expected: expectedPhysicalFootprintOrientations,
                actual: matchedPhysicalFootprintOrientations,
              },
            ]
          : [],
    }),
    createCorpusCheck({
      id: `${path}.operational-directed-orientations`,
      status: !matchedCandidate
        ? "SKIPPED"
        : orientationsMatch
          ? "PASS"
          : "OBSERVED",
      summary: !matchedCandidate
        ? "Directed orientation comparison is deferred because no physical geometry candidate matched."
        : orientationsMatch
          ? "The physically matched candidate also has the corresponding directed package-yaw histogram."
          : "The physically matched candidate differs in directed package yaw; this remains operational evidence rather than a physical geometry failure.",
      evidence: {
        parityScope: "operational-observation-not-robotics-pass",
        expectedOrientations: expectedMatchedOrientations,
        matchedCandidateOrientations: matchedOrientations,
        sourceRawPlaceOrientations: pattern.placeOrientations,
      },
    }),
    maximumCheck(
      path,
      generatedMaximum,
      pattern.packageCount,
      generationIncomplete,
    ),
  ];

  return {
    sourcePatternOrdinal: pattern.ordinal,
    sourceUniqueLayerId: pattern.sourceUniqueLayerId,
    sourcePackageCount: pattern.packageCount,
    sourceCountRole: "feasible-reference-not-asserted-maximum",
    sourceBoundsMm: pattern.boundsMm,
    sourceOrientations: pattern.orientations,
    sourcePlaceOrientations: pattern.placeOrientations,
    sourcePhysicalFootprintOrientations: pattern.physicalFootprintOrientations,
    physicalFootprintExact: matchRecord(physicalFootprintExact),
    physicalFootprintRobIntegerCompatible: matchRecord(
      physicalFootprintRobIntegerCompatible,
    ),
    operationalDirectedYawExact: matchRecord(operationalDirectedYawExact),
    acceptedMatchKind,
    acceptedSymmetry: acceptedMatch?.symmetry ?? null,
    matchedCandidateRank: matchedCandidate?.rank ?? null,
    matchedCandidateBoundsMm: matchedBounds,
    matchedCandidateOrientations: matchedOrientations,
    matchedCandidatePhysicalFootprintOrientations:
      matchedPhysicalFootprintOrientations,
    maximumCenterDisplacementMm:
      acceptedMatch?.maximumCenterDisplacementMm ?? null,
    maximumBoundsDifferenceMm,
    generatedMaximumPackageCount: generatedMaximum,
    generatedMaximumRelationToSource: relationToSource(
      generatedMaximum,
      pattern.packageCount,
    ),
    checks,
    status: combineStatuses(checks.map(({ status }) => status)),
  };
}

export function skippedScenarioReport(
  scenario: RobCorpusScenario,
): ScenarioComparisonReport {
  const check = createCorpusCheck({
    id: `${scenario.id}.input-availability`,
    status: "SKIPPED",
    summary: scenario.skipReason ?? "The scenario has no solver input.",
    evidence: {
      envelopeSource: scenario.inputSummary.envelopeSource,
    },
  });
  return {
    id: scenario.id,
    basis: scenario.basis,
    input: scenario.inputSummary,
    status: "SKIPPED",
    skipReason: scenario.skipReason,
    solver: null,
    patterns: [],
    checks: [check],
  };
}

export function compareGeneratedSolverResult(
  source: SourceCharacterization,
  scenario: RobCorpusScenario,
  result: SolverResult,
): ScenarioComparisonReport {
  if (!scenario.solverInput) return skippedScenarioReport(scenario);
  const runnableScenario = scenario as RunnableScenario;
  const generatedMaximum = Math.max(
    0,
    ...result.candidates.map(({ metrics }) => metrics.packageCount),
  );
  const generationLimitReached = result.diagnostics.some(
    ({ code }) => code === "generation-limit-reached",
  );
  const generationLimits = result.diagnostics
    .filter(({ code }) => code === "generation-limit-reached")
    .map(({ phase, generator, count }) => ({
      phase,
      generator: generator ?? null,
      count: count ?? null,
    }));
  const checks: CorpusCheck[] = [
    createCorpusCheck({
      id: `${scenario.id}.scenario-basis`,
      status: scenario.inputSummary.observationOnly ? "OBSERVED" : "PASS",
      summary: scenario.inputSummary.observationOnly
        ? "The solver envelope is a measured source observation and is not allowed-overhang policy."
        : "The solver uses encoded pallet dimensions with zero clearance and no policy overhang.",
      evidence: {
        observationOnly: scenario.inputSummary.observationOnly,
        sourcePackageCountConstraintApplied: false,
        allowedOverhangPolicyMm: scenario.inputSummary.allowedOverhangPolicyMm,
      },
    }),
    createCorpusCheck({
      id: `${scenario.id}.solver-completion`,
      status: result.status === "completed" ? "PASS" : "FAIL",
      summary:
        result.status === "completed"
          ? "The solver completed."
          : "The solver was cancelled before producing a complete result.",
      evidence: { solverStatus: result.status },
      mismatches:
        result.status === "completed"
          ? []
          : [
              {
                path: `${scenario.id}.solver.status`,
                expected: "completed",
                actual: result.status,
              },
            ],
    }),
    createCorpusCheck({
      id: `${scenario.id}.generation-completeness`,
      status: generationLimitReached ? "BLOCKED" : "PASS",
      summary: generationLimitReached
        ? "At least one deterministic generator limit was truly reached while another draft was available, so configured-family coverage is incomplete."
        : "No configured generator limit was reached; this exhausts the implemented families but does not prove layout-vocabulary completeness.",
      evidence: {
        generationLimitReached,
        generationLimits,
        generatorVocabularyCompleteness: "Open",
      },
    }),
  ];
  const patterns = source.patterns.map((pattern) =>
    comparePattern(
      source,
      pattern,
      runnableScenario,
      result,
      generatedMaximum,
      generationLimitReached,
    ),
  );

  return {
    id: scenario.id,
    basis: scenario.basis,
    input: scenario.inputSummary,
    status: combineStatuses([
      ...checks.map(({ status }) => status),
      ...patterns.map(({ status }) => status),
    ]),
    skipReason: null,
    solver: {
      status: result.status,
      candidateCount: result.candidates.length,
      generatedMaximumPackageCount: generatedMaximum,
      generationLimitReached,
      diagnostics: result.diagnostics.map(
        ({ severity, phase, code, generator, count }) => ({
          severity,
          phase,
          code,
          generator: generator ?? null,
          count: count ?? null,
        }),
      ),
    },
    patterns,
    checks,
  };
}
