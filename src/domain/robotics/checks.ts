import type { PalletStation } from "~/domain/project/projectSchema";
import {
  envelopeToBounds,
  horizontalEnvelopeBounds,
} from "~/domain/robotics/frames";
import {
  createRobotCycleMotionRoute,
  createRobotCycleTransitionRoute,
  type RobotMotionSegment,
  type RobotMotionWaypoint,
} from "~/domain/robotics/motionRoute";
import type {
  HorizontalBoundsMm,
  HorizontalEnvelopeMm,
  RobotCycle,
  RobotDiagnostic,
  RobotObstacle,
  RobotPose,
} from "~/domain/robotics/types";

export type BoundaryCheck =
  | {
      status: "checked";
      valid: boolean;
      actual: number;
      minimum: number;
      maximum: number;
    }
  | {
      status: "not-checked";
      reason: "zero-radius-sentinel";
      actual: number;
    };

function finiteTolerance(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("toleranceMm must be finite and non-negative.");
  }
  return value;
}

export function isUncalibratedRobotRadius(
  station: Pick<PalletStation, "robotRadiusMm">,
): boolean {
  return station.robotRadiusMm.min === 0 && station.robotRadiusMm.max === 0;
}

export function checkReachBoundary(
  pose: Pick<RobotPose, "positionMm">,
  station: Pick<PalletStation, "robotCenterMm" | "robotRadiusMm">,
  toleranceMm = 0,
): BoundaryCheck {
  const tolerance = finiteTolerance(toleranceMm);
  const distance = Math.hypot(
    pose.positionMm.x - station.robotCenterMm.x,
    pose.positionMm.y - station.robotCenterMm.y,
  );
  if (isUncalibratedRobotRadius(station)) {
    return {
      status: "not-checked",
      reason: "zero-radius-sentinel",
      actual: distance,
    };
  }
  return {
    status: "checked",
    valid:
      distance >= station.robotRadiusMm.min - tolerance &&
      distance <= station.robotRadiusMm.max + tolerance,
    actual: distance,
    minimum: station.robotRadiusMm.min,
    maximum: station.robotRadiusMm.max,
  };
}

export function boundsContained(
  container: HorizontalBoundsMm,
  child: HorizontalBoundsMm,
  toleranceMm = 0,
): boolean {
  const tolerance = finiteTolerance(toleranceMm);
  return (
    child.minX >= container.minX - tolerance &&
    child.minY >= container.minY - tolerance &&
    child.maxX <= container.maxX + tolerance &&
    child.maxY <= container.maxY + tolerance
  );
}

export function pointWithinHorizontalEnvelope(
  pose: Pick<RobotPose, "positionMm">,
  envelope: HorizontalEnvelopeMm,
  toleranceMm = 0,
): boolean {
  const bounds = envelopeToBounds(envelope);
  const tolerance = finiteTolerance(toleranceMm);
  return (
    pose.positionMm.x >= bounds.minX - tolerance &&
    pose.positionMm.x <= bounds.maxX + tolerance &&
    pose.positionMm.y >= bounds.minY - tolerance &&
    pose.positionMm.y <= bounds.maxY + tolerance
  );
}

function boundsOverlapInclusive(
  left: HorizontalBoundsMm,
  right: HorizontalBoundsMm,
  toleranceMm: number,
): boolean {
  return (
    left.minX <= right.maxX + toleranceMm &&
    left.maxX >= right.minX - toleranceMm &&
    left.minY <= right.maxY + toleranceMm &&
    left.maxY >= right.minY - toleranceMm
  );
}

function poseZOverlapsObstacle(
  pose: RobotPose,
  obstacle: RobotObstacle,
): boolean {
  const minimum = obstacle.minZMm ?? Number.NEGATIVE_INFINITY;
  const maximum = obstacle.maxZMm ?? Number.POSITIVE_INFINITY;
  return pose.positionMm.z >= minimum && pose.positionMm.z <= maximum;
}

