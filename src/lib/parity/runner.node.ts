import { solveLayer } from "~/domain/solver/solve";
import { aggregateRobCorpusReport } from "~/lib/parity/aggregation";
import {
  DEFAULT_ROB_CORPUS_MAX_FILE_BYTES,
  discoverRobCorpus,
} from "~/lib/parity/discovery.node";
import { semanticRobDigest, sha256ByteDigest } from "~/lib/parity/digests.node";
import {
  compareGeneratedSolverResult,
  skippedScenarioReport,
} from "~/lib/parity/generatedComparison";
import { extractRobCorpusScenarios } from "~/lib/parity/inputExtraction";
import { decodeRobBytes, loadRobFileSafely } from "~/lib/parity/loader.node";
import { assertPrivacySafeCorpusReport } from "~/lib/parity/schemas";
import {
  characterizeRobSource,
  sourceCharacterizationReport,
} from "~/lib/parity/sourceCharacterization";
import { sourceGeometryValidationCheck } from "~/lib/parity/sourceValidation";
import { combineStatuses, createCorpusCheck } from "~/lib/parity/status";
import type {
  CorpusCheck,
  CorpusFileReport,
  RobCorpusReport,
  RobCorpusScenario,
  ScenarioComparisonReport,
} from "~/lib/parity/types";
import { parseRobText, serializeRobText } from "~/lib/robParser";

export const DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR = 500;

export type RunExternalRobCorpusOptions = {
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
  maxFileBytes?: number;
  maxCandidatesPerGenerator?: number;
  /** The comparator already checks the complete source symmetry orbit. */
  includeGeneratedSymmetryVariants?: boolean;
  digestSelection?: {
    byteDigestPrefixes: readonly string[];
    anonymizeReportBasenames?: boolean;
  };
  now?: () => Date;
};

function safeErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Unknown error.";
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z]:[\\/][^ ]+/g, "[local-path]")
    .replace(/\/(?:Users|home)\/[^ ]+/gi, "[local-path]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function failedFileReport(input: {
  fileId: string;
  basename: string;
  byteLength: number;
  byteDigestSha256: string | null;
  checks: CorpusCheck[];
  checkId: string;
  summary: string;
  cause: unknown;
}): CorpusFileReport {
  const failedCheck = createCorpusCheck({
    id: input.checkId,
    status: "FAIL",
    summary: input.summary,
    evidence: { error: safeErrorMessage(input.cause) },
    mismatches: [
      {
        path: input.checkId,
        expected: "successful",
        actual: "failed",
      },
    ],
  });
  const checks = [...input.checks, failedCheck];
  return {
    fileId: input.fileId,
    basename: input.basename,
    byteLength: input.byteLength,
    byteDigestSha256: input.byteDigestSha256,
    semanticDigestSha256: null,
    familyId: null,
    status: combineStatuses(checks.map(({ status }) => status)),
    checks,
    source: null,
    scenarios: [],
  };
}

function failedScenarioReport(
  scenario: RobCorpusScenario,
  cause: unknown,
): ScenarioComparisonReport {
  if (!scenario.solverInput) return skippedScenarioReport(scenario);
  const check = createCorpusCheck({
    id: `${scenario.id}.execution`,
    status: "FAIL",
    summary: "The solver scenario could not be executed.",
    evidence: { error: safeErrorMessage(cause) },
    mismatches: [
      {
        path: `${scenario.id}.execution`,
        expected: "successful",
        actual: "failed",
      },
    ],
  });
  return {
    id: scenario.id,
    basis: scenario.basis,
    input: scenario.inputSummary,
    status: "FAIL",
    skipReason: null,
    solver: null,
    patterns: [],
    checks: [check],
  };
}

