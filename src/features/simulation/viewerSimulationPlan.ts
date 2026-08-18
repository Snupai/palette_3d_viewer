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

function calibratedTransferPose(
  localPick: ViewerScenePose,
  localTransfer: ViewerScenePose,
  localPlace: ViewerScenePose,
  worldPick: ViewerScenePose,
  worldPlace: ViewerScenePose,
): ViewerScenePose {
  const clearanceMm = Math.max(
    0,
    localTransfer.positionMm.z -
      Math.max(localPick.positionMm.z, localPlace.positionMm.z),
  );
  return {
    positionMm: {
      x: (worldPick.positionMm.x + worldPlace.positionMm.x) / 2,
      y: (worldPick.positionMm.y + worldPlace.positionMm.y) / 2,
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

  return cycles.map((cycle) => {
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
        )
      : localTransfer;

    return {
      ...cycle,
      pickPose: asTimelinePose(worldPick),
      transferPose: asTimelinePose(worldTransfer),
      placePose: asTimelinePose(worldPlace),
    };
  });
}

export function timelinePoseToViewerPose(pose: RobotPose): ViewerScenePose {
  return {
    positionMm: { ...pose.positionMm },
    yawDeg: pose.yawDeg,
  };
}
