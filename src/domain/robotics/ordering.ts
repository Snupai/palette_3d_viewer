import type { PalletizingDirection } from "~/domain/project/projectSchema";
import { directionSigns } from "~/domain/robotics/frames";
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

function baseComparator(direction: PalletizingDirection) {
  const signs = directionSigns(direction);
  return (left: RobotGripGroup, right: RobotGripGroup): number => {
    if (
      left.sourceSequence !== null &&
      right.sourceSequence !== null &&
      left.sourceSequence !== right.sourceSequence
    ) {
      return left.sourceSequence - right.sourceSequence;
    }
    const yDifference =
      signs.y * (left.centerPalletMm.y - right.centerPalletMm.y);
    if (yDifference !== 0) return yDifference;
    const xDifference =
      signs.x * (left.centerPalletMm.x - right.centerPalletMm.x);
    if (xDifference !== 0) return xDifference;
    return left.id.localeCompare(right.id);
  };
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
  direction: PalletizingDirection,
  diagnostics: RobotDiagnostic[],
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

  const compare = baseComparator(direction);
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

function applyEditedOrder(
  suggested: readonly RobotGripGroup[],
  editedOrder: readonly string[],
  dependencies: readonly RobotOrderDependency[],
  diagnostics: RobotDiagnostic[],
): RobotGripGroup[] {
  const groupsById = new Map(suggested.map((group) => [group.id, group]));
  const used = new Set<string>();
  const ordered: RobotGripGroup[] = [];
  for (const groupId of editedOrder) {
    const group = groupsById.get(groupId);
    if (!group) {
      diagnostics.push({
        severity: "error",
        phase: "ordering",
        code: "missing-order-group",
        message: `Edited robot order references missing group "${groupId}".`,
        groupId,
      });
      continue;
    }
    if (used.has(groupId)) {
      diagnostics.push({
        severity: "error",
        phase: "ordering",
        code: "duplicate-order-group",
        message: `Edited robot order contains group "${groupId}" more than once.`,
        groupId,
      });
      continue;
    }
    used.add(groupId);
    ordered.push(group);
  }
  for (const group of suggested) {
    if (used.has(group.id)) continue;
    diagnostics.push({
      severity: "error",
      phase: "ordering",
      code: "missing-order-group",
      message: `Edited robot order omits group "${group.id}"; it was appended using the suggestion order.`,
      groupId: group.id,
    });
    ordered.push(group);
  }

  const indexById = new Map(ordered.map(({ id }, index) => [id, index]));
  for (const dependency of dependencies) {
    const before = indexById.get(dependency.beforeGroupId);
    const after = indexById.get(dependency.afterGroupId);
    if (before === undefined || after === undefined || before < after) continue;
    diagnostics.push({
      severity: "error",
      phase: "ordering",
      code: "order-dependency-violation",
      message: `Edited order places "${dependency.afterGroupId}" before prerequisite "${dependency.beforeGroupId}".`,
      groupId: dependency.afterGroupId,
    });
  }
  return ordered;
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
  const suggested = topologicalOrder(
    groups,
    normalized,
    direction,
    diagnostics,
  );
  const ordered = editedOrder
    ? applyEditedOrder(suggested, editedOrder, normalized, diagnostics)
    : suggested;
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
