import type { LayerSymmetry } from "~/domain/geometry/transforms";
import {
  normalizeGeneratedGeometryMetric,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import { stableRegionTopologyValue } from "~/domain/solver/region-topology/canonicalValue";
import {
  partialRegionTopologyFitsFrame,
  realizeRegionConstraints,
} from "~/domain/solver/region-topology/constraints";
import {
  createRegionTopologyIdentity,
  type RegionShapeAssignment,
} from "~/domain/solver/region-topology/identity";
import {
  materializeRegionTopologyDraft,
  type MaterializedRegionTopologyDraft,
} from "~/domain/solver/region-topology/materialization";
import {
  REGION_TOPOLOGY_FAMILIES,
  type GuillotineCutNode,
  type OwnedStructuralRegionGraph,
  type PinwheelCycleNode,
  type RegionFramePolicy,
  type RegionGraphTemplate,
  type RegionShape,
  type RegionShapeCatalog,
  type RegionSpacingPolicy,
  type RegionTopologyFamily,
  type SpacedRegionGraph,
} from "~/domain/solver/region-topology/model";
import { compareRegionShapes } from "~/domain/solver/region-topology/shapeCatalog";
import { seedGridCorePinwheels } from "~/domain/solver/region-topology/pinwheelSeeds";
import {
  PINWHEEL_ARM_RESIDUAL_POLICIES,
  PINWHEEL_RESIDUAL_PLACEMENTS,
  REGION_RECURSIVE_CORE_ALIGNMENTS,
  realizeRegionLineSpacing,
  realizeRegionSpacing,
  type RegionSpacingSelection,
} from "~/domain/solver/region-topology/spacing";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
  RegionWorkSnapshot,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

export type RegionTopologySearchRequest = Readonly<{
  input: NormalizedLayerSolverInput;
  catalog: RegionShapeCatalog;
  templates: readonly RegionGraphTemplate[];
  targetCountsDescending: readonly number[];
  ledger: RegionWorkLedger;
  framePolicies?: readonly RegionFramePolicy[];
  framePolicyFilter?: readonly RegionFramePolicy[];
  spacingSelections?: readonly RegionSpacingSelection[];
  symmetries?: readonly LayerSymmetry[];
}>;

export type RegionTopologySearchDraft = MaterializedRegionTopologyDraft &
  Readonly<{
    canonicalRealizationOrderKey: string;
  }>;

export type RegionTopologySearchStatistics = Readonly<{
  rootStateCount: number;
  frontierPopCount: number;
  expandedStateCount: number;
  countPrunedStateCount: number;
  constraintPrunedStateCount: number;
  completedAssignmentCount: number;
  duplicateRealizationCount: number;
  infeasibleRealizationCount: number;
  invalidMaterializationCount: number;
}>;

export type RegionTopologySearchResult =
  | Readonly<{
      status: "completed";
      drafts: readonly RegionTopologySearchDraft[];
      statistics: RegionTopologySearchStatistics;
      work: RegionWorkSnapshot;
    }>
  | Readonly<{
      status: "stopped";
      reason: RegionSearchStopReason;
      drafts: readonly RegionTopologySearchDraft[];
      statistics: RegionTopologySearchStatistics;
      work: RegionWorkSnapshot;
    }>
  | Readonly<{
      status: "invalid";
      reason: string;
      drafts: readonly RegionTopologySearchDraft[];
      statistics: RegionTopologySearchStatistics;
      work: RegionWorkSnapshot;
    }>;

type MutableSearchStatistics = {
  rootStateCount: number;
  frontierPopCount: number;
  expandedStateCount: number;
  countPrunedStateCount: number;
  constraintPrunedStateCount: number;
  completedAssignmentCount: number;
  duplicateRealizationCount: number;
  infeasibleRealizationCount: number;
  invalidMaterializationCount: number;
};

type PreparedTemplate = Readonly<{
  template: RegionGraphTemplate;
  templateOrderIndex: number;
  templateOrderKey: string;
  orientationPreference: number;
  slotIds: readonly string[];
  domains: readonly (readonly RegionShape[])[];
  domainsByCount: readonly ReadonlyMap<number, readonly RegionShape[]>[];
  suffixReachableCounts: readonly ReadonlySet<number>[] | null;
  framePolicies: readonly RegionFramePolicy[];
  spacingSelections: readonly RegionSpacingSelection[];
}>;

type PreparedRoot = Omit<PreparedTemplate, "suffixReachableCounts"> &
  Readonly<{
    targetCount: number;
    suffixReachableCounts: readonly ReadonlySet<number>[];
  }>;

type SearchState = Readonly<{
  root: PreparedRoot;
  nextSlotIndex: number;
  assignedCount: number;
  assignments: readonly RegionShapeAssignment[];
  orderKey: string;
}>;

type PendingIndependentRealization = Readonly<{
  graph: OwnedStructuralRegionGraph;
  framePolicies: readonly RegionFramePolicy[];
  orderKey: string;
  hadImmediateValidPhysicalRealization: boolean;
}>;

type RealizationBatchResult =
  | Readonly<{
      status: "completed";
      hasValidPhysicalRealization: boolean;
      mayHaveIndependentSpacingRealization: boolean;
    }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>
  | Readonly<{ status: "invalid"; reason: string }>;

const supportedPolicies = Object.freeze([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
] as const satisfies readonly RegionSpacingPolicy[]);
const supportedPolicySet = new Set<RegionSpacingPolicy>([
  ...supportedPolicies,
  "suction-group-aware",
]);
const recursiveCoreAlignmentSet = new Set<string>(
  REGION_RECURSIVE_CORE_ALIGNMENTS,
);
const pinwheelResidualPlacementSet = new Set<string>(
  PINWHEEL_RESIDUAL_PLACEMENTS,
);
const pinwheelArmResidualPolicySet = new Set<string>(
  PINWHEEL_ARM_RESIDUAL_POLICIES,
);
const framePolicyOrder: Readonly<Record<RegionFramePolicy, number>> = {
  "center-occupied-bounds": 0,
  "integer-center-occupied-bounds": 1,
  "fill-generation-bounds": 2,
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type RetainedRegionDraft = Readonly<{
  ownerFamily: RegionTopologyFamily;
  draft: RegionTopologySearchDraft;
}>;

export type BoundedRegionDraftRetentionOutcome = Readonly<{
  retained: boolean;
  replacementOccurred: boolean;
  retainedDraftCount: number;
}>;

export type BoundedRegionDraftRetention = Readonly<{
  consider(
    ownerFamily: RegionTopologyFamily,
    draft: RegionTopologySearchDraft,
  ): BoundedRegionDraftRetentionOutcome;
  drafts(): readonly RegionTopologySearchDraft[];
  retainedCount(): number;
}>;

const ownerFamilyOrder = new Map<RegionTopologyFamily, number>(
  REGION_TOPOLOGY_FAMILIES.map((family, index) => [family, index]),
);

function interleaveSequences<T>(
  sequences: readonly (readonly T[])[],
): readonly T[] {
  const values: T[] = [];
  const maximumLength = Math.max(0, ...sequences.map(({ length }) => length));
  for (let itemIndex = 0; itemIndex < maximumLength; itemIndex += 1) {
    for (const sequence of sequences) {
      const value = sequence[itemIndex];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function groupedRetentionEntries(
  entries: readonly RetainedRegionDraft[],
  keyOf: (entry: RetainedRegionDraft) => string,
): ReadonlyMap<string, readonly RetainedRegionDraft[]> {
  const groups = new Map<string, RetainedRegionDraft[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return groups;
}

function compareRetentionCells(
  left: RetainedRegionDraft,
  right: RetainedRegionDraft,
): number {
  return (
    ownerFamilyOrder.get(left.ownerFamily)! -
      ownerFamilyOrder.get(right.ownerFamily)! ||
    compareStrings(left.draft.topologyId, right.draft.topologyId) ||
    framePolicyOrder[left.draft.regionFramePolicy] -
      framePolicyOrder[right.draft.regionFramePolicy]
  );
}

function retentionCellKey(entry: RetainedRegionDraft): string {
  return JSON.stringify([
    entry.ownerFamily,
    entry.draft.topologyId,
    entry.draft.regionFramePolicy,
  ]);
}

function cellStratifiedOrder(
  entries: readonly RetainedRegionDraft[],
): readonly RetainedRegionDraft[] {
  const cells = [
    ...groupedRetentionEntries(entries, retentionCellKey).values(),
  ];
  const cellsByOwner = new Map<
    RegionTopologyFamily,
    Array<readonly RetainedRegionDraft[]>
  >();
  for (const cell of cells) {
    const ownerFamily = cell[0]!.ownerFamily;
    const ownerCells = cellsByOwner.get(ownerFamily) ?? [];
    ownerCells.push(cell);
    cellsByOwner.set(ownerFamily, ownerCells);
  }
  const orderedCells = interleaveSequences(
    [...cellsByOwner.entries()]
      .sort(
        ([left], [right]) =>
          ownerFamilyOrder.get(left)! - ownerFamilyOrder.get(right)!,
      )
      .map(([, ownerCells]) =>
        ownerCells.sort((left, right) =>
          compareRetentionCells(left[0]!, right[0]!),
        ),
      ),
  );
  return interleaveSequences(
    orderedCells.map((cell) =>
      [...cell].sort(
        (left, right) =>
          compareStrings(
            left.draft.canonicalRealizationOrderKey,
            right.draft.canonicalRealizationOrderKey,
          ) ||
          compareStrings(left.draft.realizationKey, right.draft.realizationKey),
      ),
    ),
  );
}

function canonicalStratifiedRetentionOrder(
  entries: readonly RetainedRegionDraft[],
): readonly RetainedRegionDraft[] {
  const entriesByPackageCount = new Map<number, RetainedRegionDraft[]>();
  for (const entry of entries) {
    const packageCount = entry.draft.placements.length;
    const countEntries = entriesByPackageCount.get(packageCount) ?? [];
    countEntries.push(entry);
    entriesByPackageCount.set(packageCount, countEntries);
  }
  return Object.freeze(
    [...entriesByPackageCount.entries()]
      .sort(([left], [right]) => right - left)
      .flatMap(([, countEntries]) => cellStratifiedOrder(countEntries)),
  );
}

function retainedDraftIdentityKey(entry: RetainedRegionDraft): string {
  return JSON.stringify([
    entry.ownerFamily,
    entry.draft.topologyId,
    entry.draft.regionFramePolicy,
    entry.draft.realizationKey,
  ]);
}

/**
 * Keeps higher package-count tiers first, then interleaves owner families while
 * round-robining their `(topologyId, framePolicy)` cells. Each cell contributes
 * drafts by the canonical semantic realization order supplied by the search.
 * Adding a draft can only move an already-evicted draft later in that order, so
 * the bounded streaming result is independent of discovery order without
 * retaining history.
 */
export function createBoundedRegionDraftRetention(
  maxRetainedDrafts: number,
): BoundedRegionDraftRetention {
  if (!Number.isSafeInteger(maxRetainedDrafts) || maxRetainedDrafts <= 0) {
    throw new RangeError("maxRetainedDrafts must be a positive safe integer.");
  }

  const entries: RetainedRegionDraft[] = [];
  const identityKeys = new Set<string>();

  function outcome(
    retained: boolean,
    replacementOccurred: boolean,
  ): BoundedRegionDraftRetentionOutcome {
    return Object.freeze({
      retained,
      replacementOccurred,
      retainedDraftCount: entries.length,
    });
  }

  function consider(
    ownerFamily: RegionTopologyFamily,
    draft: RegionTopologySearchDraft,
  ): BoundedRegionDraftRetentionOutcome {
    if (!ownerFamilyOrder.has(ownerFamily)) {
      throw new RangeError("Unknown region topology owner family.");
    }
    if (
      typeof draft.canonicalRealizationOrderKey !== "string" ||
      draft.canonicalRealizationOrderKey.length === 0
    ) {
      throw new TypeError(
        "canonicalRealizationOrderKey must be a non-empty string.",
      );
    }
    const candidate = Object.freeze({ ownerFamily, draft });
    const candidateIdentityKey = retainedDraftIdentityKey(candidate);
    if (identityKeys.has(candidateIdentityKey)) return outcome(true, false);
    if (entries.length < maxRetainedDrafts) {
      entries.push(candidate);
      identityKeys.add(candidateIdentityKey);
      return outcome(true, false);
    }

    const ordered = canonicalStratifiedRetentionOrder([...entries, candidate]);
    const retained = ordered.slice(0, maxRetainedDrafts);
    if (!retained.includes(candidate)) return outcome(false, false);

    const evicted = ordered[maxRetainedDrafts];
    if (!evicted || evicted === candidate) {
      throw new Error("Bounded region draft retention selected no eviction.");
    }
    const evictedIndex = entries.indexOf(evicted);
    if (evictedIndex < 0) {
      throw new Error(
        "Bounded region draft retention lost its eviction target.",
      );
    }
    identityKeys.delete(retainedDraftIdentityKey(evicted));
    entries.splice(evictedIndex, 1, candidate);
    identityKeys.add(candidateIdentityKey);
    return outcome(true, true);
  }

  return Object.freeze({
    consider,
    drafts: () =>
      Object.freeze(
        canonicalStratifiedRetentionOrder(entries).map(({ draft }) => draft),
      ),
    retainedCount: () => entries.length,
  });
}

function emptyStatistics(): MutableSearchStatistics {
  return {
    rootStateCount: 0,
    frontierPopCount: 0,
    expandedStateCount: 0,
    countPrunedStateCount: 0,
    constraintPrunedStateCount: 0,
    completedAssignmentCount: 0,
    duplicateRealizationCount: 0,
    infeasibleRealizationCount: 0,
    invalidMaterializationCount: 0,
  };
}

function frozenStatistics(
  statistics: MutableSearchStatistics,
): RegionTopologySearchStatistics {
  return Object.freeze({ ...statistics });
}

function sortedDrafts(
  drafts: readonly RegionTopologySearchDraft[],
): readonly RegionTopologySearchDraft[] {
  return Object.freeze(
    [...drafts].sort((left, right) =>
      compareStrings(left.realizationKey, right.realizationKey),
    ),
  );
}

function stoppedResult(
  reason: RegionSearchStopReason,
  drafts: readonly RegionTopologySearchDraft[],
  statistics: MutableSearchStatistics,
  ledger: RegionWorkLedger,
): RegionTopologySearchResult {
  return Object.freeze({
    status: "stopped",
    reason,
    drafts: reason === "cancelled" ? Object.freeze([]) : sortedDrafts(drafts),
    statistics: frozenStatistics(statistics),
    work: ledger.snapshot(),
  });
}

function invalidResult(
  reason: string,
  statistics: MutableSearchStatistics,
  ledger: RegionWorkLedger,
): RegionTopologySearchResult {
  return Object.freeze({
    status: "invalid",
    reason,
    drafts: Object.freeze([]),
    statistics: frozenStatistics(statistics),
    work: ledger.snapshot(),
  });
}

function normalizedTargetCounts(
  values: readonly number[],
  input: NormalizedLayerSolverInput,
): readonly number[] | string {
  const counts: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    if (
      !Number.isSafeInteger(value) ||
      value < input.constraints.minimumPackageCount ||
      value > input.constraints.maximumPackageCount
    ) {
      return "Every target count must be a safe integer within solver constraints.";
    }
    if (!seen.has(value)) {
      seen.add(value);
      counts.push(value);
    }
  }
  counts.sort((left, right) => right - left);
  return Object.freeze(counts);
}

function sortedObject(value: Readonly<Record<string, string>>): unknown {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      compareStrings(left, right),
    ),
  );
}

function canonicalTemplateValue(template: RegionGraphTemplate): unknown {
  return {
    templateKey: template.templateKey,
    claimedFamily: template.claimedFamily,
    definitionVersion: template.definitionVersion,
    slots: [...template.slots]
      .map((slot) => ({
        ...slot,
        footprintClasses: [...slot.footprintClasses].sort(compareStrings),
        packageCounts: slot.packageCounts
          ? [...slot.packageCounts].sort((left, right) => left - right)
          : undefined,
        spacingX: [...slot.spacingX].sort(compareStrings),
        spacingY: [...slot.spacingY].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    relations: [...template.relations]
      .map((relation) => relation)
      .sort((left, right) =>
        compareStrings(
          stableRegionTopologyValue(left),
          stableRegionTopologyValue(right),
        ),
      ),
    embedding: {
      ...template.embedding,
      rotationSystem: [...template.embedding.rotationSystem].sort(
        (left, right) => compareStrings(left.slotId, right.slotId),
      ),
    },
    automorphisms: template.automorphisms
      .map(sortedObject)
      .sort((left, right) =>
        compareStrings(
          stableRegionTopologyValue(left),
          stableRegionTopologyValue(right),
        ),
      ),
    collapseRules: [...template.collapseRules].sort((left, right) =>
      compareStrings(
        stableRegionTopologyValue(left),
        stableRegionTopologyValue(right),
      ),
    ),
    framePolicies: [...template.framePolicies].sort(
      (left, right) => framePolicyOrder[left] - framePolicyOrder[right],
    ),
    witness: template.witness,
  };
}

function canonicalTemplates(
  templates: readonly RegionGraphTemplate[],
):
  | readonly Readonly<{ template: RegionGraphTemplate; orderKey: string }>[]
  | string {
  const unique = new Map<string, RegionGraphTemplate>();
  for (const template of templates) {
    if (typeof template !== "object" || template === null) {
      return "Every region template must be an object.";
    }
    const supportedWitness =
      (template.claimedFamily === "guillotine" &&
        template.witness.kind === "guillotine-cut-tree") ||
      (template.claimedFamily === "pinwheel" &&
        template.witness.kind === "four-arm-cycle") ||
      (template.claimedFamily === "bridge-chain" &&
        template.witness.kind === "embedded-bridge") ||
      (template.claimedFamily === "spine-corridor" &&
        template.witness.kind === "spine-tree");
    if (!supportedWitness) {
      return "The claimed topology family does not match a supported search witness.";
    }
    const orderKey = stableRegionTopologyValue(
      canonicalTemplateValue(template),
    );
    if (!unique.has(orderKey)) unique.set(orderKey, template);
  }
  return Object.freeze(
    [...unique.entries()]
      .map(([orderKey, template]) => Object.freeze({ template, orderKey }))
      .sort((left, right) => compareStrings(left.orderKey, right.orderKey)),
  );
}

function pinwheelSlotIds(cycle: PinwheelCycleNode): readonly string[] {
  const slotIds = [...cycle.armSlotIds];
  if (cycle.core.kind === "grid") slotIds.push(cycle.core.slotId);
  if (cycle.core.kind === "cycle") {
    slotIds.push(...pinwheelSlotIds(cycle.core.cycle));
  }
  return Object.freeze(slotIds);
}

function structuralSlotIds(
  template: RegionGraphTemplate,
): readonly string[] | string {
  const slotIds: string[] = [];
  if (template.witness.kind === "guillotine-cut-tree") {
    function visit(node: GuillotineCutNode): void {
      if (node.kind === "slot") {
        slotIds.push(node.slotId);
        return;
      }
      node.children.forEach(visit);
    }
    visit(template.witness.root);
  } else if (template.witness.kind === "four-arm-cycle") {
    slotIds.push(...pinwheelSlotIds(template.witness.root));
  } else if (template.witness.kind === "embedded-bridge") {
    const relationIds = new Set(template.relations.map(({ id }) => id));
    if (
      template.witness.rotationSystemRelationIds.length === 0 ||
      template.witness.rotationSystemRelationIds.some(
        (relationId) => !relationIds.has(relationId),
      )
    ) {
      return "An embedded-bridge witness must reference known graph relations.";
    }
    slotIds.push(
      ...template.embedding.rotationSystem.map(({ slotId }) => slotId),
    );
  } else if (template.witness.kind === "spine-tree") {
    if (
      !Array.isArray(template.witness.orderedSpines) ||
      template.witness.orderedSpines.length !== 1
    ) {
      return "A step-spine witness must define exactly one spine.";
    }
    const spine = template.witness.orderedSpines[0];
    if (
      !spine ||
      !Array.isArray(spine.attachmentSlotIds) ||
      spine.attachmentSlotIds.length !== 2
    ) {
      return "A step-spine witness must define exactly two attachments.";
    }
    slotIds.push(
      spine.attachmentSlotIds[1],
      spine.spineSlotId,
      spine.attachmentSlotIds[0],
      template.witness.mainSlotId,
    );
  } else {
    return "Unsupported region topology witness.";
  }

  const templateSlotIds = template.slots.map(({ id }) => id);
  if (
    new Set(slotIds).size !== slotIds.length ||
    new Set(templateSlotIds).size !== templateSlotIds.length ||
    slotIds.length !== templateSlotIds.length ||
    slotIds.some((slotId) => !templateSlotIds.includes(slotId))
  ) {
    return "Topology witness slots must match template slots exactly.";
  }
  return Object.freeze(slotIds);
}

function shapeFitsSlot(
  shape: RegionShape,
  slot: RegionGraphTemplate["slots"][number],
): boolean {
  return (
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

type ShapeDomainResult =
  | Readonly<{
      status: "completed";
      domains: readonly (readonly RegionShape[])[];
      domainsByCount: readonly ReadonlyMap<number, readonly RegionShape[]>[];
    }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>
  | Readonly<{ status: "invalid"; reason: string }>;

function shapeDomains(
  template: RegionGraphTemplate,
  slotIds: readonly string[],
  catalog: RegionShapeCatalog,
  ledger: RegionWorkLedger,
): ShapeDomainResult {
  const slotById = new Map(template.slots.map((slot) => [slot.id, slot]));
  const domains: Array<readonly RegionShape[]> = [];
  const domainsByCount: Array<ReadonlyMap<number, readonly RegionShape[]>> = [];
  for (const slotId of slotIds) {
    const slot = slotById.get(slotId)!;
    if (slot.optionalZero) {
      return Object.freeze({
        status: "invalid",
        reason:
          "Optional zero-slot collapse is not implemented in this search slice.",
      });
    }

    const domain: RegionShape[] = [];
    for (const shape of catalog.orderedShapes) {
      const decision = ledger.debit("domain-revision");
      if (decision !== "continue") {
        return Object.freeze({ status: "stopped", reason: decision });
      }
      if (shapeFitsSlot(shape, slot)) domain.push(shape);
    }
    domain.sort(compareRegionShapes);
    const frozenDomain = Object.freeze(domain);
    const byCountMutable = new Map<number, RegionShape[]>();
    for (const shape of frozenDomain) {
      const shapes = byCountMutable.get(shape.packageCount) ?? [];
      shapes.push(shape);
      byCountMutable.set(shape.packageCount, shapes);
    }
    const byCount = new Map<number, readonly RegionShape[]>();
    for (const packageCount of [...byCountMutable.keys()].sort(
      (left, right) => left - right,
    )) {
      byCount.set(
        packageCount,
        Object.freeze(byCountMutable.get(packageCount)!),
      );
    }
    domains.push(frozenDomain);
    domainsByCount.push(byCount);
  }
  return Object.freeze({
    status: "completed",
    domains: Object.freeze(domains),
    domainsByCount: Object.freeze(domainsByCount),
  });
}

function suffixReachableCounts(
  domains: readonly (readonly RegionShape[])[],
  targetCount: number,
  ledger: RegionWorkLedger,
):
  | Readonly<{ status: "completed"; suffix: readonly ReadonlySet<number>[] }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }> {
  const suffix: Array<ReadonlySet<number>> = Array.from(
    { length: domains.length + 1 },
    () => new Set<number>(),
  );
  suffix[domains.length] = new Set([0]);

  for (let index = domains.length - 1; index >= 0; index -= 1) {
    const reachable = new Set<number>();
    const packageCounts = [
      ...new Set(domains[index]!.map(({ packageCount }) => packageCount)),
    ].sort((left, right) => left - right);
    for (const packageCount of packageCounts) {
      for (const suffixCount of suffix[index + 1]!) {
        const decision = ledger.debit("count-dp-word");
        if (decision !== "continue") {
          return Object.freeze({ status: "stopped", reason: decision });
        }
        const count = packageCount + suffixCount;
        if (count <= targetCount) reachable.add(count);
      }
    }
    suffix[index] = reachable;
  }
  return Object.freeze({
    status: "completed",
    suffix: Object.freeze(suffix),
  });
}

const structuralShapeKeyByShape = new WeakMap<RegionShape, string>();
const stateOrderShapeKeyByShape = new WeakMap<RegionShape, string>();

function cachedShapeKey(
  cache: WeakMap<RegionShape, string>,
  shape: RegionShape,
  includeNaturalSize: boolean,
): string {
  const cached = cache.get(shape);
  if (cached !== undefined) return cached;
  const key = stableRegionTopologyValue({
    footprintClass: shape.footprintClass,
    columns: shape.columns,
    rows: shape.rows,
    packageCount: shape.packageCount,
    ...(includeNaturalSize ? { naturalSizeMm: shape.naturalSizeMm } : {}),
    key: shape.key,
  });
  cache.set(shape, key);
  return key;
}

function lengthPrefixedSequence(values: readonly string[]): string {
  return values.map((value) => `${value.length}:${value}`).join("");
}

function structuralAssignmentKey(
  root: PreparedRoot,
  nextSlotIndex: number,
  assignments: readonly RegionShapeAssignment[],
): string {
  return `${root.templateOrderIndex}:${nextSlotIndex}:${lengthPrefixedSequence(
    assignments.map(({ shape }) =>
      cachedShapeKey(structuralShapeKeyByShape, shape, true),
    ),
  )}`;
}

function stateOrderKey(assignments: readonly RegionShapeAssignment[]): string {
  return `[${assignments
    .map(({ shape }) => cachedShapeKey(stateOrderShapeKeyByShape, shape, false))
    .join(",")}]`;
}

function targetCompatibleAfterAssignment(
  root: PreparedRoot,
  assignedCount: number,
  nextSlotIndex: number,
): boolean {
  const suffixCounts = root.suffixReachableCounts[nextSlotIndex];
  const remainingCount = root.targetCount - assignedCount;
  return (
    suffixCounts !== undefined &&
    remainingCount >= 0 &&
    suffixCounts.has(remainingCount)
  );
}

function compareStates(left: SearchState, right: SearchState): number {
  if (left.root.targetCount !== right.root.targetCount) {
    return left.root.targetCount > right.root.targetCount ? -1 : 1;
  }
  return (
    left.root.slotIds.length - right.root.slotIds.length ||
    right.nextSlotIndex - left.nextSlotIndex ||
    right.assignedCount - left.assignedCount ||
    left.root.orientationPreference - right.root.orientationPreference ||
    compareStrings(left.root.templateOrderKey, right.root.templateOrderKey) ||
    compareStrings(left.orderKey, right.orderKey)
  );
}

function normalizedFramePolicies(
  requested: readonly RegionFramePolicy[] | undefined,
  template: RegionGraphTemplate,
  filter: readonly RegionFramePolicy[] | undefined,
): readonly RegionFramePolicy[] | string {
  const policies = requested ?? template.framePolicies;
  if (policies.length === 0) {
    return "At least one region frame policy is required.";
  }

  const allowed = new Set(template.framePolicies);
  const unique = new Set<RegionFramePolicy>();
  for (const policy of policies) {
    if (
      policy !== "center-occupied-bounds" &&
      policy !== "integer-center-occupied-bounds" &&
      policy !== "fill-generation-bounds"
    ) {
      return "Unknown region frame policy.";
    }
    if (!allowed.has(policy)) {
      return `Region frame policy ${policy} is not allowed by the template.`;
    }
    unique.add(policy);
  }

  const normalized = [...unique].sort(
    (left, right) => framePolicyOrder[left] - framePolicyOrder[right],
  );
  if (filter === undefined) return Object.freeze(normalized);

  const selected = new Set<RegionFramePolicy>();
  for (const policy of filter) {
    if (
      policy !== "center-occupied-bounds" &&
      policy !== "integer-center-occupied-bounds" &&
      policy !== "fill-generation-bounds"
    ) {
      return "Unknown region frame policy.";
    }
    selected.add(policy);
  }
  return Object.freeze(normalized.filter((policy) => selected.has(policy)));
}

function hasPinwheelCore(template: RegionGraphTemplate): boolean {
  return (
    template.witness.kind === "four-arm-cycle" &&
    template.witness.root.core.kind !== "empty"
  );
}

function hasGridPinwheelCore(template: RegionGraphTemplate): boolean {
  return (
    template.witness.kind === "four-arm-cycle" &&
    template.witness.root.core.kind === "grid"
  );
}

function defaultSpacingSelections(
  template: RegionGraphTemplate,
): readonly RegionSpacingSelection[] {
  const hasCore = hasPinwheelCore(template);
  const hasGridCore = hasGridPinwheelCore(template);
  const alignments = hasCore
    ? REGION_RECURSIVE_CORE_ALIGNMENTS
    : ([undefined] as const);
  const selections: RegionSpacingSelection[] = [];
  const immediatePolicies =
    template.claimedFamily === "guillotine"
      ? supportedPolicies.filter((policy) => policy !== "inter-region-seam")
      : supportedPolicies;
  for (const x of immediatePolicies) {
    for (const y of immediatePolicies) {
      for (const recursiveCoreAlignment of alignments) {
        const residualPlacements =
          hasCore && (x === "inter-region-seam" || y === "inter-region-seam")
            ? PINWHEEL_RESIDUAL_PLACEMENTS
            : ([undefined] as const);
        const armResidualPolicies = hasGridCore
          ? PINWHEEL_ARM_RESIDUAL_POLICIES
          : ([undefined] as const);
        for (const pinwheelResidualPlacement of residualPlacements) {
          for (const pinwheelArmResidualPolicy of armResidualPolicies) {
            selections.push(
              Object.freeze({
                x,
                y,
                ...(recursiveCoreAlignment === undefined
                  ? {}
                  : { recursiveCoreAlignment }),
                ...(pinwheelResidualPlacement === undefined
                  ? {}
                  : { pinwheelResidualPlacement }),
                ...(pinwheelArmResidualPolicy === undefined
                  ? {}
                  : { pinwheelArmResidualPolicy }),
              }),
            );
          }
        }
      }
    }
  }
  return Object.freeze(selections);
}

function normalizedSpacingSelections(
  requested: readonly RegionSpacingSelection[] | undefined,
  template: RegionGraphTemplate,
): readonly RegionSpacingSelection[] | string {
  const values = requested ?? defaultSpacingSelections(template);
  if (values.length === 0) {
    return "At least one region spacing selection is required.";
  }

  const commonX = template.slots.reduce(
    (allowed, slot) =>
      new Set([...allowed].filter((policy) => slot.spacingX.includes(policy))),
    new Set<RegionSpacingPolicy>(supportedPolicySet),
  );
  const commonY = template.slots.reduce(
    (allowed, slot) =>
      new Set([...allowed].filter((policy) => slot.spacingY.includes(policy))),
    new Set<RegionSpacingPolicy>(supportedPolicySet),
  );
  const unique = new Map<string, RegionSpacingSelection>();
  for (const selection of values) {
    if (typeof selection !== "object" || selection === null) {
      return "Every spacing selection must be an object.";
    }
    if (!supportedPolicySet.has(selection.x)) {
      if (selection.x === "suction-group-aware") {
        return `Region x spacing policy ${selection.x} is not implemented.`;
      }
      return "Unknown x spacing policy.";
    }
    if (!supportedPolicySet.has(selection.y)) {
      if (selection.y === "suction-group-aware") {
        return `Region y spacing policy ${selection.y} is not implemented.`;
      }
      return "Unknown y spacing policy.";
    }
    if (
      selection.recursiveCoreAlignment !== undefined &&
      !recursiveCoreAlignmentSet.has(selection.recursiveCoreAlignment)
    ) {
      return "Unknown recursive pinwheel core alignment.";
    }
    if (
      selection.pinwheelResidualPlacement !== undefined &&
      !pinwheelResidualPlacementSet.has(selection.pinwheelResidualPlacement)
    ) {
      return "Unknown pinwheel residual placement.";
    }
    if (
      selection.pinwheelArmResidualPolicy !== undefined &&
      !pinwheelArmResidualPolicySet.has(selection.pinwheelArmResidualPolicy)
    ) {
      return "Unknown pinwheel arm residual policy.";
    }
    const explicitResidual = selection.pinwheelArmResidualMm;
    if (
      selection.suctionGroupCenterPhaseMm !== undefined &&
      selection.suctionGroupCenterPhaseMm !== 0 &&
      selection.suctionGroupCenterPhaseMm !== 0.5
    )
      return "Unknown suction group center phase.";
    if (
      selection.suctionGroupRemainder !== undefined &&
      selection.suctionGroupRemainder !== "first" &&
      selection.suctionGroupRemainder !== "last"
    )
      return "Unknown suction group remainder placement.";
    if (
      explicitResidual !== undefined &&
      (typeof explicitResidual !== "object" || explicitResidual === null)
    ) {
      return "Pinwheel arm residual allocation must be an object.";
    }
    if (
      explicitResidual !== undefined &&
      [explicitResidual.x, explicitResidual.y].some(
        (amount) =>
          amount !== undefined && (!Number.isFinite(amount) || amount < 0),
      )
    ) {
      return "Pinwheel arm residual allocation must be finite and non-negative.";
    }
    if (!commonX.has(selection.x) || !commonY.has(selection.y)) continue;

    const pinwheel = template.claimedFamily === "pinwheel";
    const normalized: RegionSpacingSelection = Object.freeze({
      x: selection.x,
      y: selection.y,
      ...(selection.suctionGroupCenterPhaseMm === undefined
        ? {}
        : { suctionGroupCenterPhaseMm: selection.suctionGroupCenterPhaseMm }),
      ...(selection.suctionGroupRemainder === undefined
        ? {}
        : { suctionGroupRemainder: selection.suctionGroupRemainder }),
      ...(pinwheel && selection.recursiveCoreAlignment !== undefined
        ? { recursiveCoreAlignment: selection.recursiveCoreAlignment }
        : {}),
      ...(pinwheel && selection.pinwheelResidualPlacement !== undefined
        ? { pinwheelResidualPlacement: selection.pinwheelResidualPlacement }
        : {}),
      ...(pinwheel && selection.pinwheelArmResidualPolicy !== undefined
        ? { pinwheelArmResidualPolicy: selection.pinwheelArmResidualPolicy }
        : {}),
      ...(pinwheel && explicitResidual !== undefined
        ? {
            pinwheelArmResidualMm: Object.freeze({
              ...(explicitResidual.x === undefined
                ? {}
                : { x: explicitResidual.x }),
              ...(explicitResidual.y === undefined
                ? {}
                : { y: explicitResidual.y }),
            }),
          }
        : {}),
    });
    unique.set(stableRegionTopologyValue(normalized), normalized);
  }
  return Object.freeze(
    [...unique.values()].sort((left, right) =>
      compareStrings(
        stableRegionTopologyValue(left),
        stableRegionTopologyValue(right),
      ),
    ),
  );
}

type RegionSpacingPlan = readonly RegionSpacingSelection[];

function uniformSpacingPlans(
  nodeCount: number,
  selections: readonly RegionSpacingSelection[],
): readonly RegionSpacingPlan[] {
  return Object.freeze(
    selections.map((selection) =>
      Object.freeze(Array.from({ length: nodeCount }, () => selection)),
    ),
  );
}

function independentGridPinwheelSpacingPlanCatalog(
  input: NormalizedLayerSolverInput,
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly IndependentSpacingPlanSpec[]>,
): IndependentSpacingPlanCatalog | string {
  if (
    graph.ownerFamily !== "pinwheel" ||
    graph.witness.kind !== "four-arm-cycle" ||
    graph.witness.root.core.kind !== "grid"
  ) {
    return "Independent grid spacing requires a grid-core pinwheel witness.";
  }

  const alignments = REGION_RECURSIVE_CORE_ALIGNMENTS;
  const specs = independentSpacingPlanSpecs(
    graph.nodes.length,
    specCache,
  ).filter(({ mask }) => setBitCount(mask) === 1);
  const plans: RegionSpacingPlan[] = [];
  for (const spec of specs) {
    for (const recursiveCoreAlignment of alignments) {
      plans.push(
        Object.freeze(
          graph.nodes.map((_, regionIndex) =>
            Object.freeze({
              x:
                (spec.mask & (1 << (regionIndex * 2))) !== 0
                  ? spec.distributedPolicy
                  : "compact",
              y:
                (spec.mask & (1 << (regionIndex * 2 + 1))) !== 0
                  ? spec.distributedPolicy
                  : "compact",
              ...(recursiveCoreAlignment === undefined
                ? {}
                : { recursiveCoreAlignment }),
              pinwheelArmResidualPolicy: "spacing-directed" as const,
            }),
          ),
        ),
      );
    }
  }
  const groupCapacity = input.constraints.provisionalPackagesPerCycle;
  const groupedPlans: RegionSpacingPlan[] = [];
  if (groupCapacity > 1) {
    for (const plan of [...plans]) {
      const groupedIndex = plan.findIndex((selection, index) => {
        const node = graph.nodes[index]!;
        return node.footprintClass === "crosswise"
          ? selection.y === "continuous-space-between" &&
              node.rows > groupCapacity
          : selection.x === "continuous-space-between" &&
              node.columns > groupCapacity;
      });
      if (groupedIndex < 0) continue;
      for (const suctionGroupRemainder of ["first", "last"] as const) {
        for (const suctionGroupCenterPhaseMm of [undefined, 0.5] as const) {
          groupedPlans.push(
            Object.freeze(
              plan.map((selection, index) =>
                index !== groupedIndex
                  ? selection
                  : Object.freeze({
                      ...selection,
                      x:
                        selection.x === "continuous-space-between"
                          ? ("suction-group-aware" as const)
                          : selection.x,
                      y:
                        selection.y === "continuous-space-between"
                          ? ("suction-group-aware" as const)
                          : selection.y,
                      suctionGroupRemainder,
                      ...(suctionGroupCenterPhaseMm === undefined
                        ? {}
                        : { suctionGroupCenterPhaseMm }),
                    }),
              ),
            ),
          );
        }
      }
    }
  }
  const groupedLineCount = (plan: RegionSpacingPlan) =>
    Math.max(
      ...plan.map((selection, index) =>
        selection.x === "suction-group-aware"
          ? graph.nodes[index]!.columns
          : selection.y === "suction-group-aware"
            ? graph.nodes[index]!.rows
            : 0,
      ),
    );
  groupedPlans.sort(
    (left, right) => groupedLineCount(right) - groupedLineCount(left),
  );
  const frozenPlans = Object.freeze([...groupedPlans, ...plans]);
  return Object.freeze({
    length: frozenPlans.length,
    planAt(index: number): RegionSpacingPlan {
      const plan = frozenPlans[index];
      if (!plan) {
        throw new RangeError(
          "Independent grid pinwheel plan index is out of range.",
        );
      }
      return plan;
    },
  });
}

function independentPinwheelSpacingPlanCatalog(
  input: NormalizedLayerSolverInput,
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly IndependentSpacingPlanSpec[]>,
  maximumWorkUnits: number,
): IndependentSpacingPlanCatalog | string {
  if (
    graph.ownerFamily !== "pinwheel" ||
    graph.witness.kind !== "four-arm-cycle"
  ) {
    return "Independent pinwheel spacing requires a four-arm-cycle witness.";
  }
  if (graph.witness.root.core.kind === "empty") {
    return independentEmptyPinwheelResidualPlanCatalog(
      input,
      graph,
      maximumWorkUnits,
    );
  }
  if (graph.witness.root.core.kind === "grid") {
    return independentGridPinwheelSpacingPlanCatalog(input, graph, specCache);
  }
  return "Independent spacing for recursive pinwheel cores is not implemented.";
}

function canonicalRegionIndex(
  slotId: string,
  nodeCount: number,
): number | null {
  const match = /^region-(\d+)$/.exec(slotId);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 && index < nodeCount
    ? index
    : null;
}

function pinwheelArmRegionIndices(
  graph: OwnedStructuralRegionGraph,
): readonly [number, number, number, number] | string {
  if (graph.witness.kind !== "four-arm-cycle") {
    return "Pinwheel arm roles require a four-arm-cycle witness.";
  }
  const indices = graph.witness.root.armSlotIds.map((slotId) =>
    canonicalRegionIndex(slotId, graph.nodes.length),
  );
  if (indices.some((index) => index === null)) {
    return "Pinwheel arm roles must reference canonical regions.";
  }
  return Object.freeze(indices) as readonly [number, number, number, number];
}

function hasIndependentOppositePinwheelCounts(
  graph: OwnedStructuralRegionGraph,
): boolean | string {
  const indices = pinwheelArmRegionIndices(graph);
  if (typeof indices === "string") return indices;
  const counts = indices.map((index) => graph.nodes[index]!.packageCount);
  return counts[0] !== counts[2] || counts[1] !== counts[3];
}

function priorityEmptyPinwheelSpacingPlans(
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly IndependentSpacingPlanSpec[]>,
): readonly RegionSpacingPlan[] | string {
  if (
    graph.ownerFamily !== "pinwheel" ||
    graph.witness.kind !== "four-arm-cycle" ||
    graph.witness.root.core.kind !== "empty"
  ) {
    return "Priority empty-core spacing requires an empty-core pinwheel witness.";
  }
  const independentCounts = hasIndependentOppositePinwheelCounts(graph);
  if (typeof independentCounts === "string") return independentCounts;
  if (!independentCounts) return Object.freeze([]);

  const specs = independentSpacingPlanSpecs(
    graph.nodes.length,
    specCache,
  ).filter(
    ({ distributedPolicy, mask }) =>
      distributedPolicy === "continuous-space-between" &&
      setBitCount(mask) === 1,
  );
  return Object.freeze(
    specs.map(({ distributedPolicy, mask }) =>
      Object.freeze(
        graph.nodes.map((_, regionIndex) =>
          Object.freeze({
            x:
              (mask & (1 << (regionIndex * 2))) !== 0
                ? distributedPolicy
                : "compact",
            y:
              (mask & (1 << (regionIndex * 2 + 1))) !== 0
                ? distributedPolicy
                : "compact",
            pinwheelArmResidualPolicy: "spacing-directed" as const,
          }),
        ),
      ),
    ),
  );
}

function stepSpineRegionIndices(
  graph: OwnedStructuralRegionGraph,
): readonly number[] | string {
  if (graph.witness.kind !== "spine-tree") {
    return "Step-spine spacing requires a spine-tree witness.";
  }
  const spine = graph.witness.orderedSpines[0];
  const slotIds = [
    graph.witness.mainSlotId,
    spine.spineSlotId,
    ...spine.attachmentSlotIds,
  ];
  const indices = slotIds.map((slotId) =>
    canonicalRegionIndex(slotId, graph.nodes.length),
  );
  if (
    indices.some((index) => index === null) ||
    new Set(indices).size !== graph.nodes.length ||
    indices.length !== graph.nodes.length
  ) {
    return "Step-spine roles must map bijectively to canonical regions.";
  }
  return Object.freeze(indices as number[]);
}

function setBitCount(value: number): number {
  let remaining = value;
  let count = 0;
  while (remaining > 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

type IndependentSpacingPlanSpec = Readonly<{
  distributedPolicy: "continuous-space-between" | "integer-balanced";
  mask: number;
}>;

type IndependentSpacingPlanCatalog = Readonly<{
  length: number;
  planAt(index: number): RegionSpacingPlan | null;
}>;

type PinwheelArmRoleIndex = 0 | 1 | 2 | 3;
type PinwheelResidualChainSpec = Readonly<{
  axis: "x" | "y";
  firstRoleIndex: PinwheelArmRoleIndex;
  secondRoleIndex: PinwheelArmRoleIndex;
}>;
type PinwheelArmMetric = Readonly<{
  regionIndex: number;
  columns: number;
  rows: number;
  naturalLengthMm: number;
  naturalWidthMm: number;
  itemLengthMm: number;
  itemWidthMm: number;
}>;
type PinwheelResidualAllocationSpec = readonly [number, number, number, number];

function pinwheelResidualChains(
  chirality: PinwheelCycleNode["chirality"],
): readonly PinwheelResidualChainSpec[] {
  return chirality === "clockwise"
    ? Object.freeze([
        Object.freeze({
          axis: "x" as const,
          firstRoleIndex: 3 as const,
          secondRoleIndex: 0 as const,
        }),
        Object.freeze({
          axis: "x" as const,
          firstRoleIndex: 2 as const,
          secondRoleIndex: 1 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          firstRoleIndex: 3 as const,
          secondRoleIndex: 2 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          firstRoleIndex: 0 as const,
          secondRoleIndex: 1 as const,
        }),
      ])
    : Object.freeze([
        Object.freeze({
          axis: "x" as const,
          firstRoleIndex: 0 as const,
          secondRoleIndex: 1 as const,
        }),
        Object.freeze({
          axis: "x" as const,
          firstRoleIndex: 3 as const,
          secondRoleIndex: 2 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          firstRoleIndex: 0 as const,
          secondRoleIndex: 3 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          firstRoleIndex: 1 as const,
          secondRoleIndex: 2 as const,
        }),
      ]);
}

function pinwheelArmMetrics(
  input: NormalizedLayerSolverInput,
  graph: OwnedStructuralRegionGraph,
):
  | readonly [
      PinwheelArmMetric,
      PinwheelArmMetric,
      PinwheelArmMetric,
      PinwheelArmMetric,
    ]
  | string {
  const regionIndices = pinwheelArmRegionIndices(graph);
  if (typeof regionIndices === "string") return regionIndices;
  const dimensions = input.package.dimensionsMm;
  const clearance = input.package.clearanceMm;
  const metrics = regionIndices.map((regionIndex) => {
    const node = graph.nodes[regionIndex]!;
    const crosswise = node.footprintClass === "crosswise";
    const itemLengthMm = crosswise ? dimensions.width : dimensions.length;
    const itemWidthMm = crosswise ? dimensions.length : dimensions.width;
    return Object.freeze({
      regionIndex,
      columns: node.columns,
      rows: node.rows,
      naturalLengthMm: normalizeGeneratedGeometryMetric(
        node.columns * itemLengthMm + (node.columns - 1) * clearance,
        `pinwheel.region-${regionIndex}.naturalLengthMm`,
      ),
      naturalWidthMm: normalizeGeneratedGeometryMetric(
        node.rows * itemWidthMm + (node.rows - 1) * clearance,
        `pinwheel.region-${regionIndex}.naturalWidthMm`,
      ),
      itemLengthMm,
      itemWidthMm,
    });
  });
  return Object.freeze(metrics) as readonly [
    PinwheelArmMetric,
    PinwheelArmMetric,
    PinwheelArmMetric,
    PinwheelArmMetric,
  ];
}

function pinwheelMetricSpan(
  metric: PinwheelArmMetric,
  axis: "x" | "y",
): number {
  return axis === "x" ? metric.naturalLengthMm : metric.naturalWidthMm;
}

function pinwheelLineCount(metric: PinwheelArmMetric, axis: "x" | "y"): number {
  return axis === "x" ? metric.columns : metric.rows;
}

function pinwheelResidualAllocationValues(
  residualMm: number,
  first: PinwheelArmMetric,
  second: PinwheelArmMetric,
  axis: "x" | "y",
  maximumValueCount: number,
): readonly number[] {
  if (residualMm <= SOLVER_GEOMETRY_EPSILON_MM) {
    return Object.freeze([0]);
  }
  const firstGapCount = Math.max(0, pinwheelLineCount(first, axis) - 1);
  const secondGapCount = Math.max(0, pinwheelLineCount(second, axis) - 1);
  const minimumFirstMm = 0;
  const maximumFirstMm = residualMm;

  const totalGapCount = firstGapCount + secondGapCount;
  const equalGapFirstMm =
    totalGapCount === 0
      ? minimumFirstMm
      : (residualMm * firstGapCount) / totalGapCount;
  const midpointMm = (minimumFirstMm + maximumFirstMm) / 2;
  const priority = [
    minimumFirstMm,
    maximumFirstMm,
    equalGapFirstMm,
    midpointMm,
    Math.floor(midpointMm),
    Math.ceil(midpointMm),
  ];
  const values = new Map<string, number>();
  const append = (candidate: number) => {
    const clamped = Math.min(
      maximumFirstMm,
      Math.max(minimumFirstMm, candidate),
    );
    const normalized = normalizeGeneratedGeometryMetric(
      clamped,
      "pinwheel.residualAllocationMm",
    );
    values.set(String(normalized), normalized);
  };
  for (const candidate of priority) {
    append(candidate);
    if (values.size >= maximumValueCount) {
      return Object.freeze([...values.values()]);
    }
  }

  const minimumInteger = Math.ceil(minimumFirstMm);
  const maximumInteger = Math.floor(maximumFirstMm);
  let lower = Math.min(maximumInteger, Math.floor(equalGapFirstMm));
  let upper = Math.max(minimumInteger, lower + 1);
  while (
    values.size < maximumValueCount &&
    (lower >= minimumInteger || upper <= maximumInteger)
  ) {
    if (lower < minimumInteger) {
      append(upper);
      upper += 1;
      continue;
    }
    if (upper > maximumInteger) {
      append(lower);
      lower -= 1;
      continue;
    }
    if (
      Math.abs(lower - equalGapFirstMm) <= Math.abs(upper - equalGapFirstMm)
    ) {
      append(lower);
      lower -= 1;
    } else {
      append(upper);
      upper += 1;
    }
  }
  return Object.freeze([...values.values()]);
}

type MutablePinwheelBounds = {
  minX?: number;
  minY?: number;
  maxX?: number;
  maxY?: number;
};

type PinwheelAxisPolicies = Readonly<{
  x: RegionSpacingPolicy;
  y: RegionSpacingPolicy;
}>;

const pinwheelAxisPolicies = Object.freeze([
  Object.freeze({ x: "compact", y: "integer-balanced" }),
  Object.freeze({ x: "integer-balanced", y: "compact" }),
  Object.freeze({ x: "integer-balanced", y: "integer-balanced" }),
  Object.freeze({ x: "compact", y: "continuous-space-between" }),
  Object.freeze({ x: "continuous-space-between", y: "compact" }),
  Object.freeze({
    x: "continuous-space-between",
    y: "continuous-space-between",
  }),
  Object.freeze({ x: "compact", y: "compact" }),
  Object.freeze({ x: "continuous-space-between", y: "integer-balanced" }),
  Object.freeze({ x: "integer-balanced", y: "continuous-space-between" }),
] as const satisfies readonly PinwheelAxisPolicies[]);

function pinwheelResidualPlanIsCollisionSafe(
  metrics: readonly [
    PinwheelArmMetric,
    PinwheelArmMetric,
    PinwheelArmMetric,
    PinwheelArmMetric,
  ],
  chains: readonly PinwheelResidualChainSpec[],
  frameLengthMm: number,
  frameWidthMm: number,
  residualsMm: readonly number[],
  firstExtrasMm: PinwheelResidualAllocationSpec,
  clearanceMm: number,
  policies: PinwheelAxisPolicies,
): boolean {
  const bounds: MutablePinwheelBounds[] = Array.from({ length: 4 }, () => ({}));
  chains.forEach((chain, chainIndex) => {
    const first = metrics[chain.firstRoleIndex];
    const second = metrics[chain.secondRoleIndex];
    const policy = chain.axis === "x" ? policies.x : policies.y;
    const absorbsResidual = policy !== "compact";
    const firstExtraMm = absorbsResidual ? firstExtrasMm[chainIndex]! : 0;
    const secondExtraMm = absorbsResidual
      ? residualsMm[chainIndex]! - firstExtraMm
      : 0;
    const frameSpanMm = chain.axis === "x" ? frameLengthMm : frameWidthMm;
    const firstSpanMm = pinwheelMetricSpan(first, chain.axis) + firstExtraMm;
    const secondSpanMm = pinwheelMetricSpan(second, chain.axis) + secondExtraMm;
    const secondMinimumMm = frameSpanMm - secondSpanMm;
    if (chain.axis === "x") {
      bounds[chain.firstRoleIndex]!.minX = 0;
      bounds[chain.firstRoleIndex]!.maxX = firstSpanMm;
      bounds[chain.secondRoleIndex]!.minX = secondMinimumMm;
      bounds[chain.secondRoleIndex]!.maxX = frameSpanMm;
    } else {
      bounds[chain.firstRoleIndex]!.minY = 0;
      bounds[chain.firstRoleIndex]!.maxY = firstSpanMm;
      bounds[chain.secondRoleIndex]!.minY = secondMinimumMm;
      bounds[chain.secondRoleIndex]!.maxY = frameSpanMm;
    }
  });

  const allocated = bounds as Array<Required<MutablePinwheelBounds>>;
  const occupied: Array<Required<MutablePinwheelBounds>> = [];
  for (let roleIndex = 0; roleIndex < metrics.length; roleIndex += 1) {
    const metric = metrics[roleIndex]!;
    const region = allocated[roleIndex]!;
    const residualX = region.maxX - region.minX - metric.naturalLengthMm;
    const residualY = region.maxY - region.minY - metric.naturalWidthMm;
    const x = realizeRegionLineSpacing({
      minimumMm: region.minX,
      maximumMm: region.maxX,
      itemSpanMm: metric.itemLengthMm,
      clearanceMm,
      count: metric.columns,
      policy: residualX > SOLVER_GEOMETRY_EPSILON_MM ? policies.x : "compact",
    });
    const y = realizeRegionLineSpacing({
      minimumMm: region.minY,
      maximumMm: region.maxY,
      itemSpanMm: metric.itemWidthMm,
      clearanceMm,
      count: metric.rows,
      policy: residualY > SOLVER_GEOMETRY_EPSILON_MM ? policies.y : "compact",
    });
    if (x.status !== "feasible" || y.status !== "feasible") return false;
    occupied.push({
      minX: x.centersMm[0]! - metric.itemLengthMm / 2,
      maxX: x.centersMm[x.centersMm.length - 1]! + metric.itemLengthMm / 2,
      minY: y.centersMm[0]! - metric.itemWidthMm / 2,
      maxY: y.centersMm[y.centersMm.length - 1]! + metric.itemWidthMm / 2,
    });
  }

  const separated = (
    first: Required<MutablePinwheelBounds>,
    second: Required<MutablePinwheelBounds>,
  ) =>
    first.maxX + clearanceMm <= second.minX + SOLVER_GEOMETRY_EPSILON_MM ||
    second.maxX + clearanceMm <= first.minX + SOLVER_GEOMETRY_EPSILON_MM ||
    first.maxY + clearanceMm <= second.minY + SOLVER_GEOMETRY_EPSILON_MM ||
    second.maxY + clearanceMm <= first.minY + SOLVER_GEOMETRY_EPSILON_MM;
  for (let firstIndex = 0; firstIndex < occupied.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < occupied.length;
      secondIndex += 1
    ) {
      if (!separated(occupied[firstIndex]!, occupied[secondIndex]!)) {
        return false;
      }
    }
  }
  return true;
}

function independentEmptyPinwheelResidualPlanCatalog(
  input: NormalizedLayerSolverInput,
  graph: OwnedStructuralRegionGraph,
  maximumWorkUnits: number,
): IndependentSpacingPlanCatalog | string {
  if (
    graph.ownerFamily !== "pinwheel" ||
    graph.witness.kind !== "four-arm-cycle" ||
    graph.witness.root.core.kind !== "empty"
  ) {
    return "Independent residual allocation requires an empty-core pinwheel witness.";
  }
  const metrics = pinwheelArmMetrics(input, graph);
  if (typeof metrics === "string") return metrics;
  const chains = pinwheelResidualChains(graph.witness.root.chirality);
  const clearance = input.package.clearanceMm;
  const frameLengthMm = Math.max(
    ...chains
      .filter(({ axis }) => axis === "x")
      .map(
        ({ firstRoleIndex, secondRoleIndex }) =>
          pinwheelMetricSpan(metrics[firstRoleIndex], "x") +
          clearance +
          pinwheelMetricSpan(metrics[secondRoleIndex], "x"),
      ),
  );
  const frameWidthMm = Math.max(
    ...chains
      .filter(({ axis }) => axis === "y")
      .map(
        ({ firstRoleIndex, secondRoleIndex }) =>
          pinwheelMetricSpan(metrics[firstRoleIndex], "y") +
          clearance +
          pinwheelMetricSpan(metrics[secondRoleIndex], "y"),
      ),
  );
  const residualsMm = chains.map(
    ({ axis, firstRoleIndex, secondRoleIndex }) =>
      (axis === "x" ? frameLengthMm : frameWidthMm) -
      pinwheelMetricSpan(metrics[firstRoleIndex], axis) -
      pinwheelMetricSpan(metrics[secondRoleIndex], axis) -
      clearance,
  );
  if (residualsMm.every((amount) => amount <= SOLVER_GEOMETRY_EPSILON_MM)) {
    return Object.freeze({
      length: 0,
      planAt() {
        throw new RangeError(
          "Independent residual plan index is out of range.",
        );
      },
    });
  }
  const planWorkUnits = graph.nodes.length * 2;
  const maximumIndependentPlanAttempts =
    Math.floor(maximumWorkUnits / planWorkUnits) + 1;
  const maximumAllocationCount = Math.max(
    1,
    Math.ceil(maximumIndependentPlanAttempts / pinwheelAxisPolicies.length),
  );
  const valuesByChain = chains.map((chain, chainIndex) =>
    pinwheelResidualAllocationValues(
      residualsMm[chainIndex]!,
      metrics[chain.firstRoleIndex],
      metrics[chain.secondRoleIndex],
      chain.axis,
      maximumAllocationCount,
    ),
  );
  if (valuesByChain.some((values) => values.length === 0)) {
    return Object.freeze({
      length: 0,
      planAt() {
        throw new RangeError(
          "Independent residual plan index is out of range.",
        );
      },
    });
  }

  let allocationCount = 1;
  for (const values of valuesByChain) {
    if (allocationCount > maximumAllocationCount / values.length) {
      allocationCount = maximumAllocationCount;
      break;
    }
    allocationCount *= values.length;
  }
  const planCount = Math.min(
    maximumIndependentPlanAttempts,
    allocationCount * pinwheelAxisPolicies.length,
  );
  return Object.freeze({
    length: planCount,
    planAt(index: number): RegionSpacingPlan | null {
      if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
        throw new RangeError(
          "Independent residual plan index is out of range.",
        );
      }
      const policies =
        pinwheelAxisPolicies[index % pinwheelAxisPolicies.length]!;
      let allocationIndex = Math.floor(index / pinwheelAxisPolicies.length);
      const mutableAllocation = Array<number>(chains.length).fill(0);
      for (
        let chainIndex = chains.length - 1;
        chainIndex >= 0;
        chainIndex -= 1
      ) {
        const values = valuesByChain[chainIndex]!;
        mutableAllocation[chainIndex] =
          values[allocationIndex % values.length]!;
        allocationIndex = Math.floor(allocationIndex / values.length);
      }
      const allocation = Object.freeze([
        mutableAllocation[0]!,
        mutableAllocation[1]!,
        mutableAllocation[2]!,
        mutableAllocation[3]!,
      ]) as PinwheelResidualAllocationSpec;
      const repeatsCompactAxis = chains.some((chain, chainIndex) => {
        const policy = chain.axis === "x" ? policies.x : policies.y;
        return (
          policy === "compact" &&
          allocation[chainIndex] !== valuesByChain[chainIndex]![0]
        );
      });
      if (
        repeatsCompactAxis ||
        !pinwheelResidualPlanIsCollisionSafe(
          metrics,
          chains,
          frameLengthMm,
          frameWidthMm,
          residualsMm,
          allocation,
          clearance,
          policies,
        )
      ) {
        return null;
      }

      const extrasByRegion = graph.nodes.map(() => ({ x: 0, y: 0 }));
      chains.forEach((chain, chainIndex) => {
        const first = metrics[chain.firstRoleIndex];
        const second = metrics[chain.secondRoleIndex];
        const axisPolicy = chain.axis === "x" ? policies.x : policies.y;
        const absorbsResidual = axisPolicy !== "compact";
        const firstExtraMm = absorbsResidual ? allocation[chainIndex]! : 0;
        const secondExtraMm = absorbsResidual
          ? residualsMm[chainIndex]! - firstExtraMm
          : 0;
        extrasByRegion[first.regionIndex]![chain.axis] = firstExtraMm;
        extrasByRegion[second.regionIndex]![chain.axis] = secondExtraMm;
      });
      return Object.freeze(
        graph.nodes.map((_, regionIndex) => {
          const extras = extrasByRegion[regionIndex]!;
          return Object.freeze({
            x: extras.x > SOLVER_GEOMETRY_EPSILON_MM ? policies.x : "compact",
            y: extras.y > SOLVER_GEOMETRY_EPSILON_MM ? policies.y : "compact",
            pinwheelArmResidualPolicy: "spacing-directed" as const,
            pinwheelArmResidualMm: Object.freeze({ ...extras }),
          });
        }),
      );
    },
  });
}

function independentSpacingPlanSpecs(
  nodeCount: number,
  cache: Map<number, readonly IndependentSpacingPlanSpec[]>,
): readonly IndependentSpacingPlanSpec[] {
  const cached = cache.get(nodeCount);
  if (cached) return cached;

  const distributedPolicies = Object.freeze([
    "continuous-space-between",
    "integer-balanced",
  ] as const);
  const axisChoiceCount = nodeCount * 2;
  const maskCount = 2 ** axisChoiceCount;
  const masksByComplexity = Array.from(
    { length: maskCount },
    (_, mask) => mask,
  ).sort(
    (left, right) => setBitCount(left) - setBitCount(right) || left - right,
  );
  const specs: IndependentSpacingPlanSpec[] = [];
  for (const distributedPolicy of distributedPolicies) {
    for (const mask of masksByComplexity) {
      if (
        maskAxisIsUniform(mask, nodeCount, 0) &&
        maskAxisIsUniform(mask, nodeCount, 1)
      ) {
        continue;
      }
      specs.push(Object.freeze({ distributedPolicy, mask }));
    }
  }
  const orderedSpecs = Object.freeze(specs);
  cache.set(nodeCount, orderedSpecs);
  return orderedSpecs;
}

function maskAxisIsUniform(
  mask: number,
  roleCount: number,
  axisOffset: 0 | 1,
): boolean {
  const first = (mask & (1 << axisOffset)) !== 0;
  for (let roleIndex = 1; roleIndex < roleCount; roleIndex += 1) {
    if (((mask & (1 << (roleIndex * 2 + axisOffset))) !== 0) !== first) {
      return false;
    }
  }
  return true;
}

function independentGuillotineSpacingPlanCatalog(
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly IndependentSpacingPlanSpec[]>,
): IndependentSpacingPlanCatalog | string {
  if (
    graph.ownerFamily !== "guillotine" ||
    graph.witness.kind !== "guillotine-cut-tree"
  ) {
    return "Independent guillotine spacing requires a guillotine cut-tree witness.";
  }
  const orderedSpecs = independentSpacingPlanSpecs(
    graph.nodes.length,
    specCache,
  ).filter(({ mask }) => setBitCount(mask) <= 2);
  const seamSelections = Object.freeze([
    Object.freeze({
      x: "inter-region-seam" as const,
      y: "compact" as const,
    }),
    Object.freeze({
      x: "compact" as const,
      y: "inter-region-seam" as const,
    }),
    Object.freeze({
      x: "inter-region-seam" as const,
      y: "inter-region-seam" as const,
    }),
  ]);

  return Object.freeze({
    length: orderedSpecs.length + seamSelections.length,
    planAt(index: number): RegionSpacingPlan {
      const spec = orderedSpecs[index];
      if (spec) {
        return Object.freeze(
          graph.nodes.map((_, regionIndex) =>
            Object.freeze({
              x:
                (spec.mask & (1 << (regionIndex * 2))) !== 0
                  ? spec.distributedPolicy
                  : "compact",
              y:
                (spec.mask & (1 << (regionIndex * 2 + 1))) !== 0
                  ? spec.distributedPolicy
                  : "compact",
            }),
          ),
        );
      }
      const seamSelection = seamSelections[index - orderedSpecs.length];
      if (!seamSelection) {
        throw new RangeError("Independent spacing plan index is out of range.");
      }
      return Object.freeze(
        graph.nodes.map(() => Object.freeze({ ...seamSelection })),
      );
    },
  });
}

function independentStepSpineSpacingPlanCatalog(
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly IndependentSpacingPlanSpec[]>,
): IndependentSpacingPlanCatalog | string {
  const roleIndices = stepSpineRegionIndices(graph);
  if (typeof roleIndices === "string") return roleIndices;

  const orderedSpecs = independentSpacingPlanSpecs(
    graph.nodes.length,
    specCache,
  );

  return Object.freeze({
    length: orderedSpecs.length,
    planAt(index: number): RegionSpacingPlan {
      const spec = orderedSpecs[index];
      if (!spec) {
        throw new RangeError("Independent spacing plan index is out of range.");
      }
      const mutable = Array.from({ length: graph.nodes.length }, () => ({
        x: "compact" as RegionSpacingPolicy,
        y: "compact" as RegionSpacingPolicy,
      }));
      roleIndices.forEach((regionIndex, roleIndex) => {
        if ((spec.mask & (1 << (roleIndex * 2))) !== 0) {
          mutable[regionIndex]!.x = spec.distributedPolicy;
        }
        if ((spec.mask & (1 << (roleIndex * 2 + 1))) !== 0) {
          mutable[regionIndex]!.y = spec.distributedPolicy;
        }
      });
      return Object.freeze(
        mutable.map((selection) => Object.freeze({ ...selection })),
      );
    },
  });
}

type EmbeddedBridgeSpacingChoice = Readonly<{
  axisIndex: number;
  policy: "inter-region-seam" | "integer-balanced" | "continuous-space-between";
}>;

type EmbeddedBridgeSpacingPlanSpec = Readonly<{
  choices: readonly EmbeddedBridgeSpacingChoice[];
}>;

function embeddedBridgeSpacingPlanSpecs(
  nodeCount: number,
  cache: Map<number, readonly EmbeddedBridgeSpacingPlanSpec[]>,
): readonly EmbeddedBridgeSpacingPlanSpec[] {
  const cached = cache.get(nodeCount);
  if (cached) return cached;
  const axisCount = nodeCount * 2;
  const policies = Object.freeze([
    "inter-region-seam",
    "integer-balanced",
    "continuous-space-between",
  ] as const);
  const specs: EmbeddedBridgeSpacingPlanSpec[] = [];
  const appendPolicies = (
    axisIndices: readonly number[],
    choiceIndex: number,
    choices: readonly EmbeddedBridgeSpacingChoice[],
  ) => {
    if (choiceIndex === axisIndices.length) {
      specs.push(Object.freeze({ choices: Object.freeze([...choices]) }));
      return;
    }
    for (const policy of policies) {
      appendPolicies(axisIndices, choiceIndex + 1, [
        ...choices,
        Object.freeze({ axisIndex: axisIndices[choiceIndex]!, policy }),
      ]);
    }
  };
  const chooseAxes = (
    desiredCount: number,
    nextAxisIndex: number,
    axisIndices: readonly number[],
  ) => {
    if (axisIndices.length === desiredCount) {
      appendPolicies(axisIndices, 0, []);
      return;
    }
    for (let axisIndex = nextAxisIndex; axisIndex < axisCount; axisIndex += 1) {
      chooseAxes(desiredCount, axisIndex + 1, [...axisIndices, axisIndex]);
    }
  };
  for (let choiceCount = 1; choiceCount <= 3; choiceCount += 1) {
    chooseAxes(choiceCount, 0, []);
  }
  const ordered = Object.freeze(
    specs.sort((left, right) => {
      const leftRegionCount = new Set(
        left.choices.map(({ axisIndex }) => Math.floor(axisIndex / 2)),
      ).size;
      const rightRegionCount = new Set(
        right.choices.map(({ axisIndex }) => Math.floor(axisIndex / 2)),
      ).size;
      return (
        left.choices.length - right.choices.length ||
        leftRegionCount - rightRegionCount ||
        compareStrings(
          stableRegionTopologyValue(left),
          stableRegionTopologyValue(right),
        )
      );
    }),
  );
  cache.set(nodeCount, ordered);
  return ordered;
}

function independentEmbeddedBridgeSpacingPlanCatalog(
  graph: OwnedStructuralRegionGraph,
  specCache: Map<number, readonly EmbeddedBridgeSpacingPlanSpec[]>,
): IndependentSpacingPlanCatalog | string {
  if (
    graph.ownerFamily !== "bridge-chain" ||
    graph.witness.kind !== "embedded-bridge"
  ) {
    return "Independent embedded spacing requires an embedded-bridge witness.";
  }
  const orderedSpecs = embeddedBridgeSpacingPlanSpecs(
    graph.nodes.length,
    specCache,
  );
  return Object.freeze({
    length: orderedSpecs.length,
    planAt(index: number): RegionSpacingPlan {
      const spec = orderedSpecs[index];
      if (!spec) {
        throw new RangeError("Independent spacing plan index is out of range.");
      }
      const mutable = graph.nodes.map(() => ({
        x: "compact" as RegionSpacingPolicy,
        y: "compact" as RegionSpacingPolicy,
      }));
      for (const { axisIndex, policy } of spec.choices) {
        const regionIndex = Math.floor(axisIndex / 2);
        const axis = axisIndex % 2 === 0 ? "x" : "y";
        mutable[regionIndex]![axis] = policy;
      }
      return Object.freeze(
        mutable.map((selection) => Object.freeze({ ...selection })),
      );
    },
  });
}

function earlyIndependentPlanCount(graph: OwnedStructuralRegionGraph): number {
  const axisChoiceCount = graph.nodes.length * 2;
  if (graph.ownerFamily === "bridge-chain") {
    return axisChoiceCount * 3 + graph.nodes.length * 9;
  }
  return axisChoiceCount + (axisChoiceCount * (axisChoiceCount - 1)) / 2;
}

function independentSpacingMayResolveStepConstraint(reason: string): boolean {
  return (
    reason ===
      "Both step-spine junctions must remain offset after allocation." ||
    reason.startsWith("Step-spine relation ")
  );
}

function usesMixedFootprintClasses(
  assignments: readonly RegionShapeAssignment[],
): boolean {
  const classes = new Set(
    assignments
      .map(({ shape }) => shape.footprintClass)
      .filter((footprintClass) => footprintClass !== "square"),
  );
  return classes.size > 1;
}

const axisPreservingSymmetries = new Set<LayerSymmetry>([
  "identity",
  "rotate-180",
  "mirror-x",
  "mirror-y",
]);

function materializableTopologySymmetries(
  input: NormalizedLayerSolverInput,
  requested: readonly LayerSymmetry[] | undefined,
): readonly LayerSymmetry[] | undefined {
  if (input.package.dimensionsMm.length === input.package.dimensionsMm.width) {
    return requested;
  }
  const supportsLengthwise = input.constraints.allowedRotations.some(
    (rotation) => rotation === 0 || rotation === 180,
  );
  const supportsCrosswise = input.constraints.allowedRotations.some(
    (rotation) => rotation === 90 || rotation === 270,
  );
  if (supportsLengthwise && supportsCrosswise) return requested;

  const candidates =
    requested ?? ([...axisPreservingSymmetries] as readonly LayerSymmetry[]);
  return Object.freeze(
    candidates.filter((symmetry) => axisPreservingSymmetries.has(symmetry)),
  );
}

function spacingSelectionKey(selection: RegionSpacingSelection): string {
  return lengthPrefixedSequence([
    selection.x,
    selection.y,
    selection.recursiveCoreAlignment ?? "",
    selection.pinwheelResidualPlacement ?? "",
    selection.pinwheelArmResidualPolicy ?? "",
    selection.pinwheelArmResidualMm?.x?.toString() ?? "",
    selection.pinwheelArmResidualMm?.y?.toString() ?? "",
    selection.suctionGroupRemainder ?? "",
    selection.suctionGroupCenterPhaseMm?.toString() ?? "",
  ]);
}

function realizationAttemptKey(
  graph: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  selections: readonly RegionSpacingSelection[],
): string {
  return lengthPrefixedSequence([
    graph.topologyFingerprint,
    framePolicy,
    lengthPrefixedSequence(selections.map(spacingSelectionKey)),
  ]);
}

function physicalSpacingKey(graph: SpacedRegionGraph): string {
  const placements: Array<
    readonly [number, number, RegionShape["footprintClass"]]
  > = [];
  for (let index = 0; index < graph.topology.nodes.length; index += 1) {
    const node = graph.topology.nodes[index]!;
    const spacing = graph.spacingByRegion[index]!;
    for (const y of spacing.yCentersMm) {
      for (const x of spacing.xCentersMm) {
        placements.push(Object.freeze([x, y, node.footprintClass]));
      }
    }
  }
  placements.sort(
    (left, right) =>
      left[0] - right[0] ||
      left[1] - right[1] ||
      compareStrings(left[2], right[2]),
  );
  return stableRegionTopologyValue(placements);
}

export function searchRegionTopologies(
  request: RegionTopologySearchRequest,
): RegionTopologySearchResult {
  const statistics = emptyStatistics();
  if (typeof request !== "object" || request === null) {
    throw new TypeError("Region topology search request must be an object.");
  }
  const { input, catalog, ledger } = request;
  if (typeof input !== "object" || input === null) {
    return invalidResult(
      "Normalized solver input must be an object.",
      statistics,
      ledger,
    );
  }
  if (typeof catalog !== "object" || catalog === null) {
    return invalidResult(
      "Region shape catalog must be an object.",
      statistics,
      ledger,
    );
  }

  const normalization = ledger.debit("normalization");
  if (normalization !== "continue") {
    return stoppedResult(normalization, [], statistics, ledger);
  }

  const targetCounts = normalizedTargetCounts(
    request.targetCountsDescending,
    input,
  );
  if (typeof targetCounts === "string") {
    return invalidResult(targetCounts, statistics, ledger);
  }
  const templates = canonicalTemplates(request.templates);
  if (typeof templates === "string") {
    return invalidResult(templates, statistics, ledger);
  }

  const preparedTemplates: PreparedTemplate[] = [];
  const maximumTargetCount = targetCounts[0] ?? 0;
  for (const [
    templateOrderIndex,
    { template, orderKey },
  ] of templates.entries()) {
    const framePolicies = normalizedFramePolicies(
      request.framePolicies,
      template,
      request.framePolicyFilter,
    );
    if (typeof framePolicies === "string") {
      return invalidResult(framePolicies, statistics, ledger);
    }
    const spacingSelections = normalizedSpacingSelections(
      request.spacingSelections,
      template,
    );
    if (typeof spacingSelections === "string") {
      return invalidResult(spacingSelections, statistics, ledger);
    }
    if (
      framePolicies.length === 0 ||
      spacingSelections.length === 0 ||
      targetCounts.length === 0
    ) {
      continue;
    }

    const slotIds = structuralSlotIds(template);
    if (typeof slotIds === "string") {
      return invalidResult(slotIds, statistics, ledger);
    }
    const domainResult = shapeDomains(template, slotIds, catalog, ledger);
    if (domainResult.status === "stopped") {
      return stoppedResult(domainResult.reason, [], statistics, ledger);
    }
    if (domainResult.status === "invalid") {
      return invalidResult(domainResult.reason, statistics, ledger);
    }

    let reachableSuffixes: readonly ReadonlySet<number>[] | null = null;
    if (!domainResult.domains.some((domain) => domain.length === 0)) {
      const suffixResult = suffixReachableCounts(
        domainResult.domains,
        maximumTargetCount,
        ledger,
      );
      if (suffixResult.status === "stopped") {
        return stoppedResult(suffixResult.reason, [], statistics, ledger);
      }
      reachableSuffixes = suffixResult.suffix;
    }
    preparedTemplates.push(
      Object.freeze({
        template,
        templateOrderIndex,
        templateOrderKey: orderKey,
        orientationPreference: template.slots
          .find(({ id }) => id === slotIds[0])
          ?.footprintClasses.includes(input.package.inletOrientation)
          ? 0
          : 1,
        slotIds,
        domains: domainResult.domains,
        domainsByCount: domainResult.domainsByCount,
        suffixReachableCounts: reachableSuffixes,
        framePolicies,
        spacingSelections,
      }),
    );
  }

  const frontier: SearchState[] = [];
  const structuralFitByAssignmentKey = new Map<string, boolean>();
  for (const targetCount of targetCounts) {
    for (const preparedTemplate of preparedTemplates) {
      const rootDecision = ledger.debit("root-state");
      if (rootDecision !== "continue") {
        return stoppedResult(rootDecision, [], statistics, ledger);
      }
      statistics.rootStateCount += 1;
      const reachableSuffixes = preparedTemplate.suffixReachableCounts;
      if (!reachableSuffixes?.[0]?.has(targetCount)) {
        statistics.countPrunedStateCount += 1;
        continue;
      }

      const root: PreparedRoot = Object.freeze({
        ...preparedTemplate,
        targetCount,
        suffixReachableCounts: reachableSuffixes,
      });
      const frontierDecision = ledger.observeFrontierSize(frontier.length + 1);
      if (frontierDecision !== "continue") {
        return stoppedResult(frontierDecision, [], statistics, ledger);
      }
      frontier.push(
        Object.freeze({
          root,
          nextSlotIndex: 0,
          assignedCount: 0,
          assignments: Object.freeze([]),
          orderKey: stateOrderKey([]),
        }),
      );
    }
  }

  // Reserve every ordinary root first. Preferred complete assignments share
  // the same frontier and consume at most a tenth of the work budget.
  const seedBudget = ledger.snapshot();
  let remainingSeedAttempts = Math.floor(
    Math.min(
      seedBudget.budget.maxWorkUnits / 10,
      (seedBudget.budget.maxWorkUnits - seedBudget.totalUsed) / 2,
    ),
  );
  for (const { root } of [...frontier]) {
    const seeds = seedGridCorePinwheels(
      input,
      root.template,
      root.slotIds,
      root.domains,
      root.targetCount,
      ledger,
      remainingSeedAttempts,
      seedBudget.budget.maxFrontierStates - frontier.length,
    );
    remainingSeedAttempts -= seeds.attempts;
    statistics.expandedStateCount += seeds.attempts;
    if (seeds.stopReason !== null) {
      return stoppedResult(seeds.stopReason, [], statistics, ledger);
    }
    for (const assignments of seeds.assignments) {
      const seedDecision = ledger.observeFrontierSize(frontier.length + 1);
      if (seedDecision !== "continue") {
        return stoppedResult(seedDecision, [], statistics, ledger);
      }
      frontier.push(
        Object.freeze({
          root,
          nextSlotIndex: root.slotIds.length,
          assignedCount: root.targetCount,
          assignments,
          orderKey: stateOrderKey(assignments),
        }),
      );
    }
  }

  const draftRetention = createBoundedRegionDraftRetention(
    ledger.snapshot().budget.maxRetainedDrafts,
  );
  const retainedDrafts = () => draftRetention.drafts();
  const attemptedRealizations = new Set<string>();
  const validByAttemptedPhysicalRealization = new Map<string, boolean>();
  const pendingIndependentRealizations = new Map<
    string,
    PendingIndependentRealization
  >();
  const pendingIndependentPlanOffsets = new Map<string, number>();
  const independentSpacingSpecCache = new Map<
    number,
    readonly IndependentSpacingPlanSpec[]
  >();
  const embeddedBridgeSpacingSpecCache = new Map<
    number,
    readonly EmbeddedBridgeSpacingPlanSpec[]
  >();
  const pendingIndependentPlanCatalogs = new Map<
    string,
    IndependentSpacingPlanCatalog
  >();
  const realizePlans = (
    graph: OwnedStructuralRegionGraph,
    framePolicies: readonly RegionFramePolicy[],
    spacingPlans: readonly RegionSpacingPlan[],
  ): RealizationBatchResult => {
    let hasValidPhysicalRealization = false;
    let mayHaveIndependentSpacingRealization = false;
    for (const framePolicy of framePolicies) {
      for (const selections of spacingPlans) {
        const attemptKey = realizationAttemptKey(
          graph,
          framePolicy,
          selections,
        );
        if (attemptedRealizations.has(attemptKey)) {
          statistics.duplicateRealizationCount += 1;
          continue;
        }
        attemptedRealizations.add(attemptKey);

        const constraints = realizeRegionConstraints(
          input,
          graph,
          framePolicy,
          selections,
          ledger,
        );
        if (constraints.status === "stopped") {
          return Object.freeze({
            status: "stopped",
            reason: constraints.reason,
          });
        }
        if (constraints.status === "invalid") {
          return Object.freeze({
            status: "invalid",
            reason: constraints.reason,
          });
        }
        if (constraints.status === "infeasible") {
          if (
            graph.ownerFamily === "bridge-chain" ||
            (graph.ownerFamily === "spine-corridor" &&
              independentSpacingMayResolveStepConstraint(constraints.reason))
          ) {
            mayHaveIndependentSpacingRealization = true;
          }
          statistics.infeasibleRealizationCount += 1;
          continue;
        }
        if (
          graph.ownerFamily === "spine-corridor" ||
          graph.ownerFamily === "guillotine"
        ) {
          mayHaveIndependentSpacingRealization = true;
        }

        const spacing = realizeRegionSpacing(
          input,
          constraints.graph,
          selections,
          ledger,
        );
        if (spacing.status === "stopped") {
          return Object.freeze({ status: "stopped", reason: spacing.reason });
        }
        if (spacing.status === "invalid") {
          return Object.freeze({ status: "invalid", reason: spacing.reason });
        }
        if (spacing.status === "infeasible") {
          statistics.infeasibleRealizationCount += 1;
          continue;
        }

        const physicalKey = physicalSpacingKey(spacing.graph);
        if (validByAttemptedPhysicalRealization.has(physicalKey)) {
          statistics.duplicateRealizationCount += 1;
          if (validByAttemptedPhysicalRealization.get(physicalKey) === true) {
            hasValidPhysicalRealization = true;
            mayHaveIndependentSpacingRealization ||=
              graph.ownerFamily === "bridge-chain";
          }
          continue;
        }

        const materialization = materializeRegionTopologyDraft(
          input,
          spacing.graph,
          ledger,
        );
        if (materialization.status === "stopped") {
          return Object.freeze({
            status: "stopped",
            reason: materialization.reason,
          });
        }
        if (materialization.status === "infeasible") {
          validByAttemptedPhysicalRealization.set(physicalKey, false);
          statistics.infeasibleRealizationCount += 1;
          continue;
        }
        if (materialization.status === "invalid") {
          statistics.invalidMaterializationCount += 1;
          return Object.freeze({
            status: "invalid",
            reason: materialization.reason,
          });
        }

        validByAttemptedPhysicalRealization.set(physicalKey, true);
        hasValidPhysicalRealization = true;
        mayHaveIndependentSpacingRealization ||=
          graph.ownerFamily === "bridge-chain";
        const searchableDraft: RegionTopologySearchDraft = Object.freeze({
          ...materialization.draft,
          canonicalRealizationOrderKey: stableRegionTopologyValue(selections),
        });
        const retention = draftRetention.consider(
          graph.ownerFamily,
          searchableDraft,
        );
        const storageDecision = ledger.observeDraftStorage({
          retainedDraftCount: retention.retainedDraftCount,
          replacementOccurred: retention.replacementOccurred,
        });
        if (storageDecision !== "continue") {
          return Object.freeze({
            status: "stopped",
            reason: storageDecision,
          });
        }
      }
    }
    return Object.freeze({
      status: "completed",
      hasValidPhysicalRealization,
      mayHaveIndependentSpacingRealization,
    });
  };

  const pendingPrecedesState = (
    pending: PendingIndependentRealization,
    state: SearchState,
  ): boolean =>
    pending.graph.targetCount > state.root.targetCount ||
    (pending.graph.ownerFamily !== "bridge-chain" &&
      pending.graph.targetCount === state.root.targetCount &&
      pending.graph.nodes.length < state.root.slotIds.length);

  const realizePendingIndependentRealizations = (
    isEligible: (pending: PendingIndependentRealization) => boolean,
    mode: "early" | "all",
  ): RealizationBatchResult => {
    const prepared: Array<
      Readonly<{
        pending: PendingIndependentRealization;
        planCatalog: IndependentSpacingPlanCatalog;
        startIndex: number;
        endIndex: number;
      }>
    > = [];
    const eligiblePending = [...pendingIndependentRealizations.values()]
      .filter(isEligible)
      .sort((left, right) => compareStrings(left.orderKey, right.orderKey));
    for (const pending of eligiblePending) {
      const checkpoint = ledger.checkpoint();
      if (checkpoint !== "continue") {
        return Object.freeze({ status: "stopped", reason: checkpoint });
      }
      let planCatalog = pendingIndependentPlanCatalogs.get(pending.orderKey);
      if (!planCatalog) {
        const created =
          pending.graph.ownerFamily === "guillotine"
            ? independentGuillotineSpacingPlanCatalog(
                pending.graph,
                independentSpacingSpecCache,
              )
            : pending.graph.ownerFamily === "pinwheel"
              ? independentPinwheelSpacingPlanCatalog(
                  input,
                  pending.graph,
                  independentSpacingSpecCache,
                  ledger.snapshot().budget.maxWorkUnits,
                )
              : pending.graph.ownerFamily === "bridge-chain"
                ? independentEmbeddedBridgeSpacingPlanCatalog(
                    pending.graph,
                    embeddedBridgeSpacingSpecCache,
                  )
                : independentStepSpineSpacingPlanCatalog(
                    pending.graph,
                    independentSpacingSpecCache,
                  );
        if (typeof created === "string") {
          return Object.freeze({ status: "invalid", reason: created });
        }
        planCatalog = created;
        pendingIndependentPlanCatalogs.set(pending.orderKey, planCatalog);
      }
      const startIndex =
        pendingIndependentPlanOffsets.get(pending.orderKey) ?? 0;
      const endIndex =
        mode === "all" || pending.graph.ownerFamily === "guillotine"
          ? planCatalog.length
          : startIndex === 0
            ? Math.min(
                planCatalog.length,
                earlyIndependentPlanCount(pending.graph),
              )
            : startIndex;
      prepared.push(
        Object.freeze({ pending, planCatalog, startIndex, endIndex }),
      );
    }

    const maximumPlanCount = Math.max(
      0,
      ...prepared.map(({ startIndex, endIndex }) => endIndex - startIndex),
    );
    let hasValidPhysicalRealization = false;
    let mayHaveIndependentSpacingRealization = false;
    const validPendingOrderKeys = new Set<string>();
    for (let offset = 0; offset < maximumPlanCount; offset += 1) {
      for (const { pending, planCatalog, startIndex, endIndex } of prepared) {
        const planIndex = startIndex + offset;
        if (planIndex >= endIndex) continue;
        const planDecision = ledger.debit(
          "independent-spacing-axis",
          pending.graph.nodes.length * 2,
        );
        if (planDecision !== "continue") {
          return Object.freeze({ status: "stopped", reason: planDecision });
        }
        const spacingPlan = planCatalog.planAt(planIndex);
        if (spacingPlan === null) continue;
        const deferred = realizePlans(
          pending.graph,
          pending.framePolicies,
          Object.freeze([spacingPlan]),
        );
        if (deferred.status !== "completed") return deferred;
        if (deferred.hasValidPhysicalRealization) {
          hasValidPhysicalRealization = true;
          validPendingOrderKeys.add(pending.orderKey);
        }
        mayHaveIndependentSpacingRealization ||=
          deferred.mayHaveIndependentSpacingRealization;
      }
    }
    for (const { pending, planCatalog, startIndex, endIndex } of prepared) {
      const unresolvedIndependentOnlyTopology =
        mode === "early" &&
        pending.graph.ownerFamily !== "pinwheel" &&
        pending.graph.ownerFamily !== "bridge-chain" &&
        startIndex === 0 &&
        !pending.hadImmediateValidPhysicalRealization &&
        !validPendingOrderKeys.has(pending.orderKey);
      if (endIndex >= planCatalog.length || unresolvedIndependentOnlyTopology) {
        pendingIndependentRealizations.delete(pending.orderKey);
        pendingIndependentPlanOffsets.delete(pending.orderKey);
        pendingIndependentPlanCatalogs.delete(pending.orderKey);
      } else {
        pendingIndependentPlanOffsets.set(pending.orderKey, endIndex);
      }
    }
    return Object.freeze({
      status: "completed",
      hasValidPhysicalRealization,
      mayHaveIndependentSpacingRealization,
    });
  };

  const templateLaneCount = Math.max(
    1,
    ...preparedTemplates.map(
      ({ templateOrderIndex }) => templateOrderIndex + 1,
    ),
  );
  const nextTemplateLaneByTarget = new Map<number, number>();
  // Share the remaining work among targets at least as dense as a catalog grid.
  // Lower tiers retain descending scheduling after these roots are exhausted.
  // The quantum is fixed at search start, so progress batching cannot change it.
  const gridCapacity = Math.max(
    0,
    ...catalog.orderedShapes.map((shape) => shape.packageCount),
  );
  const denseTargets = targetCounts.filter((count) => count >= gridCapacity);
  const schedulingBudget = ledger.snapshot();
  const targetWorkQuantum = Math.max(
    1,
    Math.floor(
      (schedulingBudget.budget.maxWorkUnits - schedulingBudget.totalUsed) /
        Math.max(1, denseTargets.length),
    ),
  );
  let targetCursor = 0;
  let targetWorkStart = schedulingBudget.totalUsed;
  const nextFrontierStateIndex = (): number => {
    let activeTargetCount = Math.max(
      ...frontier.map(({ root }) => root.targetCount),
    );
    if (
      denseTargets.some((count) =>
        frontier.some(({ root }) => root.targetCount === count),
      )
    ) {
      const used = ledger.snapshot().totalUsed;
      if (used - targetWorkStart >= targetWorkQuantum) {
        targetCursor = (targetCursor + 1) % denseTargets.length;
        targetWorkStart = used;
      }
      while (
        !frontier.some(
          ({ root }) => root.targetCount === denseTargets[targetCursor],
        )
      ) {
        targetCursor = (targetCursor + 1) % denseTargets.length;
        targetWorkStart = used;
      }
      activeTargetCount = denseTargets[targetCursor]!;
    }
    const startLane = nextTemplateLaneByTarget.get(activeTargetCount) ?? 0;
    for (let offset = 0; offset < templateLaneCount; offset += 1) {
      const lane = (startLane + offset) % templateLaneCount;
      let selectedIndex = -1;
      for (let index = 0; index < frontier.length; index += 1) {
        const state = frontier[index]!;
        if (
          state.root.targetCount !== activeTargetCount ||
          state.root.templateOrderIndex !== lane
        ) {
          continue;
        }
        if (
          selectedIndex < 0 ||
          compareStates(state, frontier[selectedIndex]!) < 0
        ) {
          selectedIndex = index;
        }
      }
      if (selectedIndex >= 0) {
        nextTemplateLaneByTarget.set(
          activeTargetCount,
          (lane + 1) % templateLaneCount,
        );
        return selectedIndex;
      }
    }
    throw new Error("Region topology frontier has no schedulable state.");
  };

  while (frontier.length > 0) {
    const nextStateIndex = nextFrontierStateIndex();
    const nextState = frontier[nextStateIndex]!;
    const deferred = realizePendingIndependentRealizations(
      (pending) =>
        (pending.graph.ownerFamily !== "pinwheel" ||
          (pending.hadImmediateValidPhysicalRealization &&
            pending.graph.witness.kind === "four-arm-cycle" &&
            pending.graph.witness.root.core.kind === "grid")) &&
        pendingPrecedesState(pending, nextState),
      "early",
    );
    if (deferred.status === "stopped") {
      return stoppedResult(
        deferred.reason,
        retainedDrafts(),
        statistics,
        ledger,
      );
    }
    if (deferred.status === "invalid") {
      return invalidResult(deferred.reason, statistics, ledger);
    }

    const [state] = frontier.splice(nextStateIndex, 1);
    if (!state) throw new Error("Region topology frontier state disappeared.");
    const popDecision = ledger.debit("frontier-pop");
    if (popDecision !== "continue") {
      return stoppedResult(popDecision, retainedDrafts(), statistics, ledger);
    }
    statistics.frontierPopCount += 1;

    if (state.nextSlotIndex < state.root.slotIds.length) {
      const slotIndex = state.nextSlotIndex;
      const slotId = state.root.slotIds[slotIndex]!;
      const domain = state.root.domains[slotIndex]!;
      const domainByCount = state.root.domainsByCount[slotIndex]!;
      const nextSlotIndex = slotIndex + 1;
      let compatibleShapeCount = 0;

      for (const [packageCount, shapes] of domainByCount) {
        const assignedCount = state.assignedCount + packageCount;
        if (
          !targetCompatibleAfterAssignment(
            state.root,
            assignedCount,
            nextSlotIndex,
          )
        ) {
          continue;
        }

        compatibleShapeCount += shapes.length;
        for (const shape of shapes) {
          const assignments = Object.freeze([
            ...state.assignments,
            Object.freeze({ slotId, shape }),
          ]);
          const assignmentKey = structuralAssignmentKey(
            state.root,
            nextSlotIndex,
            assignments,
          );
          let fitsFrame = structuralFitByAssignmentKey.get(assignmentKey);
          if (fitsFrame === undefined) {
            const expansionDecision = ledger.debit("template-expansion");
            if (expansionDecision !== "continue") {
              return stoppedResult(
                expansionDecision,
                retainedDrafts(),
                statistics,
                ledger,
              );
            }
            statistics.expandedStateCount += 1;
            fitsFrame = partialRegionTopologyFitsFrame(
              input,
              state.root.template,
              assignments,
            );
            structuralFitByAssignmentKey.set(assignmentKey, fitsFrame);
          } else {
            const checkpoint = ledger.checkpoint();
            if (checkpoint !== "continue") {
              return stoppedResult(
                checkpoint,
                retainedDrafts(),
                statistics,
                ledger,
              );
            }
          }
          if (!fitsFrame) {
            statistics.constraintPrunedStateCount += 1;
            continue;
          }
          const frontierDecision = ledger.observeFrontierSize(
            frontier.length + 1,
          );
          if (frontierDecision !== "continue") {
            return stoppedResult(
              frontierDecision,
              retainedDrafts(),
              statistics,
              ledger,
            );
          }
          frontier.push(
            Object.freeze({
              root: state.root,
              nextSlotIndex,
              assignedCount,
              assignments,
              orderKey: stateOrderKey(assignments),
            }),
          );
        }
      }
      statistics.countPrunedStateCount += domain.length - compatibleShapeCount;
      continue;
    }

    statistics.completedAssignmentCount += 1;
    if (
      !input.constraints.allowMixedPackageOrientations &&
      usesMixedFootprintClasses(state.assignments)
    ) {
      statistics.infeasibleRealizationCount += 1;
      continue;
    }
    const identity = createRegionTopologyIdentity(
      {
        template: state.root.template,
        assignments: state.assignments,
        targetCount: state.assignedCount,
        frameBoundsMm: input.generationBoundsMm,
        symmetries: materializableTopologySymmetries(input, request.symmetries),
      },
      ledger,
    );
    if (identity.status === "stopped") {
      return stoppedResult(
        identity.reason,
        retainedDrafts(),
        statistics,
        ledger,
      );
    }
    if (identity.status === "invalid") {
      return invalidResult(identity.reason, statistics, ledger);
    }

    const immediate = realizePlans(
      identity.graph,
      state.root.framePolicies,
      uniformSpacingPlans(
        identity.graph.nodes.length,
        state.root.spacingSelections,
      ),
    );
    if (immediate.status === "stopped") {
      return stoppedResult(
        immediate.reason,
        retainedDrafts(),
        statistics,
        ledger,
      );
    }
    if (immediate.status === "invalid") {
      return invalidResult(immediate.reason, statistics, ledger);
    }

    if (
      request.spacingSelections === undefined &&
      identity.graph.ownerFamily === "pinwheel" &&
      identity.graph.witness.kind === "four-arm-cycle" &&
      identity.graph.witness.root.core.kind === "empty"
    ) {
      const priorityPlans = priorityEmptyPinwheelSpacingPlans(
        identity.graph,
        independentSpacingSpecCache,
      );
      if (typeof priorityPlans === "string") {
        return invalidResult(priorityPlans, statistics, ledger);
      }
      const centerFramePolicies = state.root.framePolicies.filter(
        (framePolicy) => framePolicy === "center-occupied-bounds",
      );
      if (priorityPlans.length > 0 && centerFramePolicies.length > 0) {
        const priority = realizePlans(
          identity.graph,
          centerFramePolicies,
          priorityPlans,
        );
        if (priority.status === "stopped") {
          return stoppedResult(
            priority.reason,
            retainedDrafts(),
            statistics,
            ledger,
          );
        }
        if (priority.status === "invalid") {
          return invalidResult(priority.reason, statistics, ledger);
        }
      }
    }

    let hasDeferredPinwheelSpacing = false;
    let deferredPinwheelFramePolicies = state.root.framePolicies;
    if (
      identity.graph.ownerFamily === "pinwheel" &&
      identity.graph.witness.kind === "four-arm-cycle"
    ) {
      if (identity.graph.witness.root.core.kind === "grid") {
        hasDeferredPinwheelSpacing = true;
      } else if (identity.graph.witness.root.core.kind === "empty") {
        const independentCounts = hasIndependentOppositePinwheelCounts(
          identity.graph,
        );
        if (typeof independentCounts === "string") {
          return invalidResult(independentCounts, statistics, ledger);
        }
        deferredPinwheelFramePolicies = state.root.framePolicies.filter(
          (framePolicy) => framePolicy === "center-occupied-bounds",
        );
        hasDeferredPinwheelSpacing =
          independentCounts && deferredPinwheelFramePolicies.length > 0;
      }
    }
    if (
      request.spacingSelections === undefined &&
      (hasDeferredPinwheelSpacing ||
        ((identity.graph.ownerFamily === "bridge-chain" ||
          identity.graph.ownerFamily === "spine-corridor" ||
          identity.graph.ownerFamily === "guillotine") &&
          immediate.mayHaveIndependentSpacingRealization))
    ) {
      const orderKey = stableRegionTopologyValue({
        negativeTargetCount: -identity.graph.targetCount,
        topologyFingerprint: identity.graph.topologyFingerprint,
      });
      if (!pendingIndependentRealizations.has(orderKey)) {
        pendingIndependentRealizations.set(
          orderKey,
          Object.freeze({
            graph: identity.graph,
            framePolicies: hasDeferredPinwheelSpacing
              ? deferredPinwheelFramePolicies
              : state.root.framePolicies,
            orderKey,
            hadImmediateValidPhysicalRealization:
              immediate.hasValidPhysicalRealization,
          }),
        );
        pendingIndependentPlanOffsets.set(orderKey, 0);
      }
    }
  }

  const finalEarly = realizePendingIndependentRealizations(() => true, "early");
  if (finalEarly.status === "stopped") {
    return stoppedResult(
      finalEarly.reason,
      retainedDrafts(),
      statistics,
      ledger,
    );
  }
  if (finalEarly.status === "invalid") {
    return invalidResult(finalEarly.reason, statistics, ledger);
  }
  const deferred = realizePendingIndependentRealizations(() => true, "all");
  if (deferred.status === "stopped") {
    return stoppedResult(deferred.reason, retainedDrafts(), statistics, ledger);
  }
  if (deferred.status === "invalid") {
    return invalidResult(deferred.reason, statistics, ledger);
  }

  const finalCheckpoint = ledger.checkpoint();
  if (finalCheckpoint !== "continue") {
    return stoppedResult(finalCheckpoint, retainedDrafts(), statistics, ledger);
  }

  return Object.freeze({
    status: "completed",
    drafts: sortedDrafts(retainedDrafts()),
    statistics: frozenStatistics(statistics),
    work: ledger.snapshot(),
  });
}
