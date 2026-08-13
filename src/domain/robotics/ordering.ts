import { compareGripPositionsBottomRightRowMajor } from "~/domain/gripDependencies";
import type { PalletizingDirection } from "~/domain/project/projectSchema";
import type {
  RobotDiagnostic,
  RobotGripGroup,
  RobotOrderDependency,
} from "~/domain/robotics/types";

export type RobotOrderSuggestion = {
  groups: readonly RobotGripGroup[];
  order: readonly string[];
  dependencies: readonly RobotOrderDependency[];
  source:
    | "imported-sequence"
    | "explicit-project-sequence"
    | "explicit-edit"
    | "suggested-topological";
  diagnostics: readonly RobotDiagnostic[];
};

function baseComparator() {
  return (left: RobotGripGroup, right: RobotGripGroup): number =>
    (left.sourceSequence !== null && right.sourceSequence !== null
      ? left.sourceSequence - right.sourceSequence
      : 0) ||
    compareGripPositionsBottomRightRowMajor(
      left.centerPalletMm,
      right.centerPalletMm,
    ) ||
    left.groupNumber - right.groupNumber ||
    left.id.localeCompare(right.id);
}

function normalizedDependencies(
  groupsById: ReadonlyMap<string, RobotGripGroup>,
  dependencies: readonly RobotOrderDependency[],
  diagnostics: RobotDiagnostic[],
): RobotOrderDependency[] {
  const seen = new Set<string>();
  const normalized: RobotOrderDependency[] = [];
  for (const dependency of dependencies) {
    const key = `${dependency.beforeGroupId}::${dependency.afterGroupId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      !groupsById.has(dependency.beforeGroupId) ||
      !groupsById.has(dependency.afterGroupId)
    ) {
      diagnostics.push({
        severity: "error",
        phase: "ordering",
        code: "dependency-missing-group",
        message: `Order dependency "${dependency.beforeGroupId}" -> "${dependency.afterGroupId}" references a missing group.`,
        groupId: !groupsById.has(dependency.beforeGroupId)
          ? dependency.beforeGroupId
          : dependency.afterGroupId,
      });
      continue;
    }
    normalized.push({ ...dependency });
  }
  return normalized;
}

function topologicalOrder(
  groups: readonly RobotGripGroup[],
  dependencies: readonly RobotOrderDependency[],
  diagnostics: RobotDiagnostic[],
  preferredIndexById?: ReadonlyMap<string, number>,
): RobotGripGroup[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(groups.map(({ id }) => [id, 0]));
  for (const dependency of dependencies) {
    const next = outgoing.get(dependency.beforeGroupId) ?? [];
    next.push(dependency.afterGroupId);
    outgoing.set(dependency.beforeGroupId, next);
    indegree.set(
      dependency.afterGroupId,
      (indegree.get(dependency.afterGroupId) ?? 0) + 1,
    );
  }
  for (const targets of outgoing.values()) targets.sort();

  const fallbackCompare = baseComparator();
  const compare = (left: RobotGripGroup, right: RobotGripGroup) =>
    preferredIndexById
      ? (preferredIndexById.get(left.id) ?? Number.POSITIVE_INFINITY) -
          (preferredIndexById.get(right.id) ?? Number.POSITIVE_INFINITY) ||
        fallbackCompare(left, right)
      : fallbackCompare(left, right);
  const available = groups
    .filter(({ id }) => (indegree.get(id) ?? 0) === 0)
    .sort(compare);
  const ordered: RobotGripGroup[] = [];
  while (available.length > 0) {
    const current = available.shift()!;
    ordered.push(current);
    for (const targetId of outgoing.get(current.id) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = groupsById.get(targetId);
        if (target) {
          available.push(target);
          available.sort(compare);
        }
      }
    }
  }

  if (ordered.length !== groups.length) {
    const orderedIds = new Set(ordered.map(({ id }) => id));
    const cyclic = groups.filter(({ id }) => !orderedIds.has(id)).sort(compare);
    diagnostics.push({
      severity: "error",
      phase: "ordering",
      code: "dependency-cycle",
      message: `Robot order dependencies contain a cycle involving: ${cyclic.map(({ id }) => id).join(", ")}.`,
      details: { cyclicGroupCount: cyclic.length },
    });
    ordered.push(...cyclic);
  }
  return ordered;
}

function editedOrderPreference(
  groups: readonly RobotGripGroup[],
  editedOrder: readonly string[],
  diagnostics: RobotDiagnostic[],
): ReadonlyMap<string, number> {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const preference = new Map<string, number>();
  for (const groupId of editedOrder) {
    if (!groupsById.has(groupId)) {
      diagnostics.push({
        severity: "error",
        phase: "ordering",
        code: "missing-order-group",
        message: `Edited robot order references missing group "${groupId}".`,
        groupId,
      });
      continue;
    }
    if (preference.has(groupId)) {
      diagnostics.push({
        severity: "error",
        phase: "ordering",
        code: "duplicate-order-group",
        message: `Edited robot order contains group "${groupId}" more than once.`,
        groupId,
      });
      continue;
    }
    preference.set(groupId, preference.size);
  }
  for (const group of groups) {
    if (preference.has(group.id)) continue;
    diagnostics.push({
      severity: "error",
      phase: "ordering",
      code: "missing-order-group",
      message: `Edited robot order omits group "${group.id}"; its position was resolved from the hard dependencies.`,
      groupId: group.id,
    });
  }
  return preference;
}

/** Returns a topological suggestion that remains an ordinary editable id list. */
export function suggestRobotOrder(
  groups: readonly RobotGripGroup[],
  dependencies: readonly RobotOrderDependency[],
  direction: PalletizingDirection,
  editedOrder?: readonly string[],
): RobotOrderSuggestion {
  const diagnostics: RobotDiagnostic[] = [];
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const normalized = normalizedDependencies(
    groupsById,
    dependencies,
    diagnostics,
  );
  void direction;
  const preferredIndexById = editedOrder
    ? editedOrderPreference(groups, editedOrder, diagnostics)
    : undefined;
  const ordered = topologicalOrder(
    groups,
    normalized,
    diagnostics,
    preferredIndexById,
  );
  const explicitSource = groups.every(
    ({ groupingSource }) => groupingSource === "explicit-project-cycle",
  );
  return {
    groups: ordered,
    order: ordered.map(({ id }) => id),
    dependencies: normalized,
    source: editedOrder
      ? "explicit-edit"
      : explicitSource
        ? "explicit-project-sequence"
        : "suggested-topological",
    diagnostics,
  };
}
