import {
  gripperSchema,
  palletStationSchema,
  type Gripper,
  type PackageSpec,
  type PalletStation,
  type Project,
} from "~/domain/project/projectSchema";

export const MULTIPACK_EQUIPMENT_PROFILE_ID =
  "multipack-roboter-observed-defaults";
export const MULTIPACK_EQUIPMENT_PROFILE_VERSION = 1 as const;
export const MULTIPACK_GRIPPER_ID =
  "builtin:multipack-roboter-observed-defaults:v1:gripper:schmalzgripper";
export const MULTIPACK_PALLET_STATION_ID =
  "builtin:multipack-roboter-observed-defaults:v1:station:pallet-place-definition";

export type GripperPackageLimits = NonNullable<Gripper["packageLimits"]>;

export type BuiltInEquipmentProfile = {
  id: typeof MULTIPACK_EQUIPMENT_PROFILE_ID;
  version: typeof MULTIPACK_EQUIPMENT_PROFILE_VERSION;
  name: string;
  provenance: {
    status: "observed-not-calibrated";
    application: "Multipack für Roboter";
    applicationVersion: "2.1.315.25";
    latestCorroboratingPlanDate: "2026-08-07";
    source: string;
  };
  gripper: Gripper;
  palletStation: PalletStation;
  packageLimitsByInletOrientation: Record<
    PackageSpec["inletOrientation"],
    GripperPackageLimits
  >;
  stationReach: {
    status: "not-calibrated";
    sentinel: { min: 0; max: 0 };
    meaning: string;
  };
};

const gripper = gripperSchema.parse({
  id: MULTIPACK_GRIPPER_ID,
  name: "schmalzgripper",
  externalId: "1",
  isDefault: true,
  maxPickupLengthMm: 450,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 0,
    positiveX: 0,
    negativeY: 0,
    positiveY: 0,
  },
  inletOrientation: "lengthwise",
  allowedPlaceRotations: [0, 90, 180, 270],
  packageLimits: null,
  settings: { type: "suction", multipickSinglePlace: false },
});

const palletStation = palletStationSchema.parse({
  id: MULTIPACK_PALLET_STATION_ID,
  name: "Pallet place definition",
  externalId: "1",
  isDefault: true,
  palletOrigin: { x: "right", y: "bottom" },
  obstacleEnvelopeMm: {
    negativeX: 1_500,
    positiveX: 1_500,
    negativeY: 1_500,
    positiveY: 1_500,
  },
  tcpEnvelopeMm: {
    negativeX: 2_000,
    positiveX: 2_000,
    negativeY: 2_000,
    positiveY: 2_000,
  },
  allowedDirections: [
    "x-negative-y-positive",
    "x-negative-y-negative",
    "x-positive-y-positive",
    "x-positive-y-negative",
  ],
  preferredDirection: "x-negative-y-positive",
  robotCenterMm: { x: 0, y: 0 },
  robotRadiusMm: { min: 0, max: 0 },
  inletAlignment: "right",
});

const packageLimitsByInletOrientation: BuiltInEquipmentProfile["packageLimitsByInletOrientation"] =
  {
    lengthwise: {
      lengthMm: { min: 50, max: 500 },
      widthMm: { min: 50, max: 420 },
      heightMm: { min: 50, max: 400 },
    },
    crosswise: {
      lengthMm: { min: 50, max: 500 },
      widthMm: { min: 50, max: 300 },
      heightMm: { min: 50, max: 400 },
    },
  };

const profile: BuiltInEquipmentProfile = {
  id: MULTIPACK_EQUIPMENT_PROFILE_ID,
  version: MULTIPACK_EQUIPMENT_PROFILE_VERSION,
  name: "Multipack Roboter observed defaults",
  provenance: {
    status: "observed-not-calibrated",
    application: "Multipack für Roboter",
    applicationVersion: "2.1.315.25",
    latestCorroboratingPlanDate: "2026-08-07",
    source:
      "Observed in the installed Multipack UI and corroborated against the active local plan database; not a station survey or production calibration.",
  },
  gripper,
  palletStation,
  packageLimitsByInletOrientation,
  stationReach: {
    status: "not-calibrated",
    sentinel: { min: 0, max: 0 },
    meaning:
      "The observed 0 / 0 robot-radius values are a legacy sentinel. Radial reach is not calibrated and must not be reported as checked.",
  },
};