async function evaluateFile(input: {
  fileId: string;
  file: Awaited<ReturnType<typeof discoverRobCorpus>>["files"][number];
  reportBasename?: string;
  root: Awaited<ReturnType<typeof discoverRobCorpus>>["root"];
  maxFileBytes: number;
  maxCandidatesPerGenerator: number;
  includeGeneratedSymmetryVariants: boolean;
}): Promise<CorpusFileReport> {
  const checks: CorpusCheck[] = [];
  const reportBasename = input.reportBasename ?? input.file.basename;
  let loaded;
  try {
    loaded = await loadRobFileSafely(
      input.root,
      input.file,
      input.maxFileBytes,
    );
  } catch (cause) {
    return failedFileReport({
      fileId: input.fileId,
      basename: reportBasename,
      byteLength: input.file.byteLength,
      byteDigestSha256: null,
      checks,
      checkId: "source.safe-load",
      summary: "The .rob file failed the safe-loading gate.",
      cause,
    });
  }

  const byteDigestSha256 = sha256ByteDigest(loaded.bytes);
  checks.push(
    createCorpusCheck({
      id: "source.safe-load",
      status: "PASS",
      summary:
        "A regular in-root non-symlink .rob file was loaded within the byte limit.",
      evidence: {
        byteLength: loaded.bytes.byteLength,
        byteDigestSha256,
      },
    }),
  );

  let parsed;
  try {
    parsed = parseRobText(decodeRobBytes(loaded.bytes));
  } catch (cause) {
    return failedFileReport({
      fileId: input.fileId,
      basename: reportBasename,
      byteLength: loaded.bytes.byteLength,
      byteDigestSha256,
      checks,
      checkId: "parser.parse",
      summary: "The .rob parser rejected the safely loaded source.",
      cause,
    });
  }

  checks.push(
    createCorpusCheck({
      id: "parser.parse",
      status: "PASS",
      summary: "The safely loaded .rob source parsed successfully.",
      evidence: {
        physicalLayerCount: parsed.layer_count,
        sourcePackageCount: parsed.total_boxes,
      },
    }),
  );
  const semanticDigestSha256 = semanticRobDigest(parsed);

  try {
    const roundTripped = parseRobText(serializeRobText(parsed));
    const roundTripDigest = semanticRobDigest(roundTripped);
    checks.push(
      createCorpusCheck({
        id: "parser.semantic-roundtrip",
        status: roundTripDigest === semanticDigestSha256 ? "PASS" : "FAIL",
        summary:
          roundTripDigest === semanticDigestSha256
            ? "Parser serialization preserves the semantic .rob digest."
            : "Parser serialization changed the semantic .rob digest.",
        evidence: {
          sourceSemanticDigestSha256: semanticDigestSha256,
          roundTripSemanticDigestSha256: roundTripDigest,
        },
        mismatches:
          roundTripDigest === semanticDigestSha256
            ? []
            : [
                {
                  path: "parser.semanticDigestSha256",
                  expected: semanticDigestSha256,
                  actual: roundTripDigest,
                },
              ],
      }),
    );
  } catch (cause) {
    checks.push(
      createCorpusCheck({
        id: "parser.semantic-roundtrip",
        status: "FAIL",
        summary: "The semantic parser roundtrip could not be completed.",
        evidence: { error: safeErrorMessage(cause) },
        mismatches: [
          {
            path: "parser.semantic-roundtrip",
            expected: "successful",
            actual: "failed",
          },
        ],
      }),
    );
  }

  let source;
  try {
    source = characterizeRobSource(parsed);
  } catch (cause) {
    return failedFileReport({
      fileId: input.fileId,
      basename: reportBasename,
      byteLength: loaded.bytes.byteLength,
      byteDigestSha256,
      checks,
      checkId: "source.characterization",
      summary: "The parsed .rob geometry could not be characterized safely.",
      cause,
    });
  }

  checks.push(
    createCorpusCheck({
      id: "input.encoded-fields",
      status: "PASS",
      summary:
        "Solver inputs were extracted only from encoded dimensions and input direction; unencoded policy/resource fields remain explicit unknowns.",
      evidence: {
        packageDimensionsMm: source.encodedInput.packageDimensionsMm,
        palletDimensionsMm: source.encodedInput.palletDimensionsMm,
        inputDirection: source.encodedInput.inputDirection,
        fieldsNotEncoded: [...source.encodedInput.fieldsNotEncoded],
        sourceFeasiblePackageCount:
          source.encodedInput.sourceFeasiblePackageCount,
        sourceFeasibleCountRole: source.encodedInput.sourceFeasibleCountRole,
      },
    }),
    createCorpusCheck({
      id: "source.stack-characterization",
      status: "OBSERVED",
      summary:
        "The exact physical layer sequence, pattern identity/equality, interlayers, package counts, cycle counts, and trailing interlayer were characterized from the source.",
      evidence: {
        sourcePatternIdentitySequence:
          source.stack.sourcePatternIdentitySequence,
        patternEqualitySequence: source.stack.patternEqualitySequence,
        packagesPerPhysicalLayer: source.stack.packagesPerPhysicalLayer,
        cyclesPerPhysicalLayer: source.stack.cyclesPerPhysicalLayer,
        interlayersBeforePhysicalLayers:
          source.stack.interlayersBeforePhysicalLayers,
        trailingInterlayer: source.stack.trailingInterlayer,
      },
    }),
    createCorpusCheck({
      id: "source.robotics-observation",
      status: "OBSERVED",
      summary:
        "Source grip and cycle metrics are reported as observations, not solver parity.",
      evidence: {
        parityScope: "Open",
        sourceGripCountsByPattern: source.robotics.sourceGripCountsByPattern,
        sourceCyclesPerPhysicalLayer:
          source.robotics.sourceCyclesPerPhysicalLayer,
      },
    }),
    createCorpusCheck({
      id: "generated.robotics-parity",
      status: "BLOCKED",
      summary:
        "Generated grip/cycle parity is blocked until group planning supplies comparable robot cycles.",
      evidence: {
        parityScope: "Open",
        blockedBy: "group-planning",
      },
    }),
    createCorpusCheck({
      id: "generated.stack-parity",
      status: "BLOCKED",
      summary:
        "Generated physical-stack parity is blocked until generated patterns are composed into an explicit stack sequence.",
      evidence: {
        blockedBy: "generated-stack-composition",
        sourceStackStillCharacterized: true,
      },
    }),
  );

  const extractedScenarios = extractRobCorpusScenarios(source, {
    maxCandidatesPerGenerator: input.maxCandidatesPerGenerator,
  });
  checks.push(sourceGeometryValidationCheck(source, extractedScenarios));
  const scenarios = extractedScenarios.map((scenario) => {
    if (!scenario.solverInput) return skippedScenarioReport(scenario);
    try {
      return compareGeneratedSolverResult(
        source,
        scenario,
        solveLayer(scenario.solverInput, {
          includeSymmetryVariants: input.includeGeneratedSymmetryVariants,
        }),
      );
    } catch (cause) {
      return failedScenarioReport(scenario, cause);
    }
  });

  return {
    fileId: input.fileId,
    basename: reportBasename,
    byteLength: loaded.bytes.byteLength,
    byteDigestSha256,
    semanticDigestSha256,
    familyId: source.family.id,
    status: combineStatuses([
      ...checks.map(({ status }) => status),
      ...scenarios.map(({ status }) => status),
    ]),
    checks,
    source: sourceCharacterizationReport(source),
    scenarios,
  };
}