export function checkObstacleAtPose(
  pose: RobotPose,
  toolEnvelope: HorizontalEnvelopeMm,
  obstacle: RobotObstacle,
  toleranceMm = 0,
): boolean {
  const tolerance = finiteTolerance(toleranceMm);
  return (
    poseZOverlapsObstacle(pose, obstacle) &&
    boundsOverlapInclusive(
      horizontalEnvelopeBounds(pose, toolEnvelope),
      obstacle.boundsMm,
      tolerance,
    )
  );
}

function yawChanges(from: RobotPose, to: RobotPose): boolean {
  const delta = (((to.yawDeg - from.yawDeg) % 360) + 360) % 360;
  return delta > 1e-9 && Math.abs(delta - 360) > 1e-9;
}

/**
 * Horizontal bounds the tool can reach at `pose` under any yaw: the square
 * circumscribing the envelope's farthest corner. Used when a segment rotates,
 * because the intermediate orientations are not covered by the endpoint AABBs.
 */
export function rotationSweptEnvelopeBounds(
  pose: Pick<RobotPose, "positionMm">,
  envelope: HorizontalEnvelopeMm,
): HorizontalBoundsMm {
  const radius = Math.hypot(
    Math.max(envelope.negativeX, envelope.positiveX),
    Math.max(envelope.negativeY, envelope.positiveY),
  );
  return {
    minX: pose.positionMm.x - radius,
    maxX: pose.positionMm.x + radius,
    minY: pose.positionMm.y - radius,
    maxY: pose.positionMm.y + radius,
  };
}

/**
 * Horizontal bounds swept by the tool along a linear TCP move. When the yaw
 * changes along the segment, both endpoints use the rotation-swept bounds so
 * every intermediate orientation is inside the volume.
 */
export function sweptToolBounds(
  from: RobotPose,
  to: RobotPose,
  toolEnvelope: HorizontalEnvelopeMm,
): HorizontalBoundsMm {
  if (from.frame !== to.frame) {
    throw new Error("Segment checks require both poses in one frame.");
  }
  const rotates = yawChanges(from, to);
  const fromBounds = rotates
    ? rotationSweptEnvelopeBounds(from, toolEnvelope)
    : horizontalEnvelopeBounds(from, toolEnvelope);
  const toBounds = rotates
    ? rotationSweptEnvelopeBounds(to, toolEnvelope)
    : horizontalEnvelopeBounds(to, toolEnvelope);
  return {
    minX: Math.min(fromBounds.minX, toBounds.minX),
    minY: Math.min(fromBounds.minY, toBounds.minY),
    maxX: Math.max(fromBounds.maxX, toBounds.maxX),
    maxY: Math.max(fromBounds.maxY, toBounds.maxY),
  };
}

/** Conservative swept-AABB obstacle test for a linear TCP move. */
export function checkObstacleAlongSegment(
  from: RobotPose,
  to: RobotPose,
  toolEnvelope: HorizontalEnvelopeMm,
  obstacle: RobotObstacle,
  toleranceMm = 0,
): boolean {
  const tolerance = finiteTolerance(toleranceMm);
  const sweptBounds = sweptToolBounds(from, to, toolEnvelope);
  const segmentMinZ = Math.min(from.positionMm.z, to.positionMm.z);
  const segmentMaxZ = Math.max(from.positionMm.z, to.positionMm.z);
  const obstacleMinZ = obstacle.minZMm ?? Number.NEGATIVE_INFINITY;
  const obstacleMaxZ = obstacle.maxZMm ?? Number.POSITIVE_INFINITY;
  const zOverlaps = segmentMinZ <= obstacleMaxZ && segmentMaxZ >= obstacleMinZ;
  return (
    zOverlaps &&
    boundsOverlapInclusive(sweptBounds, obstacle.boundsMm, tolerance)
  );
}

