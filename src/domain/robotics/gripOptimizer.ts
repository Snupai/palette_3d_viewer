import { solverRectangleBoundsOverlap } from "~/domain/solver/geometryPolicy";
import type { Rotation } from "~/domain/palletTypes";

/**
 * Grip optimizer for automatic suction grouping.
 *
 * Packages can only share a grip when they lie on one line along their local
 * pickup axis and touch face to face. Per line, the optimizer picks the chunk
 * sizes (and, when allowed, small slides that close gaps inside a chunk) by
 * the following costs, in order:
 *
 * 1. fewer grips;
 * 2. fewer single grips;
 * 3. fewer single grips on the outer edge of the layer;
 * 4. less total package movement;
 * 5. fewer single grips as the last grip of their line in laying direction
 *    (bottom to top, right to left): a line then starts with its single and
 *    the next line does not follow one single with another;
 * 6. fewer single grips touching other single grips ("chains");
 * 7. single grips closer to the layer centre;
 * 8. larger chunks first along the line (deterministic tie-break).
 *
 * Lines are first decided in a fixed geometric order; later passes re-decide
 * each line against the single grips of all other lines until nothing
 * changes, so a chain with a single in a later line is also avoided. The
 * result is independent of the input order.
 *
 * Packages only slide when that cannot change the physical layout rules:
 * the pickup span must equal the physical package length (not true for some
 * imported crosswise plans) and no inter-package clearance may be required,
 * because grip members end up touching, and packages on the layer's outer
 * edge never leave it.
 *
 * With sliding, one call repeats the optimization on its own shifted output
 * until a run moves nothing, so running it again on the result changes
 * nothing (a second "recalculate" is a no-op). `maxShiftMm` limits each of
 * these steps, so the total movement can exceed it.
 */

export type GripOptimizerPlacement = {
  id: string;
  positionMm: { x: number; y: number };
  rotation: Rotation;
};

export type GripOptimizerOptions = {
  /** Centre distance of face-adjacent grip members along the pickup axis. */
  spanMm: number;
  /** Physical package size; rotation 0 puts `length` along x. */
  packageSizeMm: { length: number; width: number };
  maxPackagesPerPick: number;
  /** Packages may slide along their line to close gaps; 0 disables it. */
  maxShiftMm?: number;
  /** Required gap between packages; any positive value disables sliding. */
  clearanceMm?: number;
  toleranceMm?: number;
  /**
   * Extra rule for multi-package grips, given the members at their planned
   * positions (e.g. imported .rob plans need whole-millimetre grip points).
   * A rejected chunk is not formed, so the line is split differently.
   */
  chunkAllowed?: (members: readonly GripOptimizerPlacement[]) => boolean;
  /**
   * With `chunkAllowed`, slide offsets on this grid are tried after the
   * cheapest ones, so a valid position between them is not missed.
   */
  offsetGridMm?: number;
};

export type GripOptimizerResult = {
  /** Placement ids per grip, ordered along the pickup axis. */
  groups: string[][];
  /** Only placements that were moved, with their new centre. */
  movedPositions: Map<string, { x: number; y: number }>;
};

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

type Item = {
  id: string;
  rotation: Rotation;
  horizontal: boolean;
  axis: number;
  cross: number;
};

type Cost = [number, number, number, number, number, number, number];

const ZERO_COST: Cost = [0, 0, 0, 0, 0, 0, 0];
const COMPARE_EPSILON = 1e-6;

function addCost(left: Cost, right: Cost): Cost {
  return left.map((value, index) => value + right[index]!) as Cost;
}

function compareCost(left: Cost, right: Cost): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (Math.abs(difference) > COMPARE_EPSILON) return difference;
  }
  return 0;
}

function toItem(placement: GripOptimizerPlacement): Item {
  const horizontal = placement.rotation === 0 || placement.rotation === 180;
  return {
    id: placement.id,
    rotation: placement.rotation,
    horizontal,
    axis: horizontal ? placement.positionMm.x : placement.positionMm.y,
    cross: horizontal ? placement.positionMm.y : placement.positionMm.x,
  };
}

