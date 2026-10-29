import type { RegionSearchBudget } from "~/domain/solver/region-topology/model";

export const REGION_SEARCH_WORK_MODEL_VERSION = 9 as const;

export const REGION_WORK_KINDS = [
  "catalog-shape",
  "root-state",
  "frontier-pop",
  "template-expansion",
  "count-dp-word",
  "domain-revision",
  "canonical-transform",
  "line-constraint",
  "independent-spacing-axis",
  "spacing-realization",
  "normalization",
  "materialize-placement",
] as const;

export type RegionWorkKind = (typeof REGION_WORK_KINDS)[number];

export type RegionSearchStopReason =
  | "work-budget-exhausted"
  | "frontier-budget-exhausted"
  | "cancelled";

export type RegionWorkDecision = "continue" | RegionSearchStopReason;

export type RegionDraftStorageObservation = Readonly<{
  retainedDraftCount: number;
  replacementOccurred: boolean;
}>;

export type RegionWorkSnapshot = Readonly<{
  workModelVersion: typeof REGION_SEARCH_WORK_MODEL_VERSION;
  budget: RegionSearchBudget;
  totalUsed: number;
  usedByKind: Readonly<Record<RegionWorkKind, number>>;
  frontierPeak: number;
  discoveredDraftCount: number;
  retainedDraftCount: number;
  storageReplacementOccurred: boolean;
  stopReason: RegionSearchStopReason | null;
  cancellationObserved: boolean;
}>;

export type RegionWorkLedger = Readonly<{
  checkpoint(): RegionWorkDecision;
  debit(kind: RegionWorkKind, units?: number): RegionWorkDecision;
  observeFrontierSize(size: number): RegionWorkDecision;
  observeDraftStorage(
    observation: RegionDraftStorageObservation,
  ): RegionWorkDecision;
  snapshot(): RegionWorkSnapshot;
}>;

const workKinds = new Set<string>(REGION_WORK_KINDS);

function assertPositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function assertNonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizedBudget(budget: RegionSearchBudget): RegionSearchBudget {
  if (typeof budget !== "object" || budget === null) {
    throw new TypeError("Region search budget must be an object.");
  }
  return Object.freeze({
    maxWorkUnits: assertPositiveSafeInteger(
      budget.maxWorkUnits,
      "budget.maxWorkUnits",
    ),
    maxFrontierStates: assertPositiveSafeInteger(
      budget.maxFrontierStates,
      "budget.maxFrontierStates",
    ),
    maxRetainedDrafts: assertPositiveSafeInteger(
      budget.maxRetainedDrafts,
      "budget.maxRetainedDrafts",
    ),
  });
}

function emptyWorkCounts(): Record<RegionWorkKind, number> {
  return {
    "catalog-shape": 0,
    "root-state": 0,
    "frontier-pop": 0,
    "template-expansion": 0,
    "count-dp-word": 0,
    "domain-revision": 0,
    "canonical-transform": 0,
    "line-constraint": 0,
    "independent-spacing-axis": 0,
    "spacing-realization": 0,
    normalization: 0,
    "materialize-placement": 0,
  };
}

function copyWorkCounts(
  counts: Readonly<Record<RegionWorkKind, number>>,
): Readonly<Record<RegionWorkKind, number>> {
  return Object.freeze({
    "catalog-shape": counts["catalog-shape"],
    "root-state": counts["root-state"],
    "frontier-pop": counts["frontier-pop"],
    "template-expansion": counts["template-expansion"],
    "count-dp-word": counts["count-dp-word"],
    "domain-revision": counts["domain-revision"],
    "canonical-transform": counts["canonical-transform"],
    "line-constraint": counts["line-constraint"],
    "independent-spacing-axis": counts["independent-spacing-axis"],
    "spacing-realization": counts["spacing-realization"],
    normalization: counts.normalization,
    "materialize-placement": counts["materialize-placement"],
  });
}

