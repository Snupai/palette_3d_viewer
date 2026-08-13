import type { Grip } from "~/domain/palletTypes";
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

export function compareGripPositionsRightBottomToLeftTop(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return right.x - left.x || left.y - right.y;
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
