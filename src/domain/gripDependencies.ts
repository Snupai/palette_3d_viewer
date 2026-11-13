import {
  placementRectangleBounds,
  type RectangleSizeMm,
} from "~/domain/geometry";
import type { Grip, Rotation } from "~/domain/palletTypes";
import { footprintSize, gripsToBoxes } from "~/domain/palletGeometry";
import { PLACE_APPROACH_OFFSET_MM } from "~/domain/placeApproach";

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

/**
 * Automatic grip order: right to left, then bottom to top. Together with the
 * support dependencies (a grip only after everything it rests on) and the
 * free-access guard this fills a layer column by column from the right.
 */
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

/**
 * Free-access rule for placing grips: the gripper needs a free corner, so a
 * grip can never be set into a slot that already-placed packages close on
 * both sides of one axis (left and right, or front and back). A neighbour
 * blocks a side when it overlaps the grip across the axis and leaves less
 * than the place approach offset between them.
 *
 * An open run of slots along an axis can still be filled as long as one of
 * its ends is open (fill it from the closed end); once both ends are closed,
 * its last slot will be enclosed. The guard counts such dead runs so an order
 * can avoid creating them.
 *
 * A side that touches placed packages must touch them along its whole
 * length: a grip half supported on one side (e.g. a two-package column next
 * to a single) is pushed off line and blocks the slot beside its free half.
 */
export type GripPocketGuard = {
  /** The grip is closed on both sides of an axis by `placed` grips. */
  isEnclosed(gripId: string, placed: ReadonlySet<string>): boolean;
  /**
   * Unplaced grips that can no longer be reached in any order once `gripId`
   * is placed, but still could before.
   */
  newDeadlocks(gripId: string, placed: ReadonlySet<string>): number;
  /** Sides that touch `placed` grips along only part of their length. */
  partialSides(gripId: string, placed: ReadonlySet<string>): number;
  /** The two grips close a side of each other. */
  adjacent(left: string, right: string): boolean;
};

/** Holes and ends up to this size still count as a fully supported side. */
const SIDE_COVER_TOLERANCE_MM = 10;

// Sides of a grip: 0 = x-, 1 = x+, 2 = y-, 3 = y+ (opposite: side ^ 1).
const POCKET_SIDE_COUNT = 4;

type SideContact = { neighbour: number; from: number; to: number };

