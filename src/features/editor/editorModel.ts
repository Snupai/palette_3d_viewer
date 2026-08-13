import {
  boundingRectangleForPlacements,
  createEffectivePalletEnvelope,
  placementClearanceBounds,
  placementRectangleBounds,
  rectangleBoundsCenter,
  rectangleBoundsContain,
  rectangleBoundsOverlap,
  symmetricSideAllowance,
  type PointMm,
  type RectangleBoundsMm,
} from "~/domain/geometry";
import {
  buildGripDeltaDependencies,
  buildGripVerticalOverlapDependencies,
  orderGripsByDependencies,
} from "~/domain/gripDependencies";
import { pickOffsetForCount } from "~/domain/palletGeometry";
import {
  projectSchema,
  type LayerPattern,
  type PackagePlacement,
  type PatternOrderDependency,
  type PlanningSolution,
  type Project,
} from "~/domain/project/projectSchema";
import {
  suggestRobotOrder,
  type RobotCycle,
  type RobotCycleMaterialization,
  type RobotDiagnostic,
  type RobotGripGroup,
  type RobotPose,
} from "~/domain/robotics";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import {
  projectPatternReference,
  stackPatternsFromProjectSolution,
  transformStackPattern,
} from "~/domain/stack";
import type { Grip, Rotation } from "~/domain/palletTypes";

export type ProjectEditorMode = "pattern" | "order" | "flow";

export type ProjectEditorDiagnostic = {
  severity: "warning" | "error";
  code:
    | "missing-active-solution"
    | "missing-pattern"
    | "missing-pallet"
    | "placement-out-of-bounds"
    | "placement-overlap"
    | "placement-unassigned"
    | "empty-group"
    | "invalid-group-geometry"
    | "group-label-mismatch"
    | "group-order-omission"
    | "group-number-duplicate"
    | "invalid-order"
    | "invalid-project";
  message: string;
  placementIds?: readonly string[];
  gripIds?: readonly string[];
};

export type ProjectEditorGroup = {
  id: string;
  groupNumber: number;
  placementIds: readonly string[];
  centerMm: PointMm;
  rotation: Rotation;
  persisted: boolean;
  orderIndex: number;
};

export type ProjectEditorOrderDependency = PatternOrderDependency & {
  source: "explicit" | "inferred";
};

export type ProjectEditorOrderModel = {
  groups: readonly ProjectEditorGroup[];
  order: readonly string[];
  dependencies: readonly ProjectEditorOrderDependency[];
  unassignedPlacementIds: readonly string[];
  diagnostics: readonly ProjectEditorDiagnostic[];
};

export type ProjectEditorCommand =
  | {
      type: "move-placements";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
      deltaMm: PointMm;
    }
  | {
      type: "set-placement-position";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementId: string;
      positionMm: PointMm;
    }
  | {
      type: "rotate-placements";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
      quarterTurns?: number;
    }
  | {
      type: "center-placements";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
    }
  | {
      type: "set-label-side";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
      labelSide: CandidateLabelSide | null;
    }
  | {
      type: "insert-placement";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementId: string;
      orientation: "longitudinal" | "transverse";
    }
  | {
      type: "delete-placements";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
    }
  | {
      type: "set-pattern-name";
      mode: "pattern";
      solutionId: string;
      patternId: string;
      name: string;
    }
  | {
      type: "create-group";
      mode: "order";
      solutionId: string;
      patternId: string;
      placementIds: readonly string[];
    }
  | {
      type: "remove-group";
      mode: "order";
      solutionId: string;
      patternId: string;
      gripId: string;
    }
  | {
      type: "split-group";
      mode: "order";
      solutionId: string;
      patternId: string;
      gripId: string;
    }
  | {
      type: "merge-groups";
      mode: "order";
      solutionId: string;
      patternId: string;
      gripIds: readonly string[];
    }
  | {
      type: "reorder-group";
      mode: "order";
      solutionId: string;
      patternId: string;
      gripId: string;
      toIndex: number;
    }
  | {
      type: "apply-suggested-order";
      mode: "order";
      solutionId: string;
      patternId: string;
      gripIds: readonly string[];
    }
  | {
      type: "add-order-dependency";
      mode: "order";
      solutionId: string;
      patternId: string;
      beforeGripId: string;
      afterGripId: string;
    }
  | {
      type: "remove-order-dependency";
      mode: "order";
      solutionId: string;
      patternId: string;
      beforeGripId: string;
      afterGripId: string;
    }
  | {
      type: "set-interlayer-before";
      mode: "pattern";
      solutionId: string;
      layerId: string;
      quantity: number;
    }
  | {
      type: "set-interlayer-thickness";
      mode: "pattern";
      solutionId: string;
      thicknessMm: number;
    }
  | {
      type: "set-interlayer-before-thickness";
      mode: "pattern";
      solutionId: string;
      layerId: string;
      thicknessMm: number;
    }
  | {
      type: "set-trailing-interlayer";
      mode: "pattern";
      solutionId: string;
      quantity: number;
    }
  | {
      type: "set-trailing-interlayer-thickness";
      mode: "pattern";
      solutionId: string;
      thicknessMm: number;
    }
  | {
      type: "set-active-solution";
      mode: "pattern" | "order" | "flow";
      solutionId: string;
    };

export class ProjectEditorCommandError extends Error {
  constructor(
    message: string,
    readonly diagnostics: readonly ProjectEditorDiagnostic[] = [],
  ) {
    super(message);
    this.name = "ProjectEditorCommandError";
  }
}

const labelOffsetBySide: Record<CandidateLabelSide, { x: number; y: number }> =
  {
    top: { x: 0, y: -1 },
    right: { x: -1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: 1, y: 0 },
    top_right: { x: -1, y: -1 },
    bottom_right: { x: -1, y: 1 },
    bottom_left: { x: 1, y: 1 },
    top_left: { x: 1, y: -1 },
  };
const cardinalLabelRotation = ["right", "top", "left", "bottom"] as const;
const cornerLabelRotation = [
  "top_right",
  "top_left",
  "bottom_left",
  "bottom_right",
] as const;

function rotateLabelSide(
  labelSide: CandidateLabelSide | null,
  quarterTurns: number,
): CandidateLabelSide | null {
  if (labelSide === null) return null;
  const labels = cardinalLabelRotation.includes(
    labelSide as (typeof cardinalLabelRotation)[number],
  )
    ? cardinalLabelRotation
    : cornerLabelRotation;
  const index = labels.indexOf(labelSide as never);
  return labels[(index + quarterTurns) % labels.length]!;
}

