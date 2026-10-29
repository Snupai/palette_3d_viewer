import type {
  RobotCycle,
  RobotCycleMaterialization,
  RobotDiagnostic,
  RobotPose,
} from "~/domain/robotics/types";

export type RobotEditorFlowStep = {
  cycleId: string;
  sequence: number;
  physicalLayerId: string;
  groupId: string;
  groupNumber: number;
  placementIds: readonly string[];
  packageCount: number;
  pickPose: RobotPose;
  transferPose: RobotPose;
  placePose: RobotPose;
  diagnostics: readonly RobotDiagnostic[];
  blocked: boolean;
};

/** Read model for the future React flow mode; it does not own or recompute cycles. */
export function createRobotEditorFlow(
  materialization: RobotCycleMaterialization,
): readonly RobotEditorFlowStep[] {
  return materialization.cycles.map((cycle) => {
    const diagnostics = materialization.diagnostics.filter(
      (diagnostic) =>
        diagnostic.cycleId === cycle.id ||
        diagnostic.groupId === cycle.groupId ||
        diagnostic.layerId === cycle.physicalLayerId,
    );
    return {
      cycleId: cycle.id,
      sequence: cycle.sequence,
      physicalLayerId: cycle.physicalLayerId,
      groupId: cycle.groupId,
      groupNumber: cycle.groupNumber,
      placementIds: cycle.placementIds,
      packageCount: cycle.packageCount,
      pickPose: cycle.pickPose,
      transferPose: cycle.transferPose,
      placePose: cycle.placePose,
      diagnostics,
      blocked: diagnostics.some(({ severity }) => severity === "error"),
    };
  });
}

export type RobotCycleReportRow = {
  cycleId: string;
  sequence: number;
  layer: number;
  groupId: string;
  groupNumber: number;
  packageCount: number;
  placementIds: readonly string[];
  gripperId: string | null;
  stationId: string | null;
  pickPose: RobotPose;
  transferPose: RobotPose;
  placePose: RobotPose;
  source: RobotCycle["provenance"]["cycleSource"];
};

export type RobotCycleReport = {
  projectId: string | null;
  solutionId: string | null;
  valid: boolean;
  cycleCount: number;
  singleCount: number;
  doubleCount: number;
  largerMultipickCount: number;
  packageCount: number;
  rows: readonly RobotCycleReportRow[];
  diagnostics: readonly RobotDiagnostic[];
};

/** Report data over the exact canonical cycles used by simulation and export. */
export function createRobotCycleReport(
  materialization: RobotCycleMaterialization,
): RobotCycleReport {
  return {
    projectId: materialization.projectId,
    solutionId: materialization.solutionId,
    valid: materialization.valid,
    cycleCount: materialization.cycles.length,
    singleCount: materialization.cycles.filter(
      ({ packageCount }) => packageCount === 1,
    ).length,
    doubleCount: materialization.cycles.filter(
      ({ packageCount }) => packageCount === 2,
    ).length,
    largerMultipickCount: materialization.cycles.filter(
      ({ packageCount }) => packageCount > 2,
    ).length,
    packageCount: materialization.cycles.reduce(
      (total, { packageCount }) => total + packageCount,
      0,
    ),
    rows: materialization.cycles.map((cycle) => ({
      cycleId: cycle.id,
      sequence: cycle.sequence,
      layer: cycle.physicalLayerIndex + 1,
      groupId: cycle.groupId,
      groupNumber: cycle.groupNumber,
      packageCount: cycle.packageCount,
      placementIds: cycle.placementIds,
      gripperId: cycle.gripperId,
      stationId: cycle.stationId,
      pickPose: cycle.pickPose,
      transferPose: cycle.transferPose,
      placePose: cycle.placePose,
      source: cycle.provenance.cycleSource,
    })),
    diagnostics: materialization.diagnostics,
  };
}
