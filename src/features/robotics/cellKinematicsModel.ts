import { BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION } from "~/components/rob-viewer/bundledRobotCell";
import type { ViewerScenePose } from "~/components/rob-viewer/viewerTypes";
import type { Project } from "~/domain/project/projectSchema";
import {
  validateUr10eCellKinematics,
  type RobotCycleMaterialization,
  type RobotPose,
  type Ur10eCellKinematicsResult,
  type Ur10eCellKinematicsSummary,
} from "~/domain/robotics";
import type { Translate } from "~/i18n";
import { createViewerSimulationCycles } from "~/features/simulation/viewerSimulationPlan";

/** Only guided projects run in the bundled UR10e lift cell (see SimulationWorkspace). */
export function usesBundledUr10eCell(
  project: Pick<Project, "source">,
): boolean {
  return project.source.kind === "new";
}

/**
 * Runs the UR10e checks for the cycles the simulation plays back: the
 * canonical cycles are mapped into the calibrated cell frame exactly as the
 * viewer does, so the checked poses are the animated ones.
 */
export function createBundledCellKinematics(
  project: Project,
  materialization: RobotCycleMaterialization,
  toViewerPose: (pose: RobotPose) => ViewerScenePose,
): Ur10eCellKinematicsResult | null {
  if (!usesBundledUr10eCell(project) || materialization.cycles.length === 0) {
    return null;
  }
  const cellCycles = createViewerSimulationCycles(
    materialization.cycles,
    toViewerPose,
    BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
  );
  return validateUr10eCellKinematics(cellCycles, {
    packageWeightKg: project.package.weightKg,
  });
}

export type CellKinematicsDescription = {
  status: "complete" | "warning" | "not-checked";
  /** Translated result sentences, in report order. */
  lines: readonly string[];
  /** What the UR10e checks still leave out. */
  limitations: string;
};

/** Readable UR10e check result for the readiness panel and the report. */
export function describeCellKinematics(
  summary: Ur10eCellKinematicsSummary | null | undefined,
  t: Translate,
): CellKinematicsDescription {
  const limitations = t("robotics.kinematics.limitations");
  if (!summary || summary.cycleCount === 0) {
    return {
      status: "not-checked",
      lines: [t("robotics.kinematics.notChecked")],
      limitations,
    };
  }
  const kg = (value: number) =>
    value.toFixed(1).replace(".", t("robotics.kinematics.decimalSeparator"));
  const lines = [
    t("robotics.kinematics.reach", {
      solved: summary.solvedWaypointCount,
      count: summary.waypointCount,
    }),
  ];
  if (summary.unreachableWaypointCount > 0) {
    lines.push(
      t("robotics.kinematics.unreachable", {
        count: summary.unreachableWaypointCount,
      }),
    );
  }
  if (summary.jointLimitWaypointCount > 0) {
    lines.push(
      t("robotics.kinematics.jointLimit", {
        count: summary.jointLimitWaypointCount,
      }),
    );
  }
  lines.push(
    summary.unsolvedPathSampleCount > 0
      ? t("robotics.kinematics.pathUnsolved", {
          count: summary.unsolvedPathSampleCount,
          total: summary.pathSampleCount,
        })
      : t("robotics.kinematics.pathOk", { count: summary.pathSampleCount }),
  );
  lines.push(
    summary.singularWaypointCount > 0
      ? t("robotics.kinematics.singular", {
          count: summary.singularWaypointCount,
        })
      : t("robotics.kinematics.noSingularity"),
  );
  if (summary.configurationChangeCount > 0) {
    lines.push(
      t("robotics.kinematics.configuration", {
        count: summary.configurationChangeCount,
      }),
    );
  }
  const payload = summary.payload;
  if (payload.status === "not-checked") {
    lines.push(t("robotics.kinematics.payloadNotChecked"));
  } else {
    const values = {
      max: kg(payload.maxPayloadKg),
      limit: kg(payload.limitKg),
    };
    lines.push(
      payload.exceededCycleCount > 0
        ? t("robotics.kinematics.payloadExceeded", {
            ...values,
            count: payload.exceededCycleCount,
          })
        : t("robotics.kinematics.payload", values),
    );
    if (!payload.gripperMassIncluded) {
      lines.push(t("robotics.kinematics.payloadNoGripper"));
    }
  }
  const clean =
    summary.solvedWaypointCount === summary.waypointCount &&
    summary.unsolvedPathSampleCount === 0 &&
    summary.singularWaypointCount === 0 &&
    summary.configurationChangeCount === 0 &&
    payload.status === "checked" &&
    payload.exceededCycleCount === 0;
  return { status: clean ? "complete" : "warning", lines, limitations };
}
