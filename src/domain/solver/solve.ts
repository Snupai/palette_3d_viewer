import { finalizeGeneratedCandidates } from "~/domain/solver/candidates";
import {
  generateCandidateFamily,
  generateSymmetryCandidateDrafts,
} from "~/domain/solver/generators";
import type { RegionSearchBudget } from "~/domain/solver/region-topology/model";
import type { TargetCountPolicy } from "~/domain/solver/region-topology/targetCounts";
import {
  generateRegionTopologyDrafts,
  type RegionTopologyGenerationResult,
} from "~/domain/solver/regionTopology";
import {
  BASE_GENERATOR_FAMILIES,
  type BaseGeneratorFamily,
  type GeneratedCandidateDraft,
  type GeneratorFamily,
  type LayerSolverInput,
  type NormalizedLayerSolverInput,
  type SolverDiagnostic,
  type SolverExclusion,
  type SolverOptions,
  type SolverPhase,
  type SolverProgress,
  type SolverResult,
  type SolverStatistics,
} from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";

/** Conservative default for direct synchronous callers and offline tools. */
export const DEFAULT_SOLVE_LAYER_REGION_SEARCH_BUDGET: RegionSearchBudget =
  Object.freeze({
    maxWorkUnits: 5_000,
    maxFrontierStates: 2_000,
    maxRetainedDrafts: 1_250,
  });

/** Extended bounded budget used by the production worker path. */
export const PRODUCTION_REGION_SEARCH_BUDGET: RegionSearchBudget =
  Object.freeze({
    maxWorkUnits: 1_000_000,
    maxFrontierStates: 10_000,
    maxRetainedDrafts: 1_250,
  });

// These families enumerate both axes and reflections themselves. Preserve the
// symmetry budget for families that rely on the later expansion.
const familiesWithOwnSymmetries: ReadonlySet<GeneratorFamily> = new Set([
  "crossed-strip",
  "stepped-block",
  "slice-grid",
  "paired-grid",
  "mosaic",
  "rounded-slice",
  "anchored-ring",
  "capped-ring",
  "asymmetric-ring",
  "nested-edge",
  "nested-strip",
  "staircase",
  "staircase-variable",
  "staircase-exchange",
]);

function needsSymmetryExpansion(family: GeneratorFamily | undefined): boolean {
  return family === undefined || !familiesWithOwnSymmetries.has(family);
}

function regionTargetCountPolicy(
  input: NormalizedLayerSolverInput,
): TargetCountPolicy {
  const { minimumPackageCount: minimum, maximumPackageCount: maximum } =
    input.constraints;
  return minimum === maximum
    ? Object.freeze({ kind: "exact", count: minimum })
    : Object.freeze({ kind: "range", minimum, maximum });
}

function regionWorkSummary(
  work: RegionTopologyGenerationResult["work"],
): string {
  return `Region topology search used ${work.totalUsed} of ${work.budget.maxWorkUnits} work units, reached ${work.frontierPeak} of ${work.budget.maxFrontierStates} frontier states at peak, discovered ${work.discoveredDraftCount} drafts, retained ${work.retainedDraftCount} within the hard storage limit of ${work.budget.maxRetainedDrafts}, and ${work.storageReplacementOccurred ? "did" : "did not"} replace an earlier retained draft.`;
}

