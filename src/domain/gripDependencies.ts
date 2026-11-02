import {
  placementRectangleBounds,
  type RectangleSizeMm,
} from "~/domain/geometry";
import type { Grip, Rotation } from "~/domain/palletTypes";
import { footprintSize, gripsToBoxes } from "~/domain/palletGeometry";

type BoxBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export type GripDependency = {
  prerequisiteIndex: number;
  dependentIndex: number;
};

export type GripOrderDependency = {
  beforeGripId: string;
  afterGripId: string;
  source?: "explicit" | "inferred";
};

export type GripPlacementFootprint = {
  gripId: string | null;
  positionMm: { x: number; y: number };
  rotation: Rotation;
};

/** Nearest grips along one axis direction plus the gap they share. */
export type GripNeighborMatch = {
  indices: number[];
  gap: number;
};

export type GripNeighborIndex = {
  /** Slack that still counts as "equally near" when several grips tie. */
  readonly nearestTolerance: number;
  nearestInDirection(
    sourceIndex: number,
    axis: "x" | "y",
    direction: -1 | 1,
  ): GripNeighborMatch | null;
};

const COORDINATE_TOLERANCE = 0.500_001;

export const LEGACY_ROB_DELTA_APPROACH_DISTANCE_MM = 80;

export function compareGripPositionsBottomLeftRowMajor(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return left.y - right.y || left.x - right.x;
}

export function compareGripPositionsBottomRightRowMajor(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return left.y - right.y || right.x - left.x;
}

export function compareGripPositionsRightBottomToLeftTop(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return right.x - left.x || left.y - right.y;
}

/** Layer geometry behind {@link compareGripsByLayerRows}. */
export type GripOrderLayout = {
  /** Grips whose centre is at or below this y go first. */
  splitYMm: number;
  /** Bottom of the layer; row bands are counted from here. */
  originYMm: number;
  /** Height of one row band: the most common package footprint height. */
  rowPitchMm: number;
  /** Lowest footprint edge per grip id. */
  bottomYById: ReadonlyMap<string, number>;
};

/**
 * Builds the row/half layout of a layer from its package footprints. The
 * row pitch is the most frequent footprint height (ties: the smaller one), so
 * a column of crosswise packages next to lengthwise rows does not define rows.
 */
export function createGripOrderLayout(
  footprints: readonly {
    gripId: string | null;
    minY: number;
    maxY: number;
  }[],
): GripOrderLayout | null {
  const splitYMm = lowerHalfSplitYMm(footprints);
  if (splitYMm === null) return null;
  const heightCounts = new Map<number, number>();
  for (const { minY, maxY } of footprints) {
    const height = Math.round((maxY - minY) * 1000) / 1000;
    heightCounts.set(height, (heightCounts.get(height) ?? 0) + 1);
  }
  const [rowPitchMm] = [...heightCounts].sort(
    ([leftHeight, leftCount], [rightHeight, rightCount]) =>
      rightCount - leftCount || leftHeight - rightHeight,
  )[0]!;
  const bottomYById = new Map<string, number>();
  for (const { gripId, minY } of footprints) {
    if (gripId === null) continue;
    bottomYById.set(gripId, Math.min(bottomYById.get(gripId) ?? minY, minY));
  }
  return {
    splitYMm,
    originYMm: Math.min(...footprints.map(({ minY }) => minY)),
    rowPitchMm,
    bottomYById,
  };
}

/**
 * Automatic grip order of a layer:
 *
 * 1. every grip below the split line before any grip above it; a grip that
 *    straddles the line belongs to the half containing its centre (a centre
 *    on the line counts as lower);
 * 2. inside a half, row band by band from the bottom; a grip belongs to the
 *    band that contains its bottom edge, so a crosswise column pair starting
 *    in the bottom row band is placed with that row;
 * 3. inside a band right to left, then bottom to top.
 *
 * Without a layout this is the plain right-to-left, bottom-to-top order.
 */
