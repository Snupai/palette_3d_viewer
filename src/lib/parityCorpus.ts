import legacyImportCase from "~/lib/__fixtures__/anonymized-plan.golden.json";
import observedAp5006Case from "~/lib/__fixtures__/parity/ap5006-1329-00004.observed.parity.json";
import syntheticAlternatingStackCase from "~/lib/__fixtures__/parity/synthetic-alternating-stack.parity.json";
import syntheticIdentityVariantsCase from "~/lib/__fixtures__/parity/synthetic-identity-variants.parity.json";
import syntheticSquareGridCase from "~/lib/__fixtures__/parity/synthetic-square-grid.parity.json";
import { parseRobText, serializeRobText } from "~/lib/robParser";
import {
  collectParityMismatches,
  PARITY_SCORECARD_DIMENSIONS,
  parityCaseSchema,
  semanticRobPlanFingerprint,
  summarizeRobPlan,
  type ParityCandidateSetValue,
  type ParityCase,
  type ParityCaseV2,
  type ParityEvidenceStatus,
  type ParityMismatch,
  type ParityScorecardDimensionName,
  type ParityValue,
  type RobPlanSummary,
} from "~/lib/parityGoldenCase";

export type ParityCorpusSource = {
  source: string;
  value: unknown;
};

export type ParityCorpusDiagnostic = {
  source: string;
  code: "invalid-case" | "duplicate-case-id";
  path: (string | number)[];
  message: string;
};

export type ParityCorpus = {
  cases: ParityCase[];
  sourceByCaseId: Record<string, string>;
  diagnostics: ParityCorpusDiagnostic[];
};

export const BUILT_IN_PARITY_CASE_SOURCES: readonly ParityCorpusSource[] = [
  {
    source: "src/lib/__fixtures__/anonymized-plan.golden.json",
    value: legacyImportCase,
  },
  {
    source:
      "src/lib/__fixtures__/parity/ap5006-1329-00004.observed.parity.json",
    value: observedAp5006Case,
  },
  {
    source:
      "src/lib/__fixtures__/parity/synthetic-alternating-stack.parity.json",
    value: syntheticAlternatingStackCase,
  },
  {
    source:
      "src/lib/__fixtures__/parity/synthetic-identity-variants.parity.json",
    value: syntheticIdentityVariantsCase,
  },
  {
    source: "src/lib/__fixtures__/parity/synthetic-square-grid.parity.json",
    value: syntheticSquareGridCase,
  },
];

/**
 * Validates and deterministically orders a corpus supplied by tests, the app,
 * or another public-data adapter. Invalid documents are diagnosed, not hidden.
 */
export function discoverParityCorpus(
  sources: readonly ParityCorpusSource[],
): ParityCorpus {
  const diagnostics: ParityCorpusDiagnostic[] = [];
  const cases: Array<{ parityCase: ParityCase; source: string }> = [];

  for (const source of sources) {
    const result = parityCaseSchema.safeParse(source.value);
    if (!result.success) {
      diagnostics.push(
        ...result.error.issues.map((issue) => ({
          source: source.source,
          code: "invalid-case" as const,
          path: issue.path,
          message: issue.message,
        })),
      );
      continue;
    }
    cases.push({ parityCase: result.data, source: source.source });
  }

  const firstSourceById = new Map<string, string>();
  const uniqueCases: Array<{ parityCase: ParityCase; source: string }> = [];
  for (const entry of cases) {
    const existingSource = firstSourceById.get(entry.parityCase.id);
    if (existingSource) {
      diagnostics.push({
        source: entry.source,
        code: "duplicate-case-id",
        path: ["id"],
        message: `case id "${entry.parityCase.id}" is already declared by ${existingSource}`,
      });
      continue;
    }
    firstSourceById.set(entry.parityCase.id, entry.source);
    uniqueCases.push(entry);
  }

  uniqueCases.sort((left, right) =>
    left.parityCase.id < right.parityCase.id
      ? -1
      : left.parityCase.id > right.parityCase.id
        ? 1
        : 0,
  );

  return {
    cases: uniqueCases.map(({ parityCase }) => parityCase),
    sourceByCaseId: Object.fromEntries(
      uniqueCases.map(({ parityCase, source }) => [parityCase.id, source]),
    ),
    diagnostics,
  };
}

