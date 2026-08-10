import { resolveMultipackEquipmentProfile } from "~/domain/project/equipmentProfiles";
import type { Project } from "~/domain/project/projectSchema";
import {
  materializeRobotCycles,
  preflightProjectRobExport,
  stationPointToPallet,
  transformYawForDirection,
  type RobExportOptions,
  type RobotCycleMaterialization,
  type RobotCycleMaterializationOptions,
  type RobotDiagnostic,
  type RobotObstacle,
  type RobotPose,
} from "~/domain/robotics";
import type { ViewerScenePose } from "~/components/rob-viewer/viewerTypes";

export type RobotWorkspaceSettings = {
  pickX: string;
  pickY: string;
  pickZ: string;
  pickYaw: string;
  pickReferenceStatus: "verified" | "unverified";
  pickReferenceSource: string;
  transferClearanceMm: string;
  maxPackagesPerPick: string;
  obstacles: readonly RobotObstacle[];
};

export type WorkspaceUnknownFieldMode =
  | "block"
  | "preserve-imported"
  | "explicit-values";

export type RobotExportWorkspaceSettings = {
  quantization: NonNullable<RobExportOptions["quantization"]>["mode"];
  mappingAcknowledged: boolean;
  mappingId: string;
  xSign: 1 | -1;
  ySign: 1 | -1;
  yawSign: 1 | -1;
  yawOffsetDeg: string;
  unknownFieldMode: WorkspaceUnknownFieldMode;
  field8: string;
  field9: string;
  unknownFieldSemantics: string;
  unknownFieldProvenance: string;
  allowCountOnlyInterlayers: boolean;
};

export type RobotReadinessStatus =
  | "complete"
  | "needs-input"
  | "engineering"
  | "not-checked"
  | "warning"
  | "blocked";

export type RobotReadinessItem = {
  id: "plan" | "equipment" | "pickup" | "workspace" | "obstacles" | "export";
  label: string;
  status: RobotReadinessStatus;
  evidence: string;
};

export function createInitialRobotWorkspaceSettings(
  project: Project,
): RobotWorkspaceSettings {
  return {
    pickX: "",
    pickY: "",
    pickZ: "",
    pickYaw: "0",
    pickReferenceStatus: "unverified",
    pickReferenceSource:
      "User-entered workspace value; external station survey not supplied.",
    transferClearanceMm: "200",
    maxPackagesPerPick: project.package.multiPickAllowed ? "2" : "1",
    obstacles: [],
  };
}

export function createInitialRobotExportSettings(): RobotExportWorkspaceSettings {
  return {
    quantization: "reject-decimals",
    mappingAcknowledged: false,
    mappingId: "internal-station-mapping-v1",
    xSign: 1,
    ySign: 1,
    yawSign: 1,
    yawOffsetDeg: "0",
    unknownFieldMode: "block",
    field8: "0",
    field9: "0",
    unknownFieldSemantics:
      "Unknown final .rob fields supplied for internal inspection only; external semantics remain unverified.",
    unknownFieldProvenance: "User-selected robotics workspace export policy.",
    allowCountOnlyInterlayers: false,
  };
}

function finiteNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function workspacePickReferenceComplete(
  settings: RobotWorkspaceSettings,
): boolean {
  return [
    settings.pickX,
    settings.pickY,
    settings.pickZ,
    settings.pickYaw,
  ].every((value) => finiteNumber(value) !== null);
}

export function materializationOptionsFromWorkspace(
  settings: RobotWorkspaceSettings,
): RobotCycleMaterializationOptions {
  const transferClearanceMm = finiteNumber(settings.transferClearanceMm);
  const maxPackagesPerPick = finiteNumber(settings.maxPackagesPerPick);
  const pickX = finiteNumber(settings.pickX);
  const pickY = finiteNumber(settings.pickY);
  const pickZ = finiteNumber(settings.pickZ);
  const pickYaw = finiteNumber(settings.pickYaw);
  const hasPickReference =
    pickX !== null && pickY !== null && pickZ !== null && pickYaw !== null;

  return {
    ...(hasPickReference
      ? {
          pickReference: {
            originMm: { x: pickX, y: pickY, z: pickZ },
            yawDeg: pickYaw,
            provenance: {
              status: settings.pickReferenceStatus,
              source:
                settings.pickReferenceSource.trim() ||
                "User-entered robotics workspace value; source not supplied.",
            },
          },
        }
      : {}),
    ...(transferClearanceMm !== null && transferClearanceMm >= 0
      ? { transferClearanceMm }
      : {}),
    ...(maxPackagesPerPick !== null &&
    Number.isInteger(maxPackagesPerPick) &&
    maxPackagesPerPick > 0
      ? { maxPackagesPerPick }
      : {}),
    obstacles: settings.obstacles,
  };
}

