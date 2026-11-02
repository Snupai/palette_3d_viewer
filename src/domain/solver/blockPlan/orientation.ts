/**
 * Orientation codes of the block-plan Muster.
 *
 * `Orient` is a 1-based code: 1 = 0°, 2 = 90°, 3 = 180°, 4 = 270°.
 * A computed value of 5 wraps back to 1. `SubOrient` only distinguishes
 * 1 (package length along X) from 2 (length along Y).
 */

export type MusterOrient = 1 | 2 | 3 | 4;

/** 1 = package length runs along X, 2 = along Y. */
export type MusterSubOrient = 1 | 2;

export const ORIENT_ROTATION_DEGREES = [0, 90, 180, 270] as const;

/** Wraps any orient value into 1..4 (5 → 1, 0 → 4). */
export function wrapMusterOrient(value: number): MusterOrient {
  return (((((Math.trunc(value) - 1) % 4) + 4) % 4) + 1) as MusterOrient;
}

/** `Orient` byte to `.rob` rotation in degrees. */
export function musterOrientRotation(orient: MusterOrient): 0 | 90 | 180 | 270 {
  return ORIENT_ROTATION_DEGREES[wrapMusterOrient(orient) - 1]!;
}

/**
 * Displayed orient of a placed package:
 * `OrientBase + (Rotiert ? 1 : 0)`, with 5 wrapped to 1.
 */
export function displayMusterOrient(
  orientBase: MusterOrient,
  rotated: boolean,
): MusterOrient {
  return wrapMusterOrient(orientBase + (rotated ? 1 : 0));
}

/** Mirror-replication rotates the block orient byte with `3 − Orient` (1 ↔ 2). */
export function mirrorReplicationOrient(orient: MusterOrient): MusterOrient {
  return wrapMusterOrient(3 - orient);
}

export function swapMusterSubOrient(
  subOrient: MusterSubOrient,
): MusterSubOrient {
  return subOrient === 1 ? 2 : 1;
}

/**
 * SubOrient assignment when a block is added:
 *
 * - layerOrient 2: 1 when `dX > dY`, else 2
 * - layerOrient 1: 1 when `dX` equals the package length, else 2
 * - layerOrient 0: 1 when `dX` equals the package width, else 2
 * - other values leave the value untouched; a freshly appended block
 *   therefore defaults to 2.
 */
export function subOrientForBlock(
  layerOrient: number,
  dX: number,
  dY: number,
  packageLength: number,
  packageWidth: number,
  fallback: MusterSubOrient = 2,
): MusterSubOrient {
  if (layerOrient === 2) return dX > dY ? 1 : 2;
  if (layerOrient === 1) return dX === packageLength ? 1 : 2;
  if (layerOrient === 0) return dX === packageWidth ? 1 : 2;
  return fallback;
}
