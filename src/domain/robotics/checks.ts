import type { PalletStation } from "~/domain/project/projectSchema";
import {
  envelopeToBounds,
  horizontalEnvelopeBounds,
} from "~/domain/robotics/frames";
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

/** Conservative swept-AABB test for a linear TCP move. */
export function checkObstacleAlongSegment(
  from: RobotPose,
  to: RobotPose,
  toolEnvelope: HorizontalEnvelopeMm,
  obstacle: RobotObstacle,
  toleranceMm = 0,
): boolean {
  if (from.frame !== to.frame) {
    throw new Error("Obstacle checks require both segment poses in one frame.");
  }
  const tolerance = finiteTolerance(toleranceMm);
  const fromBounds = horizontalEnvelopeBounds(from, toolEnvelope);
  const toBounds = horizontalEnvelopeBounds(to, toolEnvelope);
  const sweptBounds = {
    minX: Math.min(fromBounds.minX, toBounds.minX),
    minY: Math.min(fromBounds.minY, toBounds.minY),
    maxX: Math.max(fromBounds.maxX, toBounds.maxX),
    maxY: Math.max(fromBounds.maxY, toBounds.maxY),
  };
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

function poseEntries(cycle: RobotCycle): Array<{
  name: "pick" | "transfer" | "place";
  pose: RobotPose;
}> {
  return [
    { name: "pick", pose: cycle.pickPose },
    { name: "transfer", pose: cycle.transferPose },
    { name: "place", pose: cycle.placePose },
  ];
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

  for (const cycle of cycles) {
    for (const { name, pose } of poseEntries(cycle)) {
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

    const segments = [
      { name: "pick-transfer", from: cycle.pickPose, to: cycle.transferPose },
      {
        name: "transfer-place",
        from: cycle.transferPose,
        to: cycle.placePose,
      },
    ] as const;
    for (const segment of segments) {
      for (const obstacle of obstacles) {
        if (
          !checkObstacleAlongSegment(
            segment.from,
            segment.to,
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
          message: `Cycle "${cycle.id}" ${segment.name} swept envelope intersects obstacle "${obstacle.name ?? obstacle.id}".`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: obstacle.id,
          details: { phase: segment.name, check: "conservative-swept-aabb" },
        });
      }
    }
  }

  return diagnostics;
}
