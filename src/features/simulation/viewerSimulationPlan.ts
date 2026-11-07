import type {
  ViewerSceneCalibrationConfig,
  ViewerScenePose,
} from "~/components/rob-viewer/viewerTypes";
import {
  composeViewerPoses,
  interpolateViewerYawDeg,
  viewerFrameFromReference,
} from "~/components/rob-viewer/viewerPoseMath";
import type { RobotCycle, RobotPose } from "~/domain/robotics";

function asTimelinePose(pose: ViewerScenePose): RobotPose {
  return {
    frame: "pallet",
    positionMm: { ...pose.positionMm },
    yawDeg: pose.yawDeg,
  };
}

function cleanNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000_000) / 1_000_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Horizontal transfer point. Without a robot pivot it is the pick/place
 * midpoint; with one it lies on the arc around the robot base (mean radius,
 * mean bearing on the shorter side), so the animated straight moves swing
 * around the robot instead of cutting through its base.
 */
function transferPoint(
  pick: ViewerScenePose["positionMm"],
  place: ViewerScenePose["positionMm"],
  pivot: { x: number; y: number } | undefined,
): { x: number; y: number } {
  if (!pivot) {
    return { x: (pick.x + place.x) / 2, y: (pick.y + place.y) / 2 };
  }
  const pickBearing = Math.atan2(pick.y - pivot.y, pick.x - pivot.x);
  const placeBearing = Math.atan2(place.y - pivot.y, place.x - pivot.x);
  const delta = Math.atan2(
    Math.sin(placeBearing - pickBearing),
    Math.cos(placeBearing - pickBearing),
  );
  const bearing = pickBearing + delta / 2;
  const radius =
    (Math.hypot(pick.x - pivot.x, pick.y - pivot.y) +
      Math.hypot(place.x - pivot.x, place.y - pivot.y)) /
    2;
  return {
    x: cleanNumber(pivot.x + radius * Math.cos(bearing)),
    y: cleanNumber(pivot.y + radius * Math.sin(bearing)),
  };
}

function calibratedTransferPose(
  localPick: ViewerScenePose,
  localTransfer: ViewerScenePose,
  localPlace: ViewerScenePose,
  worldPick: ViewerScenePose,
  worldPlace: ViewerScenePose,
  pivot: { x: number; y: number } | undefined,
): ViewerScenePose {
  const clearanceMm = Math.max(
    0,
    localTransfer.positionMm.z -
      Math.max(localPick.positionMm.z, localPlace.positionMm.z),
  );
  return {
    positionMm: {
      ...transferPoint(worldPick.positionMm, worldPlace.positionMm, pivot),
      z:
        Math.max(worldPick.positionMm.z, worldPlace.positionMm.z) + clearanceMm,
    },
    yawDeg: interpolateViewerYawDeg(worldPick.yawDeg, worldPlace.yawDeg, 0.5),
  };
}

/**
 * Creates simulation-only cycles in one viewer/world frame. Canonical cycles stay
 * untouched so validation, reporting, and .rob export retain their source values.
 */
export function createViewerSimulationCycles(
  cycles: readonly RobotCycle[],
  toViewerPose: (pose: RobotPose) => ViewerScenePose,
  calibration: ViewerSceneCalibrationConfig | null,
): readonly RobotCycle[] {
  const referencePick = cycles[0] ? toViewerPose(cycles[0].pickPose) : null;
  const pickupFrame =
    calibration && referencePick
      ? viewerFrameFromReference(referencePick, calibration.pickupPose)
      : null;

  const mapped = cycles.map((cycle) => {
    const localPick = toViewerPose(cycle.pickPose);
    const localTransfer = toViewerPose(cycle.transferPose);
    const localPlace = toViewerPose(cycle.placePose);
    const worldPick = pickupFrame
      ? composeViewerPoses(pickupFrame, localPick)
      : localPick;
    const worldPlace = calibration
      ? composeViewerPoses(calibration.palletPose, localPlace)
      : localPlace;
    const worldTransfer = calibration
      ? calibratedTransferPose(
          localPick,
          localTransfer,
          localPlace,
          worldPick,
          worldPlace,
          calibration.robotBaseMm,
        )
      : localTransfer;
    return { cycle, worldPick, worldTransfer, worldPlace };
  });

  const pivot = calibration?.robotBaseMm;
  return mapped.map(
    ({ cycle, worldPick, worldTransfer, worldPlace }, index) => {
      const previousPlace = mapped[index - 1]?.worldPlace;
      // The empty return swings around the robot base like the carried move;
      // its height is lifted to the route's safe Z by the transition route.
      const returnTransferPose =
        pivot && previousPlace
          ? asTimelinePose({
              positionMm: {
                ...transferPoint(
                  previousPlace.positionMm,
                  worldPick.positionMm,
                  pivot,
                ),
                z: worldTransfer.positionMm.z,
              },
              yawDeg: interpolateViewerYawDeg(
                previousPlace.yawDeg,
                worldPick.yawDeg,
                0.5,
              ),
            })
          : undefined;
      return {
        ...cycle,
        pickPose: asTimelinePose(worldPick),
        transferPose: asTimelinePose(worldTransfer),
        placePose: asTimelinePose(worldPlace),
        ...(returnTransferPose ? { returnTransferPose } : {}),
      };
    },
  );
}

export function timelinePoseToViewerPose(pose: RobotPose): ViewerScenePose {
  return {
    positionMm: { ...pose.positionMm },
    yawDeg: pose.yawDeg,
  };
}
