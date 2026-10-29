import type {
  PalletizingDirection,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import type {
  ResolvedRoboticsResources,
  RobotDiagnostic,
} from "~/domain/robotics/types";

export function resolveSelectedRoboticsResources(
  project: Project,
  directionOverride?: PalletizingDirection,
): ResolvedRoboticsResources {
  const diagnostics: RobotDiagnostic[] = [];
  const gripper =
    project.selectedGripperId === null
      ? null
      : (project.grippers.find(({ id }) => id === project.selectedGripperId) ??
        null);
  if (project.selectedGripperId === null) {
    diagnostics.push({
      severity: "error",
      phase: "resources",
      code: "missing-gripper-selection",
      message:
        "Select a gripper before robot cycles are calculated or exported.",
      path: ["selectedGripperId"],
      resourceId: null,
    });
  } else if (!gripper) {
    diagnostics.push({
      severity: "error",
      phase: "resources",
      code: "missing-gripper",
      message: `Selected gripper "${project.selectedGripperId}" does not exist in the project.`,
      path: ["selectedGripperId"],
      resourceId: project.selectedGripperId,
    });
  }

  const station =
    project.selectedPalletStationId === null
      ? null
      : (project.palletStations.find(
          ({ id }) => id === project.selectedPalletStationId,
        ) ?? null);
  if (project.selectedPalletStationId === null) {
    diagnostics.push({
      severity: "error",
      phase: "resources",
      code: "missing-station-selection",
      message:
        "Select a pallet station before station-frame poses are calculated or exported.",
      path: ["selectedPalletStationId"],
      resourceId: null,
    });
  } else if (!station) {
    diagnostics.push({
      severity: "error",
      phase: "resources",
      code: "missing-station",
      message: `Selected pallet station "${project.selectedPalletStationId}" does not exist in the project.`,
      path: ["selectedPalletStationId"],
      resourceId: project.selectedPalletStationId,
    });
  }

  const direction =
    directionOverride ??
    project.package.palletizingDirection ??
    station?.preferredDirection ??
    null;
  if (station && direction && !station.allowedDirections.includes(direction)) {
    diagnostics.push({
      severity: "error",
      phase: "resources",
      code: "station-direction-not-allowed",
      message: `Palletizing direction "${direction}" is not allowed by station "${station.name}".`,
      path: ["package", "palletizingDirection"],
      resourceId: station.id,
      details: { direction },
    });
  }

  return { gripper, station, direction, diagnostics };
}

export function validateCycleGripperAssignments(
  solution: PlanningSolution,
  selectedGripperId: string | null,
): RobotDiagnostic[] {
  if (selectedGripperId === null) return [];
  return solution.robotCycles.flatMap((cycle) => {
    if (cycle.gripperId === null || cycle.gripperId === selectedGripperId) {
      return [];
    }
    return [
      {
        severity: "error" as const,
        phase: "resources" as const,
        code: "cycle-gripper-mismatch" as const,
        message: `Cycle "${cycle.id}" references gripper "${cycle.gripperId}" but project selection is "${selectedGripperId}".`,
        path: ["robotCycles", cycle.id, "gripperId"],
        cycleId: cycle.id,
        resourceId: cycle.gripperId,
        details: { selectedGripperId },
      },
    ];
  });
}
