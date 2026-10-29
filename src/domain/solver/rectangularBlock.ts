import {
  boundingRectangleForPlacements,
  placementRectangleBounds,
  rectangleBoundsCenter,
  rectangleBoundsContain,
} from "~/domain/geometry";
import type { RectangleBoundsMm } from "~/domain/geometry";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { placementsUseMixedPackageOrientations } from "~/domain/solver/orientationPolicy";
import type {
  GeneratedPlacement,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

export const MAX_DISTRIBUTED_SPACING_MM = 25;
export const MAX_DISTRIBUTED_SPACING_RATIO = 0.15;

export function maximumDistributedExtraGapMm(itemSpanMm: number): number {
  return Math.min(
    MAX_DISTRIBUTED_SPACING_MM,
    itemSpanMm * MAX_DISTRIBUTED_SPACING_RATIO,
  );
}

export type RectangularBlockAssessment =
  | { valid: true }
  | {
      valid: false;
      reason: "target-bounds" | "uncovered-gap";
      message: string;
    };

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SOLVER_GEOMETRY_EPSILON_MM;
}

function reachesRequestedBounds(
  occupied: RectangleBoundsMm,
  target: RectangleBoundsMm,
): boolean {
  return (
    approximatelyEqual(occupied.minX, target.minX) &&
    approximatelyEqual(occupied.minY, target.minY) &&
    approximatelyEqual(occupied.maxX, target.maxX) &&
    approximatelyEqual(occupied.maxY, target.maxY)
  );
}

type CompactBand = {
  crossMinimum: number;
  crossMaximum: number;
  rectangles: RectangleBoundsMm[];
};

function compactBands(
  rectangles: readonly RectangleBoundsMm[],
  horizontal: boolean,
): CompactBand[] {
  const crossMinimum = (bounds: RectangleBoundsMm) =>
    horizontal ? bounds.minY : bounds.minX;
  const crossMaximum = (bounds: RectangleBoundsMm) =>
    horizontal ? bounds.maxY : bounds.maxX;
  const inlineMinimum = (bounds: RectangleBoundsMm) =>
    horizontal ? bounds.minX : bounds.minY;
  const sorted = [...rectangles].sort(
    (left, right) =>
      crossMinimum(left) - crossMinimum(right) ||
      crossMaximum(left) - crossMaximum(right) ||
      inlineMinimum(left) - inlineMinimum(right),
  );
  const bands: CompactBand[] = [];
  for (const rectangle of sorted) {
    const minimum = crossMinimum(rectangle);
    const maximum = crossMaximum(rectangle);
    const previous = bands.at(-1);
    if (
      previous &&
      approximatelyEqual(previous.crossMinimum, minimum) &&
      approximatelyEqual(previous.crossMaximum, maximum)
    ) {
      previous.rectangles.push(rectangle);
      continue;
    }
    bands.push({
      crossMinimum: minimum,
      crossMaximum: maximum,
      rectangles: [rectangle],
    });
  }
  return bands;
}

