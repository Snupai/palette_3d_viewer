import {
  placementClearanceBounds,
  placementRectangleBounds,
  type PointMm,
  type RectangleBoundsMm,
} from "~/domain/geometry";
import type { LayerPattern, Project } from "~/domain/project/projectSchema";
import {
  EDITOR_GEOMETRY_TOLERANCE_MM,
  editorBoundsContain,
  editorBoundsOverlap,
  editorOverlapMeasure,
  editorProtrusionMeasure,
  editorViolationsWorsen,
  projectEditorEnvelope,
} from "~/features/editor/editorModel";

/** Edges closer than this count as touching — the same tolerance validation uses. */
const EPSILON_MM = EDITOR_GEOMETRY_TOLERANCE_MM;
const MAX_SLIDE_STEPS = 4;
/** Sub-visual offset used to step out of a float-level contact overlap. */
const NUDGE_MM = 1e-6;

type Axis = "x" | "y";

export type DragCollisionContext = {
  /** Clearance bounds of the dragged packages at their original position. */
  moving: readonly {
    clearance: RectangleBoundsMm;
    physical: RectangleBoundsMm;
  }[];
  /** Clearance bounds of every package that stays in place. */
  obstacles: readonly RectangleBoundsMm[];
  envelope: RectangleBoundsMm | null;
  /**
   * Blocking geometry errors (overlap / out of bounds) involving the dragged
   * packages after committing `delta`, keyed like the editor diagnostics and
   * valued by their size. Uses exactly the same arithmetic and tolerance as
   * `validateProjectPattern`. A commit may keep errors the pattern already had
   * but must not add or worsen one — the same rule the move command applies,
   * so a committed drag is never rejected.
   */
  violations?: (delta: PointMm) => ReadonlyMap<string, number>;
  /**
   * Grid (mm) a committed drag snaps to. Imported `.rob` plans can only store
   * whole millimetres, so they snap to 1 mm; other plans to 0.1 mm.
   */
  gridMm?: number;
};

export function createDragCollisionContext(
  project: Project,
  pattern: LayerPattern,
  placementIds: readonly string[],
): DragCollisionContext {
  const movingIds = new Set(placementIds);
  const size = project.package.dimensionsMm;
  const clearance = project.package.clearanceMm;
  const moving: DragCollisionContext["moving"][number][] = [];
  const obstacles: RectangleBoundsMm[] = [];
  const obstacleIds: string[] = [];
  for (const placement of pattern.placements) {
    const clearanceBounds = placementClearanceBounds(
      placement,
      size,
      clearance,
    );
    if (movingIds.has(placement.id)) {
      moving.push({
        clearance: clearanceBounds,
        physical: placementRectangleBounds(placement, size),
      });
    } else {
      obstacles.push(clearanceBounds);
      obstacleIds.push(placement.id);
    }
  }
  const envelope = projectEditorEnvelope(project);
  const movingPlacements = pattern.placements.filter(({ id }) =>
    movingIds.has(id),
  );
  const violations = (delta: PointMm) => {
    const shifted = movingPlacements.map((placement) => {
      const moved = {
        ...placement,
        positionMm: {
          x: placement.positionMm.x + delta.x,
          y: placement.positionMm.y + delta.y,
        },
      };
      return {
        id: placement.id,
        physical: placementRectangleBounds(moved, size),
        clearance: placementClearanceBounds(moved, size, clearance),
      };
    });
    const pair = (left: string, right: string) =>
      `placement-overlap:${[left, right].sort().join("|")}`;
    const measures = new Map<string, number>();
    shifted.forEach((entry, index) => {
      if (envelope && !editorBoundsContain(envelope, entry.physical))
        measures.set(
          `placement-out-of-bounds:${entry.id}`,
          editorProtrusionMeasure(envelope, entry.physical),
        );
      obstacles.forEach((obstacle, obstacleIndex) => {
        if (editorBoundsOverlap(entry.clearance, obstacle))
          measures.set(
            pair(entry.id, obstacleIds[obstacleIndex]!),
            editorOverlapMeasure(entry.clearance, obstacle),
          );
      });
      for (const other of shifted.slice(index + 1)) {
        if (editorBoundsOverlap(entry.clearance, other.clearance))
          measures.set(
            pair(entry.id, other.id),
            editorOverlapMeasure(entry.clearance, other.clearance),
          );
      }
    });
    return measures;
  };
  return {
    moving,
    obstacles,
    envelope,
    violations,
    gridMm: project.source.kind === "rob-import" ? 1 : 0.1,
  };
}

function shift(bounds: RectangleBoundsMm, delta: PointMm): RectangleBoundsMm {
  return {
    minX: bounds.minX + delta.x,
    minY: bounds.minY + delta.y,
    maxX: bounds.maxX + delta.x,
    maxY: bounds.maxY + delta.y,
  };
}