export function createGripPocketGuard(
  gripIds: readonly string[],
  placements: readonly GripPlacementFootprint[],
  packageSize: RectangleSizeMm,
  blockingGapMm: number = PLACE_APPROACH_OFFSET_MM,
): GripPocketGuard {
  // Index-based tables: the guard runs for every grip of every candidate.
  const ids = [...new Set(gripIds)].sort();
  const count = ids.length;
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const boundsByGrip = placementBoundsByGrip(ids, placements, packageSize);
  const bounds = ids.map((id) => boundsByGrip.get(id) ?? []);
  // neighbours[g * 4 + side]: grips that close that side of g.
  const neighbours: number[][] = Array.from(
    { length: count * POCKET_SIDE_COUNT },
    () => [],
  );
  // contacts[g * 4 + side]: stretches of that side touched per neighbour.
  const contacts: SideContact[][] = Array.from(
    { length: count * POCKET_SIDE_COUNT },
    () => [],
  );
  // Extent of each grip side along the side.
  const extentFrom = new Float64Array(count * POCKET_SIDE_COUNT);
  const extentTo = new Float64Array(count * POCKET_SIDE_COUNT);
  const near = (gap: number) =>
    gap >= -COORDINATE_TOLERANCE && gap < blockingGapMm;
  // Whole-grip outlines: far apart grips never close a side of each other.
  const outline = bounds.map((boxes) => ({
    left: Math.min(...boxes.map(({ left }) => left)),
    right: Math.max(...boxes.map(({ right }) => right)),
    bottom: Math.min(...boxes.map(({ bottom }) => bottom)),
    top: Math.max(...boxes.map(({ top }) => top)),
  }));
  const addSides = (grip: number, neighbour: number) => {
    const sides = [false, false, false, false];
    for (const source of bounds[grip]!) {
      for (const other of bounds[neighbour]!) {
        const fromY = Math.max(source.bottom, other.bottom);
        const toY = Math.min(source.top, other.top);
        const fromX = Math.max(source.left, other.left);
        const toX = Math.min(source.right, other.right);
        const touch = (side: number, from: number, to: number) => {
          sides[side] = true;
          contacts[grip * POCKET_SIDE_COUNT + side]!.push({
            neighbour,
            from,
            to,
          });
        };
        if (toY - fromY > COORDINATE_TOLERANCE) {
          if (near(other.left - source.right)) touch(1, fromY, toY);
          if (near(source.left - other.right)) touch(0, fromY, toY);
        }
        if (toX - fromX > COORDINATE_TOLERANCE) {
          if (near(other.bottom - source.top)) touch(3, fromX, toX);
          if (near(source.bottom - other.top)) touch(2, fromX, toX);
        }
      }
    }
    sides.forEach((touches, side) => {
      if (touches) neighbours[grip * POCKET_SIDE_COUNT + side]!.push(neighbour);
    });
  };
  // Sweep along x: only grips within the blocking gap can close a side.
  const byLeft = outline
    .map((_, index) => index)
    .sort((left, right) => outline[left]!.left - outline[right]!.left);
  for (let position = 0; position < count; position += 1) {
    const grip = byLeft[position]!;
    const a = outline[grip]!;
    for (let next = position + 1; next < count; next += 1) {
      const neighbour = byLeft[next]!;
      const b = outline[neighbour]!;
      if (b.left - a.right >= blockingGapMm) break;
      if (
        b.bottom - a.top >= blockingGapMm ||
        a.bottom - b.top >= blockingGapMm
      )
        continue;
      addSides(grip, neighbour);
      addSides(neighbour, grip);
    }
  }
  for (let grip = 0; grip < count; grip += 1) {
    const own = bounds[grip]!;
    if (own.length > 0) {
      const minX = Math.min(...own.map(({ left }) => left));
      const maxX = Math.max(...own.map(({ right }) => right));
      const minY = Math.min(...own.map(({ bottom }) => bottom));
      const maxY = Math.max(...own.map(({ top }) => top));
      const base = grip * POCKET_SIDE_COUNT;
      extentFrom.set([minY, minY, minX, minX], base);
      extentTo.set([maxY, maxY, maxX, maxX], base);
    }
  }

  // Placement state as flags, cached per (set, size): an order only adds to
  // its placed set, so every candidate of one step shares the conversion and
  // the dead runs before the step.
  let cachedSet: ReadonlySet<string> | null = null;
  let cachedSize = -1;
  let cachedFlags = new Uint8Array(count);
  let cachedBeforeMemo: Uint8Array | null = null;
  const placedFlags = (placed: ReadonlySet<string>): Uint8Array => {
    if (placed !== cachedSet || placed.size !== cachedSize) {
      cachedSet = placed;
      cachedSize = placed.size;
      cachedFlags = new Uint8Array(count);
      cachedBeforeMemo = null;
      placed.forEach((id) => {
        const index = indexById.get(id);
        if (index !== undefined) cachedFlags[index] = 1;
      });
    }
    return cachedFlags;
  };

  const sideClosed = (flags: Uint8Array, grip: number, side: number) =>
    neighbours[grip * POCKET_SIDE_COUNT + side]!.some(
      (neighbour) => flags[neighbour] === 1,
    );

  /**
   * Whether an unplaced grip's run is closed at both ends along some axis.
   * `memo` (0 unknown, 1 open, 2 closed) belongs to one placement state.
   */
  const isDeadlocked = (
    flags: Uint8Array,
    memo: Uint8Array,
    grip: number,
  ): boolean => {
    const closedToward = (from: number, side: number): boolean => {
      const key = from * POCKET_SIDE_COUNT + side;
      if (memo[key] !== 0) return memo[key] === 2;
      // Runs only move one way along the axis, so this recursion ends.
      const closed = neighbours[key]!.some(
        (neighbour) => flags[neighbour] === 1 || closedToward(neighbour, side),
      );
      memo[key] = closed ? 2 : 1;
      return closed;
    };
    return (
      (closedToward(grip, 0) && closedToward(grip, 1)) ||
      (closedToward(grip, 2) && closedToward(grip, 3))
    );
  };

  const sideIsPartial = (
    flags: Uint8Array,
    grip: number,
    side: number,
  ): boolean => {
    const key = grip * POCKET_SIDE_COUNT + side;
    // Only worth waiting for when a neighbour of that side is still missing;
    // a side the layout itself leaves partly open stays as it is.
    if (neighbours[key]!.every((neighbour) => flags[neighbour] === 1)) {
      return false;
    }
    const stretches = contacts[key]!.filter(
      ({ neighbour }) => flags[neighbour] === 1,
    ).sort((left, right) => left.from - right.from);
    if (stretches.length === 0) return false;
    let reached = extentFrom[key]!;
    for (const { from, to } of stretches) {
      if (from > reached + SIDE_COVER_TOLERANCE_MM) return true;
      reached = Math.max(reached, to);
    }
    return reached < extentTo[key]! - SIDE_COVER_TOLERANCE_MM;
  };

  const isEnclosed = (gripId: string, placed: ReadonlySet<string>) => {
    const grip = indexById.get(gripId);
    if (grip === undefined) return false;
    const flags = placedFlags(placed);
    return (
      (sideClosed(flags, grip, 0) && sideClosed(flags, grip, 1)) ||
      (sideClosed(flags, grip, 2) && sideClosed(flags, grip, 3))
    );
  };

  return {
    isEnclosed,
    newDeadlocks(gripId, placed) {
      const grip = indexById.get(gripId);
      if (grip === undefined) return 0;
      const flags = placedFlags(placed);
      cachedBeforeMemo ??= new Uint8Array(count * POCKET_SIDE_COUNT);
      const beforeMemo = cachedBeforeMemo;
      // Only grips whose run passes through `grip` can change: walk away
      // from it along every side.
      const affected = new Set<number>();
      for (let side = 0; side < POCKET_SIDE_COUNT; side += 1) {
        const queue: number[] = [grip];
        while (queue.length > 0) {
          const current = queue.pop()!;
          for (const next of neighbours[current * POCKET_SIDE_COUNT + side]!) {
            if (flags[next] === 1 || next === grip || affected.has(next)) {
              continue;
            }
            affected.add(next);
            queue.push(next);
          }
        }
      }
      if (affected.size === 0) return 0;
      const was = flags[grip]!;
      flags[grip] = 1;
      const afterMemo = new Uint8Array(count * POCKET_SIDE_COUNT);
      let added = 0;
      affected.forEach((other) => {
        if (isDeadlocked(flags, afterMemo, other)) {
          flags[grip] = was;
          const before = isDeadlocked(flags, beforeMemo, other);
          flags[grip] = 1;
          if (!before) added += 1;
        }
      });
      flags[grip] = was;
      return added;
    },
    partialSides(gripId, placed) {
      const grip = indexById.get(gripId);
      if (grip === undefined) return 0;
      const flags = placedFlags(placed);
      let partial = 0;
      for (let side = 0; side < POCKET_SIDE_COUNT; side += 1) {
        if (sideIsPartial(flags, grip, side)) partial += 1;
      }
      return partial;
    },
    adjacent(left, right) {
      const grip = indexById.get(left);
      const other = indexById.get(right);
      if (grip === undefined || other === undefined) return false;
      for (let side = 0; side < POCKET_SIDE_COUNT; side += 1) {
        if (neighbours[grip * POCKET_SIDE_COUNT + side]!.includes(other)) {
          return true;
        }
      }
      return false;
    },
  };
}