function validatedDigestPrefixes(prefixes: readonly string[]): string[] {
  if (prefixes.length === 0) {
    throw new Error("Digest selection requires at least one SHA-256 prefix.");
  }
  const normalized = prefixes.map((prefix) => prefix.toLowerCase());
  if (normalized.some((prefix) => !/^[a-f0-9]{12,64}$/.test(prefix))) {
    throw new Error(
      "Every digest selection prefix must contain 12 to 64 lowercase SHA-256 hex characters.",
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Digest selection prefixes must be unique.");
  }
  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < normalized.length;
      rightIndex += 1
    ) {
      const left = normalized[leftIndex]!;
      const right = normalized[rightIndex]!;
      if (left.startsWith(right) || right.startsWith(left)) {
        throw new Error(
          "Digest selection prefixes must not overlap or contain one another.",
        );
      }
    }
  }
  return normalized;
}

async function selectFilesByByteDigest(
  discovery: Awaited<ReturnType<typeof discoverRobCorpus>>,
  prefixesInput: readonly string[],
  maxFileBytes: number,
): Promise<
  Array<Awaited<ReturnType<typeof discoverRobCorpus>>["files"][number]>
> {
  const prefixes = validatedDigestPrefixes(prefixesInput);
  const selected = new Map<
    string,
    {
      digest: string;
      file: Awaited<ReturnType<typeof discoverRobCorpus>>["files"][number];
    }
  >();
  for (const file of discovery.files) {
    const loaded = await loadRobFileSafely(discovery.root, file, maxFileBytes);
    const digest = sha256ByteDigest(loaded.bytes);
    for (const prefix of prefixes) {
      if (!digest.startsWith(prefix)) continue;
      const existing = selected.get(prefix);
      if (existing && existing.digest !== digest) {
        throw new Error(
          `Digest selection prefix ${prefix} is ambiguous within the configured corpus.`,
        );
      }
      if (!existing) selected.set(prefix, { digest, file });
    }
  }
  const missing = prefixes.filter((prefix) => !selected.has(prefix));
  if (missing.length > 0) {
    throw new Error(
      `The configured corpus is missing ${missing.length} required digest selection case(s).`,
    );
  }
  return prefixes.map((prefix) => selected.get(prefix)!.file);
}

