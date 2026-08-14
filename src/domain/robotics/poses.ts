import { pickOffsetForCount } from "~/domain/palletGeometry";
import type { Rotation } from "~/domain/palletTypes";
import type {
  Gripper,
  PackageSpec,
  PalletSpec,
  PalletStation,
  PalletizingDirection,
} from "~/domain/project/projectSchema";
import {
  interpolateYawDeg,
  normalizeYawDeg,
  palletPointToStation,
  rotateVector2,
  tcpPoseFromGripPoint,
  transformYawForDirection,
} from "~/domain/robotics/frames";
import type {
  PickReference,
  RobotGripGroup,
  RobotPose,
  Vector3Mm,
} from "~/domain/robotics/types";

export const PACKAGE_GROUP_TOP_CENTER_PICK_SOURCE =
  "package-group-top-center-v1";

export function derivedPickReferenceFromPackage(
  packageSpec: PackageSpec,
): PickReference {
  return {
    originMm: { x: 0, y: 0, z: packageSpec.dimensionsMm.height },
    yawDeg: 0,
    provenance: {
      status: "derived",
      source: PACKAGE_GROUP_TOP_CENTER_PICK_SOURCE,
    },
  };
}

function orthogonalPickRotation(yawDeg: number): Rotation {
  const snapped = normalizeYawDeg(Math.round(yawDeg / 90) * 90);
  if (snapped === 90 || snapped === 180 || snapped === 270) return snapped;
  return 0;
}

export type CalculatedCyclePoses = {
  pickPose: RobotPose;
  transferPose: RobotPose;
  placePose: RobotPose;
};

function transferPoseBetween(
  pickPose: RobotPose,
  placePose: RobotPose,
  clearanceMm: number,
): RobotPose {
  if (!Number.isFinite(clearanceMm) || clearanceMm < 0) {
    throw new Error("transferClearanceMm must be finite and non-negative.");
  }
  if (pickPose.frame !== placePose.frame) {
    throw new Error("Pick and place poses must use one coordinate frame.");
  }
  return {
    frame: pickPose.frame,
    positionMm: {
      x: (pickPose.positionMm.x + placePose.positionMm.x) / 2,
      y: (pickPose.positionMm.y + placePose.positionMm.y) / 2,
      z: Math.max(pickPose.positionMm.z, placePose.positionMm.z) + clearanceMm,
    },
    yawDeg: interpolateYawDeg(pickPose.yawDeg, placePose.yawDeg, 0.5),
  };
}

function pickGripPoint(
  packageSpec: PackageSpec,
  packageCount: number,
  reference: PickReference,
): { point: Vector3Mm; yawDeg: number } {
  const yawDeg = normalizeYawDeg(
    reference.yawDeg ??
      (packageSpec.inletOrientation === "lengthwise" ? 0 : 90),
  );
  if (reference.provenance.source === PACKAGE_GROUP_TOP_CENTER_PICK_SOURCE) {
    const offset = pickOffsetForCount(
      packageSpec.dimensionsMm.length,
      packageSpec.dimensionsMm.width,
      packageSpec.inletOrientation === "crosswise" ? 1 : 0,
      orthogonalPickRotation(yawDeg),
      packageCount,
    );
    return {
      point: {
        x: offset.x,
        y: offset.y,
        z: reference.originMm.z,
      },
      yawDeg,
    };
  }
  const feedLength =
    packageSpec.inletOrientation === "lengthwise"
      ? packageSpec.dimensionsMm.length
      : packageSpec.dimensionsMm.width;
  const feedWidth =
    packageSpec.inletOrientation === "lengthwise"
      ? packageSpec.dimensionsMm.width
      : packageSpec.dimensionsMm.length;
  const offset = rotateVector2(
    {
      x: (Math.max(1, packageCount) * feedLength) / 2,
      y: -feedWidth / 2,
    },
    yawDeg,
  );
  return {
    point: {
      x: reference.originMm.x + offset.x,
      y: reference.originMm.y + offset.y,
      z: reference.originMm.z,
    },
    yawDeg,
  };
}

export function calculateProjectCyclePoses(
  group: RobotGripGroup,
  packageSpec: PackageSpec,
  pallet: PalletSpec,
  gripper: Gripper,
  station: PalletStation,
  direction: PalletizingDirection,
  pickReference: PickReference,
  transferClearanceMm: number,
): CalculatedCyclePoses {
  const placeGripPoint = palletPointToStation(
    group.centerPalletMm,
    pallet,
    station,
    direction,
  );
  const placeYawDeg = transformYawForDirection(
    group.placeRotationDeg,
    direction,
  );
  const placePose = tcpPoseFromGripPoint(
    placeGripPoint,
    placeYawDeg,
    gripper.tcpMm,
  );
  const pick = pickGripPoint(packageSpec, group.packageCount, pickReference);
  const pickPose = tcpPoseFromGripPoint(pick.point, pick.yawDeg, gripper.tcpMm);
  return {
    pickPose,
    transferPose: transferPoseBetween(pickPose, placePose, transferClearanceMm),
    placePose,
  };
}

export function unresolvedProjectCyclePoses(
  group: RobotGripGroup,
  packageSpec: PackageSpec,
  pickReference: PickReference,
  transferClearanceMm: number,
): CalculatedCyclePoses {
  const pick = pickGripPoint(packageSpec, group.packageCount, pickReference);
  const pickPose: RobotPose = {
    frame: "pallet",
    positionMm: { ...pick.point },
    yawDeg: pick.yawDeg,
  };
  const placePose: RobotPose = {
    frame: "pallet",
    positionMm: { ...group.centerPalletMm },
    yawDeg: normalizeYawDeg(group.placeRotationDeg),
  };
  return {
    pickPose,
    transferPose: transferPoseBetween(pickPose, placePose, transferClearanceMm),
    placePose,
  };
}

export function posesFromExplicitProjectCycle(
  input: {
    pick: { x: number; y: number; z: number | null; rotation: number };
    place: { x: number; y: number; z: number | null; rotation: number };
  },
  fallbackPickZMm: number,
  fallbackPlaceZMm: number,
  transferClearanceMm: number,
): CalculatedCyclePoses {
  const pickPose: RobotPose = {
    frame: "legacy-rob",
    positionMm: {
      x: input.pick.x,
      y: input.pick.y,
      z: input.pick.z ?? fallbackPickZMm,
    },
    yawDeg: normalizeYawDeg(input.pick.rotation),
  };
  const placePose: RobotPose = {
    frame: "legacy-rob",
    positionMm: {
      x: input.place.x,
      y: input.place.y,
      z: input.place.z ?? fallbackPlaceZMm,
    },
    yawDeg: normalizeYawDeg(input.place.rotation),
  };
  return {
    pickPose,
    transferPose: transferPoseBetween(pickPose, placePose, transferClearanceMm),
    placePose,
  };
}