function clonePackageLimits(value: GripperPackageLimits): GripperPackageLimits {
  return {
    lengthMm: { ...value.lengthMm },
    widthMm: { ...value.widthMm },
    heightMm: { ...value.heightMm },
  };
}

function cloneGripper(value: Gripper): Gripper {
  return {
    ...value,
    tcpMm: { ...value.tcpMm },
    envelopeMm: { ...value.envelopeMm },
    allowedPlaceRotations: [...value.allowedPlaceRotations],
    packageLimits: value.packageLimits
      ? clonePackageLimits(value.packageLimits)
      : null,
    settings:
      value.settings.type === "suction"
        ? { ...value.settings }
        : value.settings.type === "clamp"
          ? {
              ...value.settings,
              allowedPickPositions: [...value.settings.allowedPickPositions],
            }
          : {
              ...value.settings,
              allowedPickRotations: [...value.settings.allowedPickRotations],
            },
  };
}

function clonePalletStation(value: PalletStation): PalletStation {
  return {
    ...value,
    palletOrigin: { ...value.palletOrigin },
    obstacleEnvelopeMm: { ...value.obstacleEnvelopeMm },
    tcpEnvelopeMm: { ...value.tcpEnvelopeMm },
    allowedDirections: [...value.allowedDirections],
    robotCenterMm: { ...value.robotCenterMm },
    robotRadiusMm: { ...value.robotRadiusMm },
  };
}

function exactResourceMatch<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getMultipackEquipmentProfile(): BuiltInEquipmentProfile {
  return {
    ...profile,
    provenance: { ...profile.provenance },
    gripper: cloneGripper(profile.gripper),
    palletStation: clonePalletStation(profile.palletStation),
    packageLimitsByInletOrientation: {
      lengthwise: clonePackageLimits(
        profile.packageLimitsByInletOrientation.lengthwise,
      ),
      crosswise: clonePackageLimits(
        profile.packageLimitsByInletOrientation.crosswise,
      ),
    },
    stationReach: {
      ...profile.stationReach,
      sentinel: { ...profile.stationReach.sentinel },
    },
  };
}

export function createMultipackEquipmentProfileResources(): {
  grippers: Gripper[];
  palletStations: PalletStation[];
} {
  return {
    grippers: [cloneGripper(profile.gripper)],
    palletStations: [clonePalletStation(profile.palletStation)],
  };
}

export function isMultipackProfileGripper(value: Gripper | null): boolean {
  return (
    value?.id === MULTIPACK_GRIPPER_ID &&
    exactResourceMatch(value, profile.gripper)
  );
}

export function isMultipackProfileStation(
  value: PalletStation | null,
): boolean {
  return (
    value?.id === MULTIPACK_PALLET_STATION_ID &&
    exactResourceMatch(value, profile.palletStation)
  );
}

export function resolveMultipackEquipmentProfile(
  project: Project,
): BuiltInEquipmentProfile | null {
  const selectedGripper =
    project.grippers.find(({ id }) => id === project.selectedGripperId) ?? null;
  const selectedStation =
    project.palletStations.find(
      ({ id }) => id === project.selectedPalletStationId,
    ) ?? null;
  return isMultipackProfileGripper(selectedGripper) &&
    isMultipackProfileStation(selectedStation)
    ? getMultipackEquipmentProfile()
    : null;
}

export function resolveMultipackGripperPackageLimits(
  value: Gripper,
  inletOrientation: PackageSpec["inletOrientation"],
): GripperPackageLimits | undefined {
  if (!isMultipackProfileGripper(value)) return undefined;
  return clonePackageLimits(
    profile.packageLimitsByInletOrientation[inletOrientation],
  );
}