function overlapsStrictly(
  left: RectangleBoundsMm,
  right: RectangleBoundsMm,
): boolean {
  return (
    left.minX < right.maxX - EPSILON_MM &&
    left.maxX > right.minX + EPSILON_MM &&
    left.minY < right.maxY - EPSILON_MM &&
    left.maxY > right.minY + EPSILON_MM
  );
}

/** Entry/exit times of a moving interval against a static one along one axis. */
function axisWindow(
  movingMin: number,
  movingMax: number,
  staticMin: number,
  staticMax: number,
  velocity: number,
): { entry: number; exit: number } | null {
  if (velocity === 0) {
    const overlapping =
      movingMax > staticMin + EPSILON_MM && movingMin < staticMax - EPSILON_MM;
    return overlapping ? { entry: -Infinity, exit: Infinity } : null;
  }
  if (velocity > 0) {
    return {
      entry: (staticMin - movingMax) / velocity,
      exit: (staticMax - movingMin) / velocity,
    };
  }
  return {
    entry: (staticMax - movingMin) / velocity,
    exit: (staticMin - movingMax) / velocity,
  };
}

type Hit = { time: number; axis: Axis };

/**
 * Rate at which the overlap of a moving interval with a static one changes
 * under `velocity` (positive = the overlap grows), as a one-sided derivative
 * with exact boundary comparisons.
 */
function overlapGrowth(
  movingMin: number,
  movingMax: number,
  staticMin: number,
  staticMax: number,
  velocity: number,
): number {
  if (velocity === 0) return 0;
  // overlap = min(maxes) - max(mins)
  // Exact comparisons: a tolerance here could hide real growth; the
  // tolerance applies to the overlap test and the commit check instead.
  const upper =
    velocity > 0
      ? movingMax < staticMax
        ? velocity
        : 0
      : movingMax <= staticMax
        ? velocity
        : 0;
  const lower =
    velocity > 0
      ? movingMin >= staticMin
        ? velocity
        : 0
      : movingMin > staticMin
        ? velocity
        : 0;
  return upper - lower;
}

function earliestHit(
  context: DragCollisionContext,
  position: PointMm,
  motion: PointMm,
): Hit | null {
  let best: Hit | null = null;
  const consider = (time: number, axis: Axis) => {
    const clamped = Math.max(0, time);
    if (clamped > 1) return;
    if (!best || clamped < best.time) best = { time: clamped, axis };
  };

  for (const entry of context.moving) {
    const moving = shift(entry.clearance, position);
    for (const obstacle of context.obstacles) {
      // Packages that already overlap (e.g. an imported plan) never trap the
      // drag: they may be pulled apart, but not pushed further together.
      if (overlapsStrictly(moving, obstacle)) {
        // Existing overlap: allow any motion that does not grow its area
        // (the measure the move command compares). Along one axis the
        // overlap length rises, plateaus, then falls, so the area's rate of
        // change only decreases during a straight move — if it does not grow
        // now, it cannot grow later in this step. Otherwise block the axis
        // that drives the growth and let the other one slide.
        const lengthX =
          Math.min(moving.maxX, obstacle.maxX) -
          Math.max(moving.minX, obstacle.minX);
        const lengthY =
          Math.min(moving.maxY, obstacle.maxY) -
          Math.max(moving.minY, obstacle.minY);
        const growthX =
          overlapGrowth(
            moving.minX,
            moving.maxX,
            obstacle.minX,
            obstacle.maxX,
            motion.x,
          ) * lengthY;
        const growthY =
          overlapGrowth(
            moving.minY,
            moving.maxY,
            obstacle.minY,
            obstacle.maxY,
            motion.y,
          ) * lengthX;
        if (growthX + growthY > 0) consider(0, growthX >= growthY ? "x" : "y");
        continue;
      }
      const x = axisWindow(
        moving.minX,
        moving.maxX,
        obstacle.minX,
        obstacle.maxX,
        motion.x,
      );
      const y = axisWindow(
        moving.minY,
        moving.maxY,
        obstacle.minY,
        obstacle.maxY,
        motion.y,
      );
      if (!x || !y) continue;
      const entryTime = Math.max(x.entry, y.entry);
      const exitTime = Math.min(x.exit, y.exit);
      if (entryTime >= exitTime || exitTime <= 0) continue;
      // Touching edges of a corner yield an empty window, so only real
      // penetration counts: require the entry before the exit with slack.
      if (exitTime - Math.max(0, entryTime) <= EPSILON_MM / magnitude(motion))
        continue;
      consider(entryTime, x.entry >= y.entry ? "x" : "y");
    }

    const envelope = context.envelope;
    if (!envelope) continue;
    const physical = shift(entry.physical, position);
    // A package already outside the envelope gets a negative time, which
    // clamps to 0: it may move back inside but never further out.
    if (motion.x > 0) consider((envelope.maxX - physical.maxX) / motion.x, "x");
    if (motion.x < 0) consider((envelope.minX - physical.minX) / motion.x, "x");
    if (motion.y > 0) consider((envelope.maxY - physical.maxY) / motion.y, "y");
    if (motion.y < 0) consider((envelope.minY - physical.minY) / motion.y, "y");
  }
  return best;
}

