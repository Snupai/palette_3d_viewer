import {
  CORPUS_PARITY_STATUSES,
  type CorpusCheck,
  type CorpusParityStatus,
  type CorpusStatusCounts,
  type JsonValue,
} from "~/lib/parity/types";

const STATUS_PRECEDENCE: Record<CorpusParityStatus, number> = {
  SKIPPED: 0,
  PASS: 1,
  OBSERVED: 2,
  BLOCKED: 3,
  FAIL: 4,
};

export function emptyStatusCounts(): CorpusStatusCounts {
  return {
    PASS: 0,
    FAIL: 0,
    OBSERVED: 0,
    BLOCKED: 0,
    SKIPPED: 0,
  };
}

export function countStatuses(
  statuses: readonly CorpusParityStatus[],
): CorpusStatusCounts {
  const counts = emptyStatusCounts();
  for (const status of statuses) counts[status] += 1;
  return counts;
}

export function combineStatuses(
  statuses: readonly CorpusParityStatus[],
): CorpusParityStatus {
  if (statuses.length === 0) return "SKIPPED";
  return statuses.reduce((combined, status) =>
    STATUS_PRECEDENCE[status] > STATUS_PRECEDENCE[combined] ? status : combined,
  );
}

export function createCorpusCheck(input: {
  id: string;
  status: CorpusParityStatus;
  summary: string;
  evidence?: Record<string, JsonValue>;
  mismatches?: CorpusCheck["mismatches"];
}): CorpusCheck {
  return {
    id: input.id,
    status: input.status,
    summary: input.summary,
    evidence: input.evidence ?? {},
    mismatches: input.mismatches ?? [],
  };
}

export function isCorpusParityStatus(
  value: string,
): value is CorpusParityStatus {
  return (CORPUS_PARITY_STATUSES as readonly string[]).includes(value);
}
