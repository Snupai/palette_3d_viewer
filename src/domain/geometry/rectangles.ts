import {
  assertRectangleBounds,
  rectangleBoundsLength,
  rectangleBoundsWidth,
} from "~/domain/geometry/envelope";
import type {
  PlacementGeometry,
  PointMm,
  RectangleBoundsMm,
  RectangleSizeMm,
} from "~/domain/geometry/types";
import type { Rotation } from "~/domain/palletTypes";

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

function nonNegative(value: number, field: string): number {
  const normalized = finite(value, field);
  if (normalized < 0) throw new Error(`${field} must not be negative.`);
  return normalized;
}

function positive(value: number, field: string): number {
  const normalized = finite(value, field);
  if (normalized <= 0) throw new Error(`${field} must be positive.`);
  return normalized;
}

export function rectangleSizeForRotation(
  packageSize: RectangleSizeMm,
  rotation: Rotation,
): RectangleSizeMm {
  const length = positive(packageSize.length, "packageSize.length");
  const width = positive(packageSize.width, "packageSize.width");
  if (rotation === 0 || rotation === 180) return { length, width };
  if (rotation === 90 || rotation === 270) {
    return { length: width, width: length };
  }
  throw new Error("rotation must be one of 0, 90, 180, or 270.");
}

export function placementRectangleBounds(
  placement: PlacementGeometry,
  packageSize: RectangleSizeMm,
): RectangleBoundsMm {
  const x = finite(placement.positionMm.x, "placement.positionMm.x");
  const y = finite(placement.positionMm.y, "placement.positionMm.y");
  const footprint = rectangleSizeForRotation(packageSize, placement.rotation);
  return {
    minX: x - footprint.length / 2,
    minY: y - footprint.width / 2,
    maxX: x + footprint.length / 2,
    maxY: y + footprint.width / 2,
  };
}

/**
 * Inflates a package by half the requested inter-package clearance on every
 * side. Two such bounds may touch but must not overlap.
 */
export function placementClearanceBounds(
  placement: PlacementGeometry,
  packageSize: RectangleSizeMm,
  clearanceMm: number,
): RectangleBoundsMm {
  const clearance = nonNegative(clearanceMm, "clearanceMm");
  return inflateRectangleBounds(
    placementRectangleBounds(placement, packageSize),
    clearance / 2,
  );
}

export function inflateRectangleBounds(
  boundsInput: RectangleBoundsMm,
  amountMm: number,
): RectangleBoundsMm {
  const bounds = assertRectangleBounds(boundsInput);
  const amount = nonNegative(amountMm, "amountMm");
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

/** Strict overlap: touching edges are legal. */
export function rectangleBoundsOverlap(
  leftInput: RectangleBoundsMm,
  rightInput: RectangleBoundsMm,
  clearanceMm = 0,
): boolean {
  const clearance = nonNegative(clearanceMm, "clearanceMm");
  const left =
    clearance === 0
      ? assertRectangleBounds(leftInput, "left")
      : inflateRectangleBounds(leftInput, clearance / 2);
  const right =
    clearance === 0
      ? assertRectangleBounds(rightInput, "right")
      : inflateRectangleBounds(rightInput, clearance / 2);

  return (
    left.minX < right.maxX &&
    left.maxX > right.minX &&
    left.minY < right.maxY &&
    left.maxY > right.minY
  );
}

export function placementsOverlap(
  left: PlacementGeometry,
  right: PlacementGeometry,
  packageSize: RectangleSizeMm,
  clearanceMm = 0,
): boolean {
  return rectangleBoundsOverlap(
    placementRectangleBounds(left, packageSize),
    placementRectangleBounds(right, packageSize),
    clearanceMm,
  );
}

export function rectangleBoundsContain(
  containerInput: RectangleBoundsMm,
  childInput: RectangleBoundsMm,
  toleranceMm = 0,
): boolean {
  const container = assertRectangleBounds(containerInput, "container");
  const child = assertRectangleBounds(childInput, "child");
  const tolerance = nonNegative(toleranceMm, "toleranceMm");
  return (
    child.minX >= container.minX - tolerance &&
    child.minY >= container.minY - tolerance &&
    child.maxX <= container.maxX + tolerance &&
    child.maxY <= container.maxY + tolerance
  );
}

export function placementWithinBounds(
  placement: PlacementGeometry,
  packageSize: RectangleSizeMm,
  container: RectangleBoundsMm,
  toleranceMm = 0,
): boolean {
  return rectangleBoundsContain(
    container,
    placementRectangleBounds(placement, packageSize),
    toleranceMm,
  );
}

export function boundingRectangleForPlacements(
  placements: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
): RectangleBoundsMm | null {
  if (placements.length === 0) return null;
  const first = placementRectangleBounds(placements[0]!, packageSize);
  const bounds = { ...first };
  for (let index = 1; index < placements.length; index += 1) {
    const placementBounds = placementRectangleBounds(
      placements[index]!,
      packageSize,
    );
    bounds.minX = Math.min(bounds.minX, placementBounds.minX);
    bounds.minY = Math.min(bounds.minY, placementBounds.minY);
    bounds.maxX = Math.max(bounds.maxX, placementBounds.maxX);
    bounds.maxY = Math.max(bounds.maxY, placementBounds.maxY);
  }
  return bounds;
}

export function rectangleBoundsCenter(bounds: RectangleBoundsMm): PointMm {
  return {
    x: bounds.minX + rectangleBoundsLength(bounds) / 2,
    y: bounds.minY + rectangleBoundsWidth(bounds) / 2,
  };
}