/** Physical footprint; the pickup axis always carries the package length. */
function rectFor(
  item: Item,
  axis: number,
  size: { length: number; width: number },
): Rect {
  const x = item.horizontal ? axis : item.cross;
  const y = item.horizontal ? item.cross : axis;
  const halfX = (item.horizontal ? size.length : size.width) / 2;
  const halfY = (item.horizontal ? size.width : size.length) / 2;
  return { minX: x - halfX, minY: y - halfY, maxX: x + halfX, maxY: y + halfY };
}

/**
 * Overlap with the solver/editor geometry tolerance, so float noise at a
 * flush contact neither blocks a slide nor differs from editor validation.
 */
function overlaps(left: Rect, right: Rect) {
  return solverRectangleBoundsOverlap(left, right);
}

/** Rectangles share a boundary segment of positive length. */
function touches(left: Rect, right: Rect, tolerance: number): boolean {
  const overlapX =
    Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX);
  const overlapY =
    Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY);
  const touchX =
    Math.abs(left.maxX - right.minX) <= tolerance ||
    Math.abs(right.maxX - left.minX) <= tolerance;
  const touchY =
    Math.abs(left.maxY - right.minY) <= tolerance ||
    Math.abs(right.maxY - left.minY) <= tolerance;
  return (touchX && overlapY > tolerance) || (touchY && overlapX > tolerance);
}

function onLayerEdge(rect: Rect, bounds: Rect, tolerance: number): boolean {
  return (
    rect.minX <= bounds.minX + tolerance ||
    rect.minY <= bounds.minY + tolerance ||
    rect.maxX >= bounds.maxX - tolerance ||
    rect.maxY >= bounds.maxY - tolerance
  );
}

