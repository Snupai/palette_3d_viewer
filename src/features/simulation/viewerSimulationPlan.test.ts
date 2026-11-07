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
    placeApproach: null,
    placeApproachPose: null,
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
    // Pick bears −42.2° and place −160.3° from the robot base (1058.6, 599.5);
    // the transfer sits on the 595 mm mean radius at the −101.2° mid bearing
    // instead of the straight midpoint (990.5, 301) next to the base column.
    expect(calibrated[0]?.transferPose).toEqual({
      frame: "pallet",
      positionMm: { x: 942.959663423, y: 15.890080987, z: 1_262 },
      yawDeg: -180,
    });
    // The empty return from cycle 1's place to cycle 2's pick swings around
    // the base as well; the first cycle has no return move.
    expect(calibrated[0]?.returnTransferPose).toBeUndefined();
    expect(calibrated[1]?.returnTransferPose).toEqual({
      frame: "pallet",
      // Place bears −160.25° and pick −40.96°: mid −100.6° on the 582.9 mm
      // mean radius; yaw halfway from 90° to −90°.
      positionMm: { x: 951.331904036, y: 26.532769931, z: 1_262 },
      yawDeg: 0,
    });
    expect(cycles).toEqual(sourceSnapshot);
  });

  it("moves the place pre-position with the calibrated pallet", () => {
    const [first, second] = cycles;
    const withApproach = [
      {
        ...first,
        // dx = 1: 80 mm in pallet +X, raised by package height 40 + 10 mm.
        placeApproachPose: pose(480, 300, 150, 0),
      },
      second,
    ];
    const calibrated = createViewerSimulationCycles(
      withApproach,
      timelinePoseToViewerPose,
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
    );

    // The calibrated pallet is turned 90°, so pallet +X becomes cell +Y.
    expect(calibrated[0]?.placeApproachPose).toEqual({
      frame: "pallet",
      positionMm: { x: 489, y: 475, z: 150 },
      yawDeg: 90,
    });
    expect(calibrated[1]?.placeApproachPose).toBeNull();
  });

  it("keeps the straight pick/place midpoint without a robot pivot", () => {
    const { robotCellRevision, palletPose, pickupPose } =
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION;
    const withoutPivot = { robotCellRevision, palletPose, pickupPose };
    const calibrated = createViewerSimulationCycles(
      cycles,
      timelinePoseToViewerPose,
      withoutPivot,
    );

    expect(calibrated[0]?.transferPose).toEqual({
      frame: "pallet",
      positionMm: { x: 990.5, y: 301, z: 1_262 },
      yawDeg: -180,
    });
  });
});