function magnitude(point: PointMm): number {
  return Math.hypot(point.x, point.y);
}

/**
 * Moves a dragged selection from `from` towards `to` (both deltas relative to
 * the original placement positions). The selection stops flush against other
 * packages (respecting package clearance) and the pallet envelope, and keeps
 * sliding along the contact edge with the remaining motion.
 */
export function resolveDragDelta(
  context: DragCollisionContext,
  from: PointMm,
  to: PointMm,
): PointMm {
  let position = { ...from };
  let motion = { x: to.x - from.x, y: to.y - from.y };
  for (let step = 0; step < MAX_SLIDE_STEPS; step += 1) {
    if (magnitude(motion) <= EPSILON_MM) break;
    const hit = earliestHit(context, position, motion);
    if (!hit) {
      position = { x: position.x + motion.x, y: position.y + motion.y };
      break;
    }
    position = {
      x: position.x + motion.x * hit.time,
      y: position.y + motion.y * hit.time,
    };
    const remaining = 1 - hit.time;
    motion = {
      x: hit.axis === "x" ? 0 : motion.x * remaining,
      y: hit.axis === "y" ? 0 : motion.y * remaining,
    };
  }
  return position;
}

/** Grid values (1 / `scale` mm) around `value`, `reach` steps either side. */
function gridNeighbours(value: number, scale: number, reach: number): number[] {
  const base = Math.round(value * scale);
  const values: number[] = [];
  for (let step = -reach; step <= reach; step += 1) {
    const candidate = (base + step) / scale;
    values.push(Object.is(candidate, -0) ? 0 : candidate);
  }
  return values;
}

function geometricViolations(
  context: DragCollisionContext,
  delta: PointMm,
): Map<string, number> {
  const measures = new Map<string, number>();
  context.moving.forEach((entry, index) => {
    const moving = shift(entry.clearance, delta);
    context.obstacles.forEach((obstacle, obstacleIndex) => {
      if (editorBoundsOverlap(moving, obstacle))
        measures.set(
          `overlap:${index}|${obstacleIndex}`,
          editorOverlapMeasure(moving, obstacle),
        );
    });
    const envelope = context.envelope;
    const physical = shift(entry.physical, delta);
    if (envelope && !editorBoundsContain(envelope, physical))
      measures.set(`out:${index}`, editorProtrusionMeasure(envelope, physical));
  });
  return measures;
}

/**
 * Picks the committed move for a resolved drag delta: the nearest point on the
 * drag grid (`gridMm`, default 0.1 mm; within two steps), else — on the
 * 0.1 mm grid only — on the 0.01 mm grid, the exact delta or a 1 nm nudge of
 * it. A candidate must not add or worsen a blocking geometry error (errors
 * the pattern already had may stay or shrink). Neighbours on both sides are tried because a contact
 * may be approached from either direction. Falls back to `fallback` (the last
 * committable position).
 */
export function roundDragDelta(
  context: DragCollisionContext,
  delta: PointMm,
  fallback: PointMm = { x: 0, y: 0 },
): PointMm {
  const violations =
    context.violations ?? ((d: PointMm) => geometricViolations(context, d));
  const baseline = violations({ x: 0, y: 0 });
  const acceptable = (candidate: PointMm) =>
    !editorViolationsWorsen(baseline, violations(candidate));
  const distance = (candidate: PointMm) =>
    Math.hypot(candidate.x - delta.x, candidate.y - delta.y);
  const grid = (scale: number, reach: number) =>
    gridNeighbours(delta.x, scale, reach).flatMap((x) =>
      gridNeighbours(delta.y, scale, reach).map((y) => ({ x, y })),
    );
  const byDistance = (candidates: PointMm[]) =>
    candidates.sort(
      (left, right) =>
        distance(left) - distance(right) ||
        Math.abs(left.x) +
          Math.abs(left.y) -
          (Math.abs(right.x) + Math.abs(right.y)) ||
        left.x - right.x ||
        left.y - right.y,
    );
  const gridScale = Math.round(1 / (context.gridMm ?? 0.1));
  // Drag grid first. On the 0.1 mm grid, tight gaps may need 0.01 mm, and
  // the exact delta or 1 nm nudges absorb float error at a contact off both
  // grids. A whole-millimetre grid (imported .rob plans) is strict: off-grid
  // positions could not be stored, so the last valid grid position is kept.
  const nudges = [0, -NUDGE_MM, NUDGE_MM];
  const candidates = [
    ...byDistance(grid(gridScale, 2)),
    ...(gridScale <= 1
      ? []
      : [
          ...byDistance(grid(100, 10)),
          ...nudges.flatMap((x) =>
            nudges.map((y) => ({ x: delta.x + x, y: delta.y + y })),
          ),
        ]),
  ];
  return candidates.find(acceptable) ?? fallback;
}
