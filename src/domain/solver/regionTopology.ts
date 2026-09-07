import type { LayerSymmetry } from "~/domain/geometry/transforms";
import type {
  RegionFramePolicy,
  RegionGraphTemplate,
  RegionSearchBudget,
  RegionShapeCatalog,
} from "~/domain/solver/region-topology/model";
import type { RegionSpacingSelection } from "~/domain/solver/region-topology/spacing";
import {
  type TargetCountPolicy,
  type TargetCountSearchPlan,
  normalizeTargetCountPolicy,
  planTargetCounts,
  safeGeometricPackageUpperBound,
} from "~/domain/solver/region-topology/targetCounts";
import { buildRegionShapeCatalog } from "~/domain/solver/region-topology/shapeCatalog";
import {
  searchRegionTopologies,
  type RegionTopologySearchResult,
} from "~/domain/solver/region-topology/search";
import {
  buildGuillotineTopologyTemplates,
  type GuillotineTopologyCatalogLimits,
} from "~/domain/solver/region-topology/topologies/guillotine";
import { buildBridgeChainTopologyTemplates } from "~/domain/solver/region-topology/topologies/bridgeChain";
import { buildPinwheelTopologyTemplates } from "~/domain/solver/region-topology/topologies/pinwheel";
import { buildStepSpineTopologyTemplates } from "~/domain/solver/region-topology/topologies/stepSpine";
import {
  createRegionWorkLedger,
  type RegionSearchStopReason,
  type RegionWorkLedger,
  type RegionWorkSnapshot,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

export const DEFAULT_REGION_SEARCH_BUDGET: RegionSearchBudget = Object.freeze({
  maxWorkUnits: 250_000,
  maxFrontierStates: 10_000,
  maxRetainedDrafts: 1_000,
});

export type RegionTopologyCatalogLimits = GuillotineTopologyCatalogLimits &
  Readonly<{
    /** Omit only for the compatibility pilot catalog; zero enables empty-core pinwheels. */
    maxPinwheelCoreDepth?: number;
    /** Omit only for narrow family-level tests. */
    includeStepSpine?: boolean;
    /** Omit only for narrow family-level tests. */
    includeBridgeChain?: boolean;
  }>;

export const DEFAULT_REGION_TOPOLOGY_CATALOG_LIMITS: RegionTopologyCatalogLimits =
  Object.freeze({
    maxRegionsPerTopology: 3,
    maxPinwheelCoreDepth: 1,
    includeStepSpine: true,
    includeBridgeChain: false,
  });

export type RegionTopologyGenerationOptions = Readonly<{
  targetCountPolicy?: TargetCountPolicy;
  budget?: RegionSearchBudget;
  catalogLimits?: RegionTopologyCatalogLimits;
  framePolicies?: readonly RegionFramePolicy[];
  spacingSelections?: readonly RegionSpacingSelection[];
  symmetries?: readonly LayerSymmetry[];
  shouldCancel?: () => boolean;
}>;

export type RegionTopologyGenerationResult =
  | Readonly<{
      status: "completed";
      drafts: RegionTopologySearchResult["drafts"];
      targetCountPlan: TargetCountSearchPlan;
      search: RegionTopologySearchResult;
      work: RegionWorkSnapshot;
    }>
  | Readonly<{
      status: "stopped";
      reason: RegionSearchStopReason;
      drafts: RegionTopologySearchResult["drafts"];
      targetCountPlan: TargetCountSearchPlan | null;
      search: RegionTopologySearchResult | null;
      work: RegionWorkSnapshot;
    }>
  | Readonly<{
      status: "invalid";
      reason: string;
      drafts: RegionTopologySearchResult["drafts"];
      targetCountPlan: TargetCountSearchPlan | null;
      search: RegionTopologySearchResult | null;
      work: RegionWorkSnapshot;
    }>;

function stoppedResult(
  reason: RegionSearchStopReason,
  ledger: RegionWorkLedger,
  targetCountPlan: TargetCountSearchPlan | null = null,
  search: RegionTopologySearchResult | null = null,
): RegionTopologyGenerationResult {
  return Object.freeze({
    status: "stopped",
    reason,
    drafts:
      reason === "cancelled" || search === null
        ? Object.freeze([])
        : search.drafts,
    targetCountPlan,
    search,
    work: ledger.snapshot(),
  });
}

function invalidResult(
  reason: string,
  ledger: RegionWorkLedger,
  targetCountPlan: TargetCountSearchPlan | null = null,
  search: RegionTopologySearchResult | null = null,
): RegionTopologyGenerationResult {
  return Object.freeze({
    status: "invalid",
    reason,
    drafts: Object.freeze([]),
    targetCountPlan,
    search,
    work: ledger.snapshot(),
  });
}

function shapeFitsSlot(
  shape: RegionShapeCatalog["orderedShapes"][number],
  slot: RegionGraphTemplate["slots"][number],
): boolean {
  return (
    !slot.optionalZero &&
    slot.footprintClasses.includes(shape.footprintClass) &&
    shape.columns >= slot.minimumColumns &&
    shape.rows >= slot.minimumRows &&
    (slot.maximumColumns === undefined ||
      shape.columns <= slot.maximumColumns) &&
    (slot.maximumRows === undefined || shape.rows <= slot.maximumRows) &&
    (slot.packageCounts === undefined ||
      slot.packageCounts.includes(shape.packageCount))
  );
}

function reachableTemplateCounts(
  template: RegionGraphTemplate,
  catalog: RegionShapeCatalog,
  upperBound: number,
  ledger: RegionWorkLedger,
):
  | Readonly<{ status: "completed"; counts: ReadonlySet<number> }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }> {
  let reachable = new Set([0]);
  const slots = [...template.slots].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  for (const slot of slots) {
    const countSet = new Set<number>();
    for (const shape of catalog.orderedShapes) {
      const decision = ledger.debit("domain-revision");
      if (decision !== "continue") {
        return Object.freeze({ status: "stopped", reason: decision });
      }
      if (shapeFitsSlot(shape, slot)) countSet.add(shape.packageCount);
    }
    const counts = [...countSet].sort((left, right) => left - right);
    const next = new Set<number>();
    for (const count of counts) {
      for (const prefix of reachable) {
        const decision = ledger.debit("count-dp-word");
        if (decision !== "continue") {
          return Object.freeze({ status: "stopped", reason: decision });
        }
        const sum = prefix + count;
        if (sum <= upperBound) next.add(sum);
      }
    }
    reachable = next;
  }
  return Object.freeze({ status: "completed", counts: reachable });
}

