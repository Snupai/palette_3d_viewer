import { describe, expect, it } from "vitest";
import type { RegionSearchBudget } from "~/domain/solver/region-topology/model";
import {
  createRegionWorkLedger,
  REGION_SEARCH_WORK_MODEL_VERSION,
} from "~/domain/solver/region-topology/workBudget";

const budget: RegionSearchBudget = {
  maxWorkUnits: 12,
  maxFrontierStates: 4,
  maxRetainedDrafts: 3,
};

function emptyWorkCounts() {
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

describe("region work budget", () => {
  it("records exact semantic work, frontier, and draft-storage snapshots", () => {
    const ledger = createRegionWorkLedger(budget);

    expect(ledger.debit("root-state", 2)).toBe("continue");
    expect(ledger.debit("domain-revision", 3)).toBe("continue");
    expect(ledger.observeFrontierSize(4)).toBe("continue");
    expect(
      ledger.observeDraftStorage({
        retainedDraftCount: 1,
        replacementOccurred: false,
      }),
    ).toBe("continue");
    expect(
      ledger.observeDraftStorage({
        retainedDraftCount: 2,
        replacementOccurred: false,
      }),
    ).toBe("continue");

    expect(ledger.snapshot()).toEqual({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget,
      totalUsed: 5,
      usedByKind: {
        ...emptyWorkCounts(),
        "root-state": 2,
        "domain-revision": 3,
      },
      frontierPeak: 4,
      discoveredDraftCount: 2,
      retainedDraftCount: 2,
      storageReplacementOccurred: false,
      stopReason: null,
      cancellationObserved: false,
    });
  });

  it("charges cache hits and misses identically", () => {
    function run(cacheWarm: boolean) {
      const ledger = createRegionWorkLedger(budget);
      const cache = new Map<string, number>();
      if (cacheWarm) cache.set("shared-domain", 1);

      for (const key of ["shared-domain", "shared-domain", "other-domain"]) {
        expect(ledger.debit("domain-revision")).toBe("continue");
        if (!cache.has(key)) cache.set(key, cache.size + 1);
      }
      return ledger.snapshot();
    }

    expect(run(false)).toEqual(run(true));
    expect(run(false).totalUsed).toBe(3);
  });

  it("checks cancellation before booking the next debit", () => {
    let cancellationChecks = 0;
    const ledger = createRegionWorkLedger(budget, () => {
      cancellationChecks += 1;
      return true;
    });

    expect(ledger.debit("catalog-shape", 5)).toBe("cancelled");
    expect(cancellationChecks).toBe(1);
    expect(ledger.snapshot()).toEqual({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget,
      totalUsed: 0,
      usedByKind: emptyWorkCounts(),
      frontierPeak: 0,
      discoveredDraftCount: 0,
      retainedDraftCount: 0,
      storageReplacementOccurred: false,
      stopReason: "cancelled",
      cancellationObserved: true,
    });
  });

  it("reserves multi-unit work atomically and stops without partial debit", () => {
    const ledger = createRegionWorkLedger({
      maxWorkUnits: 3,
      maxFrontierStates: 2,
      maxRetainedDrafts: 1,
    });

    expect(ledger.debit("materialize-placement", 2)).toBe("continue");
    expect(ledger.debit("materialize-placement", 2)).toBe(
      "work-budget-exhausted",
    );
    expect(ledger.snapshot()).toEqual({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget: {
        maxWorkUnits: 3,
        maxFrontierStates: 2,
        maxRetainedDrafts: 1,
      },
      totalUsed: 2,
      usedByKind: {
        ...emptyWorkCounts(),
        "materialize-placement": 2,
      },
      frontierPeak: 0,
      discoveredDraftCount: 0,
      retainedDraftCount: 0,
      storageReplacementOccurred: false,
      stopReason: "work-budget-exhausted",
      cancellationObserved: false,
    });
  });

  it("stops above the frontier limit but treats draft capacity as storage", () => {
    const frontierLedger = createRegionWorkLedger({
      maxWorkUnits: 1,
      maxFrontierStates: 2,
      maxRetainedDrafts: 1,
    });
    expect(frontierLedger.observeFrontierSize(2)).toBe("continue");
    expect(frontierLedger.observeFrontierSize(3)).toBe(
      "frontier-budget-exhausted",
    );
    expect(frontierLedger.snapshot().frontierPeak).toBe(2);

    const draftLedger = createRegionWorkLedger({
      maxWorkUnits: 1,
      maxFrontierStates: 1,
      maxRetainedDrafts: 2,
    });
    expect(
      draftLedger.observeDraftStorage({
        retainedDraftCount: 1,
        replacementOccurred: false,
      }),
    ).toBe("continue");
    expect(
      draftLedger.observeDraftStorage({
        retainedDraftCount: 2,
        replacementOccurred: false,
      }),
    ).toBe("continue");
    expect(
      draftLedger.observeDraftStorage({
        retainedDraftCount: 2,
        replacementOccurred: true,
      }),
    ).toBe("continue");
    expect(
      draftLedger.observeDraftStorage({
        retainedDraftCount: 2,
        replacementOccurred: false,
      }),
    ).toBe("continue");
    expect(draftLedger.snapshot()).toMatchObject({
      discoveredDraftCount: 4,
      retainedDraftCount: 2,
      storageReplacementOccurred: true,
      stopReason: null,
    });
    expect(() =>
      draftLedger.observeDraftStorage({
        retainedDraftCount: 3,
        replacementOccurred: false,
      }),
    ).toThrowError(
      "retained draft count must not exceed budget.maxRetainedDrafts.",
    );
  });

  it("fails closed for invalid budgets and debit sizes", () => {
    expect(() =>
      createRegionWorkLedger({
        maxWorkUnits: 0,
        maxFrontierStates: 1,
        maxRetainedDrafts: 1,
      }),
    ).toThrowError("budget.maxWorkUnits must be a positive safe integer.");

    const ledger = createRegionWorkLedger(budget);
    expect(() => ledger.debit("root-state", Number.NaN)).toThrowError(
      "units must be a positive safe integer.",
    );
    expect(ledger.snapshot().totalUsed).toBe(0);
  });
});
