/**
 * Place approach ("Vorposition") encoded by the last two `.rob` coordinate
 * fields (field 8 = dx, field 9 = dy, each −1, 0 or 1).
 *
 * The robot first moves to the pre-position and then slides diagonally down
 * into the final place position:
 *
 * - pre-position XY = final XY + (dx, dy) · {@link PLACE_APPROACH_OFFSET_MM},
 *   in pallet axes (the same axes as x/y of the `.rob` line). The direction
 *   does not rotate with the place rotation.
 * - pre-position Z = final place Z + package height +
 *   {@link PLACE_APPROACH_CLEARANCE_MM}, so the carried package's bottom face
 *   clears the packages already placed in the same layer.
 * - `0 0` means a purely vertical place without a side offset.
 *
 * `dx = 1` puts the pre-position in +X, so the package is pushed in −X
 * against its already placed neighbours.
 */

/**
 * Lateral distance between pre-position and final place position. One shared
 * value for the editor's approach sweep and the robot route/simulation.
 * 80 mm suits the simulation; the real cell usually uses less.
 */
export const PLACE_APPROACH_OFFSET_MM = 80;

/**
 * Provisional safety clearance above the package height for the pre-position.
 * Not yet confirmed against the robot program.
 */
export const PLACE_APPROACH_CLEARANCE_MM = 10;

export type PlaceApproachDirection = {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
};

export type PlaceApproachSettings = {
  offsetMm: number;
  clearanceMm: number;
};

export const DEFAULT_PLACE_APPROACH_SETTINGS: PlaceApproachSettings = {
  offsetMm: PLACE_APPROACH_OFFSET_MM,
  clearanceMm: PLACE_APPROACH_CLEARANCE_MM,
};

function unitSign(value: number): -1 | 0 | 1 {
  if (!Number.isFinite(value) || value === 0) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * Normalizes raw field 8/9 values to a direction. Values outside {−1, 0, 1}
 * keep only their sign; the raw values stay untouched for export.
 */
export function placeApproachDirection(
  dx: number,
  dy: number,
): PlaceApproachDirection {
  return { dx: unitSign(dx), dy: unitSign(dy) };
}

export function isVerticalPlaceApproach(
  direction: PlaceApproachDirection,
): boolean {
  return direction.dx === 0 && direction.dy === 0;
}

/**
 * Lateral pre-position offset in pallet axes, or `null` for a vertical place.
 */
export function placeApproachOffsetMm(
  direction: PlaceApproachDirection,
  offsetMm: number = PLACE_APPROACH_OFFSET_MM,
): { x: number; y: number } | null {
  if (isVerticalPlaceApproach(direction)) return null;
  return { x: direction.dx * offsetMm, y: direction.dy * offsetMm };
}

/** Height of the pre-position above the final place Z. */
export function placeApproachRiseMm(
  packageHeightMm: number,
  clearanceMm: number = PLACE_APPROACH_CLEARANCE_MM,
): number {
  return packageHeightMm + clearanceMm;
}

/**
 * Pre-position for a final place position given in pallet axes. Returns
 * `null` for `0 0` (vertical place).
 */
export function placeApproachPosition(
  finalMm: { x: number; y: number; z: number },
  direction: PlaceApproachDirection,
  packageHeightMm: number,
  settings: PlaceApproachSettings = DEFAULT_PLACE_APPROACH_SETTINGS,
): { x: number; y: number; z: number } | null {
  const offset = placeApproachOffsetMm(direction, settings.offsetMm);
  if (!offset) return null;
  return {
    x: finalMm.x + offset.x,
    y: finalMm.y + offset.y,
    z: finalMm.z + placeApproachRiseMm(packageHeightMm, settings.clearanceMm),
  };
}