export function compareGripsByLayerRows(
  layout: GripOrderLayout | null,
): (
  left: { id: string; x: number; y: number },
  right: { id: string; x: number; y: number },
) => number {
  if (layout === null) return compareGripPositionsRightBottomToLeftTop;
  const tolerance = 0.5;
  const half = ({ y }: { y: number }) => (y <= layout.splitYMm + 0.001 ? 0 : 1);
  const band = ({ id, y }: { id: string; y: number }) =>
    Math.floor(
      ((layout.bottomYById.get(id) ?? y) - layout.originYMm + tolerance) /
        layout.rowPitchMm,
    );
  return (left, right) =>
    half(left) - half(right) ||
    band(left) - band(right) ||
    compareGripPositionsRightBottomToLeftTop(left, right);
}

/**
 * Split line for {@link compareGripsByLayerRows}: the package row
 * boundary (a footprint top or bottom edge strictly inside the layer) nearest
 * the layer's vertical midline, so the line never cuts through a row of
 * aligned packages. Falls back to the midline when no inner edge exists;
 * equally near edges resolve to the lower one.
 */
export function lowerHalfSplitYMm(
  footprints: readonly { minY: number; maxY: number }[],
): number | null {
  if (footprints.length === 0) return null;
  const minY = Math.min(...footprints.map(({ minY }) => minY));
  const maxY = Math.max(...footprints.map(({ maxY }) => maxY));
  const midline = (minY + maxY) / 2;
  const tolerance = 0.001;
  let best: number | null = null;
  for (const edge of footprints.flatMap(({ minY, maxY }) => [minY, maxY])) {
    if (edge <= minY + tolerance || edge >= maxY - tolerance) continue;
    const distance = Math.abs(edge - midline);
    const bestDistance = best === null ? Infinity : Math.abs(best - midline);
    if (
      distance < bestDistance - tolerance ||
      (Math.abs(distance - bestDistance) <= tolerance && edge < best!)
    ) {
      best = edge;
    }
  }
  return best ?? midline;
}

function boxBoundsByGrip(
  grips: readonly Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): BoxBounds[][] {
  return grips.map((grip) =>
    gripsToBoxes([grip], packageWidth, packageLength, 0, inputDirection).map(
      (box): BoxBounds => {
        const size = footprintSize(box);
        return {
          left: box.rect.x - size.width / 2,
          right: box.rect.x + size.width / 2,
          bottom: box.rect.y - size.length / 2,
          top: box.rect.y + size.length / 2,
        };
      },
    ),
  );
}

function placementBoundsByGrip(
  gripIds: readonly string[],
  placements: readonly GripPlacementFootprint[],
  packageSize: RectangleSizeMm,
): Map<string, BoxBounds[]> {
  const knownGripIds = new Set(gripIds);
  const boundsByGrip = new Map<string, BoxBounds[]>();
  for (const placement of placements) {
    if (placement.gripId === null || !knownGripIds.has(placement.gripId)) {
      continue;
    }
    const bounds = placementRectangleBounds(placement, packageSize);
    const gripBounds = boundsByGrip.get(placement.gripId) ?? [];
    gripBounds.push({
      left: bounds.minX,
      right: bounds.maxX,
      bottom: bounds.minY,
      top: bounds.maxY,
    });
    boundsByGrip.set(placement.gripId, gripBounds);
  }
  return boundsByGrip;
}

function verticalRelationForXOverlappingFootprints(
  leftBounds: readonly BoxBounds[],
  rightBounds: readonly BoxBounds[],
): -1 | 1 | null {
  let relation: -1 | 1 | null = null;

  for (const left of leftBounds) {
    for (const right of rightBounds) {
      const overlapX =
        Math.min(left.right, right.right) - Math.max(left.left, right.left);
      if (overlapX <= COORDINATE_TOLERANCE) continue;

      const pairRelation =
        left.top <= right.bottom + COORDINATE_TOLERANCE
          ? -1
          : right.top <= left.bottom + COORDINATE_TOLERANCE
            ? 1
            : null;
      if (pairRelation === null) return null;
      if (relation !== null && relation !== pairRelation) return null;
      relation = pairRelation;
    }
  }

  return relation;
}