function reachableCounts(
  templates: readonly RegionGraphTemplate[],
  catalog: RegionShapeCatalog,
  upperBound: number,
  ledger: RegionWorkLedger,
):
  | Readonly<{ status: "completed"; counts: readonly number[] }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }> {
  const counts = new Set<number>();
  for (const template of templates) {
    const templateResult = reachableTemplateCounts(
      template,
      catalog,
      upperBound,
      ledger,
    );
    if (templateResult.status === "stopped") return templateResult;
    templateResult.counts.forEach((count) => counts.add(count));
  }
  return Object.freeze({
    status: "completed",
    counts: Object.freeze([...counts].sort((left, right) => left - right)),
  });
}

function targetPolicyMaximum(policy: TargetCountPolicy): number {
  return policy.kind === "exact" ? policy.count : policy.maximum;
}

function inputSupportsGridCorePinwheels(
  input: NormalizedLayerSolverInput,
): boolean {
  const dimensions = input.package.dimensionsMm;
  if (dimensions.length === dimensions.width) return true;
  const rotations = input.constraints.allowedRotations;
  return (
    rotations.some((rotation) => rotation === 0 || rotation === 180) &&
    rotations.some((rotation) => rotation === 90 || rotation === 270)
  );
}

function regionFramePolicyFilter(
  input: NormalizedLayerSolverInput,
): readonly RegionFramePolicy[] {
  if (
    input.constraints.rectangularBlockFootprintPolicy === "compact-centered"
  ) {
    return Object.freeze([
      "center-occupied-bounds",
      "integer-center-occupied-bounds",
    ]);
  }
  return Object.freeze(["fill-generation-bounds"]);
}

