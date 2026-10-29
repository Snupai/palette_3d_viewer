import type {
  PalletSpec,
  PalletStation,
  PalletizingDirection,
} from "~/domain/project/projectSchema";
import type {
  HorizontalBoundsMm,
  HorizontalEnvelopeMm,
  RobotPose,
  Vector2Mm,
  Vector3Mm,
} from "~/domain/robotics/types";

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Object.is(value, -0) ? 0 : value;
}

export function normalizeYawDeg(yawDeg: number): number {
  const yaw = finite(yawDeg, "yawDeg");
  const normalized = ((yaw % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function shortestYawDeltaDeg(fromDeg: number, toDeg: number): number {
  const from = normalizeYawDeg(fromDeg);
  const to = normalizeYawDeg(toDeg);
  const delta = ((to - from + 540) % 360) - 180;
  return Object.is(delta, -0) ? 0 : delta;
}

export function interpolateYawDeg(
  fromDeg: number,
  toDeg: number,
  progress: number,
): number {
  const clamped = Math.max(0, Math.min(1, finite(progress, "progress")));
  return normalizeYawDeg(
    normalizeYawDeg(fromDeg) + shortestYawDeltaDeg(fromDeg, toDeg) * clamped,
  );
}

export function rotateVector2(vector: Vector2Mm, yawDeg: number): Vector2Mm {
  const radians = (normalizeYawDeg(yawDeg) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = finite(vector.x, "vector.x");
  const y = finite(vector.y, "vector.y");
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
}

export function directionSigns(direction: PalletizingDirection): {
  x: 1 | -1;
  y: 1 | -1;
} {
  return {
    x: direction.startsWith("x-positive") ? 1 : -1,
    y: direction.endsWith("y-positive") ? 1 : -1,
  };
}

export function transformYawForDirection(
  yawDeg: number,
  direction: PalletizingDirection,
): number {
  const signs = directionSigns(direction);
  const heading = rotateVector2({ x: 1, y: 0 }, yawDeg);
  return normalizeYawDeg(
    (Math.atan2(heading.y * signs.y, heading.x * signs.x) * 180) / Math.PI,
  );
}

export function palletOriginAnchorMm(
  pallet: Pick<PalletSpec, "dimensionsMm">,
  station: Pick<PalletStation, "palletOrigin">,
): Vector2Mm {
  const x =
    station.palletOrigin.x === "left"
      ? 0
      : station.palletOrigin.x === "center"
        ? pallet.dimensionsMm.length / 2
        : pallet.dimensionsMm.length;
  const y =
    station.palletOrigin.y === "bottom"
      ? 0
      : station.palletOrigin.y === "center"
        ? pallet.dimensionsMm.width / 2
        : pallet.dimensionsMm.width;
  return { x, y };
}

/**
 * Converts the solver/project pallet frame (X=length, Y=width, lower-left origin)
 * into the selected station frame. The station origin is the configured pallet
 * anchor and the direction controls axis signs explicitly.
 */
export function palletPointToStation(
  point: Vector3Mm,
  pallet: Pick<PalletSpec, "dimensionsMm">,
  station: Pick<PalletStation, "palletOrigin">,
  direction: PalletizingDirection,
): Vector3Mm {
  const anchor = palletOriginAnchorMm(pallet, station);
  const signs = directionSigns(direction);
  return {
    x: (finite(point.x, "point.x") - anchor.x) * signs.x,
    y: (finite(point.y, "point.y") - anchor.y) * signs.y,
    z: finite(point.z, "point.z"),
  };
}

export function stationPointToPallet(
  point: Vector3Mm,
  pallet: Pick<PalletSpec, "dimensionsMm">,
  station: Pick<PalletStation, "palletOrigin">,
  direction: PalletizingDirection,
): Vector3Mm {
  const anchor = palletOriginAnchorMm(pallet, station);
  const signs = directionSigns(direction);
  return {
    x: finite(point.x, "point.x") * signs.x + anchor.x,
    y: finite(point.y, "point.y") * signs.y + anchor.y,
    z: finite(point.z, "point.z"),
  };
}

/**
 * `tcpMm` is defined as the vector from the robot TCP to the package grip point.
 * Therefore the robot TCP is the target grip point minus the rotated vector.
 */
export function tcpPoseFromGripPoint(
  gripPointMm: Vector3Mm,
  yawDeg: number,
  tcpMm: Vector3Mm,
  frame: RobotPose["frame"] = "station",
): RobotPose {
  const horizontalOffset = rotateVector2(tcpMm, yawDeg);
  return {
    positionMm: {
      x: finite(gripPointMm.x, "gripPointMm.x") - horizontalOffset.x,
      y: finite(gripPointMm.y, "gripPointMm.y") - horizontalOffset.y,
      z: finite(gripPointMm.z, "gripPointMm.z") - finite(tcpMm.z, "tcpMm.z"),
    },
    yawDeg: normalizeYawDeg(yawDeg),
    frame,
  };
}

export function horizontalEnvelopeBounds(
  pose: Pick<RobotPose, "positionMm" | "yawDeg">,
  envelope: HorizontalEnvelopeMm,
): HorizontalBoundsMm {
  const corners = [
    { x: -envelope.negativeX, y: -envelope.negativeY },
    { x: -envelope.negativeX, y: envelope.positiveY },
    { x: envelope.positiveX, y: -envelope.negativeY },
    { x: envelope.positiveX, y: envelope.positiveY },
  ].map((corner) => {
    const rotated = rotateVector2(corner, pose.yawDeg);
    return {
      x: pose.positionMm.x + rotated.x,
      y: pose.positionMm.y + rotated.y,
    };
  });

  return {
    minX: Math.min(...corners.map(({ x }) => x)),
    minY: Math.min(...corners.map(({ y }) => y)),
    maxX: Math.max(...corners.map(({ x }) => x)),
    maxY: Math.max(...corners.map(({ y }) => y)),
  };
}

export function envelopeToBounds(
  envelope: HorizontalEnvelopeMm,
): HorizontalBoundsMm {
  return {
    minX: -envelope.negativeX,
    minY: -envelope.negativeY,
    maxX: envelope.positiveX,
    maxY: envelope.positiveY,
  };
}

export function interpolateRobotPose(
  from: RobotPose,
  to: RobotPose,
  progress: number,
): RobotPose {
  if (from.frame !== to.frame) {
    throw new Error(
      `Cannot interpolate poses in different frames (${from.frame} and ${to.frame}).`,
    );
  }
  const clamped = Math.max(0, Math.min(1, finite(progress, "progress")));
  return {
    frame: from.frame,
    positionMm: {
      x: from.positionMm.x + (to.positionMm.x - from.positionMm.x) * clamped,
      y: from.positionMm.y + (to.positionMm.y - from.positionMm.y) * clamped,
      z: from.positionMm.z + (to.positionMm.z - from.positionMm.z) * clamped,
    },
    yawDeg: interpolateYawDeg(from.yawDeg, to.yawDeg, clamped),
  };
}
