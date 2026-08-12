import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import {
  generateCandidateFamily,
  generateSymmetryCandidateDrafts,
} from "~/domain/solver/generators";
import {
  BASE_GENERATOR_FAMILIES,
  type BaseGeneratorFamily,
  type GeneratedCandidateDraft,
  type GeneratorFamily,
  type LayerSolverInput,
  type SolverDiagnostic,
  type SolverExclusion,
  type SolverOptions,
  type SolverPhase,
  type SolverProgress,
  type SolverResult,
  type SolverStatistics,
} from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function sortedDiagnostics(
  diagnostics: readonly SolverDiagnostic[],
): SolverDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    compareStrings(
      `${left.phase}:${left.code}:${left.generator ?? ""}:${left.message}`,
      `${right.phase}:${right.code}:${right.generator ?? ""}:${right.message}`,
    ),
  );
}

function sortedExclusions(
  exclusions: readonly SolverExclusion[],
): SolverExclusion[] {
  return [...exclusions].sort((left, right) =>
    compareStrings(
      `${left.reason}:${left.geometryFingerprint ?? ""}:${left.message}:${stableValue(left.provenance)}`,
      `${right.reason}:${right.geometryFingerprint ?? ""}:${right.message}:${stableValue(right.provenance)}`,
    ),
  );
}

function normalizedGeneratorOrder(
  requested: readonly BaseGeneratorFamily[] | undefined,
): BaseGeneratorFamily[] {
  const known = new Set<BaseGeneratorFamily>(BASE_GENERATOR_FAMILIES);
  const seen = new Set<BaseGeneratorFamily>();
  const order: BaseGeneratorFamily[] = [];
  for (const family of requested ?? []) {
    if (known.has(family) && !seen.has(family)) {
      seen.add(family);
      order.push(family);
    }
  }
  for (const family of BASE_GENERATOR_FAMILIES) {
    if (!seen.has(family)) order.push(family);
  }
  return order;
}

class ProgressController {
  private readonly batchSize: number;

  constructor(private readonly options: SolverOptions) {
    this.batchSize =
      Number.isInteger(options.progressBatchSize) &&
      (options.progressBatchSize ?? 0) > 0
        ? options.progressBatchSize!
        : 25;
  }

  cancelled(): boolean {
    return this.options.shouldCancel?.() === true;
  }

  checkpoint(
    phase: SolverPhase,
    completed: number,
    total: number | null,
    message: string,
    generator?: GeneratorFamily,
    force = false,
  ): boolean {
    if (this.cancelled()) return false;
    if (
      force ||
      completed === 0 ||
      (total !== null && completed === total) ||
      completed % this.batchSize === 0
    ) {
      const progress: SolverProgress = {
        phase,
        completed,
        total,
        generator,
        message,
      };
      this.options.onProgress?.(progress);
    }
    return !this.cancelled();
  }
}

function emptyStatistics(): SolverStatistics {
  return {
    generatedDraftCount: 0,
    validDraftCount: 0,
    invalidDraftCount: 0,
    geometricDuplicateCount: 0,
    candidateCount: 0,
    generatedByFamily: {
      row: 0,
      block: 0,
      "justified-grid": 0,
      pinwheel: 0,
      "nested-side": 0,
      "edge-ring": 0,
      "mixed-orientation": 0,
      symmetry: 0,
    },
  };
}

function cancelledResult(
  diagnostics: readonly SolverDiagnostic[],
  exclusions: readonly SolverExclusion[],
  statistics: SolverStatistics,
): SolverResult {
  return {
    status: "cancelled",
    candidates: [],
    diagnostics: sortedDiagnostics([
      ...diagnostics,
      {
        severity: "info",
        phase: "cancelled",
        code: "solver-cancelled",
        message:
          "Solver cancellation was observed at a cooperative checkpoint; partial candidates were not returned.",
      },
    ]),
    exclusions: sortedExclusions(exclusions),
    statistics: { ...statistics, candidateCount: 0 },
  };
}

/**
 * Pure synchronous solver. Worker scheduling can wrap this API later; progress
 * and cancellation are callback-based so the domain module has no Worker,
 * React, Three.js, timer, or platform dependency.
 */