function compareItems(left: Item, right: Item): number {
  return (
    left.rotation - right.rotation ||
    left.cross - right.cross ||
    left.axis - right.axis ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Turns ideal touching positions into ones that pass the strict editor
 * overlap check in floating point: members within the tolerance keep their
 * exact original position, moved members are nudged by the smallest
 * representable steps away from their neighbours until edges no longer
 * overlap. Returns null when that is impossible.
 */
function exactContactPlan(
  original: readonly number[],
  ideal: readonly number[],
  lengthMm: number,
  tolerance: number,
): number[] | null {
  const plan = ideal.map((axis, index) =>
    Math.abs(axis - original[index]!) <= tolerance ? original[index]! : axis,
  );
  const moved = plan.map((axis, index) => axis !== original[index]);
  const half = lengthMm / 2;
  const overlapping = (index: number) =>
    plan[index]! - half < plan[index - 1]! + half;
  const nudge = (index: number, direction: 1 | -1) => {
    for (let step = 0; step < 64 && overlapping(index); step += 1) {
      const target = direction === 1 ? index : index - 1;
      const value = plan[target]!;
      plan[target] =
        value + direction * Math.max(Math.abs(value) * Number.EPSILON, 1e-12);
    }
  };
  for (let index = 1; index < plan.length; index += 1) {
    if (moved[index] && overlapping(index)) nudge(index, 1);
  }
  for (let index = plan.length - 1; index >= 1; index -= 1) {
    if (moved[index - 1] && overlapping(index)) nudge(index, -1);
  }
  for (let index = 1; index < plan.length; index += 1) {
    if (overlapping(index)) return null;
  }
  return plan;
}

function optimizeOnce(
  placements: readonly GripOptimizerPlacement[],
  options: GripOptimizerOptions,
): GripOptimizerResult {
  const { spanMm, packageSizeMm } = options;
  if (
    !(spanMm > 0) ||
    !(packageSizeMm.length > 0) ||
    !(packageSizeMm.width > 0)
  ) {
    throw new Error("spanMm and packageSizeMm must be positive and finite.");
  }
  const tolerance = options.toleranceMm ?? 0.001;
  const maxPerPick = Math.max(1, Math.trunc(options.maxPackagesPerPick));
  const slidingAllowed =
    (options.clearanceMm ?? 0) === 0 &&
    Math.abs(spanMm - packageSizeMm.length) <= tolerance;
  const maxShift = slidingAllowed ? (options.maxShiftMm ?? 0) : 0;

  const items = placements.map(toItem).sort(compareItems);
  // One package per pick: nothing to decide, every package is its own grip
  // (same order as the line-by-line result below).
  if (maxPerPick === 1) {
    return { groups: items.map(({ id }) => [id]), movedPositions: new Map() };
  }
  const positionById = new Map(items.map((item) => [item.id, item.axis]));
  const rectOf = (item: Item) =>
    rectFor(item, positionById.get(item.id)!, packageSizeMm);

  const layerBounds = items.reduce<Rect | null>((bounds, item) => {
    const rect = rectOf(item);
    return bounds
      ? {
          minX: Math.min(bounds.minX, rect.minX),
          minY: Math.min(bounds.minY, rect.minY),
          maxX: Math.max(bounds.maxX, rect.maxX),
          maxY: Math.max(bounds.maxY, rect.maxY),
        }
      : rect;
  }, null);
  if (!layerBounds) return { groups: [], movedPositions: new Map() };
  const layerCenter = {
    x: (layerBounds.minX + layerBounds.maxX) / 2,
    y: (layerBounds.minY + layerBounds.maxY) / 2,
  };

  /**
   * A package on the layer's outer edge never slides off it, so the layer
   * outline (and with it edge and centre costs) is the same before and after
   * sliding. That keeps a repeated recalculation stable.
   */
  const keepsLayerEdges = (item: Item, moved: Rect) => {
    const original = rectFor(item, item.axis, packageSizeMm);
    const near = (left: number, right: number) =>
      Math.abs(left - right) <= tolerance;
    return (
      (!near(original.minX, layerBounds.minX) ||
        near(moved.minX, layerBounds.minX)) &&
      (!near(original.maxX, layerBounds.maxX) ||
        near(moved.maxX, layerBounds.maxX)) &&
      (!near(original.minY, layerBounds.minY) ||
        near(moved.minY, layerBounds.minY)) &&
      (!near(original.maxY, layerBounds.maxY) ||
        near(moved.maxY, layerBounds.maxY))
    );
  };

  // Lines: same rotation and cross coordinate, sorted along the pickup axis.
  const lines: Item[][] = [];
  for (const item of items) {
    const line = lines.find((candidate) => {
      const first = candidate[0]!;
      return (
        first.rotation === item.rotation &&
        Math.abs(first.cross - item.cross) <= tolerance
      );
    });
    if (line) line.push(item);
    else lines.push([item]);
  }
  for (const line of lines) {
    line.sort(
      (left, right) =>
        left.axis - right.axis || left.id.localeCompare(right.id),
    );
  }

  type Decision = { sizes: number[]; plans: number[][] };

  const decideLine = (
    line: Item[],
    otherSingles: readonly Rect[],
  ): Decision => {
    const lineIds = new Set(line.map(({ id }) => id));
    // A chunk only slides along its line, so only packages whose current or
    // original footprint reaches into the line's cross band can collide.
    const band = line.reduce(
      (extent, member) => {
        const rect = rectFor(member, member.axis, packageSizeMm);
        return member.horizontal
          ? {
              min: Math.min(extent.min, rect.minY),
              max: Math.max(extent.max, rect.maxY),
            }
          : {
              min: Math.min(extent.min, rect.minX),
              max: Math.max(extent.max, rect.maxX),
            };
      },
      { min: Infinity, max: -Infinity },
    );
    const reachesBand = (rect: Rect) =>
      line[0]!.horizontal
        ? rect.maxY > band.min && rect.minY < band.max
        : rect.maxX > band.min && rect.minX < band.max;
    const others = items.filter(
      (item) =>
        !lineIds.has(item.id) &&
        (reachesBand(rectOf(item)) ||
          reachesBand(rectFor(item, item.axis, packageSizeMm))),
    );
    const chunkPlans = new Map<string, number[] | null>();

    /**
     * Final axis positions for chunk [start, start + size), or null. Members
     * end at `offset + index * span`; offsets stay inside the chunk's own
     * extent so chunks of one line never collide, and the movement-minimal
     * collision-free offset wins.
     */
    const allowed = (members: readonly Item[], plan: readonly number[]) =>
      !options.chunkAllowed ||
      options.chunkAllowed(
        members.map((member, index) => ({
          id: member.id,
          rotation: member.rotation,
          positionMm: member.horizontal
            ? { x: plan[index]!, y: member.cross }
            : { x: member.cross, y: plan[index]! },
        })),
      );
    const chunkPlan = (start: number, size: number): number[] | null => {
      const key = `${start}:${size}`;
      if (!chunkPlans.has(key))
        chunkPlans.set(key, computeChunkPlan(start, size));
      return chunkPlans.get(key)!;
    };
    const computeChunkPlan = (start: number, size: number): number[] | null => {
      const members = line.slice(start, start + size);
      if (size === 1) return [members[0]!.axis];
      const bases = members.map(({ axis }, index) => axis - index * spanMm);
      const lowest = bases[0]!;
      const highest = bases[size - 1]!;
      if (
        bases.some(
          (base, index) => index > 0 && base < bases[index - 1]! - tolerance,
        )
      ) {
        return null;
      }
      // Already face-adjacent: keep the exact positions, recomputing them
      // could reintroduce a floating-point overlap.
      if (highest - lowest <= tolerance) {
        const plan = members.map(({ axis }) => axis);
        return allowed(members, plan) ? plan : null;
      }
      if (maxShift <= 0) return null;
      const low = Math.max(lowest, highest - maxShift);
      const high = Math.min(highest, lowest + maxShift);
      if (low > high + tolerance) return null;
      const clamp = (value: number) => Math.min(high, Math.max(low, value));
      const totalShift = (offset: number) =>
        bases.reduce((sum, base) => sum + Math.abs(offset - base), 0);
      // Between equally cheap offsets keep the chunk toward the line's
      // nearer outer end, so the outer package stays where it is.
      const nearStart = start <= line.length - (start + size);
      const byShift = (left: number, right: number) =>
        totalShift(left) - totalShift(right) ||
        (nearStart ? left - right : right - left);
      const offsets = [...new Set([low, high, ...bases.map(clamp)])].sort(
        byShift,
      );
      const tryOffset = (offset: number): number[] | null => {
        const plan = exactContactPlan(
          members.map(({ axis }) => axis),
          members.map((_, index) => offset + index * spanMm),
          packageSizeMm.length,
          tolerance,
        );
        if (!plan || !allowed(members, plan)) return null;
        const free = members.every((member, index) => {
          if (plan[index] === member.axis) return true;
          const rect = rectFor(member, plan[index]!, packageSizeMm);
          if (!keepsLayerEdges(member, rect)) return false;
          // Original spots count too: a line re-decided in a later pass may
          // move its packages back there.
          return others.every(
            (other) =>
              !overlaps(rect, rectOf(other)) &&
              !overlaps(rect, rectFor(other, other.axis, packageSizeMm)),
          );
        });
        return free ? plan : null;
      };
      for (const offset of offsets) {
        const plan = tryOffset(offset);
        if (plan) return plan;
      }
      // With a chunk rule (e.g. whole-millimetre grips) the cheapest offsets
      // may all be rejected; only then try the grid inside the same interval.
      const grid = options.offsetGridMm;
      if (!options.chunkAllowed || !grid || !(grid > 0)) return null;
      const tried = new Set(offsets);
      const extra: number[] = [];
      for (
        let step = Math.ceil((low - tolerance) / grid);
        step * grid <= high + tolerance && extra.length < 4096;
        step += 1
      ) {
        const offset = clamp(step * grid);
        if (!tried.has(offset)) extra.push(offset);
      }
      for (const offset of extra.sort(byShift)) {
        const plan = tryOffset(offset);
        if (plan) return plan;
      }
      return null;
    };

    const singleCost = (index: number): Cost => {
      if (maxPerPick === 1) return [1, 0, 0, 0, 0, 0, 0];
      const item = line[index]!;
      const rect = rectFor(item, item.axis, packageSizeMm);
      const chain = otherSingles.filter((single) =>
        touches(rect, single, tolerance),
      ).length;
      const centreX = (rect.minX + rect.maxX) / 2;
      const centreY = (rect.minY + rect.maxY) / 2;
      return [
        1,
        1,
        onLayerEdge(rect, layerBounds, tolerance) ? 1 : 0,
        0,
        endsLine(index) ? 1 : 0,
        chain,
        Math.abs(centreX - layerCenter.x) + Math.abs(centreY - layerCenter.y),
      ];
    };
    /**
     * A single at this index is the line's last grip in laying direction:
     * the top of a column, the left end of a row (rows go right to left).
     */
    const endsLine = (index: number) =>
      line.length > 1 &&
      (line[0]!.horizontal ? index === 0 : index === line.length - 1);
    const singleTouchesNext = (index: number) =>
      index + 1 < line.length &&
      Math.abs(line[index + 1]!.axis - line[index]!.axis - spanMm) <= tolerance;

    // DP from the line end. State: whether the previous chunk was a single
    // that touches the chunk starting here.
    type Entry = { cost: Cost } & Decision;
    const memo = new Map<string, Entry>();
    const solve = (start: number, previousSingleTouches: boolean): Entry => {
      if (start >= line.length) {
        return { cost: ZERO_COST, sizes: [], plans: [] };
      }
      const key = `${start}:${previousSingleTouches}`;
      const cached = memo.get(key);
      if (cached) return cached;
      let best: Entry | null = null;
      for (
        let size = Math.min(maxPerPick, line.length - start);
        size >= 1;
        size -= 1
      ) {
        const plan = chunkPlan(start, size);
        if (!plan) continue;
        const shift = plan.reduce(
          (sum, axis, index) =>
            sum + Math.abs(axis - line[start + index]!.axis),
          0,
        );
        const chunkCost: Cost =
          size === 1 ? singleCost(start) : [1, 0, 0, shift, 0, 0, 0];
        const ownChain: Cost =
          size === 1 && previousSingleTouches && maxPerPick > 1
            ? [0, 0, 0, 0, 0, 1, 0]
            : ZERO_COST;
        const rest = solve(
          start + size,
          size === 1 && singleTouchesNext(start),
        );
        const cost = addCost(addCost(chunkCost, ownChain), rest.cost);
        if (!best || compareCost(cost, best.cost) < 0) {
          best = {
            cost,
            sizes: [size, ...rest.sizes],
            plans: [plan, ...rest.plans],
          };
        }
      }
      memo.set(key, best!);
      return best!;
    };
    const { sizes, plans } = solve(0, false);
    return { sizes, plans };
  };

  const decisions: (Decision | null)[] = lines.map(() => null);
  const singlesOf = (lineIndex: number): Rect[] => {
    const decision = decisions[lineIndex];
    if (!decision) return [];
    const line = lines[lineIndex]!;
    const singles: Rect[] = [];
    let start = 0;
    decision.sizes.forEach((size) => {
      if (size === 1) singles.push(rectOf(line[start]!));
      start += size;
    });
    return singles;
  };
  const apply = (lineIndex: number, decision: Decision) => {
    const line = lines[lineIndex]!;
    let start = 0;
    decision.sizes.forEach((size, chunkIndex) => {
      line
        .slice(start, start + size)
        .forEach((member, index) =>
          positionById.set(member.id, decision.plans[chunkIndex]![index]!),
        );
      start += size;
    });
    decisions[lineIndex] = decision;
  };
  const sameDecision = (left: Decision, right: Decision) =>
    left.sizes.length === right.sizes.length &&
    left.sizes.every((size, index) => size === right.sizes[index]) &&
    left.plans
      .flat()
      .every(
        (axis, index) =>
          Math.abs(axis - right.plans.flat()[index]!) <= tolerance,
      );

  /** Whole-layer cost of the current decisions (chains counted per pair). */
  const layerCost = (): Cost => {
    const cost: Cost = [0, 0, 0, 0, 0, 0, 0];
    const singles: Rect[] = [];
    lines.forEach((line, lineIndex) => {
      let start = 0;
      const sizes = decisions[lineIndex]!.sizes;
      sizes.forEach((size, chunkIndex) => {
        cost[0] += 1;
        const members = line.slice(start, start + size);
        cost[3] += members.reduce(
          (sum, item) => sum + Math.abs(positionById.get(item.id)! - item.axis),
          0,
        );
        if (size === 1 && maxPerPick > 1) {
          const rect = rectOf(members[0]!);
          cost[1] += 1;
          if (onLayerEdge(rect, layerBounds, tolerance)) cost[2] += 1;
          const last = line[0]!.horizontal ? 0 : sizes.length - 1;
          if (sizes.length > 1 && chunkIndex === last) cost[4] += 1;
          cost[5] += singles.filter((single) =>
            touches(rect, single, tolerance),
          ).length;
          cost[6] +=
            Math.abs((rect.minX + rect.maxX) / 2 - layerCenter.x) +
            Math.abs((rect.minY + rect.maxY) / 2 - layerCenter.y);
          singles.push(rect);
        }
        start += size;
      });
    });
    return cost;
  };
  const stateKey = () =>
    decisions
      .map((decision) =>
        decision!.plans.map((plan) => plan.join(",")).join("|"),
      )
      .join(";");

  // Re-decide line by line until nothing changes. Each step can only keep or
  // lower its line's share of the layer cost, but a step that ties may flip
  // back and forth; a repeated state ends the search with the best one seen.
  const seen = new Set<string>();
  let best: { cost: Cost; decisions: Decision[] } | null = null;
  const passLimit = 2 * lines.length + 4;
  for (let pass = 0; pass < passLimit; pass += 1) {
    let changed = false;
    lines.forEach((line, lineIndex) => {
      const previous = decisions[lineIndex];
      // Re-decide from the original positions of this line only.
      line.forEach((item) => positionById.set(item.id, item.axis));
      const otherSingles = lines.flatMap((_, otherIndex) =>
        otherIndex === lineIndex ? [] : singlesOf(otherIndex),
      );
      const decision = decideLine(line, otherSingles);
      if (!previous || !sameDecision(previous, decision)) changed = true;
      apply(lineIndex, decision);
    });
    const cost = layerCost();
    if (!best || compareCost(cost, best.cost) < 0) {
      best = { cost, decisions: decisions.map((decision) => decision!) };
    }
    const key = stateKey();
    if (!changed || seen.has(key)) break;
    seen.add(key);
  }
  lines.forEach((line) =>
    line.forEach((item) => positionById.set(item.id, item.axis)),
  );
  best!.decisions.forEach((decision, lineIndex) => apply(lineIndex, decision));

  const groups: string[][] = [];
  lines.forEach((line, lineIndex) => {
    let start = 0;
    decisions[lineIndex]!.sizes.forEach((size) => {
      groups.push(line.slice(start, start + size).map(({ id }) => id));
      start += size;
    });
  });

  const movedPositions = new Map<string, { x: number; y: number }>();
  for (const item of items) {
    const axis = positionById.get(item.id)!;
    if (axis === item.axis) continue;
    movedPositions.set(
      item.id,
      item.horizontal ? { x: axis, y: item.cross } : { x: item.cross, y: axis },
    );
  }
  return { groups, movedPositions };
}

const MAX_SLIDE_ROUNDS = 8;

export function optimizeSuctionGroups(
  placements: readonly GripOptimizerPlacement[],
  options: GripOptimizerOptions,
): GripOptimizerResult {
  let current = placements.map((placement) => ({
    ...placement,
    positionMm: { ...placement.positionMm },
  }));
  const seen = new Set<string>();
  let result = optimizeOnce(current, options);
  for (
    let round = 1;
    round < MAX_SLIDE_ROUNDS && result.movedPositions.size > 0;
    round += 1
  ) {
    current = current.map((placement) => ({
      ...placement,
      positionMm:
        result.movedPositions.get(placement.id) ?? placement.positionMm,
    }));
    const key = current
      .map(({ id, positionMm }) => `${id}:${positionMm.x},${positionMm.y}`)
      .sort()
      .join(";");
    if (seen.has(key)) break;
    seen.add(key);
    result = optimizeOnce(current, options);
  }
  // A final run still wanting to move means the round limit was hit; keep
  // its decision so the returned groups match the returned positions.
  const finalPositions = new Map(
    current.map(({ id, positionMm }) => [
      id,
      result.movedPositions.get(id) ?? positionMm,
    ]),
  );
  const movedPositions = new Map<string, { x: number; y: number }>();
  for (const placement of placements) {
    const position = finalPositions.get(placement.id)!;
    if (
      position.x !== placement.positionMm.x ||
      position.y !== placement.positionMm.y
    ) {
      movedPositions.set(placement.id, position);
    }
  }
  return { groups: result.groups, movedPositions };
}