function compactBandsFormTarget(
  target: RectangleBoundsMm,
  rectangles: readonly RectangleBoundsMm[],
  clearanceMm: number,
  mixedOrientations: boolean,
  horizontal: boolean,
): boolean {
  const targetInlineMinimum = horizontal ? target.minX : target.minY;
  const targetInlineMaximum = horizontal ? target.maxX : target.maxY;
  const targetCrossMinimum = horizontal ? target.minY : target.minX;
  const targetCrossMaximum = horizontal ? target.maxY : target.maxX;
  const inlineMinimum = (bounds: RectangleBoundsMm) =>
    horizontal ? bounds.minX : bounds.minY;
  const inlineMaximum = (bounds: RectangleBoundsMm) =>
    horizontal ? bounds.maxX : bounds.maxY;
  const bands = compactBands(rectangles, horizontal);
  if (bands.length === 0) return false;
  if (
    !approximatelyEqual(bands[0]!.crossMinimum, targetCrossMinimum) ||
    !approximatelyEqual(bands.at(-1)!.crossMaximum, targetCrossMaximum)
  ) {
    return false;
  }
  for (let index = 1; index < bands.length; index += 1) {
    const previous = bands[index - 1]!;
    const current = bands[index]!;
    if (
      !approximatelyEqual(
        current.crossMinimum - previous.crossMaximum,
        clearanceMm,
      )
    ) {
      return false;
    }
  }

  const targetInlineSpan = targetInlineMaximum - targetInlineMinimum;
  const naturalSpans = bands.map((band) => {
    const ordered = [...band.rectangles].sort(
      (left, right) => inlineMinimum(left) - inlineMinimum(right),
    );
    return (
      ordered.reduce(
        (sum, rectangle) =>
          sum + inlineMaximum(rectangle) - inlineMinimum(rectangle),
        0,
      ) +
      Math.max(0, ordered.length - 1) * clearanceMm
    );
  });
  const smallestSharedSpan = Math.max(...naturalSpans);
  if (!approximatelyEqual(targetInlineSpan, smallestSharedSpan)) return false;

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
    const ordered = [...bands[bandIndex]!.rectangles].sort(
      (left, right) => inlineMinimum(left) - inlineMinimum(right),
    );
    if (
      !approximatelyEqual(inlineMinimum(ordered[0]!), targetInlineMinimum) ||
      !approximatelyEqual(inlineMaximum(ordered.at(-1)!), targetInlineMaximum)
    ) {
      return false;
    }
    const gapCount = ordered.length - 1;
    const additionalGap =
      gapCount === 0
        ? targetInlineSpan - naturalSpans[bandIndex]!
        : (targetInlineSpan - naturalSpans[bandIndex]!) / gapCount;
    if (additionalGap < -SOLVER_GEOMETRY_EPSILON_MM) return false;
    if (!mixedOrientations && additionalGap > SOLVER_GEOMETRY_EPSILON_MM) {
      return false;
    }
    if (gapCount === 0) {
      if (Math.abs(additionalGap) > SOLVER_GEOMETRY_EPSILON_MM) return false;
      continue;
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]!;
      const right = ordered[index]!;
      const leftSpan = inlineMaximum(left) - inlineMinimum(left);
      const rightSpan = inlineMaximum(right) - inlineMinimum(right);
      const allowedAdditionalGap =
        (maximumDistributedExtraGapMm(leftSpan) +
          maximumDistributedExtraGapMm(rightSpan)) /
        2;
      const actualGap = inlineMinimum(right) - inlineMaximum(left);
      if (
        additionalGap > allowedAdditionalGap + SOLVER_GEOMETRY_EPSILON_MM ||
        !approximatelyEqual(actualGap, clearanceMm + additionalGap)
      ) {
        return false;
      }
    }
  }
  return true;
}

function compactRectanglesFormTarget(
  target: RectangleBoundsMm,
  rectangles: readonly RectangleBoundsMm[],
  clearanceMm: number,
  mixedOrientations: boolean,
): boolean {
  return (
    compactBandsFormTarget(
      target,
      rectangles,
      clearanceMm,
      mixedOrientations,
      true,
    ) ||
    compactBandsFormTarget(
      target,
      rectangles,
      clearanceMm,
      mixedOrientations,
      false,
    )
  );
}

function uniqueSortedCoordinates(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const unique: number[] = [];
  for (const value of sorted) {
    const previous = unique.at(-1);
    if (
      previous === undefined ||
      Math.abs(value - previous) > SOLVER_GEOMETRY_EPSILON_MM
    ) {
      unique.push(value);
    }
  }
  return unique;
}

function expandedPhysicalBounds(
  input: NormalizedLayerSolverInput,
  placement: GeneratedPlacement,
  target: RectangleBoundsMm,
): RectangleBoundsMm {
  const physical = placementRectangleBounds(
    placement,
    input.package.dimensionsMm,
  );
  const width = physical.maxX - physical.minX;
  const height = physical.maxY - physical.minY;
  const expandX =
    (input.package.clearanceMm + maximumDistributedExtraGapMm(width)) / 2;
  const expandY =
    (input.package.clearanceMm + maximumDistributedExtraGapMm(height)) / 2;
  return {
    minX: Math.max(target.minX, physical.minX - expandX),
    minY: Math.max(target.minY, physical.minY - expandY),
    maxX: Math.min(target.maxX, physical.maxX + expandX),
    maxY: Math.min(target.maxY, physical.maxY + expandY),
  };
}

