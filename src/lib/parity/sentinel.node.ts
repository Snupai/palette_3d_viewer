import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { runExternalRobCorpus } from "~/lib/parity/runner.node";
import type { RobCorpusReport } from "~/lib/parity/types";

export const DEFAULT_ROB_SENTINEL_MAX_CANDIDATES_PER_GENERATOR = 100_000;

const digestPrefixSchema = z.string().regex(/^[a-f0-9]{12,64}$/);
const sentinelManifestSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    digestPrefixLength: z.number().int().min(12).max(64),
    privacy: z
      .object({
        absolutePathsStored: z.literal(false),
        sourceTextStored: z.literal(false),
        fileNamesStored: z.literal(false),
      })
      .passthrough(),
    selection: z
      .object({
        caseCount: z.number().int().positive(),
        stableIdentity: z.literal("sha256-byte-digest"),
      })
      .passthrough(),
    cases: z
      .array(
        z
          .object({
            byteDigestPrefix: digestPrefixSchema,
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()
  .superRefine((manifest, context) => {
    if (manifest.selection.caseCount !== manifest.cases.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selection", "caseCount"],
        message: "caseCount must equal the number of manifest cases.",
      });
    }
    const prefixes = manifest.cases.map(({ byteDigestPrefix }) =>
      byteDigestPrefix.toLowerCase(),
    );
    if (new Set(prefixes).size !== prefixes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases"],
        message: "Manifest byte digest prefixes must be unique.",
      });
    }
    if (
      prefixes.some((prefix) => prefix.length !== manifest.digestPrefixLength)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["digestPrefixLength"],
        message: "Every byte digest prefix must use digestPrefixLength.",
      });
    }
  });

export type RobCorpusSentinelManifest = z.infer<typeof sentinelManifestSchema>;

export type RunRobCorpusSentinelOptions = {
  root?: string;
  env?: Readonly<Record<string, string | undefined>>;
  manifestPath?: string;
  workingDirectory?: string;
  maxCandidatesPerGenerator?: number;
  now?: () => Date;
};

export type RobCorpusSentinelSummary = {
  selectedCases: number;
  sourcePatternBlocks: number;
  patternComparisons: number;
  nominalComparisons: number;
  observedEnvelopeComparisons: number;
  physicalFootprintExact: number;
  physicalFootprintRobIntegerCompatible: number;
  operationalDirectedYawExact: number;
  acceptedPhysicalMatches: number;
  acceptedPhysicalExact: number;
  acceptedRobIntegerCompatible: number;
  nominalAcceptedPhysicalMatches: number;
  observedEnvelopeAcceptedPhysicalMatches: number;
  unmatchedPhysicalComparisons: number;
  totalSolverCandidates: number;
  executionFailureCount: number;
  generatorTruncations: Array<{
    phase: string;
    generator: string | null;
    count: number | null;
    occurrences: number;
  }>;
};

export type RobCorpusSentinelRun = {
  manifest: {
    schemaVersion: number;
    digestPrefixLength: number;
    caseCount: number;
    stableIdentity: "sha256-byte-digest";
  };
  summary: RobCorpusSentinelSummary;
  report: RobCorpusReport;
};

async function parseManifestFile(
  manifestPath: string,
): Promise<RobCorpusSentinelManifest> {
  const stat = await lstat(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(
      "The ROB sentinel manifest must be a regular non-symlink file.",
    );
  }
  const text = await readFile(manifestPath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The ROB sentinel manifest is not valid JSON.");
  }
  return sentinelManifestSchema.parse(value);
}

async function discoverSentinelManifest(
  workingDirectory: string,
): Promise<RobCorpusSentinelManifest> {
  const artifactDirectory = resolve(workingDirectory, ".rob-corpus");
  let entries;
  try {
    entries = await readdir(artifactDirectory, { withFileTypes: true });
  } catch {
    throw new Error(
      "No local .rob-corpus artifact directory is available; set ROB_CORPUS_SENTINEL_MANIFEST to an absolute manifest path.",
    );
  }

  const manifests: RobCorpusSentinelManifest[] = [];
  for (const entry of [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
    const path = resolve(artifactDirectory, entry.name);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const value = JSON.parse(await readFile(path, "utf8")) as unknown;
      const parsed = sentinelManifestSchema.safeParse(value);
      if (parsed.success) manifests.push(parsed.data);
    } catch {
      // Other local reports are intentionally ignored during schema discovery.
    }
  }
  if (manifests.length === 0) {
    throw new Error(
      "No hash-only ROB sentinel manifest was discovered; set ROB_CORPUS_SENTINEL_MANIFEST to an absolute manifest path.",
    );
  }
  if (manifests.length > 1) {
    throw new Error(
      "Multiple hash-only ROB sentinel manifests were discovered; set ROB_CORPUS_SENTINEL_MANIFEST explicitly.",
    );
  }
  return manifests[0]!;
}

async function resolveSentinelManifest(
  options: RunRobCorpusSentinelOptions,
): Promise<RobCorpusSentinelManifest> {
  const env = options.env ?? process.env;
  const configuredPath =
    options.manifestPath ?? env.ROB_CORPUS_SENTINEL_MANIFEST;
  if (configuredPath !== undefined) {
    if (!isAbsolute(configuredPath)) {
      throw new Error("The ROB sentinel manifest path must be absolute.");
    }
    return parseManifestFile(resolve(configuredPath));
  }
  return discoverSentinelManifest(
    resolve(options.workingDirectory ?? process.cwd()),
  );
}