/** Smallest XY distance from the robot centre to the straight TCP segment. */
export function segmentMinimumRadius(
  from: Pick<RobotPose, "positionMm">,
  to: Pick<RobotPose, "positionMm">,
  station: Pick<PalletStation, "robotCenterMm">,
): number {
  const ax = from.positionMm.x - station.robotCenterMm.x;
  const ay = from.positionMm.y - station.robotCenterMm.y;
  const dx = to.positionMm.x - from.positionMm.x;
  const dy = to.positionMm.y - from.positionMm.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Reach check for a whole segment. The maximum radius is convex, so the
 * waypoints already cover it; the minimum radius excludes a disc the segment
 * can cross even when both endpoints are valid.
 */
export function checkReachAlongSegment(
  from: Pick<RobotPose, "positionMm">,
  to: Pick<RobotPose, "positionMm">,
  station: Pick<PalletStation, "robotCenterMm" | "robotRadiusMm">,
  toleranceMm = 0,
): BoundaryCheck {
  const tolerance = finiteTolerance(toleranceMm);
  const minimumRadius = segmentMinimumRadius(from, to, station);
  if (isUncalibratedRobotRadius(station)) {
    return {
      status: "not-checked",
      reason: "zero-radius-sentinel",
      actual: minimumRadius,
    };
  }
  return {
    status: "checked",
    valid: minimumRadius >= station.robotRadiusMm.min - tolerance,
    actual: minimumRadius,
    minimum: station.robotRadiusMm.min,
    maximum: station.robotRadiusMm.max,
  };
}

function routeEntries(
  cycles: readonly RobotCycle[],
  cycleIndex: number,
): {
  waypoints: readonly RobotMotionWaypoint[];
  segments: readonly RobotMotionSegment[];
} {
  const cycle = cycles[cycleIndex]!;
  const carried = createRobotCycleMotionRoute(cycle);
  const previous = cycles[cycleIndex - 1];
  if (!previous) return carried;
  const transition = createRobotCycleTransitionRoute(previous, cycle);
  return {
    waypoints: [...transition.waypoints.slice(1, -1), ...carried.waypoints],
    segments: [...transition.segments, ...carried.segments],
  };
}

export function validateCycleMotionBoundaries(
  cycles: readonly RobotCycle[],
  station: PalletStation,
  toolEnvelope: HorizontalEnvelopeMm,
  obstacles: readonly RobotObstacle[] = [],
  toleranceMm = 0,
): RobotDiagnostic[] {
  const diagnostics: RobotDiagnostic[] = [];
  const tcpBounds = envelopeToBounds(station.tcpEnvelopeMm);
  const toolBoundsLimit = envelopeToBounds(station.obstacleEnvelopeMm);
  if (cycles.length > 0 && isUncalibratedRobotRadius(station)) {
    diagnostics.push({
      severity: "warning",
      phase: "reach",
      code: "reach-not-checked-zero-radius-sentinel",
      message:
        "Station robot radius is 0 / 0, which is treated as an uncalibrated legacy sentinel. Radial reach was not checked; envelope and obstacle checks continue.",
      resourceId: station.id,
    });
  }

  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
    const cycle = cycles[cycleIndex]!;
    let route: ReturnType<typeof routeEntries>;
    try {
      route = routeEntries(cycles, cycleIndex);
    } catch (cause) {
      diagnostics.push({
        severity: "error",
        phase: "timeline",
        code: "timeline-frame-mismatch",
        message:
          cause instanceof Error
            ? cause.message
            : `Cycle "${cycle.id}" route uses incompatible frames.`,
        cycleId: cycle.id,
        layerId: cycle.physicalLayerId,
      });
      continue;
    }
    for (const { name, pose } of route.waypoints) {
      const reach = checkReachBoundary(pose, station, toleranceMm);
      if (
        reach.status === "checked" &&
        reach.actual < reach.minimum - toleranceMm
      ) {
        diagnostics.push({
          severity: "error",
          phase: "reach",
          code: "reach-below-minimum",
          message: `Cycle "${cycle.id}" ${name} TCP radius ${reach.actual.toFixed(3)} mm is below station minimum ${reach.minimum} mm.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: {
            phase: name,
            radiusMm: reach.actual,
            minimumMm: reach.minimum,
          },
        });
      } else if (
        reach.status === "checked" &&
        reach.actual > reach.maximum + toleranceMm
      ) {
        diagnostics.push({
          severity: "error",
          phase: "reach",
          code: "reach-above-maximum",
          message: `Cycle "${cycle.id}" ${name} TCP radius ${reach.actual.toFixed(3)} mm exceeds station maximum ${reach.maximum} mm.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: {
            phase: name,
            radiusMm: reach.actual,
            maximumMm: reach.maximum,
          },
        });
      }

      if (
        !pointWithinHorizontalEnvelope(pose, station.tcpEnvelopeMm, toleranceMm)
      ) {
        diagnostics.push({
          severity: "error",
          phase: "envelope",
          code: "tcp-envelope-exceeded",
          message: `Cycle "${cycle.id}" ${name} TCP (${pose.positionMm.x}, ${pose.positionMm.y}) mm is outside the station TCP envelope.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: {
            phase: name,
            minX: tcpBounds.minX,
            maxX: tcpBounds.maxX,
            minY: tcpBounds.minY,
            maxY: tcpBounds.maxY,
          },
        });
      }

      const actualToolBounds = horizontalEnvelopeBounds(pose, toolEnvelope);
      if (!boundsContained(toolBoundsLimit, actualToolBounds, toleranceMm)) {
        diagnostics.push({
          severity: "error",
          phase: "envelope",
          code: "tool-envelope-exceeded",
          message: `Cycle "${cycle.id}" ${name} gripper envelope exceeds station free-space contour.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: { phase: name },
        });
      }

      for (const obstacle of obstacles) {
        if (!checkObstacleAtPose(pose, toolEnvelope, obstacle, toleranceMm)) {
          continue;
        }
        diagnostics.push({
          severity: "error",
          phase: "collision",
          code: "obstacle-collision",
          message: `Cycle "${cycle.id}" ${name} pose intersects obstacle "${obstacle.name ?? obstacle.id}".`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: obstacle.id,
          details: { phase: name, check: "pose-aabb" },
        });
      }
    }

    for (const segment of route.segments) {
      const reach = checkReachAlongSegment(
        segment.from.pose,
        segment.to.pose,
        station,
        toleranceMm,
      );
      if (reach.status === "checked" && !reach.valid) {
        diagnostics.push({
          severity: "error",
          phase: "reach",
          code: "reach-below-minimum",
          message: `Cycle "${cycle.id}" ${segment.kind} path passes ${reach.actual.toFixed(3)} mm from the robot centre, below station minimum ${reach.minimum} mm.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: {
            phase: segment.kind,
            check: "segment-minimum-radius",
            radiusMm: reach.actual,
            minimumMm: reach.minimum,
          },
        });
      }
      // Waypoints already cover translation-only moves (the contour is
      // convex); a rotating segment can leave it between two valid poses.
      if (
        yawChanges(segment.from.pose, segment.to.pose) &&
        !boundsContained(
          toolBoundsLimit,
          sweptToolBounds(segment.from.pose, segment.to.pose, toolEnvelope),
          toleranceMm,
        )
      ) {
        diagnostics.push({
          severity: "error",
          phase: "envelope",
          code: "tool-envelope-exceeded",
          message: `Cycle "${cycle.id}" ${segment.kind} gripper rotation sweeps outside the station free-space contour.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: station.id,
          details: { phase: segment.kind, check: "conservative-swept-aabb" },
        });
      }
      for (const obstacle of obstacles) {
        if (
          !checkObstacleAlongSegment(
            segment.from.pose,
            segment.to.pose,
            toolEnvelope,
            obstacle,
            toleranceMm,
          )
        ) {
          continue;
        }
        diagnostics.push({
          severity: "error",
          phase: "collision",
          code: "obstacle-collision",
          message: `Cycle "${cycle.id}" ${segment.kind} swept envelope intersects obstacle "${obstacle.name ?? obstacle.id}".`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: obstacle.id,
          details: {
            phase: segment.kind,
            check: "conservative-swept-aabb",
          },
        });
      }
    }
  }

  return diagnostics;
}