/**
 * Packages cannot be placed above packages that overlap them in X. For
 * multipackage grips, every X-overlapping package pair must require the same
 * vertical order; interleaved grips therefore do not create opposing edges.
 */
export function buildGripVerticalOverlapDependencies(
  gripIds: readonly string[],
  placements: readonly GripPlacementFootprint[],
  packageSize: RectangleSizeMm,
): GripOrderDependency[] {
  const uniqueGripIds = [...new Set(gripIds)].sort();
  const boundsByGrip = placementBoundsByGrip(
    uniqueGripIds,
    placements,
    packageSize,
  );
  const dependencies: GripOrderDependency[] = [];

  uniqueGripIds.forEach((leftGripId, leftIndex) => {
    const leftBounds = boundsByGrip.get(leftGripId) ?? [];
    if (leftBounds.length === 0) return;

    uniqueGripIds.slice(leftIndex + 1).forEach((rightGripId) => {
      const rightBounds = boundsByGrip.get(rightGripId) ?? [];
      if (rightBounds.length === 0) return;
      const relation = verticalRelationForXOverlappingFootprints(
        leftBounds,
        rightBounds,
      );

      if (relation === -1) {
        dependencies.push({
          beforeGripId: leftGripId,
          afterGripId: rightGripId,
        });
      } else if (relation === 1) {
        dependencies.push({
          beforeGripId: rightGripId,
          afterGripId: leftGripId,
        });
      }
    });
  });

  return dependencies.sort(
    (left, right) =>
      left.beforeGripId.localeCompare(right.beforeGripId) ||
      left.afterGripId.localeCompare(right.afterGripId),
  );
}

export function mergeGripOrderDependencies(
  ...sets: readonly (readonly GripOrderDependency[])[]
): GripOrderDependency[] {
  const merged = new Map<string, GripOrderDependency>();
  for (const dependencies of sets) {
    for (const dependency of dependencies) {
      if (dependency.beforeGripId === dependency.afterGripId) continue;
      const key = `${dependency.beforeGripId}\0${dependency.afterGripId}`;
      const existing = merged.get(key);
      if (existing?.source === "explicit" && dependency.source !== "explicit") {
        continue;
      }
      merged.set(key, dependency);
    }
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.beforeGripId.localeCompare(right.beforeGripId) ||
      left.afterGripId.localeCompare(right.afterGripId),
  );
}

export function orderGripsByDependencies<
  T extends { id: string; x: number; y: number },