export function summarizeRobCorpusSentinelReport(
  report: RobCorpusReport,
): RobCorpusSentinelSummary {
  let sourcePatternBlocks = 0;
  let patternComparisons = 0;
  let nominalComparisons = 0;
  let observedEnvelopeComparisons = 0;
  let physicalFootprintExact = 0;
  let physicalFootprintRobIntegerCompatible = 0;
  let operationalDirectedYawExact = 0;
  let acceptedPhysicalMatches = 0;
  let acceptedPhysicalExact = 0;
  let acceptedRobIntegerCompatible = 0;
  let nominalAcceptedPhysicalMatches = 0;
  let observedEnvelopeAcceptedPhysicalMatches = 0;
  let totalSolverCandidates = 0;
  let executionFailureCount = 0;
  const truncations = new Map<
    string,
    RobCorpusSentinelSummary["generatorTruncations"][number]
  >();

  for (const file of report.files) {
    sourcePatternBlocks += file.source?.patterns.length ?? 0;
    executionFailureCount += file.checks.filter(
      ({ status }) => status === "FAIL",
    ).length;
    for (const scenario of file.scenarios) {
      executionFailureCount += scenario.checks.filter(
        ({ status }) => status === "FAIL",
      ).length;
      totalSolverCandidates += scenario.solver?.candidateCount ?? 0;
      for (const diagnostic of scenario.solver?.diagnostics ?? []) {
        if (diagnostic.code !== "generation-limit-reached") continue;
        const key = `${diagnostic.phase}:${diagnostic.generator ?? ""}:${diagnostic.count ?? ""}`;
        const existing = truncations.get(key);
        if (existing) {
          existing.occurrences += 1;
        } else {
          truncations.set(key, {
            phase: diagnostic.phase,
            generator: diagnostic.generator,
            count: diagnostic.count,
            occurrences: 1,
          });
        }
      }
      for (const pattern of scenario.patterns) {
        executionFailureCount += pattern.checks.filter(
          ({ status }) => status === "FAIL",
        ).length;
        patternComparisons += 1;
        if (scenario.id === "nominal-strict-v1") {
          nominalComparisons += 1;
        } else {
          observedEnvelopeComparisons += 1;
        }
        if (pattern.physicalFootprintExact.matched) {
          physicalFootprintExact += 1;
        }
        if (pattern.physicalFootprintRobIntegerCompatible.matched) {
          physicalFootprintRobIntegerCompatible += 1;
        }
        if (pattern.operationalDirectedYawExact.matched) {
          operationalDirectedYawExact += 1;
        }
        if (pattern.acceptedMatchKind) {
          acceptedPhysicalMatches += 1;
          if (scenario.id === "nominal-strict-v1") {
            nominalAcceptedPhysicalMatches += 1;
          } else {
            observedEnvelopeAcceptedPhysicalMatches += 1;
          }
        }
        if (pattern.acceptedMatchKind === "physical-footprint-exact") {
          acceptedPhysicalExact += 1;
        }
        if (
          pattern.acceptedMatchKind ===
          "physical-footprint-rob-integer-compatible"
        ) {
          acceptedRobIntegerCompatible += 1;
        }
      }
    }
  }

  return {
    selectedCases: report.files.length,
    sourcePatternBlocks,
    patternComparisons,
    nominalComparisons,
    observedEnvelopeComparisons,
    physicalFootprintExact,
    physicalFootprintRobIntegerCompatible,
    operationalDirectedYawExact,
    acceptedPhysicalMatches,
    acceptedPhysicalExact,
    acceptedRobIntegerCompatible,
    nominalAcceptedPhysicalMatches,
    observedEnvelopeAcceptedPhysicalMatches,
    unmatchedPhysicalComparisons: patternComparisons - acceptedPhysicalMatches,
    totalSolverCandidates,
    executionFailureCount,
    generatorTruncations: [...truncations.values()].sort(
      (left, right) =>
        left.phase.localeCompare(right.phase) ||
        (left.generator ?? "").localeCompare(right.generator ?? "") ||
        (left.count ?? -1) - (right.count ?? -1),
    ),
  };
}

export async function runRobCorpusSentinel(
  options: RunRobCorpusSentinelOptions = {},
): Promise<RobCorpusSentinelRun> {
  const manifest = await resolveSentinelManifest(options);
  const report = await runExternalRobCorpus({
    root: options.root,
    env: options.env,
    maxCandidatesPerGenerator:
      options.maxCandidatesPerGenerator ??
      DEFAULT_ROB_SENTINEL_MAX_CANDIDATES_PER_GENERATOR,
    includeGeneratedSymmetryVariants: false,
    digestSelection: {
      byteDigestPrefixes: manifest.cases.map(
        ({ byteDigestPrefix }) => byteDigestPrefix,
      ),
      anonymizeReportBasenames: true,
    },
    now: options.now,
  });
  if (report.files.length !== manifest.selection.caseCount) {
    throw new Error(
      "The ROB sentinel report case count differs from the manifest.",
    );
  }
  const unmatchedPrefixes = new Set(
    manifest.cases.map(({ byteDigestPrefix }) => byteDigestPrefix),
  );
  for (const file of report.files) {
    const matches = [...unmatchedPrefixes].filter((prefix) =>
      file.byteDigestSha256?.startsWith(prefix),
    );
    if (matches.length !== 1) {
      throw new Error(
        "A ROB sentinel report digest does not match exactly one manifest case.",
      );
    }
    unmatchedPrefixes.delete(matches[0]!);
  }
  if (unmatchedPrefixes.size > 0) {
    throw new Error("The ROB sentinel report omitted a manifest case.");
  }

  return {
    manifest: {
      schemaVersion: manifest.schemaVersion,
      digestPrefixLength: manifest.digestPrefixLength,
      caseCount: manifest.selection.caseCount,
      stableIdentity: manifest.selection.stableIdentity,
    },
    summary: summarizeRobCorpusSentinelReport(report),
    report,
  };
}
