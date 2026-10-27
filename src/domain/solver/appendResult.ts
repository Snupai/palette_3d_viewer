import type {
  GeneratorFamily,
  SolverDiagnostic,
  SolverResult,
} from "~/domain/solver/types";

const EMPTY_RESULT_CODES = new Set([
  "no-valid-candidates",
  "exact-rectangular-block-unavailable",
]);

/**
 * Append the candidates of a later run after those of an earlier one. Later
 * layouts that repeat an earlier geometry are counted as duplicates and
 * dropped; ranks continue from the earlier run.
 */
export function appendSolverResult(
  first: SolverResult,
  later: SolverResult,
): SolverResult {
  const seen = new Set(
    first.candidates.flatMap(({ id, geometryFingerprint }) => [
      `id:${id}`,
      `geometry:${geometryFingerprint}`,
    ]),
  );
  const appended = later.candidates.filter(
    ({ id, geometryFingerprint }) =>
      !seen.has(`id:${id}`) && !seen.has(`geometry:${geometryFingerprint}`),
  );
  const candidates = [...first.candidates, ...appended].map(
    (candidate, index) => ({ ...candidate, rank: index + 1 }),
  );
  const keepDiagnostic = ({ code }: SolverDiagnostic) =>
    candidates.length === 0 || !EMPTY_RESULT_CODES.has(code);
  const generatedByFamily = { ...first.statistics.generatedByFamily };
  for (const [family, count] of Object.entries(
    later.statistics.generatedByFamily,
  ) as [GeneratorFamily, number][]) {
    generatedByFamily[family] = (generatedByFamily[family] ?? 0) + count;
  }
  return {
    status:
      first.status === "cancelled" || later.status === "cancelled"
        ? "cancelled"
        : "completed",
    candidates,
    diagnostics: [...first.diagnostics, ...later.diagnostics].filter(
      keepDiagnostic,
    ),
    exclusions: [...first.exclusions, ...later.exclusions],
    statistics: {
      generatedDraftCount:
        first.statistics.generatedDraftCount +
        later.statistics.generatedDraftCount,
      validDraftCount:
        first.statistics.validDraftCount + later.statistics.validDraftCount,
      invalidDraftCount:
        first.statistics.invalidDraftCount +
        later.statistics.invalidDraftCount,
      geometricDuplicateCount:
        first.statistics.geometricDuplicateCount +
        later.statistics.geometricDuplicateCount +
        later.candidates.length -
        appended.length,
      candidateCount: candidates.length,
      generatedByFamily,
    },
  };
}
