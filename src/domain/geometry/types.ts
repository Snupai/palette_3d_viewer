import type { Rotation } from "~/domain/palletTypes";

/** X follows pallet/package length; Y follows pallet/package width. */
export type PointMm = {
  x: number;
  y: number;
};

export type RectangleSizeMm = {
  length: number;
  width: number;
};

export type RectangleBoundsMm = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type PlacementGeometry = {
  positionMm: PointMm;
  rotation: Rotation;
};

/**
 * Signed allowance on each pallet side. Positive values permit overhang and
 * negative values require underhang on that side.
 */
export type SignedSideAllowanceMm = {
  negativeX: number;
  positiveX: number;
  negativeY: number;
  positiveY: number;
};

export type SignedAxisAllowanceMm = {
  length: number;
  width: number;
};

/** Signed change to the total usable length/width, distributed around center. */
export type SignedCenteredEnvelopeDeltaMm = SignedAxisAllowanceMm;

export const ORTHOGONAL_ROTATIONS = [
  0, 90, 180, 270,
] as const satisfies readonly Rotation[];