export function loadBuiltInParityCorpus(): ParityCorpus {
  return discoverParityCorpus(BUILT_IN_PARITY_CASE_SOURCES);
}

export type ParityImportObservation = {
  summary: RobPlanSummary;
  semanticRoundTrip?: boolean;
};

export type ParityCaseObservation = {
  /** Public or user-supplied text; the corpus never reaches into private paths. */
  robText?: string;
  importBaseline?: ParityImportObservation;
  candidates?: ParityCandidateSetValue;
  metrics?: Record<string, ParityValue>;
};

export type ParityCheckOutcome = "matched" | "mismatched" | "not-run";

export type ParityCaseCheck = {
  path: string;
  evidenceStatus: ParityEvidenceStatus;
  outcome: ParityCheckOutcome;
  mismatches: ParityMismatch[];
};

export type ParityCaseResult = {
  parityCase: ParityCase;
  checks: ParityCaseCheck[];
  mismatches: ParityMismatch[];
  complete: boolean;
  hasGoldenRegression: boolean;
  executionError: string | null;
};

function observationFromRobText(rawText: string): ParityImportObservation {
  const parsed = parseRobText(rawText);
  const roundTripped = parseRobText(serializeRobText(parsed));
  return {
    summary: summarizeRobPlan(parsed),
    semanticRoundTrip:
      semanticRobPlanFingerprint(parsed) ===
      semanticRobPlanFingerprint(roundTripped),
  };
}

function appendExpectedMismatches(
  expected: unknown,
  actual: unknown,
  path: string,
  mismatches: ParityMismatch[],
): void {
  if (Object.is(expected, actual)) return;

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      appendExpectedMismatches(
        expected[index],
        actual[index],
        `${path}[${index}]`,
        mismatches,
      );
    }
    return;
  }

  if (
    typeof expected === "object" &&
    expected !== null &&
    !Array.isArray(expected) &&
    typeof actual === "object" &&
    actual !== null &&
    !Array.isArray(actual)
  ) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    for (const key of Object.keys(expectedRecord)) {
      appendExpectedMismatches(
        expectedRecord[key],
        actualRecord[key],
        path === "" ? key : `${path}.${key}`,
        mismatches,
      );
    }
    return;
  }

  mismatches.push({ path, expected, actual });
}

/** Partial-object comparison with exact arrays and exact diagnostic paths. */
export function collectExpectedParityMismatches(
  expected: unknown,
  actual: unknown,
  path = "",
): ParityMismatch[] {
  const mismatches: ParityMismatch[] = [];
  appendExpectedMismatches(expected, actual, path, mismatches);
  return mismatches;
}

function check(
  path: string,
  evidenceStatus: ParityEvidenceStatus,
  actualAvailable: boolean,
  compare: () => ParityMismatch[],
): ParityCaseCheck {
  if (!actualAvailable) {
    return { path, evidenceStatus, outcome: "not-run", mismatches: [] };
  }
  const mismatches = compare();
  return {
    path,
    evidenceStatus,
    outcome: mismatches.length === 0 ? "matched" : "mismatched",
    mismatches,
  };
}

function candidateExpectedComparable(
  value: ParityCandidateSetValue,
): Record<string, unknown> {
  return {
    ...(value.identitySchemaVersion === null
      ? {}
      : { identitySchemaVersion: value.identitySchemaVersion }),
    ...(value.geometryEqualitySchemaVersion === null
      ? {}
      : { geometryEqualitySchemaVersion: value.geometryEqualitySchemaVersion }),
    ...(value.totalCandidates === undefined
      ? {}
      : { totalCandidates: value.totalCandidates }),
    ...(value.orderedCandidateIds === undefined
      ? {}
      : { orderedCandidateIds: value.orderedCandidateIds }),
    ...(value.candidates === undefined ? {} : { candidates: value.candidates }),
  };
}

function metricMismatch(
  path: string,
  expected: ParityValue,
  actual: ParityValue | undefined,
  tolerance: number | undefined,
): ParityMismatch[] {
  if (
    tolerance !== undefined &&
    typeof expected === "number" &&
    typeof actual === "number" &&
    Math.abs(expected - actual) <= tolerance
  ) {
    return [];
  }
  return collectExpectedParityMismatches(expected, actual, path);
}

