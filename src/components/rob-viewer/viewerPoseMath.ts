import type { ViewerScenePose } from "~/components/rob-viewer/viewerTypes";

export const IDENTITY_VIEWER_POSE: ViewerScenePose = {
  positionMm: { x: 0, y: 0, z: 0 },
  yawDeg: 0,
};

function cleanNumber(value: number): number {
  const rounded = Math.round(value * 1_000_000_000) / 1_000_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeViewerYawDeg(yawDeg: number): number {
  const normalized = ((yawDeg + 180) % 360 + 360) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function composeViewerPoses(
  frame: ViewerScenePose,
  local: ViewerScenePose,
): ViewerScenePose {
  const radians = (frame.yawDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    positionMm: {
      x: cleanNumber(
        frame.positionMm.x +
          local.positionMm.x * cosine -
          local.positionMm.y * sine,
      ),
      y: cleanNumber(
        frame.positionMm.y +
          local.positionMm.x * sine +
          local.positionMm.y * cosine,
      ),
      z: cleanNumber(frame.positionMm.z + local.positionMm.z),
    },
    yawDeg: normalizeViewerYawDeg(frame.yawDeg + local.yawDeg),
  };
}

export function invertViewerPose(pose: ViewerScenePose): ViewerScenePose {
  const inverseYawDeg = -pose.yawDeg;
  const radians = (inverseYawDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    positionMm: {
      x: cleanNumber(
        -pose.positionMm.x * cosine + pose.positionMm.y * sine,
      ),
      y: cleanNumber(
        -pose.positionMm.x * sine - pose.positionMm.y * cosine,
      ),
      z: cleanNumber(-pose.positionMm.z),
    },
    yawDeg: normalizeViewerYawDeg(inverseYawDeg),
  };
}

export function viewerPoseToLocal(
  frame: ViewerScenePose,
  world: ViewerScenePose,
): ViewerScenePose {
  return composeViewerPoses(invertViewerPose(frame), world);
}

export function viewerFrameFromReference(
  referenceLocal: ViewerScenePose,
  referenceWorld: ViewerScenePose,
): ViewerScenePose {
  return composeViewerPoses(referenceWorld, invertViewerPose(referenceLocal));
}

export function interpolateViewerYawDeg(
  fromDeg: number,
  toDeg: number,
  progress: number,
): number {
  const delta = normalizeViewerYawDeg(toDeg - fromDeg);
  return normalizeViewerYawDeg(fromDeg + delta * progress);
}
