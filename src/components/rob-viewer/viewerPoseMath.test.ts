import { describe, expect, it } from "vitest";
import {
  composeViewerPoses,
  invertViewerPose,
  viewerFrameFromReference,
  viewerPoseToLocal,
} from "~/components/rob-viewer/viewerPoseMath";

const palletPose = {
  positionMm: { x: 789, y: -5, z: 0 },
  yawDeg: 90,
};

const pickupPose = {
  positionMm: { x: 1_492, y: 207, z: 962 },
  yawDeg: -90,
};

describe("viewer pose math", () => {
  it("maps pallet-local package poses through the confirmed 90 degree pallet frame", () => {
    expect(
      composeViewerPoses(palletPose, {
        positionMm: { x: 400, y: 300, z: 100 },
        yawDeg: 0,
      }),
    ).toEqual({
      positionMm: { x: 489, y: 395, z: 100 },
      yawDeg: 90,
    });
  });

  it("roundtrips world poses through the confirmed pallet frame", () => {
    const worldPose = {
      positionMm: { x: 489, y: 395, z: 100 },
      yawDeg: -180,
    };

    expect(
      composeViewerPoses(palletPose, viewerPoseToLocal(palletPose, worldPose)),
    ).toEqual(worldPose);
    expect(
      composeViewerPoses(palletPose, invertViewerPose(palletPose)),
    ).toEqual({
      positionMm: { x: 0, y: 0, z: 0 },
      yawDeg: 0,
    });
  });

  it("derives a pickup frame that maps the reference pick exactly to calibration", () => {
    const referencePick = {
      positionMm: { x: 1_000, y: -150, z: 200 },
      yawDeg: 180,
    };
    const pickupFrame = viewerFrameFromReference(referencePick, pickupPose);

    expect(composeViewerPoses(pickupFrame, referencePick)).toEqual(pickupPose);
    expect(
      composeViewerPoses(pickupFrame, {
        positionMm: { x: 1_025, y: -140, z: 200 },
        yawDeg: 180,
      }),
    ).toEqual({
      positionMm: { x: 1_482, y: 232, z: 962 },
      yawDeg: -90,
    });
  });
});
