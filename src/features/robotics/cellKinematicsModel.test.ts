import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { PackagePlacement, Project } from "~/domain/project/projectSchema";
import {
  BUNDLED_UR10E_CELL,
  downwardToolTransform,
  multiplyTransforms,
  transformDeviation,
  ur10eBaseTransform,
  ur10eForwardKinematics,
} from "~/domain/robotics";
import { translateDe } from "~/i18n";
import {
  createBundledCellKinematics,
  describeCellKinematics,
} from "~/features/robotics/cellKinematicsModel";
import {
  createInitialRobotWorkspaceSettings,
  createRobotReadiness,
  materializeRobotWorkspace,
  robotPoseToViewerPose,
} from "~/features/robotics/robotWorkspaceModel";

/** EURO pallet, 400 × 300 × 250 mm cartons, 6 per layer, 6 layers, 5 kg each. */
function referenceProject(input: {
  weightKg: number | null;
  source?: Project["source"];
}) {
  const placements: PackagePlacement[] = [];
  for (let column = 0; column < 3; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      placements.push({
        id: `placement-${placements.length + 1}`,
        sequence: placements.length,
        positionMm: { x: column * 400, y: row * 400 },
        rotation: 0,
        gripId: null,
        labelSide: null,
      });
    }
  }
  return createProject(
    {
      id: "ur10e-reference",
      ...(input.source ? { source: input.source } : {}),
      package: {
        dimensionsMm: { length: 400, width: 300, height: 250 },
        weightKg: input.weightKg,
        multiPickAllowed: true,
        palletizingDirection: "x-negative-y-positive",
      },
      solutions: [
        {
          id: "solution-1",
          name: "Reference",
          origin: "calculated",
          patterns: [{ id: "pattern-1", name: "6er", grips: [], placements }],
          stack: {
            interlayerThicknessMm: 3,
            layers: Array.from({ length: 6 }, (_, index) => ({
              id: `layer-${index + 1}`,
              patternId: "pattern-1",
              interlayerBefore: 0,
            })),
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    { createId: (kind) => `${kind}-reference`, now: () => 1 },
  );
}

function materialize(project: Project) {
  return materializeRobotWorkspace(
    project,
    createInitialRobotWorkspaceSettings(project),
  );
}

describe("bundled UR10e cell kinematics", () => {
  it("solves every waypoint of the reference plan and reproduces it by FK", () => {
    const project = referenceProject({ weightKg: 5 });
    const materialization = materialize(project);
    const result = createBundledCellKinematics(
      project,
      materialization,
      (pose) => robotPoseToViewerPose(pose, project, materialization),
    );

    expect(materialization.cycles).toHaveLength(36);
    expect(result?.summary).toEqual({
      robot: "UR10e",
      installationId: "bundled-ur10e-lift-cell",
      cycleCount: 36,
      // 36 × 5 carried waypoints + 35 × 3 return waypoints (incl. the via point).
      waypointCount: 285,
      solvedWaypointCount: 285,
      unreachableWaypointCount: 0,
      jointLimitWaypointCount: 0,
      singularWaypointCount: 0,
      configurationChangeCount: 0,
      pathSampleCount: 747,
      unsolvedPathSampleCount: 0,
      liftUsedMm: { min: 0, max: 900 },
      payload: {
        status: "checked",
        maxPayloadKg: 5,
        limitKg: 12.5,
        gripperMassIncluded: false,
        exceededCycleCount: 0,
      },
    });
    expect(result?.diagnostics).toEqual([]);
    expect(materialization.cellKinematics).toEqual(result?.summary);

    let worstPositionMm = 0;
    let worstRotation = 0;
    for (const { pose, solution } of result!.waypoints) {
      if (solution.status !== "solved") throw new Error("unsolved waypoint");
      const deviation = transformDeviation(
        multiplyTransforms(
          ur10eBaseTransform(BUNDLED_UR10E_CELL, solution.liftMm),
          ur10eForwardKinematics(solution.joints),
        ),
        downwardToolTransform(
          {
            x:
              pose.positionMm.x +
              BUNDLED_UR10E_CELL.flangeOffsetXMm *
                Math.cos((pose.yawDeg * Math.PI) / 180),
            y:
              pose.positionMm.y +
              BUNDLED_UR10E_CELL.flangeOffsetXMm *
                Math.sin((pose.yawDeg * Math.PI) / 180),
            z: pose.positionMm.z + BUNDLED_UR10E_CELL.flangeToSuctionMm,
          },
          (pose.yawDeg * Math.PI) / 180,
        ),
      );
      worstPositionMm = Math.max(worstPositionMm, deviation.positionMm);
      worstRotation = Math.max(worstRotation, deviation.rotation);
    }
    expect(worstPositionMm).toBeLessThan(1e-6);
    expect(worstRotation).toBeLessThan(1e-9);
  });

  it("adds payload findings to the workspace diagnostics without blocking the plan", () => {
    const project = referenceProject({ weightKg: 13 });
    const materialization = materialize(project);

    const kinematics = materialization.diagnostics.filter(
      ({ phase }) => phase === "kinematics",
    );
    expect(kinematics).toHaveLength(36);
    expect(
      new Set(kinematics.map(({ code, severity }) => `${severity}:${code}`)),
    ).toEqual(new Set(["warning:kinematics-payload-exceeded"]));
    expect(materialization.cellKinematics?.payload).toEqual({
      status: "checked",
      maxPayloadKg: 13,
      limitKg: 12.5,
      gripperMassIncluded: false,
      exceededCycleCount: 36,
    });
    expect(
      describeCellKinematics(materialization.cellKinematics, translateDe),
    ).toEqual({
      status: "warning",
      lines: [
        "285 von 285 Bahnstützpunkten sind mit UR10e und Hubachse innerhalb der Gelenkgrenzen erreichbar.",
        "Alle 747 Zwischenpunkte der geraden Bahnsegmente sind erreichbar.",
        "Kein Stützpunkt liegt nahe einer Singularität.",
        "Traglast in 36 Griffen überschritten (höchstens 13,0 kg von 12,5 kg).",
        "Die Greifermasse ist nicht hinterlegt; gezählt sind nur die Pakete.",
      ],
      limitations:
        "Nicht geprüft: Kollisionen des Arms mit der Zelle und synchronisierte Hubzeiten. Der Greifer-Abstand Flansch bis Saugfläche ist 137,4 mm, gemessen am Greifermodell.",
    });
  });

  it("reports the UR10e result as its own readiness item", () => {
    const project = referenceProject({ weightKg: null });
    const settings = createInitialRobotWorkspaceSettings(project);
    const materialization = materializeRobotWorkspace(project, settings);
    const readiness = createRobotReadiness(
      project,
      materialization,
      settings,
      false,
      0,
      translateDe,
    );

    expect(readiness.map(({ id }) => id)).toEqual([
      "plan",
      "equipment",
      "pickup",
      "workspace",
      "kinematics",
      "obstacles",
      "export",
    ]);
    expect(readiness.find(({ id }) => id === "kinematics")).toEqual({
      id: "kinematics",
      label: "UR10e-Kinematik",
      status: "warning",
      evidence:
        "285 von 285 Bahnstützpunkten sind mit UR10e und Hubachse innerhalb der Gelenkgrenzen erreichbar. Alle 747 Zwischenpunkte der geraden Bahnsegmente sind erreichbar. Kein Stützpunkt liegt nahe einer Singularität. Paketgewicht fehlt, daher wurde die Traglast nicht geprüft.",
    });
  });

  it("does not check imported plans, which do not run in the bundled cell", () => {
    const project = referenceProject({
      weightKg: 5,
      source: { kind: "rob-import", fileName: "reference.rob" },
    });
    const materialization = materialize(project);

    expect(
      createBundledCellKinematics(project, materialization, (pose) =>
        robotPoseToViewerPose(pose, project, materialization),
      ),
    ).toBeNull();
    expect(materialization.cellKinematics).toBeNull();
    expect(
      describeCellKinematics(materialization.cellKinematics, translateDe),
    ).toMatchObject({
      status: "not-checked",
      lines: [
        "Nicht geprüft: Nur geführte Pläne mit Griffen laufen in der mitgelieferten UR10e-Hubzelle.",
      ],
    });
  });
});
