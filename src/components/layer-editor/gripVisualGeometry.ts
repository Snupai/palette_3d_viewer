import type { Corner, Side } from "~/domain/palletTypes";

export type BlueLineKind = Side | Corner | null;

export type SvgFootprintBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type GripDeltaArrowGeometry = {
  centerX: number;
  centerY: number;
  endX: number;
  endY: number;
  labelX: number;
  labelY: number;
};

export function blueLinePath(
  blueLine: BlueLineKind,
  x: number,
  y: number,
  width: number,
  length: number,
): string | null {
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y - length / 2;
  const bottom = y + length / 2;
  const cornerSize = Math.min(width, length) * 0.22;

  switch (blueLine) {
    case "top":
      return `M ${left} ${top} L ${right} ${top}`;
    case "right":
      return `M ${right} ${top} L ${right} ${bottom}`;
    case "bottom":
      return `M ${left} ${bottom} L ${right} ${bottom}`;
    case "left":
      return `M ${left} ${top} L ${left} ${bottom}`;
    case "top_right":
      return `M ${right - cornerSize} ${top} L ${right} ${top} L ${right} ${top + cornerSize}`;
    case "bottom_right":
      return `M ${right - cornerSize} ${bottom} L ${right} ${bottom} L ${right} ${bottom - cornerSize}`;
    case "bottom_left":
      return `M ${left + cornerSize} ${bottom} L ${left} ${bottom} L ${left} ${bottom - cornerSize}`;
    case "top_left":
      return `M ${left + cornerSize} ${top} L ${left} ${top} L ${left} ${top + cornerSize}`;
    default:
      return null;
  }
}

export function gripDeltaArrow(
  center: { x: number; y: number },
  delta: { dx: number; dy: number },
  footprints: readonly SvgFootprintBounds[],
): GripDeltaArrowGeometry | null {
  if ((delta.dx === 0 && delta.dy === 0) || footprints.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const footprint of footprints) {
    left = Math.min(left, footprint.left);
    right = Math.max(right, footprint.right);
    top = Math.min(top, footprint.top);
    bottom = Math.max(bottom, footprint.bottom);
  }

  const vectorX = delta.dx;
  const vectorY = -delta.dy;
  const vectorLength = Math.hypot(vectorX, vectorY);
  const unitX = vectorX / vectorLength;
  const unitY = vectorY / vectorLength;
  const distanceX =
    unitX === 0
      ? Number.POSITIVE_INFINITY
      : unitX > 0
        ? (right - center.x) / unitX
        : (center.x - left) / -unitX;
  const distanceY =
    unitY === 0
      ? Number.POSITIVE_INFINITY
      : unitY > 0
        ? (bottom - center.y) / unitY
        : (center.y - top) / -unitY;
  const boundaryDistance = Math.min(distanceX, distanceY);
  const arrowDistance = Math.max(
    16,
    boundaryDistance - Math.min(12, boundaryDistance * 0.2),
  );
  const labelDistance = arrowDistance * 0.55;

  return {
    centerX: center.x,
    centerY: center.y,
    endX: center.x + unitX * arrowDistance,
    endY: center.y + unitY * arrowDistance,
    labelX: center.x + unitX * labelDistance - unitY * 16,
    labelY: center.y + unitY * labelDistance + unitX * 16,
  };
}