export function generateRegionTopologyDrafts(
  input: NormalizedLayerSolverInput,
  options: RegionTopologyGenerationOptions = {},
): RegionTopologyGenerationResult {
  const ledger = createRegionWorkLedger(
    options.budget ?? DEFAULT_REGION_SEARCH_BUDGET,
    options.shouldCancel,
  );
  if (typeof input !== "object" || input === null) {
    return invalidResult("Normalized solver input must be an object.", ledger);
  }

  const normalizedPolicy = normalizeTargetCountPolicy(
    input.constraints,
    options.targetCountPolicy,
  );
  if (!normalizedPolicy.valid) {
    return invalidResult(normalizedPolicy.message, ledger);
  }

  const geometricUpperBound = safeGeometricPackageUpperBound(input);
  let templates: readonly RegionGraphTemplate[];
  try {
    const catalogLimits =
      options.catalogLimits ?? DEFAULT_REGION_TOPOLOGY_CATALOG_LIMITS;
    const values = [...buildGuillotineTopologyTemplates(catalogLimits)];
    if (catalogLimits.maxPinwheelCoreDepth !== undefined) {
      values.push(
        ...buildPinwheelTopologyTemplates({
          maxCoreDepth: catalogLimits.maxPinwheelCoreDepth,
          includeGridCore: inputSupportsGridCorePinwheels(input),
        }),
      );
    }
    if (catalogLimits.includeStepSpine === true) {
      values.push(...buildStepSpineTopologyTemplates());
    }
    if (catalogLimits.includeBridgeChain === true) {
      values.push(...buildBridgeChainTopologyTemplates());
    }
    templates = Object.freeze(values);
  } catch (cause) {
    return invalidResult(
      cause instanceof Error
        ? cause.message
        : "Region topology catalog limits are invalid.",
      ledger,
    );
  }

  const searchUpperBound = Math.min(
    geometricUpperBound,
    targetPolicyMaximum(normalizedPolicy.policy),
  );
  const catalogResult = buildRegionShapeCatalog(
    input,
    searchUpperBound,
    ledger,
  );
  if (catalogResult.status === "stopped") {
    return stoppedResult(catalogResult.reason, ledger);
  }
  if (catalogResult.status === "invalid") {
    return invalidResult(catalogResult.reason, ledger);
  }

  const reachable = reachableCounts(
    templates,
    catalogResult.catalog,
    searchUpperBound,
    ledger,
  );
  if (reachable.status === "stopped") {
    return stoppedResult(reachable.reason, ledger);
  }
  const targetCountPlan = planTargetCounts(
    normalizedPolicy.policy,
    geometricUpperBound,
    reachable.counts,
  );

  const search = searchRegionTopologies({
    input,
    catalog: catalogResult.catalog,
    templates,
    targetCountsDescending: targetCountPlan.searchCountsDescending,
    ledger,
    framePolicies: options.framePolicies,
    framePolicyFilter: regionFramePolicyFilter(input),
    spacingSelections: options.spacingSelections,
    symmetries: options.symmetries,
  });
  if (search.status === "invalid") {
    return invalidResult(search.reason, ledger, targetCountPlan, search);
  }
  if (search.status === "stopped") {
    return stoppedResult(search.reason, ledger, targetCountPlan, search);
  }

  return Object.freeze({
    status: "completed",
    drafts: search.drafts,
    targetCountPlan,
    search,
    work: ledger.snapshot(),
  });
}