function evaluateLegacyCase(
  parityCase: Extract<ParityCase, { schemaVersion: 1 }>,
  observation: ParityCaseObservation | undefined,
): ParityCaseCheck[] {
  const importObservation = observation?.robText
    ? observationFromRobText(observation.robText)
    : observation?.importBaseline;

  return [
    check("importBaseline", "Golden", importObservation !== undefined, () => {
      if (!importObservation) return [];
      const mismatches = collectParityMismatches(
        parityCase.expected,
        importObservation.summary,
      );
      if (
        parityCase.requirements.semanticRoundTrip &&
        importObservation.semanticRoundTrip !== true
      ) {
        mismatches.push({
          path: "requirements.semanticRoundTrip",
          expected: true,
          actual: importObservation.semanticRoundTrip,
        });
      }
      return mismatches;
    }),
  ];
}

function evaluateV2Case(
  parityCase: ParityCaseV2,
  observation: ParityCaseObservation | undefined,
): ParityCaseCheck[] {
  const checks: ParityCaseCheck[] = [];
  const importObservation = observation?.robText
    ? observationFromRobText(observation.robText)
    : observation?.importBaseline;

  if (parityCase.expected.importBaseline) {
    const expectation = parityCase.expected.importBaseline;
    checks.push(
      check(
        "importBaseline",
        expectation.evidence.status,
        importObservation !== undefined,
        () => {
          if (!importObservation) return [];
          const mismatches = collectExpectedParityMismatches(
            expectation.summary,
            importObservation.summary,
            "importBaseline",
          );
          if (
            expectation.semanticRoundTrip !== undefined &&
            expectation.semanticRoundTrip !==
              importObservation.semanticRoundTrip
          ) {
            mismatches.push({
              path: "importBaseline.semanticRoundTrip",
              expected: expectation.semanticRoundTrip,
              actual: importObservation.semanticRoundTrip,
            });
          }
          return mismatches;
        },
      ),
    );
  }

  if (parityCase.expected.candidates) {
    const expectation = parityCase.expected.candidates;
    checks.push(
      check(
        "candidates",
        expectation.evidence.status,
        observation?.candidates !== undefined,
        () =>
          collectExpectedParityMismatches(
            candidateExpectedComparable(expectation.value),
            observation?.candidates,
            "candidates",
          ),
      ),
    );
  }

  for (const [metricName, expectation] of Object.entries(
    parityCase.expected.metrics ?? {},
  )) {
    if (expectation.value === undefined) continue;
    const hasMetric = Object.hasOwn(observation?.metrics ?? {}, metricName);
    checks.push(
      check(
        `metrics.${metricName}`,
        expectation.evidence.status,
        hasMetric,
        () =>
          metricMismatch(
            `metrics.${metricName}`,
            expectation.value!,
            observation?.metrics?.[metricName],
            expectation.tolerance,
          ),
      ),
    );
  }

  return checks;
}

export function evaluateParityCase(
  parityCaseInput: unknown,
  observation?: ParityCaseObservation,
  executionError: string | null = null,
): ParityCaseResult {
  const parityCase = parityCaseSchema.parse(parityCaseInput);
  const checks =
    parityCase.schemaVersion === 1
      ? evaluateLegacyCase(parityCase, observation)
      : evaluateV2Case(parityCase, observation);
  const mismatches = checks.flatMap(({ mismatches }) => mismatches);
  const goldenChecks = checks.filter(
    ({ evidenceStatus }) => evidenceStatus === "Golden",
  );

  return {
    parityCase,
    checks,
    mismatches,
    complete:
      executionError === null &&
      goldenChecks.every(({ outcome }) => outcome !== "not-run"),
    hasGoldenRegression: goldenChecks.some(
      ({ outcome }) => outcome === "mismatched",
    ),
    executionError,
  };
}

export type ParityCaseExecutor = (
  parityCase: ParityCase,
) =>
  | ParityCaseObservation
  | undefined
  | Promise<ParityCaseObservation | undefined>;

export type AggregateParityMismatch = ParityMismatch & {
  caseId: string;
  evidenceStatus: ParityEvidenceStatus;
};

