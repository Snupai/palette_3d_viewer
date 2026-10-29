import { combineStatuses, countStatuses } from "~/lib/parity/status";
import {
  CORPUS_REPORT_SCHEMA_VERSION,
  ROB_CORPUS_SCENARIO_IDS,
  type CorpusCheck,
  type CorpusDiscoveryIssue,
  type CorpusFamilyAggregate,
  type CorpusFileReport,
  type DuplicateDigestGroup,
  type RobCorpusReport,
} from "~/lib/parity/types";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function checksForFile(file: CorpusFileReport): CorpusCheck[] {
  return [
    ...file.checks,
    ...file.scenarios.flatMap((scenario) => [
      ...scenario.checks,
      ...scenario.patterns.flatMap(({ checks }) => checks),
    ]),
  ];
}

export function groupDuplicateDigests(
  files: readonly CorpusFileReport[],
  selector: (file: CorpusFileReport) => string | null,
): DuplicateDigestGroup[] {
  const fileIdsByDigest = new Map<string, string[]>();
  for (const file of files) {
    const digest = selector(file);
    if (!digest) continue;
    const fileIds = fileIdsByDigest.get(digest) ?? [];
    fileIds.push(file.fileId);
    fileIdsByDigest.set(digest, fileIds);
  }
  return [...fileIdsByDigest.entries()]
    .filter(([, fileIds]) => fileIds.length > 1)
    .map(([digestSha256, fileIds]) => ({
      digestSha256,
      fileIds: [...fileIds].sort(compareStrings),
      count: fileIds.length,
    }))
    .sort((left, right) =>
      compareStrings(left.digestSha256, right.digestSha256),
    );
}

function aggregateFamilies(
  files: readonly CorpusFileReport[],
): CorpusFamilyAggregate[] {
  const filesByFamily = new Map<string, CorpusFileReport[]>();
  for (const file of files) {
    if (!file.source) continue;
    const familyFiles = filesByFamily.get(file.source.family.id) ?? [];
    familyFiles.push(file);
    filesByFamily.set(file.source.family.id, familyFiles);
  }

  return [...filesByFamily.entries()]
    .map(([, familyFiles]) => {
      const first = familyFiles[0]!;
      const checks = familyFiles.flatMap(checksForFile);
      const scenarioStatuses = familyFiles.flatMap(({ scenarios }) =>
        scenarios.map(({ status }) => status),
      );
      return {
        family: first.source!.family,
        fileIds: familyFiles.map(({ fileId }) => fileId).sort(compareStrings),
        status: combineStatuses(familyFiles.map(({ status }) => status)),
        fileStatusCounts: countStatuses(
          familyFiles.map(({ status }) => status),
        ),
        checkStatusCounts: countStatuses(checks.map(({ status }) => status)),
        scenarioStatusCounts: countStatuses(scenarioStatuses),
      } satisfies CorpusFamilyAggregate;
    })
    .sort((left, right) => compareStrings(left.family.id, right.family.id));
}

export type AggregateRobCorpusOptions = {
  generatedAt: string;
  maxFileBytes: number;
  maxCandidatesPerGenerator: number;
  generatedSymmetryVariants: boolean;
  discoveredFileCount: number;
  discoveryIssues: readonly CorpusDiscoveryIssue[];
};

export function aggregateRobCorpusReport(
  filesInput: readonly CorpusFileReport[],
  options: AggregateRobCorpusOptions,
): RobCorpusReport {
  const files = [...filesInput].sort((left, right) =>
    compareStrings(left.fileId, right.fileId),
  );
  const families = aggregateFamilies(files);
  const checks = files.flatMap(checksForFile);
  const scenarioStatuses = files.flatMap(({ scenarios }) =>
    scenarios.map(({ status }) => status),
  );

  return {
    schemaVersion: CORPUS_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    harness: {
      maxFileBytes: options.maxFileBytes,
      maxCandidatesPerGenerator: options.maxCandidatesPerGenerator,
      generatedSymmetryVariants: options.generatedSymmetryVariants,
      sourceSymmetryOrbitCompared: true,
      scenarios: ROB_CORPUS_SCENARIO_IDS,
      privacy: {
        sourceTextStored: false,
        absolutePathsStored: false,
        reportFileNamesAreBasenamesOnly: true,
      },
    },
    summary: {
      discoveredFileCount: options.discoveredFileCount,
      acceptedFileCount: files.length,
      rejectedEntryCount: options.discoveryIssues.length,
      familyCount: families.length,
      fileStatusCounts: countStatuses(files.map(({ status }) => status)),
      checkStatusCounts: countStatuses(checks.map(({ status }) => status)),
      scenarioStatusCounts: countStatuses(scenarioStatuses),
    },
    discoveryIssues: [...options.discoveryIssues],
    duplicateGroups: {
      byteIdentical: groupDuplicateDigests(
        files,
        ({ byteDigestSha256 }) => byteDigestSha256,
      ),
      semanticallyIdentical: groupDuplicateDigests(
        files,
        ({ semanticDigestSha256 }) => semanticDigestSha256,
      ),
    },
    files,
    families,
  };
}
