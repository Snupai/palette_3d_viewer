import type { PlacementGeometry } from "~/domain/geometry/types";

function normalizedCoordinate(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

export function comparePlacementGeometry(
  left: PlacementGeometry,
  right: PlacementGeometry,
): number {
  const leftY = normalizedCoordinate(left.positionMm.y, "left.positionMm.y");
  const rightY = normalizedCoordinate(right.positionMm.y, "right.positionMm.y");
  if (leftY !== rightY) return leftY - rightY;

  const leftX = normalizedCoordinate(left.positionMm.x, "left.positionMm.x");
  const rightX = normalizedCoordinate(right.positionMm.x, "right.positionMm.x");
  if (leftX !== rightX) return leftX - rightX;
  return left.rotation - right.rotation;
}

/**
 * Canonical row-major order. Array order and transient fields do not participate
 * in the comparison, while exact center coordinates and orientation do.
 */
export function canonicalizePlacementOrder<Placement extends PlacementGeometry>(
  placements: readonly Placement[],
): Placement[] {
  return placements
    .map((placement) => ({
      ...placement,
      positionMm: {
        x: normalizedCoordinate(
          placement.positionMm.x,
          "placement.positionMm.x",
        ),
        y: normalizedCoordinate(
          placement.positionMm.y,
          "placement.positionMm.y",
        ),
      },
    }))
    .sort(comparePlacementGeometry);
}

/** Exact geometry-only key for deterministic intermediate ordering. */
export function canonicalPlacementGeometryKey(
  placements: readonly PlacementGeometry[],
): string {
  return JSON.stringify(
    canonicalizePlacementOrder(placements).map((placement) => ({
      x: placement.positionMm.x,
      y: placement.positionMm.y,
      rotation: placement.rotation,
    })),
  );
}