function expandedRectanglesCoverTarget(
  target: RectangleBoundsMm,
  rectangles: readonly RectangleBoundsMm[],
): boolean {
  const yCoordinates = uniqueSortedCoordinates([
    target.minY,
    target.maxY,
    ...rectangles.flatMap(({ minY, maxY }) => [minY, maxY]),
  ]);

  for (let index = 0; index < yCoordinates.length - 1; index += 1) {
    const minimumY = yCoordinates[index]!;
    const maximumY = yCoordinates[index + 1]!;
    if (maximumY - minimumY <= SOLVER_GEOMETRY_EPSILON_MM) continue;
    const sampleY = minimumY + (maximumY - minimumY) / 2;
    const intervals = rectangles
      .filter(
        ({ minY, maxY }) =>
          sampleY >= minY - SOLVER_GEOMETRY_EPSILON_MM &&
          sampleY <= maxY + SOLVER_GEOMETRY_EPSILON_MM,
      )
      .map(({ minX, maxX }) => ({ minX, maxX }))
      .sort((left, right) => left.minX - right.minX || left.maxX - right.maxX);
    if (intervals.length === 0) return false;

    let coveredUntil = target.minX;
    for (const interval of intervals) {
      if (interval.maxX <= coveredUntil + SOLVER_GEOMETRY_EPSILON_MM) {
        continue;
      }
      if (interval.minX > coveredUntil + SOLVER_GEOMETRY_EPSILON_MM) {
        return false;
      }
      coveredUntil = Math.max(coveredUntil, interval.maxX);
      if (coveredUntil >= target.maxX - SOLVER_GEOMETRY_EPSILON_MM) break;
    }
    if (coveredUntil < target.maxX - SOLVER_GEOMETRY_EPSILON_MM) {
      return false;
    }
  }
  return true;
}

export function assessRectangularBlockPlacements(
  input: NormalizedLayerSolverInput,
  placements: readonly GeneratedPlacement[],
): RectangularBlockAssessment {
  const occupied = boundingRectangleForPlacements(
    placements,
    input.package.dimensionsMm,
  );
  if (!occupied) {
    return {
      valid: false,
      reason: "target-bounds",
      message:
        "The packages do not form all four corners of the requested block footprint.",
    };
  }

  const compactCentered =
    input.constraints.rectangularBlockFootprintPolicy === "compact-centered";
  const target = compactCentered ? occupied : input.generationBoundsMm;
  const occupiedCenter = rectangleBoundsCenter(occupied);
  const generationCenter = rectangleBoundsCenter(input.generationBoundsMm);
  if (
    (!compactCentered && !reachesRequestedBounds(occupied, target)) ||
    (compactCentered &&
      (!rectangleBoundsContain(
        input.generationBoundsMm,
        occupied,
        SOLVER_GEOMETRY_EPSILON_MM,
      ) ||
        !approximatelyEqual(occupiedCenter.x, generationCenter.x) ||
        !approximatelyEqual(occupiedCenter.y, generationCenter.y)))
  ) {
    return {
      valid: false,
      reason: "target-bounds",
      message: compactCentered
        ? "The compact package block must fit inside and remain centered in the requested generation envelope."
        : "The packages do not form all four corners of the requested block footprint.",
    };
  }

  const physicalRectangles = placements.map((placement) =>
    placementRectangleBounds(placement, input.package.dimensionsMm),
  );
  const coversTarget = compactCentered
    ? compactRectanglesFormTarget(
        target,
        physicalRectangles,
        input.package.clearanceMm,
        placementsUseMixedPackageOrientations(placements),
      ) ||
      (input.package.clearanceMm <= SOLVER_GEOMETRY_EPSILON_MM &&
        expandedRectanglesCoverTarget(target, physicalRectangles))
    : expandedRectanglesCoverTarget(
        target,
        placements.map((placement) =>
          expandedPhysicalBounds(input, placement, target),
        ),
      );
  if (!coversTarget) {
    return {
      valid: false,
      reason: "uncovered-gap",
      message:
        "The requested block contains a missing corner, hole, or package gap that is too large to distribute cleanly.",
    };
  }
  return { valid: true };
}