export function createRegionWorkLedger(
  requestedBudget: RegionSearchBudget,
  shouldCancel?: () => boolean,
): RegionWorkLedger {
  if (shouldCancel !== undefined && typeof shouldCancel !== "function") {
    throw new TypeError("shouldCancel must be a function when provided.");
  }

  const budget = normalizedBudget(requestedBudget);
  const usedByKind = emptyWorkCounts();
  let totalUsed = 0;
  let frontierPeak = 0;
  let discoveredDraftCount = 0;
  let retainedDraftCount = 0;
  let storageReplacementOccurred = false;
  let stopReason: RegionSearchStopReason | null = null;
  let cancellationObserved = false;

  function currentDecision(): RegionWorkDecision {
    return stopReason ?? "continue";
  }

  function pollCancellation(): RegionWorkDecision {
    if (stopReason !== null) return stopReason;
    if (shouldCancel?.() === true) {
      cancellationObserved = true;
      stopReason = "cancelled";
    }
    return currentDecision();
  }

  function debit(kind: RegionWorkKind, requestedUnits = 1): RegionWorkDecision {
    if (!workKinds.has(kind)) {
      throw new RangeError(`Unknown region work kind ${String(kind)}.`);
    }
    const units = assertPositiveSafeInteger(requestedUnits, "units");
    const cancellation = pollCancellation();
    if (cancellation !== "continue") return cancellation;

    if (units > budget.maxWorkUnits - totalUsed) {
      stopReason = "work-budget-exhausted";
      return stopReason;
    }

    usedByKind[kind] += units;
    totalUsed += units;
    return "continue";
  }

  function observeFrontierSize(sizeInput: number): RegionWorkDecision {
    const size = assertNonNegativeSafeInteger(sizeInput, "frontier size");
    const cancellation = pollCancellation();
    if (cancellation !== "continue") return cancellation;
    if (size > budget.maxFrontierStates) {
      stopReason = "frontier-budget-exhausted";
      return stopReason;
    }
    frontierPeak = Math.max(frontierPeak, size);
    return "continue";
  }

  function observeDraftStorage(
    observation: RegionDraftStorageObservation,
  ): RegionWorkDecision {
    if (typeof observation !== "object" || observation === null) {
      throw new TypeError("Draft storage observation must be an object.");
    }
    const size = assertNonNegativeSafeInteger(
      observation.retainedDraftCount,
      "retained draft count",
    );
    if (typeof observation.replacementOccurred !== "boolean") {
      throw new TypeError("replacementOccurred must be a boolean.");
    }
    if (size > budget.maxRetainedDrafts) {
      throw new RangeError(
        "retained draft count must not exceed budget.maxRetainedDrafts.",
      );
    }
    if (size < retainedDraftCount || size > retainedDraftCount + 1) {
      throw new RangeError(
        "retained draft count must stay level or increase by one per discovery.",
      );
    }
    if (
      observation.replacementOccurred &&
      (size !== retainedDraftCount || size !== budget.maxRetainedDrafts)
    ) {
      throw new RangeError(
        "A storage replacement requires saturated storage with an unchanged retained count.",
      );
    }
    if (discoveredDraftCount === Number.MAX_SAFE_INTEGER) {
      throw new RangeError(
        "discovered draft count exceeds the safe integer range.",
      );
    }

    const cancellation = pollCancellation();
    if (cancellation !== "continue") return cancellation;

    discoveredDraftCount += 1;
    retainedDraftCount = size;
    storageReplacementOccurred ||= observation.replacementOccurred;
    return "continue";
  }

  function snapshot(): RegionWorkSnapshot {
    return Object.freeze({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget,
      totalUsed,
      usedByKind: copyWorkCounts(usedByKind),
      frontierPeak,
      discoveredDraftCount,
      retainedDraftCount,
      storageReplacementOccurred,
      stopReason,
      cancellationObserved,
    });
  }

  return Object.freeze({
    checkpoint: pollCancellation,
    debit,
    observeFrontierSize,
    observeDraftStorage,
    snapshot,
  });
}