>(
  grips: readonly T[],
  dependencies: readonly GripOrderDependency[],
  preferredOrder?: readonly string[],
  comparePositions: (
    left: T,
    right: T,
  ) => number = compareGripPositionsRightBottomToLeftTop,
): T[] {
  const gripById = new Map(grips.map((grip) => [grip.id, grip]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(grips.map(({ id }) => [id, 0]));
  for (const dependency of mergeGripOrderDependencies(dependencies)) {
    if (
      !gripById.has(dependency.beforeGripId) ||
      !gripById.has(dependency.afterGripId)
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
  for (const targets of outgoing.values()) targets.sort();

  const preferredIndexById = preferredOrder
    ? new Map(preferredOrder.map((id, index) => [id, index]))
    : null;
  const compare = (left: T, right: T) =>
    (preferredIndexById
      ? (preferredIndexById.get(left.id) ?? Number.POSITIVE_INFINITY) -
        (preferredIndexById.get(right.id) ?? Number.POSITIVE_INFINITY)
      : 0) ||
    comparePositions(left, right) ||
    left.id.localeCompare(right.id);
  const available = grips
    .filter(({ id }) => (indegree.get(id) ?? 0) === 0)
    .sort(compare);
  const ordered: T[] = [];
  while (available.length > 0) {
    const current = available.shift()!;
    ordered.push(current);
    for (const targetId of outgoing.get(current.id) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree !== 0) continue;
      const target = gripById.get(targetId);
      if (target) {
        available.push(target);
        available.sort(compare);
      }
    }
  }

  if (ordered.length === grips.length) return ordered;
  const orderedIds = new Set(ordered.map(({ id }) => id));
  const unresolvedIds = grips
    .filter(({ id }) => !orderedIds.has(id))
    .sort(compare)
    .map(({ id }) => id);
  throw new Error(
    `Grip order cannot be resolved because dependencies contain a cycle; unresolved grips: ${unresolvedIds.join(", ")}.`,
  );
}

/**
 * Shared neighbour search for dx/dy. Deriving deltas from a placement order and
 * inferring dependencies back out of them must agree, so both directions go
 * through this one index.
 */
export function createGripNeighborIndex(
  grips: readonly Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): GripNeighborIndex {
  const boundsByGrip = boxBoundsByGrip(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  );
  const nearestTolerance = Math.max(
    COORDINATE_TOLERANCE,
    Math.min(2, Math.min(packageWidth, packageLength) * 0.01),
  );

  return {
    nearestTolerance,
    nearestInDirection(sourceIndex, axis, direction) {
      const sourceBounds = boundsByGrip[sourceIndex] ?? [];
      const candidateGaps: { index: number; gap: number }[] = [];

      boundsByGrip.forEach((candidateBounds, candidateIndex) => {
        if (candidateIndex === sourceIndex) return;
        let candidateGap = Number.POSITIVE_INFINITY;

        sourceBounds.forEach((source) => {
          candidateBounds.forEach((candidate) => {
            const perpendicularOverlap =
              axis === "x"
                ? Math.min(source.top, candidate.top) -
                  Math.max(source.bottom, candidate.bottom)
                : Math.min(source.right, candidate.right) -
                  Math.max(source.left, candidate.left);
            if (perpendicularOverlap <= COORDINATE_TOLERANCE) return;

            const gap =
              axis === "x"
                ? direction > 0
                  ? candidate.left - source.right
                  : source.left - candidate.right
                : direction > 0
                  ? candidate.bottom - source.top
                  : source.bottom - candidate.top;
            if (gap < -COORDINATE_TOLERANCE) return;
            candidateGap = Math.min(candidateGap, Math.max(0, gap));
          });
        });

        if (!Number.isFinite(candidateGap)) return;
        candidateGaps.push({ index: candidateIndex, gap: candidateGap });
      });

      if (candidateGaps.length === 0) return null;
      const nearestGap = Math.min(...candidateGaps.map(({ gap }) => gap));
      return {
        gap: nearestGap,
        indices: candidateGaps
          .filter(({ gap }) => gap - nearestGap <= nearestTolerance)
          .map(({ index }) => index),
      };
    },
  };
}

export type GripDelta = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

type AxisSweepInterval = { enter: number; exit: number };

function axisSweepInterval(
  movingMin: number,
  movingMax: number,
  obstacleMin: number,
  obstacleMax: number,
  translation: number,
): AxisSweepInterval | null {
  const expandedMin = obstacleMin - movingMax + COORDINATE_TOLERANCE;
  const expandedMax = obstacleMax - movingMin - COORDINATE_TOLERANCE;
  if (expandedMin >= expandedMax) return null;
  if (translation === 0) {
    return 0 > expandedMin && 0 < expandedMax
      ? { enter: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY }
      : null;
  }
  const first = expandedMin / translation;
  const second = expandedMax / translation;
  return { enter: Math.min(first, second), exit: Math.max(first, second) };
}

function sweptBoundsOverlap(
  moving: BoxBounds,
  obstacle: BoxBounds,
  delta: GripDelta,
  approachDistanceMm: number,
): boolean {
  const translationX = -delta.dx * approachDistanceMm;
  const translationY = -delta.dy * approachDistanceMm;
  const xInterval = axisSweepInterval(
    moving.left,
    moving.right,
    obstacle.left,
    obstacle.right,
    translationX,
  );
  const yInterval = axisSweepInterval(
    moving.bottom,
    moving.top,
    obstacle.bottom,
    obstacle.top,
    translationY,
  );
  if (xInterval === null || yInterval === null) return false;
  const enter = Math.max(0, xInterval.enter, yInterval.enter);
  const exit = Math.min(1, xInterval.exit, yInterval.exit);
  return enter < exit;
}

function approachIsClear(
  carriedBounds: readonly BoxBounds[],
  placedBounds: readonly BoxBounds[],
  delta: GripDelta,
  approachDistanceMm: number,
): boolean {
  if (delta.dx === 0 && delta.dy === 0) return true;
  return carriedBounds.every((carried) =>
    placedBounds.every(
      (placed) =>
        !sweptBoundsOverlap(carried, placed, delta, approachDistanceMm),
    ),
  );
}

function invertedDeltaComponent(value: -1 | 0 | 1): -1 | 0 | 1 {
  if (value === 1) return -1;
  if (value === -1) return 1;
  return 0;
}

function invertedGripDelta(delta: GripDelta): GripDelta {
  return {
    dx: invertedDeltaComponent(delta.dx),
    dy: invertedDeltaComponent(delta.dy),
  };
}

function dependenciesForDelta(
  gripIndex: number,
  referenceDirection: GripDelta,
  neighbors: GripNeighborIndex,
): GripDependency[] {
  return [
    referenceDirection.dx === 0
      ? null
      : ({
          axis: "x",
          direction: Math.sign(referenceDirection.dx),
        } as const),
    referenceDirection.dy === 0
      ? null
      : ({
          axis: "y",
          direction: Math.sign(referenceDirection.dy),
        } as const),
  ]
    .filter(
      (value): value is { axis: "x" | "y"; direction: -1 | 1 } =>
        value !== null,
    )
    .flatMap(({ axis, direction }) =>
      (
        neighbors.nearestInDirection(gripIndex, axis, direction)?.indices ?? []
      ).map((prerequisiteIndex) => ({
        prerequisiteIndex,
        dependentIndex: gripIndex,
      })),
    );
}

export function buildGripDeltaDependencies(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): GripDependency[] {
  const neighbors = createGripNeighborIndex(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  );
  const dependencies = new Map<string, GripDependency>();

  grips.forEach((grip, dependentIndex) => {
    dependenciesForDelta(
      dependentIndex,
      invertedGripDelta({
        dx: Math.sign(grip.dx) as -1 | 0 | 1,
        dy: Math.sign(grip.dy) as -1 | 0 | 1,
      }),
      neighbors,
    ).forEach((dependency) => {
      dependencies.set(
        `${dependency.prerequisiteIndex}:${dependency.dependentIndex}`,
        dependency,
      );
    });
  });

  return [...dependencies.values()];
}

export type DerivedGripDeltas = {
  /** One entry per grip, aligned with the input order. */
  deltas: GripDelta[];
  /** Dependencies `buildGripDeltaDependencies` reproduces from those deltas. */
  dependencies: GripDependency[];
};

/**
 * Derives .rob approach offsets for grips in execution order. Candidate
 * references are evaluated on the target side while the 80 mm approach sweep
 * runs in the opposite direction. The stored dx/dy values encode that opposite
 * approach offset, so dependencies invert them back to the reference side.
 */
export function deriveGripDeltasForPlacementOrder(
  grips: readonly Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
  options: { maxReferenceGapMm?: number } = {},
): DerivedGripDeltas {
  const neighbors = createGripNeighborIndex(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  );
  const boundsByGrip = boxBoundsByGrip(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  );
  const maxReferenceGapMm =
    (options.maxReferenceGapMm ?? Number.POSITIVE_INFINITY) +
    neighbors.nearestTolerance;
  const deltas: GripDelta[] = [];
  const dependencies = new Map<string, GripDependency>();

  grips.forEach((_, dependentIndex) => {
    if (dependentIndex === 0) {
      deltas.push({ dx: 0, dy: 0 });
      return;
    }

    const optionsByAxis = (["x", "y"] as const).map((axis) =>
      ([1, -1] as const).flatMap((direction) => {
        const match = neighbors.nearestInDirection(
          dependentIndex,
          axis,
          direction,
        );
        if (match === null || match.gap > maxReferenceGapMm) return [];
        if (match.indices.some((index) => index >= dependentIndex)) return [];
        return [{ direction, match }];
      }),
    );
    const xOptions = optionsByAxis[0] ?? [];
    const yOptions = optionsByAxis[1] ?? [];
    const candidates = [
      ...xOptions.flatMap((x) =>
        yOptions.map((y) => ({
          delta: { dx: x.direction, dy: y.direction } satisfies GripDelta,
          references: [...x.match.indices, ...y.match.indices],
          gap: x.match.gap + y.match.gap,
        })),
      ),
      ...xOptions.map((x) => ({
        delta: { dx: x.direction, dy: 0 } satisfies GripDelta,
        references: [...x.match.indices],
        gap: x.match.gap,
      })),
      ...yOptions.map((y) => ({
        delta: { dx: 0, dy: y.direction } satisfies GripDelta,
        references: [...y.match.indices],
        gap: y.match.gap,
      })),
    ].sort(
      (left, right) =>
        Math.abs(right.delta.dx) +
          Math.abs(right.delta.dy) -
          Math.abs(left.delta.dx) -
          Math.abs(left.delta.dy) ||
        left.gap - right.gap ||
        right.delta.dx - left.delta.dx ||
        left.delta.dy - right.delta.dy,
    );
    const placedBounds = boundsByGrip
      .slice(0, dependentIndex)
      .flatMap((bounds) => bounds);
    const chosen = candidates.find((candidate) =>
      approachIsClear(
        boundsByGrip[dependentIndex] ?? [],
        placedBounds,
        candidate.delta,
        LEGACY_ROB_DELTA_APPROACH_DISTANCE_MM,
      ),
    );

    if (!chosen) {
      deltas.push({ dx: 0, dy: 0 });
      return;
    }

    deltas.push(invertedGripDelta(chosen.delta));
    for (const prerequisiteIndex of new Set(chosen.references)) {
      dependencies.set(`${prerequisiteIndex}:${dependentIndex}`, {
        prerequisiteIndex,
        dependentIndex,
      });
    }
  });

  return { deltas, dependencies: [...dependencies.values()] };
}

/**
 * Replaces selected grips with one merged grip while retaining their .rob
 * placement constraints. Stored dx/dy points away from already placed
 * reference grips, so dependency reconstruction resolves the opposite side.
 */
export function insertMergedGripByDeltaDependencies(
  grips: Grip[],
  selectedIndices: ReadonlySet<number>,
  mergedGrip: Grip,
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): { grips: Grip[]; mergedIndex: number } | null {
  const selected = new Set(
    [...selectedIndices].filter((index) => index >= 0 && index < grips.length),
  );
  if (selected.size < 2) return null;

  const remaining = grips
    .map((grip, originalIndex) => ({ grip, originalIndex }))
    .filter(({ originalIndex }) => !selected.has(originalIndex));
  const remainingIndexByOriginal = new Map(
    remaining.map(({ originalIndex }, index) => [originalIndex, index]),
  );
  let earliestInsertion = 0;
  let latestInsertion = remaining.length;

  buildGripDeltaDependencies(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  ).forEach(({ prerequisiteIndex, dependentIndex }) => {
    const prerequisiteSelected = selected.has(prerequisiteIndex);
    const dependentSelected = selected.has(dependentIndex);
    if (prerequisiteSelected === dependentSelected) return;

    if (dependentSelected) {
      const prerequisitePosition =
        remainingIndexByOriginal.get(prerequisiteIndex);
      if (prerequisitePosition !== undefined) {
        earliestInsertion = Math.max(
          earliestInsertion,
          prerequisitePosition + 1,
        );
      }
    } else {
      const dependentPosition = remainingIndexByOriginal.get(dependentIndex);
      if (dependentPosition !== undefined) {
        latestInsertion = Math.min(latestInsertion, dependentPosition);
      }
    }
  });

  if (earliestInsertion > latestInsertion) return null;

  const firstSelectedIndex = Math.min(...selected);
  const preferredInsertion = remaining.filter(
    ({ originalIndex }) => originalIndex < firstSelectedIndex,
  ).length;
  const mergedIndex = Math.max(
    earliestInsertion,
    Math.min(preferredInsertion, latestInsertion),
  );
  const next = remaining.map(({ grip }) => grip);
  next.splice(mergedIndex, 0, mergedGrip);
  return { grips: next, mergedIndex };
}