export function solveLayer(
  input: LayerSolverInput,
  options: SolverOptions = {},
): SolverResult {
  const progress = new ProgressController(options);
  const diagnostics: SolverDiagnostic[] = [];
  const exclusions: SolverExclusion[] = [];
  const statistics = emptyStatistics();

  if (
    !progress.checkpoint(
      "input-validation",
      0,
      1,
      "Validating solver input.",
      undefined,
      true,
    )
  ) {
    return cancelledResult(diagnostics, exclusions, statistics);
  }

  const inputValidation = validateAndNormalizeSolverInput(input);
  if (!inputValidation.valid || !inputValidation.normalized) {
    diagnostics.push(
      ...inputValidation.issues.map((issue) => ({
        severity: "error" as const,
        phase: "input-validation" as const,
        code: issue.code,
        message: issue.message,
      })),
    );
    progress.checkpoint(
      "complete",
      1,
      1,
      "Solver stopped because the input is invalid.",
      undefined,
      true,
    );
    return {
      status: "completed",
      candidates: [],
      diagnostics: sortedDiagnostics(diagnostics),
      exclusions: [],
      statistics,
    };
  }
  const normalizedInput = inputValidation.normalized;
  progress.checkpoint(
    "input-validation",
    1,
    1,
    "Solver input is valid.",
    undefined,
    true,
  );

  const drafts: GeneratedCandidateDraft[] = [];
  for (const family of normalizedGeneratorOrder(options.generatorOrder)) {
    if (
      !progress.checkpoint(
        "generation",
        0,
        null,
        `Generating ${family} candidates.`,
        family,
        true,
      )
    ) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
    const output = generateCandidateFamily(normalizedInput, family, {
      checkpoint: (currentFamily, count) =>
        progress.checkpoint(
          "generation",
          count,
          null,
          `Generated ${count} ${currentFamily} drafts.`,
          currentFamily,
        ),
      shouldCancel: () => progress.cancelled(),
    });
    drafts.push(...output.drafts);
    diagnostics.push(...output.diagnostics);
    exclusions.push(...output.exclusions);
    statistics.generatedByFamily[family] = output.drafts.length;
    statistics.generatedDraftCount += output.drafts.length;
    if (output.cancelled) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
    if (
      !progress.checkpoint(
        "generation",
        output.drafts.length,
        output.drafts.length,
        `Finished ${family} generation.`,
        family,
        true,
      )
    ) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
  }

  if (options.includeSymmetryVariants !== false) {
    if (
      !progress.checkpoint(
        "symmetry",
        0,
        null,
        "Generating envelope-preserving symmetry variants.",
        "symmetry",
        true,
      )
    ) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
    const symmetryOutput = generateSymmetryCandidateDrafts(
      normalizedInput,
      drafts,
      {
        checkpoint: (family, count) =>
          progress.checkpoint(
            "symmetry",
            count,
            null,
            `Generated ${count} symmetry drafts.`,
            family,
          ),
      },
    );
    drafts.push(...symmetryOutput.drafts);
    diagnostics.push(...symmetryOutput.diagnostics);
    exclusions.push(...symmetryOutput.exclusions);
    statistics.generatedByFamily.symmetry = symmetryOutput.drafts.length;
    statistics.generatedDraftCount += symmetryOutput.drafts.length;
    if (symmetryOutput.cancelled) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
    if (
      !progress.checkpoint(
        "symmetry",
        symmetryOutput.drafts.length,
        symmetryOutput.drafts.length,
        "Finished symmetry generation.",
        "symmetry",
        true,
      )
    ) {
      return cancelledResult(diagnostics, exclusions, statistics);
    }
  }

  const finalized = finalizeGeneratedCandidates(normalizedInput, drafts, {
    checkpoint: (phase, completed, total) =>
      progress.checkpoint(
        phase,
        completed,
        total,
        `${phase} ${completed} of ${total}.`,
      ),
  });
  diagnostics.push(...finalized.diagnostics);
  exclusions.push(...finalized.exclusions);
  statistics.validDraftCount = finalized.validDraftCount;
  statistics.invalidDraftCount = finalized.invalidDraftCount;
  statistics.geometricDuplicateCount = finalized.geometricDuplicateCount;
  if (finalized.cancelled) {
    return cancelledResult(diagnostics, exclusions, statistics);
  }

  statistics.candidateCount = finalized.candidates.length;
  if (
    finalized.candidates.length === 0 &&
    !finalized.diagnostics.some(
      ({ code }) => code === "outward-label-yaw-unavailable",
    )
  ) {
    if (normalizedInput.constraints.requiredShape === "rectangular-block") {
      diagnostics.push({
        severity: "warning",
        phase: "ranking",
        code: "exact-rectangular-block-unavailable",
        message:
          "No clean rectangular block matches the requested package count and bounded spacing policy. The solver did not reduce the count, cut a row, create a missing corner, or substitute a disallowed rotation.",
      });
    } else {
      diagnostics.push({
        severity: "warning",
        phase: "ranking",
        code: "no-valid-candidates",
        message:
          "No generated candidate survived validation and deduplication.",
      });
    }
  }
  progress.checkpoint(
    "complete",
    finalized.candidates.length,
    finalized.candidates.length,
    `Solver completed with ${finalized.candidates.length} candidates.`,
    undefined,
    true,
  );

  return {
    status: "completed",
    candidates: finalized.candidates,
    diagnostics: sortedDiagnostics(diagnostics),
    exclusions: sortedExclusions(exclusions),
    statistics,
  };
}