/** Grips that a given order sets into a slot closed on both sides. */
export function enclosedGripsInOrder(
  order: readonly string[],
  guard: GripPocketGuard,
): string[] {
  const placed = new Set<string>();
  const enclosed: string[] = [];
  for (const gripId of order) {
    if (guard.isEnclosed(gripId, placed)) enclosed.push(gripId);
    placed.add(gripId);
  }
  return enclosed;
}

/**
 * Index of the next grip to place. A grip is fine when it is reachable, leaves
 * every other slot reachable and rests fully against its placed neighbours.
 * The preferred (first) grip goes when it is fine; otherwise a fine grip next
 * to the previously placed one (the robot keeps working in that area), else
 * the first fine one. Without a fine grip, the least bad one is taken.
 */
export function pickAccessibleGripIndex<T extends { id: string }>(
  available: readonly T[],
  placed: ReadonlySet<string>,
  guard: GripPocketGuard | null | undefined,
  lastPlacedId?: string | null,
): number {
  if (!guard || available.length <= 1) return 0;
  type Cost = [number, number, number];
  const costs = new Map<number, Cost>();
  const costOf = (index: number): Cost => {
    const cached = costs.get(index);
    if (cached) return cached;
    const id = available[index]!.id;
    const enclosed = guard.isEnclosed(id, placed) ? 1 : 0;
    const cost: Cost = enclosed
      ? [1, 0, 0]
      : [0, guard.newDeadlocks(id, placed), guard.partialSides(id, placed)];
    costs.set(index, cost);
    return cost;
  };
  // Cheap checks first; the run lookahead only for otherwise fine grips.
  const fine = (index: number) => {
    const cached = costs.get(index);
    if (cached) return cached.every((value) => value === 0);
    const id = available[index]!.id;
    return (
      !guard.isEnclosed(id, placed) &&
      guard.partialSides(id, placed) === 0 &&
      guard.newDeadlocks(id, placed) === 0
    );
  };
  if (fine(0)) return 0;
  const indices = available.map((_, index) => index);
  // The preferred grip has to wait: continue next to the last grip first.
  if (lastPlacedId) {
    const near = indices.find(
      (index) =>
        guard.adjacent(lastPlacedId, available[index]!.id) && fine(index),
    );
    if (near !== undefined) return near;
  }
  const first = indices.find(fine);
  if (first !== undefined) return first;
  return indices.reduce((best, index) => {
    const left = costOf(index);
    const right = costOf(best);
    for (let position = 0; position < left.length; position += 1) {
      if (left[position]! !== right[position]!) {
        return left[position]! < right[position]! ? index : best;
      }
    }
    return best;
  }, 0);
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
  pocketGuard?: GripPocketGuard | null,
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
  const placed = new Set<string>();
  while (available.length > 0) {
    const [current] = available.splice(
      pickAccessibleGripIndex(
        available,
        placed,
        pocketGuard,
        ordered.at(-1)?.id,
      ),
      1,
    ) as [T];
    ordered.push(current);
    placed.add(current.id);
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
        PLACE_APPROACH_OFFSET_MM,
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