export async function runExternalRobCorpus(
  options: RunExternalRobCorpusOptions = {},
): Promise<RobCorpusReport> {
  const maxFileBytes =
    options.maxFileBytes ?? DEFAULT_ROB_CORPUS_MAX_FILE_BYTES;
  const maxCandidatesPerGenerator =
    options.maxCandidatesPerGenerator ??
    DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR;
  const includeGeneratedSymmetryVariants =
    options.includeGeneratedSymmetryVariants ?? false;
  if (
    !Number.isInteger(maxCandidatesPerGenerator) ||
    maxCandidatesPerGenerator <= 0
  ) {
    throw new Error("maxCandidatesPerGenerator must be a positive integer.");
  }

  const discovery = await discoverRobCorpus({
    root: options.root,
    env: options.env,
    maxFileBytes,
  });
  const selectedFiles = options.digestSelection
    ? await selectFilesByByteDigest(
        discovery,
        options.digestSelection.byteDigestPrefixes,
        maxFileBytes,
      )
    : discovery.files;
  const files: CorpusFileReport[] = [];
  for (let index = 0; index < selectedFiles.length; index += 1) {
    files.push(
      await evaluateFile({
        fileId: `file-${index + 1}`,
        file: selectedFiles[index]!,
        reportBasename:
          options.digestSelection?.anonymizeReportBasenames === true
            ? `sentinel-case-${String(index + 1).padStart(2, "0")}.rob`
            : undefined,
        root: discovery.root,
        maxFileBytes,
        maxCandidatesPerGenerator,
        includeGeneratedSymmetryVariants,
      }),
    );
  }

  return assertPrivacySafeCorpusReport(
    aggregateRobCorpusReport(files, {
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      maxFileBytes,
      maxCandidatesPerGenerator,
      generatedSymmetryVariants: includeGeneratedSymmetryVariants,
      discoveredFileCount: selectedFiles.length,
      discoveryIssues: options.digestSelection ? [] : discovery.issues,
    }),
  );
}
