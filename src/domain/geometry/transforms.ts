import {
  assertRectangleBounds,
  rectangleBoundsLength,
  rectangleBoundsWidth,
} from "~/domain/geometry/envelope";
import type {
  PlacementGeometry,
  PointMm,
  RectangleBoundsMm,
} from "~/domain/geometry/types";
import type { Rotation } from "~/domain/palletTypes";

export const LAYER_SYMMETRIES = [
  "identity",
  "rotate-90",
  "rotate-180",
  "rotate-270",
  "mirror-x",
  "mirror-y",
  "transpose-main",
  "transpose-anti",
] as const;

export type LayerSymmetry = (typeof LAYER_SYMMETRIES)[number];

function rotationFromDegrees(value: number): Rotation {
  const normalized = ((value % 360) + 360) % 360;
  if (
    normalized === 0 ||
    normalized === 90 ||
    normalized === 180 ||
    normalized === 270
  ) {
    return normalized;
  }
  throw new Error("The transformed rotation is not orthogonal.");
}

export function inverseLayerSymmetry(symmetry: LayerSymmetry): LayerSymmetry {
  if (symmetry === "rotate-90") return "rotate-270";
  if (symmetry === "rotate-270") return "rotate-90";
  return symmetry;
}

export function transformedEnvelopeBounds(
  sourceInput: RectangleBoundsMm,
  symmetry: LayerSymmetry,
): RectangleBoundsMm {
  const source = assertRectangleBounds(sourceInput);
  const length = rectangleBoundsLength(source);
  const width = rectangleBoundsWidth(source);
  const swapsAxes =
    symmetry === "rotate-90" ||
    symmetry === "rotate-270" ||
    symmetry === "transpose-main" ||
    symmetry === "transpose-anti";
  return {
    minX: source.minX,
    minY: source.minY,
    maxX: source.minX + (swapsAxes ? width : length),
    maxY: source.minY + (swapsAxes ? length : width),
  };
}

function transformLocalPoint(
  point: PointMm,
  length: number,
  width: number,
  symmetry: LayerSymmetry,
): PointMm {
  switch (symmetry) {
    case "identity":
      return point;
    case "rotate-90":
      return { x: width - point.y, y: point.x };
    case "rotate-180":
      return { x: length - point.x, y: width - point.y };
    case "rotate-270":
      return { x: point.y, y: length - point.x };
    case "mirror-x":
      return { x: length - point.x, y: point.y };
    case "mirror-y":
      return { x: point.x, y: width - point.y };
    case "transpose-main":
      return { x: point.y, y: point.x };
    case "transpose-anti":
      return { x: width - point.y, y: length - point.x };
  }
}

function transformRotation(
  rotation: Rotation,
  symmetry: LayerSymmetry,
): Rotation {
  switch (symmetry) {
    case "identity":
      return rotation;
    case "rotate-90":
      return rotationFromDegrees(rotation + 90);
    case "rotate-180":
      return rotationFromDegrees(rotation + 180);
    case "rotate-270":
      return rotationFromDegrees(rotation + 270);
    case "mirror-x":
      return rotationFromDegrees(180 - rotation);
    case "mirror-y":
      return rotationFromDegrees(-rotation);
    case "transpose-main":
      return rotationFromDegrees(90 - rotation);
    case "transpose-anti":
      return rotationFromDegrees(270 - rotation);
  }
}

export function transformPlacement<Placement extends PlacementGeometry>(
  placement: Placement,
  sourceInput: RectangleBoundsMm,
  symmetry: LayerSymmetry,
): Placement {
  const source = assertRectangleBounds(sourceInput);
  const length = rectangleBoundsLength(source);
  const width = rectangleBoundsWidth(source);
  const localPoint = {
    x: placement.positionMm.x - source.minX,
    y: placement.positionMm.y - source.minY,
  };
  const transformedPoint = transformLocalPoint(
    localPoint,
    length,
    width,
    symmetry,
  );
  return {
    ...placement,
    positionMm: {
      x: source.minX + transformedPoint.x,
      y: source.minY + transformedPoint.y,
    },
    rotation: transformRotation(placement.rotation, symmetry),
  };
}

export function transformPlacements<Placement extends PlacementGeometry>(
  placements: readonly Placement[],
  source: RectangleBoundsMm,
  symmetry: LayerSymmetry,
): Placement[] {
  return placements.map((placement) =>
    transformPlacement(placement, source, symmetry),
  );
}

/** Symmetries whose transformed envelope has the same dimensions as the input. */
export function envelopePreservingSymmetries(
  boundsInput: RectangleBoundsMm,
  includeIdentity = true,
): LayerSymmetry[] {
  const bounds = assertRectangleBounds(boundsInput);
  const square =
    Math.abs(rectangleBoundsLength(bounds) - rectangleBoundsWidth(bounds)) <=
    Number.EPSILON *
      Math.max(1, rectangleBoundsLength(bounds), rectangleBoundsWidth(bounds));
  const symmetries: LayerSymmetry[] = square
    ? [...LAYER_SYMMETRIES]
    : ["identity", "rotate-180", "mirror-x", "mirror-y"];
  return includeIdentity
    ? symmetries
    : symmetries.filter((symmetry) => symmetry !== "identity");
}