export function validateRobotWorkspaceSettings(
  settings: RobotWorkspaceSettings,
): RobotDiagnostic[] {
  const diagnostics: RobotDiagnostic[] = [];
  const transferClearanceMm = finiteNumber(settings.transferClearanceMm);
  if (transferClearanceMm === null || transferClearanceMm < 0) {
    diagnostics.push({
      severity: "error",
      phase: "pose",
      code: "materialization-invalid",
      message:
        "Travel clearance must be an explicit number greater than or equal to zero.",
      path: ["robotics", "transferClearanceMm"],
    });
  }

  const maxPackagesPerPick = finiteNumber(settings.maxPackagesPerPick);
  if (
    maxPackagesPerPick === null ||
    !Number.isInteger(maxPackagesPerPick) ||
    maxPackagesPerPick <= 0
  ) {
    diagnostics.push({
      severity: "error",
      phase: "grouping",
      code: "materialization-invalid",
      message:
        "Packages per calculated pickup must be an explicit positive whole number.",
      path: ["robotics", "maxPackagesPerPick"],
    });
  }

  if (
    settings.pickReferenceStatus === "verified" &&
    settings.pickReferenceSource.trim() === ""
  ) {
    diagnostics.push({
      severity: "error",
      phase: "pose",
      code: "materialization-invalid",
      message: "A checked pickup point needs a verification source.",
      path: ["robotics", "pickReferenceSource"],
    });
  }

  diagnostics.push(
    ...settings.obstacles.flatMap((obstacle, index) => {
      const values = [
        obstacle.boundsMm.minX,
        obstacle.boundsMm.minY,
        obstacle.boundsMm.maxX,
        obstacle.boundsMm.maxY,
        obstacle.minZMm ?? 0,
        obstacle.maxZMm ?? 0,
      ];
      const invalid =
        values.some((value) => !Number.isFinite(value)) ||
        obstacle.boundsMm.minX > obstacle.boundsMm.maxX ||
        obstacle.boundsMm.minY > obstacle.boundsMm.maxY ||
        (obstacle.minZMm !== undefined &&
          obstacle.maxZMm !== undefined &&
          obstacle.minZMm > obstacle.maxZMm);
      if (!invalid) return [];
      return [
        {
          severity: "error" as const,
          phase: "collision" as const,
          code: "materialization-invalid" as const,
          message: `Obstacle "${obstacle.name ?? obstacle.id}" has non-finite or reversed bounds; collision validation and export remain blocked.`,
          path: ["robotics", "obstacles", index],
          resourceId: obstacle.id,
        },
      ];
    }),
  );

  return diagnostics;
}

export function materializeRobotWorkspace(
  project: Project,
  settings: RobotWorkspaceSettings,
): RobotCycleMaterialization {
  const materialization = materializeRobotCycles(
    project,
    materializationOptionsFromWorkspace(settings),
  );
  const diagnostics = validateRobotWorkspaceSettings(settings);
  if (diagnostics.length === 0) return materialization;
  return {
    ...materialization,
    diagnostics: [...materialization.diagnostics, ...diagnostics],
    valid: false,
  };
}

function hasDiagnosticError(
  materialization: RobotCycleMaterialization,
  phases: readonly RobotDiagnostic["phase"][],
): boolean {
  return materialization.diagnostics.some(
    ({ severity, phase }) => severity === "error" && phases.includes(phase),
  );
}