function rotateQuarterTurnOffset(
  offset: PointMm,
  quarterTurns: number,
): PointMm {
  switch (quarterTurns) {
    case 0:
      return offset;
    case 1:
      return { x: -offset.y, y: offset.x };
    case 2:
      return { x: -offset.x, y: -offset.y };
    case 3:
      return { x: offset.y, y: -offset.x };
    default:
      throw new ProjectEditorCommandError(
        "Package rotation must use normalized quarter turns.",
      );
  }
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new ProjectEditorCommandError(`${field} must be finite.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ProjectEditorCommandError(
      `${field} must be a non-negative integer.`,
    );
  }
  return value;
}

function editedSolutionOrigin(
  origin: PlanningSolution["origin"],
): PlanningSolution["origin"] {
  return origin === "imported" ? "manual" : origin;
}

function context(
  project: Project,
  solutionId: string,
  patternId: string,
): { solution: PlanningSolution; pattern: LayerPattern } {
  const solution = project.solutions.find(({ id }) => id === solutionId);
  if (!solution) {
    throw new ProjectEditorCommandError(
      `Project solution "${solutionId}" does not exist.`,
      [
        {
          severity: "error",
          code: "missing-active-solution",
          message: `Project solution "${solutionId}" does not exist.`,
        },
      ],
    );
  }
  const pattern = solution.patterns.find(({ id }) => id === patternId);
  if (!pattern) {
    throw new ProjectEditorCommandError(
      `Layer pattern "${patternId}" does not exist.`,
      [
        {
          severity: "error",
          code: "missing-pattern",
          message: `Layer pattern "${patternId}" does not exist.`,
        },
      ],
    );
  }
  return { solution, pattern };
}

export function activeEditorSolution(
  project: Project,
): PlanningSolution | null {
  return (
    project.solutions.find(({ id }) => id === project.activeSolutionId) ?? null
  );
}

export function activeEditorPattern(
  project: Project,
  patternId?: string | null,
): LayerPattern | null {
  const solution = activeEditorSolution(project);
  if (!solution) return null;
  return (
    solution.patterns.find(({ id }) => id === patternId) ??
    solution.patterns[0] ??
    null
  );
}

export function normalizeProjectForEditor(project: Project): Project {
  return {
    ...project,
    solutions: project.solutions.map((solution) => {
      const normalizedById = new Map(
        stackPatternsFromProjectSolution(project, solution.id).flatMap(
          (pattern) => {
            if (!pattern.generatedGripPolicy) return [];
            const transformed = transformStackPattern(
              pattern,
              "identity",
              project.package.dimensionsMm,
              project.package.inletOrientation,
            );
            if (pattern.provenance.kind !== "project-pattern") {
              throw new Error(
                "Project editor received a non-project stack pattern.",
              );
            }
            return [[pattern.provenance.patternId, transformed] as const];
          },
        ),
      );
      return {
        ...solution,
        patterns: solution.patterns.map((pattern) => {
          const normalized = normalizedById.get(pattern.id);
          if (!normalized) return pattern;
          return {
            ...pattern,
            grips: normalized.grips.map((grip) => ({
              id: grip.sourceGripId,
              groupNumber: grip.groupNumber,
              pickX: grip.pickX,
              pickY: grip.pickY,
              pickRotation: grip.pickRotation,
              x: grip.x,
              y: grip.y,
              rotation: grip.rotation,
              numPackages: grip.numPackages,
              dx: grip.dx,
              dy: grip.dy,
            })),
            groupOrder: [...normalized.groupOrder],
            orderDependencies: normalized.orderDependencies.map(
              (dependency) => ({ ...dependency }),
            ),
          };
        }),
      };
    }),
  };
}

export function projectEditorEnvelope(
  project: Project,
): RectangleBoundsMm | null {
  if (!project.pallet) return null;
  return createEffectivePalletEnvelope(
    {
      length: project.pallet.dimensionsMm.length,
      width: project.pallet.dimensionsMm.width,
    },
    symmetricSideAllowance(project.pallet.allowedOverhangMm),
  );
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableGripId(
  patternId: string,
  placementIds: readonly string[],
): string {
  return `editor-grip-${hashString(
    `${patternId}:${[...placementIds].sort().join("|")}`,
  )}`;
}

function uniqueGripId(
  pattern: LayerPattern,
  requested: string,
  ignoredIds: ReadonlySet<string> = new Set(),
): string {
  const used = new Set(
    pattern.grips.map(({ id }) => id).filter((id) => !ignoredIds.has(id)),
  );
  if (!used.has(requested)) return requested;
  let suffix = 2;
  while (used.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

function averageCenter(placements: readonly PackagePlacement[]): PointMm {
  if (placements.length === 0) return { x: 0, y: 0 };
  const total = placements.reduce(
    (sum, placement) => ({
      x: sum.x + placement.positionMm.x,
      y: sum.y + placement.positionMm.y,
    }),
    { x: 0, y: 0 },
  );
  return {
    x: total.x / placements.length,
    y: total.y / placements.length,
  };
}

function projectGroupingSpan(project: Project): number {
  return project.source.kind === "rob-import" &&
    project.package.inletOrientation === "crosswise"
    ? project.package.dimensionsMm.width
    : project.package.dimensionsMm.length;
}

function groupGeometryError(
  project: Project,
  placements: readonly PackagePlacement[],
  allowObservedMultipick = false,
): string | null {
  const first = placements[0];
  if (!first) return "A group must contain at least one package placement.";
  if (placements.length === 1) return null;
  if (!project.package.multiPickAllowed && !allowObservedMultipick) {
    return "This project does not allow multiple packages in one grip group.";
  }
  if (placements.some(({ rotation }) => rotation !== first.rotation)) {
    return "Grouped packages must use the same placement rotation.";
  }

  const horizontal = first.rotation === 0 || first.rotation === 180;
  const crossValues = placements.map((placement) =>
    horizontal ? placement.positionMm.y : placement.positionMm.x,
  );
  const tolerance = 0.500_001;
  if (Math.max(...crossValues) - Math.min(...crossValues) > tolerance) {
    return "Grouped packages must be aligned on one cross axis.";
  }
  const axisValues = placements
    .map((placement) =>
      horizontal ? placement.positionMm.x : placement.positionMm.y,
    )
    .sort((left, right) => left - right);
  const expectedSpan = projectGroupingSpan(project);
  for (let index = 1; index < axisValues.length; index += 1) {
    if (
      Math.abs(axisValues[index]! - axisValues[index - 1]! - expectedSpan) >
      tolerance
    ) {
      return "Grouped packages must be face-adjacent along their local length axis.";
    }
  }
  return null;
}

function gripFromPlacements(
  project: Project,
  placements: readonly PackagePlacement[],
  input: {
    id: string;
    groupNumber: number;
    existing?: LayerPattern["grips"][number] | null;
    deriveLabelOffset?: boolean;
    allowObservedMultipick?: boolean;
  },
): LayerPattern["grips"][number] {
  const geometryError = groupGeometryError(
    project,
    placements,
    input.allowObservedMultipick,
  );
  if (geometryError) {
    throw new ProjectEditorCommandError(geometryError, [
      {
        severity: "error",
        code: "invalid-group-geometry",
        message: geometryError,
        placementIds: placements.map(({ id }) => id),
        gripIds: [input.id],
      },
    ]);
  }
  const first = placements[0]!;
  const center = averageCenter(placements);
  const existing = input.existing ?? null;
  const previousCenter = existing ? { x: existing.x, y: existing.y } : center;
  const inputDirection =
    project.package.inletOrientation === "crosswise" ? 1 : 0;
  const pickOffset = pickOffsetForCount(
    project.package.dimensionsMm.length,
    project.package.dimensionsMm.width,
    inputDirection,
    existing?.pickRotation ?? 0,
    placements.length,
  );
  const labels = new Set(placements.map(({ labelSide }) => labelSide));
  const sharedLabel = labels.size === 1 ? first.labelSide : undefined;
  const labelOffset =
    existing && !input.deriveLabelOffset
      ? { x: existing.dx, y: existing.dy }
      : sharedLabel === undefined
        ? { x: existing?.dx ?? 0, y: existing?.dy ?? 0 }
        : sharedLabel === null
          ? { x: 0, y: 0 }
          : labelOffsetBySide[sharedLabel];

  return {
    id: input.id,
    groupNumber: input.groupNumber,
    pickX: existing
      ? existing.pickX + center.x - previousCenter.x
      : pickOffset.x,
    pickY: existing
      ? existing.pickY + center.y - previousCenter.y
      : pickOffset.y,
    pickRotation: existing?.pickRotation ?? 0,
    x: center.x,
    y: center.y,
    rotation: first.rotation,
    numPackages: placements.length,
    dx: labelOffset.x,
    dy: labelOffset.y,
  };
}

function maxPackagesPerAutomaticGroup(project: Project): number {
  if (!project.package.multiPickAllowed) return 1;
  const selectedGripper = project.grippers.find(
    ({ id }) => id === project.selectedGripperId,
  );
  const pickupSpan =
    project.package.inletOrientation === "lengthwise"
      ? project.package.dimensionsMm.length
      : project.package.dimensionsMm.width;
  if (!selectedGripper?.maxPickupLengthMm) return 2;
  return Math.max(
    1,
    Math.min(2, Math.floor(selectedGripper.maxPickupLengthMm / pickupSpan)),
  );
}

function automaticPlacementGroups(
  project: Project,
  pattern: LayerPattern,
): string[][] {
  const maxPackages = maxPackagesPerAutomaticGroup(project);
  const span = projectGroupingSpan(project);
  const tolerance = 0.001;
  const sorted = [...pattern.placements].sort((left, right) => {
    if (left.rotation !== right.rotation) return left.rotation - right.rotation;
    const leftHorizontal = left.rotation === 0 || left.rotation === 180;
    const rightHorizontal = right.rotation === 0 || right.rotation === 180;
    const leftCross = leftHorizontal ? left.positionMm.y : left.positionMm.x;
    const rightCross = rightHorizontal
      ? right.positionMm.y
      : right.positionMm.x;
    if (leftCross !== rightCross) return leftCross - rightCross;
    const leftAxis = leftHorizontal ? left.positionMm.x : left.positionMm.y;
    const rightAxis = rightHorizontal ? right.positionMm.x : right.positionMm.y;
    if (leftAxis !== rightAxis) return leftAxis - rightAxis;
    return left.id.localeCompare(right.id);
  });

  const rows: PackagePlacement[][] = [];
  for (const placement of sorted) {
    const horizontal = placement.rotation === 0 || placement.rotation === 180;
    const cross = horizontal ? placement.positionMm.y : placement.positionMm.x;
    const row = rows.find((candidate) => {
      const first = candidate[0];
      if (!first || first.rotation !== placement.rotation) return false;
      const firstHorizontal = first.rotation === 0 || first.rotation === 180;
      const firstCross = firstHorizontal
        ? first.positionMm.y
        : first.positionMm.x;
      return Math.abs(firstCross - cross) <= tolerance;
    });
    if (row) row.push(placement);
    else rows.push([placement]);
  }

  const groups: string[][] = [];
  for (const row of rows) {
    row.sort((left, right) => {
      const horizontal = left.rotation === 0 || left.rotation === 180;
      const difference = horizontal
        ? left.positionMm.x - right.positionMm.x
        : left.positionMm.y - right.positionMm.y;
      return difference || left.id.localeCompare(right.id);
    });
    let runStart = 0;
    for (let index = 1; index <= row.length; index += 1) {
      const previous = row[index - 1];
      const current = row[index];
      const horizontal = previous
        ? previous.rotation === 0 || previous.rotation === 180
        : true;
      const continues =
        previous !== undefined &&
        current !== undefined &&
        Math.abs(
          (horizontal
            ? current.positionMm.x - previous.positionMm.x
            : current.positionMm.y - previous.positionMm.y) - span,
        ) <= tolerance;
      if (continues) continue;
      const run = row.slice(runStart, index);
      for (let start = 0; start < run.length; start += maxPackages) {
        groups.push(run.slice(start, start + maxPackages).map(({ id }) => id));
      }
      runStart = index;
    }
  }
  return groups;
}

function normalizedGroupOrder(pattern: LayerPattern): string[] {
  const ids = new Set(pattern.grips.map(({ id }) => id));
  const used = new Set<string>();
  const order: string[] = [];
  for (const id of pattern.groupOrder ?? []) {
    if (!ids.has(id) || used.has(id)) continue;
    used.add(id);
    order.push(id);
  }
  const remaining = [...pattern.grips]
    .filter(({ id }) => !used.has(id))
    .sort(
      (left, right) =>
        (left.groupNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.groupNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
    );
  order.push(...remaining.map(({ id }) => id));
  return order;
}

function inferredDependencies(
  project: Project,
  pattern: LayerPattern,
): ProjectEditorOrderDependency[] {
  if (pattern.grips.length === 0) return [];
  const legacyGrips: Grip[] = pattern.grips.map((grip) => ({
    id: grip.id,
    pickX: grip.pickX,
    pickY: grip.pickY,
    pickRotation: grip.pickRotation,
    x: grip.x,
    y: grip.y,
    rotation: grip.rotation,
    numPackages: grip.numPackages,
    dx: grip.dx,
    dy: grip.dy,
  }));
  const inputDirection =
    project.package.inletOrientation === "crosswise" ? 1 : 0;
  const deltaDependencies = buildGripDeltaDependencies(
    legacyGrips,
    project.package.dimensionsMm.length,
    project.package.dimensionsMm.width,
    inputDirection,
  ).flatMap(({ prerequisiteIndex, dependentIndex }) => {
    const beforeGripId = pattern.grips[prerequisiteIndex]?.id;
    const afterGripId = pattern.grips[dependentIndex]?.id;
    return beforeGripId && afterGripId
      ? [{ beforeGripId, afterGripId, source: "inferred" as const }]
      : [];
  });
  const verticalDependencies = buildGripVerticalOverlapDependencies(
    pattern.grips.map(({ id }) => id),
    pattern.placements,
    project.package.dimensionsMm,
  ).map((dependency) => ({ ...dependency, source: "inferred" as const }));
  return mergeDependencies(deltaDependencies, verticalDependencies);
}

function dependencyKey(dependency: PatternOrderDependency): string {
  return `${dependency.beforeGripId}::${dependency.afterGripId}`;
}

function mergeDependencies(
  ...sets: readonly (readonly PatternOrderDependency[])[]
): ProjectEditorOrderDependency[] {
  const merged = new Map<string, ProjectEditorOrderDependency>();
  for (const dependencies of sets) {
    for (const dependency of dependencies) {
      if (dependency.beforeGripId === dependency.afterGripId) continue;
      const normalized = {
        ...dependency,
        source: dependency.source ?? "explicit",
      } satisfies ProjectEditorOrderDependency;
      const key = dependencyKey(normalized);
      const existing = merged.get(key);
      if (existing?.source === "explicit" && normalized.source !== "explicit") {
        continue;
      }
      merged.set(key, normalized);
    }
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.beforeGripId.localeCompare(right.beforeGripId) ||
      left.afterGripId.localeCompare(right.afterGripId),
  );
}

function explicitDependencies(
  pattern: LayerPattern,
): ProjectEditorOrderDependency[] {
  return (pattern.orderDependencies ?? []).flatMap((dependency) =>
    dependency.source === "inferred"
      ? []
      : [{ ...dependency, source: "explicit" as const }],
  );
}

function withoutCurrentInferredDependencies(
  pattern: LayerPattern,
): LayerPattern {
  return {
    ...pattern,
    orderDependencies: explicitDependencies(pattern),
  };
}

function dependenciesContainCycle(
  gripIds: readonly string[],
  dependencies: readonly PatternOrderDependency[],
): boolean {
  const knownIds = new Set(gripIds);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(gripIds.map((id) => [id, 0]));
  for (const dependency of mergeDependencies(dependencies)) {
    if (
      !knownIds.has(dependency.beforeGripId) ||
      !knownIds.has(dependency.afterGripId)
    ) {
      continue;
    }
    const targets = outgoing.get(dependency.beforeGripId) ?? [];
    targets.push(dependency.afterGripId);
    outgoing.set(dependency.beforeGripId, targets);
    indegree.set(
      dependency.afterGripId,
      (indegree.get(dependency.afterGripId) ?? 0) + 1,
    );
  }

  const available = gripIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (available.length > 0) {
    const current = available.shift()!;
    visited += 1;
    for (const targetId of outgoing.get(current) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) available.push(targetId);
    }
  }
  return visited !== gripIds.length;
}

function assertOrderSatisfiesDependencies(
  project: Project,
  pattern: LayerPattern,
  order: readonly string[],
): void {
  const indexById = new Map(order.map((gripId, index) => [gripId, index]));
  const violation = mergeDependencies(
    pattern.orderDependencies ?? [],
    inferredDependencies(project, pattern),
  ).find((dependency) => {
    const beforeIndex = indexById.get(dependency.beforeGripId);
    const afterIndex = indexById.get(dependency.afterGripId);
    return (
      beforeIndex !== undefined &&
      afterIndex !== undefined &&
      beforeIndex >= afterIndex
    );
  });
  if (!violation) return;
  throw new ProjectEditorCommandError(
    `Grip "${violation.afterGripId}" cannot execute before prerequisite "${violation.beforeGripId}".`,
    [
      {
        severity: "error",
        code: "invalid-order",
        message: `The requested order violates ${violation.beforeGripId} before ${violation.afterGripId}.`,
        gripIds: [violation.beforeGripId, violation.afterGripId],
      },
    ],
  );
}

function ensurePatternGroups(
  project: Project,
  pattern: LayerPattern,
): LayerPattern {
  if (pattern.grips.length > 0) {
    const grips = pattern.grips.map((grip, index) => ({
      ...grip,
      groupNumber: grip.groupNumber ?? index + 1,
    }));
    const withNumbers = { ...pattern, grips };
    return cleanPatternMetadata({
      ...withNumbers,
      groupOrder: normalizedGroupOrder(withNumbers),
      orderDependencies: explicitDependencies(withNumbers),
    });
  }

  const placementsById = new Map(
    pattern.placements.map((placement) => [placement.id, placement]),
  );
  const groups = automaticPlacementGroups(project, pattern);
  const grips = groups.map((placementIds, index) => {
    const placements = placementIds.flatMap((id) => {
      const placement = placementsById.get(id);
      return placement ? [placement] : [];
    });
    const id = uniqueGripId(pattern, stableGripId(pattern.id, placementIds));
    return gripFromPlacements(project, placements, {
      id,
      groupNumber: index + 1,
    });
  });
  const gripIdByPlacement = new Map<string, string>();
  groups.forEach((placementIds, index) => {
    const grip = grips[index];
    if (!grip) return;
    placementIds.forEach((placementId) =>
      gripIdByPlacement.set(placementId, grip.id),
    );
  });
  const placements = pattern.placements.map((placement) => ({
    ...placement,
    gripId: gripIdByPlacement.get(placement.id) ?? null,
  }));
  const verticalDependencies = buildGripVerticalOverlapDependencies(
    grips.map(({ id }) => id),
    placements,
    project.package.dimensionsMm,
  );
  const orderedGrips = orderGripsByDependencies(
    grips,
    verticalDependencies,
  ).map((grip, index) => ({ ...grip, groupNumber: index + 1 }));
  return {
    ...pattern,
    grips: orderedGrips,
    placements,
    groupOrder: orderedGrips.map(({ id }) => id),
    orderDependencies: [],
  };
}

function assignmentsByGrip(
  pattern: LayerPattern,
): Map<string, PackagePlacement[]> {
  const assignments = new Map<string, PackagePlacement[]>();
  for (const placement of pattern.placements) {
    if (placement.gripId === null) continue;
    const values = assignments.get(placement.gripId) ?? [];
    values.push(placement);
    assignments.set(placement.gripId, values);
  }
  return assignments;
}

function cleanPatternMetadata(pattern: LayerPattern): LayerPattern {
  const ids = new Set(pattern.grips.map(({ id }) => id));
  const groupOrder = normalizedGroupOrder(pattern);
  const numberById = new Map(
    groupOrder.map((gripId, index) => [gripId, index + 1]),
  );
  return {
    ...pattern,
    grips: pattern.grips.map((grip, index) => ({
      ...grip,
      groupNumber: numberById.get(grip.id) ?? index + 1,
    })),
    groupOrder,
    orderDependencies: (pattern.orderDependencies ?? []).filter(
      ({ beforeGripId, afterGripId }) =>
        ids.has(beforeGripId) &&
        ids.has(afterGripId) &&
        beforeGripId !== afterGripId,
    ),
  };
}

function synchronizePatternGrips(
  project: Project,
  previousPattern: LayerPattern,
  nextPattern: LayerPattern,
  options: {
    deriveLabelOffsetsForGripIds?: ReadonlySet<string>;
  } = {},
): LayerPattern {
  if (previousPattern.grips.length === 0 && nextPattern.grips.length === 0) {
    return nextPattern;
  }
  const assignments = assignmentsByGrip(nextPattern);
  const previousById = new Map(
    previousPattern.grips.map((grip) => [grip.id, grip]),
  );
  const grips = nextPattern.grips.flatMap((grip, index) => {
    const placements = assignments.get(grip.id) ?? [];
    if (placements.length === 0) return [];
    const previousGrip = previousById.get(grip.id) ?? null;
    return [
      gripFromPlacements(project, placements, {
        id: grip.id,
        groupNumber: grip.groupNumber ?? index + 1,
        existing: previousGrip ?? grip,
        deriveLabelOffset:
          options.deriveLabelOffsetsForGripIds?.has(grip.id) ?? false,
        allowObservedMultipick:
          project.source.kind === "rob-import" && previousGrip !== null,
      }),
    ];
  });
  return cleanPatternMetadata({ ...nextPattern, grips });
}

function cycleId(patternId: string, gripId: string): string {
  return `${patternId}-cycle-${hashString(gripId)}`;
}

function synchronizePatternCycles(
  project: Project,
  solution: PlanningSolution,
  pattern: LayerPattern,
): PlanningSolution["robotCycles"] {
  const patternCycles = solution.robotCycles.filter(
    (cycle) => cycle.patternId === pattern.id,
  );
  if (patternCycles.length === 0) return solution.robotCycles;

  const otherCycles = solution.robotCycles.filter(
    (cycle) => cycle.patternId !== pattern.id,
  );
  const existingByGripId = new Map(
    patternCycles.flatMap((cycle) =>
      cycle.gripId === null ? [] : [[cycle.gripId, cycle] as const],
    ),
  );
  const assignments = assignmentsByGrip(pattern);
  const order = normalizedGroupOrder(pattern);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const cycles = pattern.grips.flatMap((grip, index) => {
    const placements = assignments.get(grip.id) ?? [];
    if (placements.length === 0) return [];
    const existing = existingByGripId.get(grip.id);
    return [
      {
        id: existing?.id ?? cycleId(pattern.id, grip.id),
        patternId: pattern.id,
        sequence: orderIndex.get(grip.id) ?? index,
        gripId: grip.id,
        placementIds: placements
          .slice()
          .sort((left, right) => left.sequence - right.sequence)
          .map(({ id }) => id),
        gripperId: existing?.gripperId ?? project.selectedGripperId,
        pickPose: {
          x: grip.pickX,
          y: grip.pickY,
          z: existing?.pickPose.z ?? null,
          rotation: grip.pickRotation,
        },
        placePose: {
          x: grip.x,
          y: grip.y,
          z: existing?.placePose.z ?? null,
          rotation: grip.rotation,
        },
        labelOffset: { x: grip.dx, y: grip.dy },
      },
    ];
  });
  return [...otherCycles, ...cycles];
}

function replacePattern(
  project: Project,
  solutionId: string,
  previousPattern: LayerPattern,
  nextPatternInput: LayerPattern,
  options: {
    deriveLabelOffsetsForGripIds?: ReadonlySet<string>;
  } = {},
): Project {
  const solution = project.solutions.find(({ id }) => id === solutionId)!;
  const synchronizedPattern = synchronizePatternGrips(
    project,
    previousPattern,
    nextPatternInput,
    options,
  );
  const orderDependencies = mergeDependencies(
    explicitDependencies(synchronizedPattern),
    inferredDependencies(project, synchronizedPattern),
  );
  if (
    dependenciesContainCycle(
      synchronizedPattern.grips.map(({ id }) => id),
      orderDependencies,
    )
  ) {
    throw new ProjectEditorCommandError(
      "The grip order dependencies contain a cycle.",
      [
        {
          severity: "error",
          code: "invalid-order",
          message: "The grip order dependencies contain a cycle.",
        },
      ],
    );
  }
  const preferredOrder = normalizedGroupOrder(synchronizedPattern);
  const orderedGrips = orderGripsByDependencies(
    synchronizedPattern.grips,
    orderDependencies,
    preferredOrder,
  );
  const nextPattern = cleanPatternMetadata({
    ...synchronizedPattern,
    grips: orderedGrips,
    groupOrder: orderedGrips.map(({ id }) => id),
    orderDependencies,
    gripPlanningSource: "manual",
  });
  const nextSolution: PlanningSolution = {
    ...solution,
    origin: editedSolutionOrigin(solution.origin),
    patterns: solution.patterns.map((pattern) =>
      pattern.id === nextPattern.id ? nextPattern : pattern,
    ),
    robotCycles: synchronizePatternCycles(project, solution, nextPattern),
  };
  return projectSchema.parse({
    ...project,
    solutions: project.solutions.map((candidate) =>
      candidate.id === nextSolution.id ? nextSolution : candidate,
    ),
  });
}

function validateGeometryOrThrow(
  project: Project,
  pattern: LayerPattern,
): void {
  const diagnostics = validateProjectPattern(project, pattern);
  const blocking = diagnostics.filter(
    ({ severity, code }) =>
      severity === "error" &&
      (code === "placement-out-of-bounds" ||
        code === "placement-overlap" ||
        code === "invalid-group-geometry"),
  );
  if (blocking.length > 0) {
    throw new ProjectEditorCommandError(blocking[0]!.message, blocking);
  }
}

function replaceGeometryPattern(
  project: Project,
  solutionId: string,
  previousPattern: LayerPattern,
  nextPattern: LayerPattern,
): Project {
  validateGeometryOrThrow(project, nextPattern);
  return replacePattern(project, solutionId, previousPattern, nextPattern);
}

function selectedPlacements(
  pattern: LayerPattern,
  placementIds: readonly string[],
): PackagePlacement[] {
  const ids = new Set(placementIds);
  const selected = pattern.placements.filter(({ id }) => ids.has(id));
  if (selected.length !== ids.size || selected.length === 0) {
    throw new ProjectEditorCommandError(
      "Select at least one existing package placement.",
    );
  }
  return selected;
}

function normalizedSequences(
  placements: readonly PackagePlacement[],
): PackagePlacement[] {
  return placements
    .slice()
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    )
    .map((placement, sequence) => ({ ...placement, sequence }));
}

export function selectionCenteringDelta(
  project: Project,
  pattern: LayerPattern,
  placementIds: readonly string[],
): PointMm {
  const envelope = projectEditorEnvelope(project);
  if (!envelope) {
    throw new ProjectEditorCommandError(
      "A pallet is required before centering package placements.",
    );
  }
  const selected = selectedPlacements(pattern, placementIds);
  const bounds = boundingRectangleForPlacements(
    selected,
    project.package.dimensionsMm,
  );
  if (!bounds) return { x: 0, y: 0 };
  const selectionCenter = rectangleBoundsCenter(bounds);
  const envelopeCenter = rectangleBoundsCenter(envelope);
  return {
    x: envelopeCenter.x - selectionCenter.x,
    y: envelopeCenter.y - selectionCenter.y,
  };
}

function insertionPosition(
  project: Project,
  pattern: LayerPattern,
  rotation: Rotation,
): PointMm {
  const envelope = projectEditorEnvelope(project);
  if (!envelope) {
    throw new ProjectEditorCommandError(
      "A pallet is required before inserting a package.",
    );
  }
  const prototype: PackagePlacement = {
    id: "prototype",
    sequence: pattern.placements.length,
    positionMm: rectangleBoundsCenter(envelope),
    rotation,
    gripId: null,
    labelSide: null,
  };
  const footprint = placementRectangleBounds(
    prototype,
    project.package.dimensionsMm,
  );
  const halfLength = (footprint.maxX - footprint.minX) / 2;
  const halfWidth = (footprint.maxY - footprint.minY) / 2;
  const clearance = project.package.clearanceMm;
  const center = rectangleBoundsCenter(envelope);
  const xCandidates = new Set<number>([
    center.x,
    envelope.minX + halfLength,
    envelope.maxX - halfLength,
  ]);
  const yCandidates = new Set<number>([
    center.y,
    envelope.minY + halfWidth,
    envelope.maxY - halfWidth,
  ]);
  for (const placement of pattern.placements) {
    const bounds = placementRectangleBounds(
      placement,
      project.package.dimensionsMm,
    );
    xCandidates.add(bounds.minX - clearance - halfLength);
    xCandidates.add(bounds.maxX + clearance + halfLength);
    yCandidates.add(bounds.minY - clearance - halfWidth);
    yCandidates.add(bounds.maxY + clearance + halfWidth);
  }
  const candidates = [...xCandidates]
    .flatMap((x) => [...yCandidates].map((y) => ({ x, y })))
    .sort(
      (left, right) =>
        (left.x - center.x) ** 2 +
          (left.y - center.y) ** 2 -
          ((right.x - center.x) ** 2 + (right.y - center.y) ** 2) ||
        left.y - right.y ||
        left.x - right.x,
    );
  for (const positionMm of candidates) {
    const candidate = { ...prototype, positionMm };
    const physical = placementRectangleBounds(
      candidate,
      project.package.dimensionsMm,
    );
    if (!rectangleBoundsContain(envelope, physical)) continue;
    const clearanceBounds = placementClearanceBounds(
      candidate,
      project.package.dimensionsMm,
      clearance,
    );
    const collides = pattern.placements.some((placement) =>
      rectangleBoundsOverlap(
        clearanceBounds,
        placementClearanceBounds(
          placement,
          project.package.dimensionsMm,
          clearance,
        ),
      ),
    );
    if (!collides) return positionMm;
  }
  throw new ProjectEditorCommandError(
    "No non-overlapping insertion position is available inside the pallet envelope.",
  );
}

export function placementIdsInMarquee(
  project: Project,
  pattern: LayerPattern,
  start: PointMm,
  end: PointMm,
): string[] {
  const marquee = {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
  if (marquee.minX === marquee.maxX || marquee.minY === marquee.maxY) return [];
  return pattern.placements.flatMap((placement) => {
    const bounds = placementRectangleBounds(
      placement,
      project.package.dimensionsMm,
    );
    const intersects =
      bounds.minX <= marquee.maxX &&
      bounds.maxX >= marquee.minX &&
      bounds.minY <= marquee.maxY &&
      bounds.maxY >= marquee.minY;
    return intersects ? [placement.id] : [];
  });
}

function remapDependencies(
  dependencies: readonly PatternOrderDependency[],
  replacements: ReadonlyMap<string, string>,
): PatternOrderDependency[] {
  return mergeDependencies(
    dependencies.map((dependency) => ({
      beforeGripId:
        replacements.get(dependency.beforeGripId) ?? dependency.beforeGripId,
      afterGripId:
        replacements.get(dependency.afterGripId) ?? dependency.afterGripId,
      source: dependency.source ?? "explicit",
    })),
  );
}

function groupOrderAfterReplacement(
  order: readonly string[],
  removedIds: ReadonlySet<string>,
  insertedIds: readonly string[],
): string[] {
  const firstIndex = Math.min(
    ...[...removedIds].map((id) => {
      const index = order.indexOf(id);
      return index < 0 ? order.length : index;
    }),
  );
  const remaining = order.filter((id) => !removedIds.has(id));
  remaining.splice(Math.min(firstIndex, remaining.length), 0, ...insertedIds);
  return remaining;
}

function createGroup(
  project: Project,
  previousPattern: LayerPattern,
  selectedIds: readonly string[],
): LayerPattern {
  const pattern = ensurePatternGroups(project, previousPattern);
  const selected = selectedPlacements(pattern, selectedIds);
  const selectedSet = new Set(selectedIds);
  const assignments = assignmentsByGrip(pattern);
  const affectedIds = new Set(
    selected.flatMap(({ gripId }) => (gripId === null ? [] : [gripId])),
  );
  if (
    affectedIds.size === 1 &&
    [...affectedIds].every((id) => {
      const assigned = assignments.get(id) ?? [];
      return (
        assigned.length === selected.length &&
        assigned.every(({ id: placementId }) => selectedSet.has(placementId))
      );
    })
  ) {
    return pattern;
  }

  const nextNumber =
    Math.max(0, ...pattern.grips.map(({ groupNumber }) => groupNumber ?? 0)) +
    1;
  const id = uniqueGripId(
    pattern,
    stableGripId(pattern.id, selectedIds),
    affectedIds,
  );
  const newGrip = gripFromPlacements(project, selected, {
    id,
    groupNumber: nextNumber,
  });
  const retainedGrips = pattern.grips.flatMap((grip) => {
    const remaining = (assignments.get(grip.id) ?? []).filter(
      ({ id: placementId }) => !selectedSet.has(placementId),
    );
    if (remaining.length === 0) return [];
    return [
      remaining.length === (assignments.get(grip.id) ?? []).length
        ? grip
        : gripFromPlacements(project, remaining, {
            id: grip.id,
            groupNumber: grip.groupNumber ?? 1,
            existing: grip,
          }),
    ];
  });
  const removedIds = new Set(
    pattern.grips
      .filter(
        (grip) =>
          !retainedGrips.some(({ id: retainedId }) => retainedId === grip.id),
      )
      .map(({ id: gripId }) => gripId),
  );
  const replacements = new Map([...removedIds].map((gripId) => [gripId, id]));
  return cleanPatternMetadata({
    ...pattern,
    grips: [...retainedGrips, newGrip],
    placements: pattern.placements.map((placement) =>
      selectedSet.has(placement.id) ? { ...placement, gripId: id } : placement,
    ),
    groupOrder: groupOrderAfterReplacement(
      normalizedGroupOrder(pattern),
      removedIds,
      [id],
    ),
    orderDependencies: remapDependencies(
      explicitDependencies(pattern),
      replacements,
    ),
  });
}

function removeGroup(pattern: LayerPattern, gripId: string): LayerPattern {
  if (!pattern.grips.some(({ id }) => id === gripId)) {
    throw new ProjectEditorCommandError(`Grip group "${gripId}" is missing.`);
  }
  return cleanPatternMetadata({
    ...pattern,
    grips: pattern.grips.filter(({ id }) => id !== gripId),
    placements: pattern.placements.map((placement) =>
      placement.gripId === gripId ? { ...placement, gripId: null } : placement,
    ),
    groupOrder: normalizedGroupOrder(pattern).filter((id) => id !== gripId),
    orderDependencies: (pattern.orderDependencies ?? []).filter(
      ({ beforeGripId, afterGripId }) =>
        beforeGripId !== gripId && afterGripId !== gripId,
    ),
  });
}

function splitGroup(
  project: Project,
  previousPattern: LayerPattern,
  gripId: string,
): LayerPattern {
  const pattern = ensurePatternGroups(project, previousPattern);
  const grip = pattern.grips.find(({ id }) => id === gripId);
  if (!grip) {
    throw new ProjectEditorCommandError(`Grip group "${gripId}" is missing.`);
  }
  const placements = pattern.placements
    .filter((placement) => placement.gripId === gripId)
    .sort((left, right) => left.sequence - right.sequence);
  if (placements.length <= 1) return pattern;
  let nextNumber =
    Math.max(0, ...pattern.grips.map(({ groupNumber }) => groupNumber ?? 0)) +
    1;
  const ignored = new Set([gripId]);
  const newGrips = placements.map((placement, index) => {
    const id = uniqueGripId(
      pattern,
      stableGripId(pattern.id, [placement.id]),
      ignored,
    );
    ignored.add(id);
    return gripFromPlacements(project, [placement], {
      id,
      groupNumber: index === 0 ? (grip.groupNumber ?? 1) : nextNumber++,
      existing: index === 0 ? grip : null,
    });
  });
  const gripIdByPlacement = new Map(
    placements.map((placement, index) => [placement.id, newGrips[index]!.id]),
  );
  const replacements = new Map([[gripId, newGrips[0]!.id]]);
  const dependencies = remapDependencies(
    explicitDependencies(pattern),
    replacements,
  );
  const expandedDependencies = mergeDependencies(
    dependencies,
    ...explicitDependencies(pattern).flatMap((dependency) => {
      if (dependency.afterGripId === gripId) {
        return newGrips.slice(1).map((newGrip) => [
          {
            beforeGripId: dependency.beforeGripId,
            afterGripId: newGrip.id,
          },
        ]);
      }
      if (dependency.beforeGripId === gripId) {
        return newGrips.slice(1).map((newGrip) => [
          {
            beforeGripId: newGrip.id,
            afterGripId: dependency.afterGripId,
          },
        ]);
      }
      return [];
    }),
  );
  return cleanPatternMetadata({
    ...pattern,
    grips: [...pattern.grips.filter(({ id }) => id !== gripId), ...newGrips],
    placements: pattern.placements.map((placement) => ({
      ...placement,
      gripId: gripIdByPlacement.get(placement.id) ?? placement.gripId,
    })),
    groupOrder: groupOrderAfterReplacement(
      normalizedGroupOrder(pattern),
      new Set([gripId]),
      newGrips.map(({ id }) => id),
    ),
    orderDependencies: expandedDependencies,
  });
}

function mergeGroups(
  project: Project,
  previousPattern: LayerPattern,
  gripIds: readonly string[],
): LayerPattern {
  const pattern = ensurePatternGroups(project, previousPattern);
  const selectedSet = new Set(gripIds);
  if (selectedSet.size < 2) {
    throw new ProjectEditorCommandError("Select at least two groups to merge.");
  }
  const order = normalizedGroupOrder(pattern);
  const selectedGrips = order.flatMap((id) => {
    if (!selectedSet.has(id)) return [];
    const grip = pattern.grips.find((candidate) => candidate.id === id);
    return grip ? [grip] : [];
  });
  if (selectedGrips.length !== selectedSet.size) {
    throw new ProjectEditorCommandError(
      "One or more selected groups are missing.",
    );
  }
  const retained = selectedGrips[0]!;
  const placements = pattern.placements.filter(
    ({ gripId }) => gripId !== null && selectedSet.has(gripId),
  );
  const mergedGrip = gripFromPlacements(project, placements, {
    id: retained.id,
    groupNumber: retained.groupNumber ?? 1,
    existing: retained,
  });
  const replacements = new Map(
    selectedGrips.slice(1).map(({ id }) => [id, retained.id]),
  );
  return cleanPatternMetadata({
    ...pattern,
    grips: pattern.grips
      .filter(({ id }) => !selectedSet.has(id) || id === retained.id)
      .map((grip) => (grip.id === retained.id ? mergedGrip : grip)),
    placements: pattern.placements.map((placement) =>
      placement.gripId !== null && selectedSet.has(placement.gripId)
        ? { ...placement, gripId: retained.id }
        : placement,
    ),
    groupOrder: groupOrderAfterReplacement(order, selectedSet, [retained.id]),
    orderDependencies: remapDependencies(
      explicitDependencies(pattern),
      replacements,
    ),
  });
}

function orderDirection(project: Project) {
  return (
    project.package.palletizingDirection ??
    project.palletStations.find(
      ({ id }) => id === project.selectedPalletStationId,
    )?.preferredDirection ??
    "x-positive-y-positive"
  );
}

function groupAsRobotGroup(group: ProjectEditorGroup): RobotGripGroup {
  return {
    id: group.id,
    groupNumber: group.groupNumber,
    physicalLayerId: "editor-layer",
    physicalLayerIndex: 0,
    placementIds: group.placementIds,
    packageCount: group.placementIds.length,
    centerPalletMm: { ...group.centerMm, z: 0 },
    placeRotationDeg: group.rotation,
    sourceGripId: group.id,
    sourceCycleId: null,
    sourceSequence: null,
    groupingSource: "explicit-pattern-grip",
  };
}

function robotOrderDiagnostics(
  diagnostics: readonly RobotDiagnostic[],
): ProjectEditorDiagnostic[] {
  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.phase !== "ordering") return [];
    return [
      {
        severity: diagnostic.severity === "error" ? "error" : "warning",
        code: "invalid-order" as const,
        message: diagnostic.message,
        ...(diagnostic.groupId ? { gripIds: [diagnostic.groupId] } : {}),
      },
    ];
  });
}

export function projectEditorOrderModel(
  project: Project,
  solutionId: string,
  patternId: string,
): ProjectEditorOrderModel {
  const { pattern } = context(project, solutionId, patternId);
  const persisted = pattern.grips.length > 0;
  const workingPattern = ensurePatternGroups(project, pattern);
  const workingOrder = normalizedGroupOrder(workingPattern);
  const orderIndexByGripId = new Map(
    workingOrder.map((gripId, index) => [gripId, index]),
  );
  const groups: ProjectEditorGroup[] = workingPattern.grips.map(
    (grip, index) => {
      const placements = workingPattern.placements.filter(
        (placement) => placement.gripId === grip.id,
      );
      const orderIndex = orderIndexByGripId.get(grip.id) ?? index;
      return {
        id: grip.id,
        groupNumber: orderIndex + 1,
        placementIds: placements.map(({ id }) => id),
        centerMm:
          placements.length > 0
            ? averageCenter(placements)
            : { x: grip.x, y: grip.y },
        rotation: placements[0]?.rotation ?? grip.rotation,
        persisted,
        orderIndex,
      };
    },
  );
  const order = workingOrder;
  const dependencies = mergeDependencies(
    explicitDependencies(workingPattern),
    inferredDependencies(project, workingPattern),
  );
  const assigned = new Set(groups.flatMap(({ placementIds }) => placementIds));
  const unassignedPlacementIds = workingPattern.placements.flatMap(({ id }) =>
    assigned.has(id) ? [] : [id],
  );
  const suggestion = suggestRobotOrder(
    groups.map(groupAsRobotGroup),
    dependencies.map((dependency) => ({
      beforeGroupId: dependency.beforeGripId,
      afterGroupId: dependency.afterGripId,
      source: dependency.source,
    })),
    orderDirection(project),
    order,
  );
  return {
    groups: groups
      .slice()
      .sort((left, right) => left.orderIndex - right.orderIndex),
    order,
    dependencies,
    unassignedPlacementIds,
    diagnostics: [
      ...validateProjectPattern(project, workingPattern),
      ...robotOrderDiagnostics(suggestion.diagnostics),
    ],
  };
}

export function suggestProjectEditorOrder(
  project: Project,
  solutionId: string,
  patternId: string,
): {
  order: readonly string[];
  diagnostics: readonly ProjectEditorDiagnostic[];
} {
  const model = projectEditorOrderModel(project, solutionId, patternId);
  const suggestion = suggestRobotOrder(
    model.groups.map(groupAsRobotGroup),
    model.dependencies.map((dependency) => ({
      beforeGroupId: dependency.beforeGripId,
      afterGroupId: dependency.afterGripId,
      source: dependency.source,
    })),
    orderDirection(project),
  );
  return {
    order: suggestion.order,
    diagnostics: robotOrderDiagnostics(suggestion.diagnostics),
  };
}

export function validateProjectPattern(
  project: Project,
  pattern: LayerPattern,
): ProjectEditorDiagnostic[] {
  const diagnostics: ProjectEditorDiagnostic[] = [];
  const envelope = projectEditorEnvelope(project);
  if (!envelope) {
    diagnostics.push({
      severity: "error",
      code: "missing-pallet",
      message:
        "A pallet is required for bounds validation and package editing.",
    });
  }

  const boundsEntries = pattern.placements.map((placement) => ({
    placement,
    physical: placementRectangleBounds(placement, project.package.dimensionsMm),
    clearance: placementClearanceBounds(
      placement,
      project.package.dimensionsMm,
      project.package.clearanceMm,
    ),
  }));
  for (const entry of boundsEntries) {
    if (envelope && !rectangleBoundsContain(envelope, entry.physical)) {
      diagnostics.push({
        severity: "error",
        code: "placement-out-of-bounds",
        message: `Package "${entry.placement.id}" exceeds the effective pallet envelope.`,
        placementIds: [entry.placement.id],
      });
    }
  }
  for (let leftIndex = 0; leftIndex < boundsEntries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < boundsEntries.length;
      rightIndex += 1
    ) {
      const left = boundsEntries[leftIndex]!;
      const right = boundsEntries[rightIndex]!;
      if (!rectangleBoundsOverlap(left.clearance, right.clearance)) continue;
      diagnostics.push({
        severity: "error",
        code: "placement-overlap",
        message: `Packages "${left.placement.id}" and "${right.placement.id}" overlap or violate clearance.`,
        placementIds: [left.placement.id, right.placement.id],
      });
    }
  }

  const assignments = assignmentsByGrip(pattern);
  const groupNumbers = new Map<number, string>();
  pattern.grips.forEach((grip, index) => {
    const groupNumber = grip.groupNumber ?? index + 1;
    const duplicate = groupNumbers.get(groupNumber);
    if (duplicate) {
      diagnostics.push({
        severity: "error",
        code: "group-number-duplicate",
        message: `Groups "${duplicate}" and "${grip.id}" both use number ${groupNumber}.`,
        gripIds: [duplicate, grip.id],
      });
    }
    groupNumbers.set(groupNumber, grip.id);
    const placements = assignments.get(grip.id) ?? [];
    if (placements.length === 0) {
      diagnostics.push({
        severity: "error",
        code: "empty-group",
        message: `Group ${groupNumber} has no package placements.`,
        gripIds: [grip.id],
      });
      return;
    }
    const geometryError = groupGeometryError(
      project,
      placements,
      project.source.kind === "rob-import",
    );
    if (geometryError) {
      diagnostics.push({
        severity: "error",
        code: "invalid-group-geometry",
        message: `Group ${groupNumber}: ${geometryError}`,
        gripIds: [grip.id],
        placementIds: placements.map(({ id }) => id),
      });
    }
    if (new Set(placements.map(({ labelSide }) => labelSide)).size > 1) {
      diagnostics.push({
        severity: "warning",
        code: "group-label-mismatch",
        message: `Group ${groupNumber} contains different package label sides; legacy grouped .rob fields cannot express that distinction.`,
        gripIds: [grip.id],
        placementIds: placements.map(({ id }) => id),
      });
    }
  });

  if (pattern.grips.length > 0) {
    const assigned = new Set(
      [...assignments.values()].flatMap((placements) =>
        placements.map(({ id }) => id),
      ),
    );
    for (const placement of pattern.placements) {
      if (assigned.has(placement.id)) continue;
      diagnostics.push({
        severity: "error",
        code: "placement-unassigned",
        message: `Package "${placement.id}" is not assigned to a grip group.`,
        placementIds: [placement.id],
      });
    }
    const order = normalizedGroupOrder(pattern);
    if (order.length !== pattern.grips.length) {
      diagnostics.push({
        severity: "error",
        code: "group-order-omission",
        message: "Execution order must contain every grip group exactly once.",
      });
    }
  }
  return diagnostics;
}

export function validateProjectEditor(
  project: Project,
  solutionId: string | null = project.activeSolutionId,
  patternId?: string | null,
): ProjectEditorDiagnostic[] {
  const parsed = projectSchema.safeParse(project);
  const diagnostics: ProjectEditorDiagnostic[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        severity: "error" as const,
        code: "invalid-project" as const,
        message: `${issue.path.join(".") || "project"}: ${issue.message}`,
      }));
  if (!solutionId) {
    return [
      ...diagnostics,
      {
        severity: "error",
        code: "missing-active-solution",
        message: "The project has no active solution.",
      },
    ];
  }
  const solution = project.solutions.find(({ id }) => id === solutionId);
  if (!solution) {
    return [
      ...diagnostics,
      {
        severity: "error",
        code: "missing-active-solution",
        message: `Project solution "${solutionId}" does not exist.`,
      },
    ];
  }
  const pattern =
    solution.patterns.find(({ id }) => id === patternId) ??
    solution.patterns[0] ??
    null;
  if (!pattern) {
    return [
      ...diagnostics,
      {
        severity: "error",
        code: "missing-pattern",
        message: "The active solution has no editable layer pattern.",
      },
    ];
  }
  const orderModel = projectEditorOrderModel(project, solution.id, pattern.id);
  return [
    ...diagnostics,
    ...orderModel.diagnostics.filter(
      (diagnostic, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.code === diagnostic.code &&
            candidate.message === diagnostic.message,
        ) === index,
    ),
  ];
}

export function describeProjectEditorCommand(
  command: ProjectEditorCommand,
): string {
  switch (command.type) {
    case "move-placements":
      return `Move ${command.placementIds.length} package(s)`;
    case "set-placement-position":
      return "Set package coordinates";
    case "rotate-placements":
      return `Rotate ${command.placementIds.length} package(s)`;
    case "center-placements":
      return `Center ${command.placementIds.length} package(s)`;
    case "set-label-side":
      return "Edit package label side";
    case "insert-placement":
      return `Insert ${command.orientation} package`;
    case "delete-placements":
      return `Delete ${command.placementIds.length} package(s)`;
    case "set-pattern-name":
      return "Rename layer pattern";
    case "create-group":
      return "Create grip group";
    case "remove-group":
      return "Remove grip group";
    case "split-group":
      return "Split grip group";
    case "merge-groups":
      return "Merge grip groups";
    case "reorder-group":
      return "Reorder grip group";
    case "apply-suggested-order":
      return "Apply automatic order suggestion";
    case "add-order-dependency":
      return "Add order dependency";
    case "remove-order-dependency":
      return "Remove order dependency";
    case "set-interlayer-before":
      return "Edit interlayer quantity";
    case "set-interlayer-thickness":
      return "Edit shared interlayer thickness";
    case "set-interlayer-before-thickness":
      return "Edit boundary interlayer thickness";
    case "set-trailing-interlayer":
      return "Edit deck interlayer quantity";
    case "set-trailing-interlayer-thickness":
      return "Edit deck interlayer thickness";
    case "set-active-solution":
      return "Change active solution";
  }
}

export function applyProjectEditorCommand(
  project: Project,
  command: ProjectEditorCommand,
): Project {
  switch (command.type) {
    case "set-active-solution": {
      if (!project.solutions.some(({ id }) => id === command.solutionId)) {
        throw new ProjectEditorCommandError(
          `Project solution "${command.solutionId}" does not exist.`,
        );
      }
      return projectSchema.parse({
        ...project,
        activeSolutionId: command.solutionId,
      });
    }
    case "set-interlayer-before": {
      const quantity = nonNegativeInteger(
        command.quantity,
        "Interlayer quantity",
      );
      const solution = project.solutions.find(
        ({ id }) => id === command.solutionId,
      );
      if (!solution) {
        throw new ProjectEditorCommandError(
          `Project solution "${command.solutionId}" does not exist.`,
        );
      }
      if (!solution.stack.layers.some(({ id }) => id === command.layerId)) {
        throw new ProjectEditorCommandError(
          `Stack layer "${command.layerId}" does not exist.`,
        );
      }
      return projectSchema.parse({
        ...project,
        solutions: project.solutions.map((candidate) =>
          candidate.id === solution.id
            ? {
                ...candidate,
                origin: editedSolutionOrigin(candidate.origin),
                stack: {
                  ...candidate.stack,
                  layers: candidate.stack.layers.map((layer) =>
                    layer.id === command.layerId
                      ? { ...layer, interlayerBefore: quantity }
                      : layer,
                  ),
                },
              }
            : candidate,
        ),
      });
    }
    case "set-interlayer-thickness": {
      const thicknessMm = finite(command.thicknessMm, "Interlayer thickness");
      if (thicknessMm <= 0) {
        throw new ProjectEditorCommandError(
          "Interlayer thickness must be positive.",
        );
      }
      return projectSchema.parse({
        ...project,
        solutions: project.solutions.map((solution) =>
          solution.id === command.solutionId
            ? {
                ...solution,
                origin: editedSolutionOrigin(solution.origin),
                stack: {
                  ...solution.stack,
                  interlayerThicknessMm: thicknessMm,
                },
              }
            : solution,
        ),
      });
    }
    case "set-interlayer-before-thickness": {
      const thicknessMm = finite(
        command.thicknessMm,
        "Boundary interlayer thickness",
      );
      if (thicknessMm <= 0) {
        throw new ProjectEditorCommandError(
          "Boundary interlayer thickness must be positive.",
        );
      }
      const solution = project.solutions.find(
        ({ id }) => id === command.solutionId,
      );
      if (!solution) {
        throw new ProjectEditorCommandError(
          `Project solution "${command.solutionId}" does not exist.`,
        );
      }
      if (!solution.stack.layers.some(({ id }) => id === command.layerId)) {
        throw new ProjectEditorCommandError(
          `Stack layer "${command.layerId}" does not exist.`,
        );
      }
      return projectSchema.parse({
        ...project,
        solutions: project.solutions.map((candidate) =>
          candidate.id === solution.id
            ? {
                ...candidate,
                origin: editedSolutionOrigin(candidate.origin),
                stack: {
                  ...candidate.stack,
                  layers: candidate.stack.layers.map((layer) =>
                    layer.id === command.layerId
                      ? { ...layer, interlayerThicknessMm: thicknessMm }
                      : layer,
                  ),
                },
              }
            : candidate,
        ),
      });
    }
    case "set-trailing-interlayer": {
      const quantity = nonNegativeInteger(
        command.quantity,
        "Deck interlayer quantity",
      );
      return projectSchema.parse({
        ...project,
        solutions: project.solutions.map((solution) =>
          solution.id === command.solutionId
            ? {
                ...solution,
                stack: { ...solution.stack, trailingInterlayer: quantity },
              }
            : solution,
        ),
      });
    }
    case "set-trailing-interlayer-thickness": {
      const thicknessMm = finite(
        command.thicknessMm,
        "Deck interlayer thickness",
      );
      if (thicknessMm <= 0) {
        throw new ProjectEditorCommandError(
          "Deck interlayer thickness must be positive.",
        );
      }
      return projectSchema.parse({
        ...project,
        solutions: project.solutions.map((solution) =>
          solution.id === command.solutionId
            ? {
                ...solution,
                stack: {
                  ...solution.stack,
                  trailingInterlayerThicknessMm: thicknessMm,
                },
              }
            : solution,
        ),
      });
    }
    default:
      break;
  }

  const { pattern: persistedPattern } = context(
    project,
    command.solutionId,
    command.patternId,
  );
  const previousPattern = withoutCurrentInferredDependencies(persistedPattern);

  switch (command.type) {
    case "move-placements": {
      finite(command.deltaMm.x, "X movement");
      finite(command.deltaMm.y, "Y movement");
      const ids = new Set(
        selectedPlacements(previousPattern, command.placementIds).map(
          ({ id }) => id,
        ),
      );
      return replaceGeometryPattern(
        project,
        command.solutionId,
        previousPattern,
        {
          ...previousPattern,
          placements: previousPattern.placements.map((placement) =>
            ids.has(placement.id)
              ? {
                  ...placement,
                  positionMm: {
                    x: placement.positionMm.x + command.deltaMm.x,
                    y: placement.positionMm.y + command.deltaMm.y,
                  },
                }
              : placement,
          ),
        },
      );
    }
    case "set-placement-position": {
      const selected = selectedPlacements(previousPattern, [
        command.placementId,
      ]);
      const placement = selected[0]!;
      return replaceGeometryPattern(
        project,
        command.solutionId,
        previousPattern,
        {
          ...previousPattern,
          placements: previousPattern.placements.map((candidate) =>
            candidate.id === placement.id
              ? {
                  ...candidate,
                  positionMm: {
                    x: finite(command.positionMm.x, "Package X"),
                    y: finite(command.positionMm.y, "Package Y"),
                  },
                }
              : candidate,
          ),
        },
      );
    }
    case "rotate-placements": {
      const selected = selectedPlacements(
        previousPattern,
        command.placementIds,
      );
      const ids = new Set(selected.map(({ id }) => id));
      const turns = ((Math.trunc(command.quarterTurns ?? 1) % 4) + 4) % 4;
      const center = averageCenter(selected);
      const rotations: Rotation[] = [0, 90, 180, 270];
      const deriveLabelOffsetsForGripIds = new Set(
        selected.flatMap((placement) =>
          turns !== 0 &&
          placement.labelSide !== null &&
          placement.gripId !== null
            ? [placement.gripId]
            : [],
        ),
      );
      const nextPattern: LayerPattern = {
        ...previousPattern,
        placements: previousPattern.placements.map((placement) => {
          if (!ids.has(placement.id)) return placement;
          const offset = rotateQuarterTurnOffset(
            {
              x: placement.positionMm.x - center.x,
              y: placement.positionMm.y - center.y,
            },
            turns,
          );
          const rotationIndex = rotations.indexOf(placement.rotation);
          return {
            ...placement,
            positionMm: {
              x: center.x + offset.x,
              y: center.y + offset.y,
            },
            rotation: rotations[(rotationIndex + turns) % rotations.length]!,
            labelSide: rotateLabelSide(placement.labelSide, turns),
          };
        }),
      };
      validateGeometryOrThrow(project, nextPattern);
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        nextPattern,
        { deriveLabelOffsetsForGripIds },
      );
    }
    case "center-placements": {
      const deltaMm = selectionCenteringDelta(
        project,
        previousPattern,
        command.placementIds,
      );
      return applyProjectEditorCommand(project, {
        type: "move-placements",
        mode: "pattern",
        solutionId: command.solutionId,
        patternId: command.patternId,
        placementIds: command.placementIds,
        deltaMm,
      });
    }
    case "set-label-side": {
      const ids = new Set(
        selectedPlacements(previousPattern, command.placementIds).map(
          ({ id }) => id,
        ),
      );
      const deriveLabelOffsetsForGripIds = new Set(
        previousPattern.placements.flatMap((placement) =>
          ids.has(placement.id) && placement.gripId !== null
            ? [placement.gripId]
            : [],
        ),
      );
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        {
          ...previousPattern,
          placements: previousPattern.placements.map((placement) =>
            ids.has(placement.id)
              ? { ...placement, labelSide: command.labelSide }
              : placement,
          ),
        },
        { deriveLabelOffsetsForGripIds },
      );
    }
    case "insert-placement": {
      if (
        previousPattern.placements.some(({ id }) => id === command.placementId)
      ) {
        throw new ProjectEditorCommandError(
          `Package placement id "${command.placementId}" already exists.`,
        );
      }
      const rotation: Rotation =
        command.orientation === "longitudinal" ? 0 : 90;
      const positionMm = insertionPosition(project, previousPattern, rotation);
      let nextPattern: LayerPattern = {
        ...previousPattern,
        placements: normalizedSequences([
          ...previousPattern.placements,
          {
            id: command.placementId,
            sequence: previousPattern.placements.length,
            positionMm,
            rotation,
            gripId: null,
            labelSide: null,
          },
        ]),
      };
      if (previousPattern.grips.length > 0) {
        nextPattern = createGroup(project, nextPattern, [command.placementId]);
      }
      return replaceGeometryPattern(
        project,
        command.solutionId,
        previousPattern,
        nextPattern,
      );
    }
    case "delete-placements": {
      const selected = selectedPlacements(
        previousPattern,
        command.placementIds,
      );
      const ids = new Set(selected.map(({ id }) => id));
      return replaceGeometryPattern(
        project,
        command.solutionId,
        previousPattern,
        {
          ...previousPattern,
          placements: normalizedSequences(
            previousPattern.placements.filter(({ id }) => !ids.has(id)),
          ),
        },
      );
    }
    case "set-pattern-name": {
      const name = command.name.trim();
      if (!name) {
        throw new ProjectEditorCommandError("Pattern name must not be empty.");
      }
      return replacePattern(project, command.solutionId, previousPattern, {
        ...previousPattern,
        name,
      });
    }
    case "create-group": {
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        createGroup(project, previousPattern, command.placementIds),
      );
    }
    case "remove-group": {
      const pattern = ensurePatternGroups(project, previousPattern);
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        removeGroup(pattern, command.gripId),
      );
    }
    case "split-group": {
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        splitGroup(project, previousPattern, command.gripId),
      );
    }
    case "merge-groups": {
      return replacePattern(
        project,
        command.solutionId,
        previousPattern,
        mergeGroups(project, previousPattern, command.gripIds),
      );
    }
    case "reorder-group": {
      const pattern = ensurePatternGroups(project, previousPattern);
      const order = normalizedGroupOrder(pattern);
      const fromIndex = order.indexOf(command.gripId);
      if (fromIndex < 0) {
        throw new ProjectEditorCommandError(
          `Grip group "${command.gripId}" is missing.`,
        );
      }
      const toIndex = Math.max(0, Math.min(order.length - 1, command.toIndex));
      order.splice(fromIndex, 1);
      order.splice(toIndex, 0, command.gripId);
      assertOrderSatisfiesDependencies(project, pattern, order);
      return replacePattern(project, command.solutionId, previousPattern, {
        ...pattern,
        groupOrder: order,
      });
    }
    case "apply-suggested-order": {
      const pattern = ensurePatternGroups(project, previousPattern);
      const ids = new Set(pattern.grips.map(({ id }) => id));
      if (
        command.gripIds.length !== ids.size ||
        new Set(command.gripIds).size !== ids.size ||
        command.gripIds.some((id) => !ids.has(id))
      ) {
        throw new ProjectEditorCommandError(
          "The suggested order must contain every grip group exactly once.",
        );
      }
      assertOrderSatisfiesDependencies(project, pattern, command.gripIds);
      return replacePattern(project, command.solutionId, previousPattern, {
        ...pattern,
        groupOrder: [...command.gripIds],
      });
    }
    case "add-order-dependency": {
      const pattern = ensurePatternGroups(project, previousPattern);
      const ids = new Set(pattern.grips.map(({ id }) => id));
      if (
        command.beforeGripId === command.afterGripId ||
        !ids.has(command.beforeGripId) ||
        !ids.has(command.afterGripId)
      ) {
        throw new ProjectEditorCommandError(
          "An order dependency needs two different existing grip groups.",
        );
      }
      const explicit = mergeDependencies(explicitDependencies(pattern), [
        {
          beforeGripId: command.beforeGripId,
          afterGripId: command.afterGripId,
          source: "explicit",
        },
      ]);
      const dependencies = mergeDependencies(
        explicit,
        inferredDependencies(project, pattern),
      );
      if (
        dependenciesContainCycle(
          pattern.grips.map(({ id }) => id),
          dependencies,
        )
      ) {
        throw new ProjectEditorCommandError(
          "The order dependency would create a cycle.",
          [
            {
              severity: "error",
              code: "invalid-order",
              message: `The requested dependency ${command.beforeGripId} before ${command.afterGripId} would create a cycle.`,
              gripIds: [command.beforeGripId, command.afterGripId],
            },
          ],
        );
      }
      return replacePattern(project, command.solutionId, previousPattern, {
        ...pattern,
        orderDependencies: explicit,
      });
    }
    case "remove-order-dependency": {
      const pattern = ensurePatternGroups(project, previousPattern);
      const requested = {
        beforeGripId: command.beforeGripId,
        afterGripId: command.afterGripId,
      };
      const key = dependencyKey(requested);
      const explicit = explicitDependencies(pattern);
      const hasExplicit = explicit.some(
        (dependency) => dependencyKey(dependency) === key,
      );
      if (
        !hasExplicit &&
        inferredDependencies(project, pattern).some(
          (dependency) => dependencyKey(dependency) === key,
        )
      ) {
        throw new ProjectEditorCommandError(
          "Automatically inferred grip dependencies cannot be removed in the order editor.",
        );
      }
      return replacePattern(project, command.solutionId, previousPattern, {
        ...pattern,
        orderDependencies: explicit.filter(
          (dependency) => dependencyKey(dependency) !== key,
        ),
      });
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

export type ProjectEditorFlowPhase = {
  id: string;
  index: number;
  cycle: RobotCycle;
  phase: "pick" | "transfer" | "place";
  pose: RobotPose;
  status: "ready" | "warning" | "blocked";
  diagnostics: readonly RobotDiagnostic[];
};

export type ProjectEditorFlow = {
  /** Exact canonical source array shared with export, simulation, and reports. */
  sourceCycles: RobotCycleMaterialization["cycles"];
  cycles: readonly RobotCycle[];
  phases: readonly ProjectEditorFlowPhase[];
};

export function createProjectEditorFlow(
  materialization: RobotCycleMaterialization,
  patternRef?: string | null,
): ProjectEditorFlow {
  const cycles = patternRef
    ? materialization.cycles.filter((cycle) => cycle.patternRef === patternRef)
    : materialization.cycles;
  const phases: ProjectEditorFlowPhase[] = [];
  for (const cycle of cycles) {
    const cycleDiagnostics = materialization.diagnostics.filter(
      (diagnostic) =>
        diagnostic.cycleId === cycle.id ||
        diagnostic.groupId === cycle.groupId ||
        diagnostic.layerId === cycle.physicalLayerId,
    );
    const status = cycleDiagnostics.some(({ severity }) => severity === "error")
      ? "blocked"
      : cycleDiagnostics.length > 0
        ? "warning"
        : "ready";
    for (const [phase, pose] of [
      ["pick", cycle.pickPose],
      ["transfer", cycle.transferPose],
      ["place", cycle.placePose],
    ] as const) {
      phases.push({
        id: `${cycle.id}:${phase}`,
        index: phases.length,
        cycle,
        phase,
        pose,
        status,
        diagnostics: cycleDiagnostics,
      });
    }
  }
  return { sourceCycles: materialization.cycles, cycles, phases };
}

export function stepProjectEditorFlow(
  currentIndex: number,
  phaseCount: number,
  direction: "begin" | "previous" | "next" | "end",
): number {
  if (phaseCount <= 0) return 0;
  switch (direction) {
    case "begin":
      return 0;
    case "previous":
      return Math.max(0, currentIndex - 1);
    case "next":
      return Math.min(phaseCount - 1, currentIndex + 1);
    case "end":
      return phaseCount - 1;
  }
}

export function activePatternReference(
  project: Project,
  solutionId: string,
  patternId: string,
): string {
  return projectPatternReference(project.id, solutionId, patternId);
}