function regionTopologyDiagnostic(
  result: RegionTopologyGenerationResult,
): SolverDiagnostic {
  const summary = regionWorkSummary(result.work);
  if (result.status === "completed") {
    const storageSaturated =
      result.work.discoveredDraftCount > result.work.retainedDraftCount;
    return {
      severity: "info",
      phase: "generation",
      code: "region-topology-search-completed",
      count: result.drafts.length,
      message: storageSaturated
        ? `${summary} Draft storage saturated, but work and frontier processing continued to completion.`
        : `${summary} The bounded search completed without truncation.`,
    };
  }
  if (result.status === "invalid") {
    return {
      severity: "error",
      phase: "generation",
      code: "region-topology-search-invalid",
      count: 0,
      message: `${summary} Region topology generation was rejected: ${result.reason}`,
    };
  }
  if (result.reason === "cancelled") {
    return {
      severity: "info",
      phase: "cancelled",
      code: "region-topology-search-cancelled",
      count: 0,
      message: `${summary} Cancellation discarded all partial region drafts.`,
    };
  }

  const limit =
    result.reason === "work-budget-exhausted" ? "work-unit" : "frontier-state";
  return {
    severity: "warning",
    phase: "generation",
    code: `region-topology-${result.reason}`,
    count: result.drafts.length,
    message: `${summary} The bounded search was truncated at its ${limit} limit; ${result.drafts.length} retained draft${result.drafts.length === 1 ? " was" : "s were"} forwarded to candidate finalization.`,
  };
}

function recordRegionDraftStatistics(
  drafts: readonly GeneratedCandidateDraft[],
  statistics: SolverStatistics,
): void {
  statistics.generatedDraftCount += drafts.length;
  for (const draft of drafts) {
    const family = draft.provenance[0]?.family;
    if (family === undefined || family === "symmetry") continue;
    statistics.generatedByFamily[family] += 1;
  }
}

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
      "crossed-strip": 0,
      "stepped-block": 0,
      "slice-grid": 0,
      "paired-grid": 0,
      mosaic: 0,
      "rounded-slice": 0,
      "anchored-ring": 0,
      "capped-ring": 0,
      "asymmetric-ring": 0,
      "nested-edge": 0,
      "nested-strip": 0,
      staircase: 0,
      "staircase-variable": 0,
      "staircase-exchange": 0,
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
  if (
    !progress.checkpoint(
      "generation",
      0,
      null,
      "Generating bounded region-topology candidates.",
      undefined,
      true,
    )
  ) {
    return cancelledResult(diagnostics, exclusions, statistics);
  }
  const regionOutput = generateRegionTopologyDrafts(normalizedInput, {
    targetCountPolicy: regionTargetCountPolicy(normalizedInput),
    budget:
      options.regionTopologyBudget ?? DEFAULT_SOLVE_LAYER_REGION_SEARCH_BUDGET,
    shouldCancel: () => progress.cancelled(),
  });
  diagnostics.push(regionTopologyDiagnostic(regionOutput));
  if (
    regionOutput.status === "stopped" &&
    regionOutput.reason === "cancelled"
  ) {
    return cancelledResult(diagnostics, exclusions, statistics);
  }
  drafts.push(...regionOutput.drafts);
  recordRegionDraftStatistics(regionOutput.drafts, statistics);
  if (
    !progress.checkpoint(
      "generation",
      regionOutput.work.totalUsed,
      regionOutput.work.budget.maxWorkUnits,
      `Finished bounded region-topology generation after discovering ${regionOutput.work.discoveredDraftCount} drafts and retaining ${regionOutput.drafts.length}.`,
      undefined,
      true,
    )
  ) {
    return cancelledResult(diagnostics, exclusions, statistics);
  }

  const legacyDrafts: GeneratedCandidateDraft[] = [];
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
      includeExperimentalIncompleteBlocks:
        options.includeExperimentalIncompleteBlocks === true,
    });
    if (needsSymmetryExpansion(family)) {
      legacyDrafts.push(...output.drafts);
    }
    drafts.push(...output.drafts);
    diagnostics.push(...output.diagnostics);
    exclusions.push(...output.exclusions);
    statistics.generatedByFamily[family] += output.drafts.length;
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
      options.candidateEquivalence === "identity"
        ? drafts.filter((draft) =>
            needsSymmetryExpansion(draft.provenance[0]?.family),
          )
        : legacyDrafts,
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
    candidateEquivalence: options.candidateEquivalence,
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
