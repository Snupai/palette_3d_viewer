import { describe, expect, it } from "vitest";
import { BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION } from "~/components/rob-viewer/bundledRobotCell";
import type { RobotCycle, RobotPose } from "~/domain/robotics";
import {
  createViewerSimulationCycles,
  timelinePoseToViewerPose,
} from "~/features/simulation/viewerSimulationPlan";

function pose(x: number, y: number, z: number, yawDeg: number): RobotPose {
  return {
    frame: "pallet",
    positionMm: { x, y, z },
    yawDeg,
  };
}

function cycle(
  id: string,
  sequence: number,
  pickPose: RobotPose,
  transferPose: RobotPose,
  placePose: RobotPose,
): RobotCycle {
  return {
    id,
    sequence,
    sequenceInLayer: sequence,
    physicalLayerId: "layer-1",
    physicalLayerIndex: 0,
    patternRef: "pattern-1",
    groupId: `group-${sequence + 1}`,
    groupNumber: sequence + 1,
    placementIds: [`placement-${sequence + 1}`],
    packageCount: 1,
    gripperId: "gripper-1",
    stationId: "station-1",
    pickPose,
    transferPose,
    placePose,
    placeGripPosePallet: { ...placePose, frame: "pallet" },
    legacyUnknownFields: null,
    provenance: {
      cycleSource: "calculated-suction-cycle",
      groupingSource: "suction-adjacency-v1",
      orderSource: "suggested-topological",
      poseSource: "calculated-project-resources",
      sourceSolutionOrigin: "calculated",
      sourceCycleId: null,
      sourceGripId: null,
      pickReferenceProvenance: null,
      coordinateConvention: "test",
      tcpOffsetConvention: "tcp-to-grasp-vector-subtracted",
      signConventionStatus: "project-defined",
    },
  };
}

const cycles = [
  cycle(
    "cycle-1",
    0,
    pose(1_000, -150, 200, 180),
    pose(800, 0, 500, 180),
    pose(400, 300, 100, 0),
  ),
  cycle(
    "cycle-2",
    1,
    pose(1_025, -140, 200, 180),
    pose(825, 0, 500, 180),
    pose(600, 300, 100, 90),
  ),
] as const;

describe("calibrated viewer simulation plan", () => {
  it("anchors pickup, places on the calibrated pallet, and preserves source cycles", () => {
    const sourceSnapshot = structuredClone(cycles);
    const calibrated = createViewerSimulationCycles(
      cycles,
      timelinePoseToViewerPose,
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
    );

    expect(calibrated[0]?.pickPose).toEqual({
      frame: "pallet",
      positionMm: { x: 1_492, y: 207, z: 962 },
      yawDeg: -90,
    });
    expect(calibrated[1]?.pickPose).toEqual({
      frame: "pallet",
      positionMm: { x: 1_482, y: 232, z: 962 },
      yawDeg: -90,
    });
    expect(calibrated[0]?.placePose).toEqual({
      frame: "pallet",
      positionMm: { x: 489, y: 395, z: 100 },
      yawDeg: 90,
    });
    expect(calibrated[0]?.transferPose).toEqual({
      frame: "pallet",
      positionMm: { x: 990.5, y: 301, z: 1_262 },
      yawDeg: -180,
    });
    expect(cycles).toEqual(sourceSnapshot);
  });
});