export type ParityScorecardAggregate = Record<
  ParityScorecardDimensionName,
  {
    Golden: number;
    Observed: number;
    Open: number;
    applicableCases: number;
    notApplicableCases: number;
  }
>;

export type ParityCorpusReport = {
  results: ParityCaseResult[];
  mismatches: AggregateParityMismatch[];
  scorecard: ParityScorecardAggregate;
  summary: {
    totalCases: number;
    completeCases: number;
    casesWithGoldenRegression: number;
    mismatchCount: number;
    goldenMismatchCount: number;
    observedMismatchCount: number;
    openMismatchCount: number;
    notRunCheckCount: number;
    executionErrorCount: number;
  };
};

const legacyScorecard: Record<
  ParityScorecardDimensionName,
  { status: ParityEvidenceStatus; applicable: boolean }
> = {
  input: { status: "Golden", applicable: true },
  geometry: { status: "Golden", applicable: true },
  diversity: { status: "Open", applicable: false },
  ranking: { status: "Open", applicable: false },
  stack: { status: "Golden", applicable: true },
  robotics: { status: "Golden", applicable: true },
  export: { status: "Golden", applicable: true },
  usability: { status: "Open", applicable: false },
  performance: { status: "Open", applicable: false },
};

function scorecardForCase(parityCase: ParityCase) {
  return parityCase.schemaVersion === 1
    ? legacyScorecard
    : parityCase.scorecard;
}

export function aggregateParityResults(
  results: readonly ParityCaseResult[],
): ParityCorpusReport {
  const scorecard = Object.fromEntries(
    PARITY_SCORECARD_DIMENSIONS.map((dimension) => [
      dimension,
      {
        Golden: 0,
        Observed: 0,
        Open: 0,
        applicableCases: 0,
        notApplicableCases: 0,
      },
    ]),
  ) as ParityScorecardAggregate;

  for (const result of results) {
    const caseScorecard = scorecardForCase(result.parityCase);
    for (const dimension of PARITY_SCORECARD_DIMENSIONS) {
      const entry = caseScorecard[dimension];
      scorecard[dimension][entry.status] += 1;
      if (entry.applicable) scorecard[dimension].applicableCases += 1;
      else scorecard[dimension].notApplicableCases += 1;
    }
  }

  const mismatches = results.flatMap((result) =>
    result.checks.flatMap((checkResult) =>
      checkResult.mismatches.map((mismatch) => ({
        caseId: result.parityCase.id,
        evidenceStatus: checkResult.evidenceStatus,
        ...mismatch,
      })),
    ),
  );

  const mismatchCount = mismatches.length;
  return {
    results: [...results],
    mismatches,
    scorecard,
    summary: {
      totalCases: results.length,
      completeCases: results.filter(({ complete }) => complete).length,
      casesWithGoldenRegression: results.filter(
        ({ hasGoldenRegression }) => hasGoldenRegression,
      ).length,
      mismatchCount,
      goldenMismatchCount: mismatches.filter(
        ({ evidenceStatus }) => evidenceStatus === "Golden",
      ).length,
      observedMismatchCount: mismatches.filter(
        ({ evidenceStatus }) => evidenceStatus === "Observed",
      ).length,
      openMismatchCount: mismatches.filter(
        ({ evidenceStatus }) => evidenceStatus === "Open",
      ).length,
      notRunCheckCount: results.reduce(
        (count, result) =>
          count +
          result.checks.filter(({ outcome }) => outcome === "not-run").length,
        0,
      ),
      executionErrorCount: results.filter(
        ({ executionError }) => executionError !== null,
      ).length,
    },
  };
}

export async function runParityCorpus(
  corpus: ParityCorpus | readonly ParityCase[],
  executor?: ParityCaseExecutor,
): Promise<ParityCorpusReport> {
  const cases: readonly ParityCase[] = Array.isArray(corpus)
    ? corpus
    : (corpus as ParityCorpus).cases;
  const results = await Promise.all(
    cases.map(async (parityCase) => {
      if (!executor) return evaluateParityCase(parityCase);
      try {
        return evaluateParityCase(parityCase, await executor(parityCase));
      } catch (cause) {
        return evaluateParityCase(
          parityCase,
          undefined,
          cause instanceof Error ? cause.message : "Parity execution failed.",
        );
      }
    }),
  );
  return aggregateParityResults(results);
}
