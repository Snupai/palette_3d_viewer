import { updateProject } from "~/domain/project/projectFactory";
import type {
  Gripper,
  PalletStation,
  Project,
} from "~/domain/project/projectSchema";

function createId(prefix: string): string {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

export function createSuctionGripperDraft(
  project: Project,
  id = createId("gripper"),
): Gripper {
  const { length, width, height } = project.package.dimensionsMm;
  return {
    id,
    name: "Unverified suction gripper draft",
    externalId: null,
    isDefault: false,
    maxPickupLengthMm: project.package.multiPickAllowed ? length * 2 : length,
    tcpMm: { x: 0, y: 0, z: 0 },
    envelopeMm: {
      negativeX: length / 2,
      positiveX: length / 2,
      negativeY: width / 2,
      positiveY: width / 2,
    },
    inletOrientation: "any",
    allowedPlaceRotations: [0, 90, 180, 270],
    packageLimits: {
      lengthMm: { min: 1, max: Math.max(length * 4, 1) },
      widthMm: { min: 1, max: Math.max(width * 4, 1) },
      heightMm: { min: 1, max: Math.max(height * 4, 1) },
    },
    settings: { type: "suction", multipickSinglePlace: false },
  };
}

export function createEditableGripperCopy(
  gripper: Gripper,
  id = createId("gripper"),
): Gripper {
  return {
    ...gripper,
    id,
    name: `${gripper.name} copy`,
    externalId: null,
    isDefault: false,
    tcpMm: { ...gripper.tcpMm },
    envelopeMm: { ...gripper.envelopeMm },
    allowedPlaceRotations: [...gripper.allowedPlaceRotations],
    packageLimits: gripper.packageLimits
      ? {
          lengthMm: { ...gripper.packageLimits.lengthMm },
          widthMm: { ...gripper.packageLimits.widthMm },
          heightMm: { ...gripper.packageLimits.heightMm },
        }
      : null,
    settings:
      gripper.settings.type === "suction"
        ? { ...gripper.settings }
        : gripper.settings.type === "clamp"
          ? {
              ...gripper.settings,
              allowedPickPositions: [...gripper.settings.allowedPickPositions],
            }
          : {
              ...gripper.settings,
              allowedPickRotations: [...gripper.settings.allowedPickRotations],
            },
  };
}

export function createPalletStationDraft(
  project: Project,
  id = createId("station"),
): PalletStation {
  const palletLength = project.pallet?.dimensionsMm.length ?? 1_200;
  const palletWidth = project.pallet?.dimensionsMm.width ?? 800;
  const extent = Math.max(palletLength, palletWidth) * 2;
  return {
    id,
    name: "Unverified pallet station draft",
    externalId: null,
    isDefault: false,
    palletOrigin: { x: "left", y: "bottom" },
    obstacleEnvelopeMm: {
      negativeX: extent,
      positiveX: extent,
      negativeY: extent,
      positiveY: extent,
    },
    tcpEnvelopeMm: {
      negativeX: extent,
      positiveX: extent,
      negativeY: extent,
      positiveY: extent,
    },
    allowedDirections: [
      "x-positive-y-positive",
      "x-positive-y-negative",
      "x-negative-y-positive",
      "x-negative-y-negative",
    ],
    preferredDirection: "x-positive-y-positive",
    robotCenterMm: { x: 0, y: 0 },
    robotRadiusMm: { min: 0, max: extent },
    inletAlignment: "center",
  };
}

export function createEditableStationCopy(
  station: PalletStation,
  id = createId("station"),
): PalletStation {
  return {
    ...station,
    id,
    name: `${station.name} copy`,
    externalId: null,
    isDefault: false,
    palletOrigin: { ...station.palletOrigin },
    obstacleEnvelopeMm: { ...station.obstacleEnvelopeMm },
    tcpEnvelopeMm: { ...station.tcpEnvelopeMm },
    allowedDirections: [...station.allowedDirections],
    robotCenterMm: { ...station.robotCenterMm },
    robotRadiusMm: { ...station.robotRadiusMm },
  };
}

export function projectWithGripper(
  project: Project,
  gripper: Gripper,
): Project {
  const exists = project.grippers.some(({ id }) => id === gripper.id);
  return updateProject(project, {
    grippers: exists
      ? project.grippers.map((current) =>
          current.id === gripper.id ? gripper : current,
        )
      : [...project.grippers, gripper],
    selectedGripperId: gripper.id,
  });
}

export function projectWithStation(
  project: Project,
  station: PalletStation,
): Project {
  const exists = project.palletStations.some(({ id }) => id === station.id);
  return updateProject(project, {
    palletStations: exists
      ? project.palletStations.map((current) =>
          current.id === station.id ? station : current,
        )
      : [...project.palletStations, station],
    selectedPalletStationId: station.id,
  });
}