export function createRobotReadiness(
  project: Project,
  materialization: RobotCycleMaterialization,
  settings: RobotWorkspaceSettings,
  exportReady: boolean,
  exportBlockingIssues: number,
): RobotReadinessItem[] {
  const hasSolution = project.activeSolutionId !== null;
  const planBlocked = hasDiagnosticError(materialization, [
    "project",
    "grouping",
    "ordering",
  ]);
  const equipmentSelected =
    project.selectedGripperId !== null &&
    project.selectedPalletStationId !== null;
  const equipmentBlocked = hasDiagnosticError(materialization, [
    "resources",
    "compatibility",
  ]);
  const multipackProfile = resolveMultipackEquipmentProfile(project);
  const pickupComplete = workspacePickReferenceComplete(settings);
  const pickupBlocked = materialization.diagnostics.some(
    ({ severity, phase, code }) =>
      severity === "error" &&
      phase === "pose" &&
      code !== "unverified-pick-reference",
  );
  const workspaceBlocked = hasDiagnosticError(materialization, [
    "reach",
    "envelope",
  ]);
  const reachNotChecked = materialization.diagnostics.some(
    ({ code }) => code === "reach-not-checked-zero-radius-sentinel",
  );
  const collisionBlocked = hasDiagnosticError(materialization, ["collision"]);

  return [
    {
      id: "plan",
      label: "Plan and pickup list",
      status: planBlocked
        ? "blocked"
        : !hasSolution || materialization.cycles.length === 0
          ? "needs-input"
          : "complete",
      evidence: planBlocked
        ? "The active plan has blocking grouping or order issues."
        : materialization.cycles.length > 0
          ? `${materialization.cycles.length} pickup${materialization.cycles.length === 1 ? "" : "s"} calculated.`
          : "Create and stack a package pattern first.",
    },
    {
      id: "equipment",
      label: "Equipment",
      status: !equipmentSelected
        ? "needs-input"
        : equipmentBlocked
          ? "blocked"
          : multipackProfile
            ? "warning"
            : "complete",
      evidence: !equipmentSelected
        ? "Select a gripper and pallet station."
        : equipmentBlocked
          ? "The selected equipment does not pass the internal compatibility checks."
          : multipackProfile
            ? "The observed Multipack default profile is selected. Its values are documented evidence, not calibrated production equipment."
            : "Selected gripper and station pass the available internal checks.",
    },
    {
      id: "pickup",
      label: "Pickup point",
      status: !pickupComplete
        ? "needs-input"
        : pickupBlocked
          ? "blocked"
          : settings.pickReferenceStatus === "verified"
            ? "complete"
            : "warning",
      evidence: !pickupComplete
        ? "Enter X, Y, Z, and yaw."
        : pickupBlocked
          ? "The pickup values or their evidence need correction."
          : settings.pickReferenceStatus === "verified"
            ? "Marked as checked against the stated source."
            : "Coordinates are present but have not been checked against the station.",
    },
    {
      id: "workspace",
      label: "Station workspace",
      status:
        !equipmentSelected || materialization.cycles.length === 0
          ? "not-checked"
          : workspaceBlocked
            ? "blocked"
            : reachNotChecked
              ? "warning"
              : "complete",
      evidence:
        !equipmentSelected || materialization.cycles.length === 0
          ? "Select equipment and calculate pickups before checking reach and envelopes."
          : workspaceBlocked
            ? "At least one pickup is outside an entered reach or envelope."
            : reachNotChecked
              ? "Entered TCP and free-space envelopes contain the calculated pickups, but radial reach was not checked because 0 / 0 is an uncalibrated legacy sentinel."
              : "Entered reach and envelope limits contain the calculated pickups.",
    },
    {
      id: "obstacles",
      label: "Fixed obstacles",
      status:
        settings.obstacles.length === 0
          ? "not-checked"
          : collisionBlocked
            ? "blocked"
            : "complete",
      evidence:
        settings.obstacles.length === 0
          ? "No fixed obstacles are modeled. Collision against individual station objects has not been checked."
          : collisionBlocked
            ? "A calculated motion intersects an entered obstacle or an obstacle is invalid."
            : `${settings.obstacles.length} entered obstacle${settings.obstacles.length === 1 ? "" : "s"} checked.`,
    },
    {
      id: "export",
      label: "Internal export setup",
      status: exportReady ? "complete" : "engineering",
      evidence: exportReady
        ? "Internal export preflight passed."
        : `${exportBlockingIssues} export setting${exportBlockingIssues === 1 ? "" : "s"} still require engineering review.`,
    },
  ];
}

export function robExportOptionsFromWorkspace(
  settings: RobotExportWorkspaceSettings,
  materialization: RobotCycleMaterialization,
): RobExportOptions {
  const yawOffsetDeg = finiteNumber(settings.yawOffsetDeg);
  const field8 = finiteNumber(settings.field8);
  const field9 = finiteNumber(settings.field9);
  const signConvention =
    settings.mappingAcknowledged &&
    settings.mappingId.trim() !== "" &&
    yawOffsetDeg !== null
      ? {
          id: settings.mappingId.trim(),
          xSign: settings.xSign,
          ySign: settings.ySign,
          yawSign: settings.yawSign,
          yawOffsetDeg,
          provenance: {
            status: "unverified" as const,
            source:
              "User-entered internal mapping; external MultiPack compatibility is not claimed.",
          },
        }
      : undefined;

  const unknownFields: RobExportOptions["unknownFields"] =
    settings.unknownFieldMode === "preserve-imported"
      ? { mode: "preserve-imported" }
      : settings.unknownFieldMode === "explicit-values" &&
          field8 !== null &&
          field9 !== null
        ? {
            mode: "explicit-values",
            semantics: settings.unknownFieldSemantics,
            provenance: settings.unknownFieldProvenance,
            valuesByCycleId: Object.fromEntries(
              materialization.cycles.map(({ id }) => [id, { field8, field9 }]),
            ),
          }
        : { mode: "reject" };

  return {
    quantization: { mode: settings.quantization },
    ...(signConvention ? { signConvention } : {}),
    unknownFields,
    interlayerThicknessPolicy: settings.allowCountOnlyInterlayers
      ? "allow-count-only"
      : "require-3mm",
  };
}

export function projectRobExportGate(
  materialization: RobotCycleMaterialization,
  settings: RobotExportWorkspaceSettings,
) {
  const options = robExportOptionsFromWorkspace(settings, materialization);
  const preflight = preflightProjectRobExport(materialization, options);
  return {
    enabled: preflight.ok,
    options,
    preflight,
  };
}

export function robotPoseToViewerPose(
  pose: RobotPose,
  project: Project,
  materialization: RobotCycleMaterialization,
): ViewerScenePose {
  if (
    pose.frame === "station" &&
    project.pallet &&
    materialization.station &&
    materialization.direction
  ) {
    return {
      positionMm: stationPointToPallet(
        pose.positionMm,
        project.pallet,
        materialization.station,
        materialization.direction,
      ),
      yawDeg: transformYawForDirection(pose.yawDeg, materialization.direction),
    };
  }
  return {
    positionMm: { ...pose.positionMm },
    yawDeg: pose.yawDeg,
  };
}
