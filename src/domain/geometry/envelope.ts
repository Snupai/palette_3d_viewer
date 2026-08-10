import type {
  PointMm,
  RectangleBoundsMm,
  RectangleSizeMm,
  SignedAxisAllowanceMm,
  SignedCenteredEnvelopeDeltaMm,
  SignedSideAllowanceMm,
} from "~/domain/geometry/types";

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be finite.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function positive(value: number, field: string): number {
  const normalized = finite(value, field);
  if (normalized <= 0) throw new Error(`${field} must be positive.`);
  return normalized;
}

export function assertRectangleBounds(
  bounds: RectangleBoundsMm,
  field = "bounds",
): RectangleBoundsMm {
  const normalized = {
    minX: finite(bounds.minX, `${field}.minX`),
    minY: finite(bounds.minY, `${field}.minY`),
    maxX: finite(bounds.maxX, `${field}.maxX`),
    maxY: finite(bounds.maxY, `${field}.maxY`),
  };
  if (normalized.maxX <= normalized.minX) {
    throw new Error(`${field}.maxX must be greater than ${field}.minX.`);
  }
  if (normalized.maxY <= normalized.minY) {
    throw new Error(`${field}.maxY must be greater than ${field}.minY.`);
  }
  return normalized;
}

export function rectangleBoundsLength(bounds: RectangleBoundsMm): number {
  return bounds.maxX - bounds.minX;
}

export function rectangleBoundsWidth(bounds: RectangleBoundsMm): number {
  return bounds.maxY - bounds.minY;
}

export function rectangleBoundsArea(bounds: RectangleBoundsMm): number {
  return rectangleBoundsLength(bounds) * rectangleBoundsWidth(bounds);
}

/**
 * Creates the exact usable load rectangle. X is pallet length and Y is pallet
 * width. Each signed side value is applied once to its named side.
 */
export function createEffectivePalletEnvelope(
  pallet: RectangleSizeMm,
  allowance: SignedSideAllowanceMm = {
    negativeX: 0,
    positiveX: 0,
    negativeY: 0,
    positiveY: 0,
  },
  origin: PointMm = { x: 0, y: 0 },
): RectangleBoundsMm {
  const length = positive(pallet.length, "pallet.length");
  const width = positive(pallet.width, "pallet.width");
  const x = finite(origin.x, "origin.x");
  const y = finite(origin.y, "origin.y");
  const negativeX = finite(allowance.negativeX, "allowance.negativeX");
  const positiveX = finite(allowance.positiveX, "allowance.positiveX");
  const negativeY = finite(allowance.negativeY, "allowance.negativeY");
  const positiveY = finite(allowance.positiveY, "allowance.positiveY");

  return assertRectangleBounds(
    {
      minX: x - negativeX,
      minY: y - negativeY,
      maxX: x + length + positiveX,
      maxY: y + width + positiveY,
    },
    "effectivePalletEnvelope",
  );
}

/** Converts one signed per-axis value per side into explicit side allowances. */
export function symmetricSideAllowance(
  allowancePerSide: SignedAxisAllowanceMm,
): SignedSideAllowanceMm {
  const length = finite(allowancePerSide.length, "allowancePerSide.length");
  const width = finite(allowancePerSide.width, "allowancePerSide.width");
  return {
    negativeX: length,
    positiveX: length,
    negativeY: width,
    positiveY: width,
  };
}

/**
 * Applies a signed change to the total usable dimensions while preserving the
 * pallet center. This is useful for sources that report total underhang rather
 * than a value per side.
 */
export function createCenteredEffectivePalletEnvelope(
  pallet: RectangleSizeMm,
  totalDelta: SignedCenteredEnvelopeDeltaMm,
  origin: PointMm = { x: 0, y: 0 },
): RectangleBoundsMm {
  const lengthDelta = finite(totalDelta.length, "totalDelta.length");
  const widthDelta = finite(totalDelta.width, "totalDelta.width");
  return createEffectivePalletEnvelope(
    pallet,
    {
      negativeX: lengthDelta / 2,
      positiveX: lengthDelta / 2,
      negativeY: widthDelta / 2,
      positiveY: widthDelta / 2,
    },
    origin,
  );
}

export function insetRectangleBounds(
  boundsInput: RectangleBoundsMm,
  insetMm: number,
): RectangleBoundsMm {
  const bounds = assertRectangleBounds(boundsInput);
  const inset = finite(insetMm, "insetMm");
  return assertRectangleBounds(
    {
      minX: bounds.minX + inset,
      minY: bounds.minY + inset,
      maxX: bounds.maxX - inset,
      maxY: bounds.maxY - inset,
    },
    "insetBounds",
  );
}

export function translateRectangleBounds(
  bounds: RectangleBoundsMm,
  offset: PointMm,
): RectangleBoundsMm {
  const x = finite(offset.x, "offset.x");
  const y = finite(offset.y, "offset.y");
  return {
    minX: bounds.minX + x,
    minY: bounds.minY + y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
  };
}
