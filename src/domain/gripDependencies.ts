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
  return compareGripPositionsBottomRightRowMajor(left, right);
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

function footprintsOverlapInX(
  lowerBounds: readonly BoxBounds[],
  upperBounds: readonly BoxBounds[],
): boolean {
  return lowerBounds.some((lower) =>
    upperBounds.some(
      (upper) =>
        Math.min(lower.right, upper.right) -
          Math.max(lower.left, upper.left) >
        COORDINATE_TOLERANCE,
    ),
  );
}

/**
 * Packages cannot be placed above packages that overlap them in X. Grips are
 * compared only when all member packages of one grip lie below all members of
 * the other, which keeps multipackage dependencies directional and acyclic.
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
    const leftBottom = Math.min(...leftBounds.map(({ bottom }) => bottom));
    const leftTop = Math.max(...leftBounds.map(({ top }) => top));

    uniqueGripIds.slice(leftIndex + 1).forEach((rightGripId) => {
      const rightBounds = boundsByGrip.get(rightGripId) ?? [];
      if (rightBounds.length === 0) return;
      const rightBottom = Math.min(...rightBounds.map(({ bottom }) => bottom));
      const rightTop = Math.max(...rightBounds.map(({ top }) => top));
      if (!footprintsOverlapInX(leftBounds, rightBounds)) return;

      if (leftTop <= rightBottom + COORDINATE_TOLERANCE) {
        dependencies.push({
          beforeGripId: leftGripId,
          afterGripId: rightGripId,
        });
      } else if (rightTop <= leftBottom + COORDINATE_TOLERANCE) {
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
    compareGripPositionsBottomRightRowMajor(left, right) ||
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

function dependenciesForDelta(
  gripIndex: number,
  delta: GripDelta,
  neighbors: GripNeighborIndex,
): GripDependency[] {
  return [
    delta.dx === 0
      ? null
      : ({ axis: "x", direction: Math.sign(delta.dx) } as const),
    delta.dy === 0
      ? null
      : ({ axis: "y", direction: Math.sign(delta.dy) } as const),
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
      {
        dx: Math.sign(grip.dx) as -1 | 0 | 1,
        dy: Math.sign(grip.dy) as -1 | 0 | 1,
      },
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
 * Derives the legacy .rob approach vector for grips in execution order. The
 * robot descends 80 mm opposite dx/dy and then moves by dx/dy into the final
 * position, so references must be on the target side and the entire approach
 * sweep must remain clear of all grips that are already on the pallet.
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

    deltas.push(chosen.delta);
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
 * placement constraints. A grip's dx/dy points toward already placed
 * reference grips; conversely, other grips whose dx/dy points at a selected
 * grip must remain after the merged grip.
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
