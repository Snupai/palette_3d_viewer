import { describe, expect, it } from "vitest";
import {
  CALCULATED_CONVEYOR_DIMENSIONS_MM,
  CALCULATED_CONVEYOR_OBSTACLE_ID,
  createCalculatedRobotConveyorModel,
  robotConveyorObstacle,
  type CalculatedRobotConveyorInput,
  type RobotCycle,
} from "~/domain/robotics";

function cycle(overrides: Partial<RobotCycle> = {}): RobotCycle {
  return {
    id: "cycle-1",
    sequence: 0,
    sequenceInLayer: 0,
    physicalLayerId: "layer-1",
    physicalLayerIndex: 0,
    patternRef: "pattern-1",
    groupId: "group-1",
    groupNumber: 1,
    placementIds: ["placement-1"],
    packageCount: 1,
    gripperId: "gripper-1",
    stationId: "station-1",
    pickPose: {
      frame: "station",
      positionMm: { x: 100, y: 200, z: 500 },
      yawDeg: 90,
    },
    transferPose: {
      frame: "station",
      positionMm: { x: 400, y: 500, z: 700 },
      yawDeg: 45,
    },
    placePose: {
      frame: "station",
      positionMm: { x: 700, y: 800, z: 115 },
      yawDeg: 0,
    },
    legacyUnknownFields: null,
    provenance: {
      cycleSource: "calculated-suction-cycle",
      groupingSource: "suction-adjacency-v1",
      orderSource: "suggested-topological",
      poseSource: "calculated-project-resources",
      sourceSolutionOrigin: "calculated",
      sourceCycleId: null,
      sourceGripId: null,
      pickReferenceProvenance: {
        status: "verified",
        source: "fixture station survey",
      },
      coordinateConvention: "project-pallet-to-station-frame-v1",
      tcpOffsetConvention: "tcp-to-grasp-vector-subtracted",
      signConventionStatus: "project-defined",
    },
    ...overrides,
  };
}

function input(
  overrides: Partial<CalculatedRobotConveyorInput> = {},
): CalculatedRobotConveyorInput {
  return {
    projectSourceKind: "new",
    inletOrientation: "lengthwise",
    gripperTcpMm: { x: 20, y: -10, z: 30 },
    cycles: [cycle()],
    stack: { packageLayers: [{ id: "layer-1", zBottomMm: 15 }] },
    ...overrides,
  };
}

describe("calculated feed conveyor", () => {
  it("derives the station-frame bed from the pickup grip point and package bottom", () => {
    const conveyor = createCalculatedRobotConveyorModel(input());

    expect(conveyor).not.toBeNull();
    expect(conveyor?.dimensionsMm).toEqual(CALCULATED_CONVEYOR_DIMENSIONS_MM);
    expect(conveyor?.travelAxis).toBe("x");
    expect(conveyor?.centerMm.x).toBeCloseTo(110);
    expect(conveyor?.centerMm.y).toBeCloseTo(220);
    expect(conveyor?.centerMm.z).toBeCloseTo(330);
    expect(conveyor?.provenance).toMatchObject({
      status: "derived",
      source: "calculated-cycle-feed-reference-v1",
    });

    const obstacle = robotConveyorObstacle(conveyor!);
    expect(obstacle.id).toBe(CALCULATED_CONVEYOR_OBSTACLE_ID);
    expect(obstacle.name).toBe("Calculated feed conveyor bed");
    expect(obstacle.boundsMm.minX).toBeCloseTo(-490);
    expect(obstacle.boundsMm.maxX).toBeCloseTo(710);
    expect(obstacle.boundsMm.minY).toBeCloseTo(-30);
    expect(obstacle.boundsMm.maxY).toBeCloseTo(470);
    expect(obstacle.minZMm).toBeCloseTo(260);
    expect(obstacle.maxZMm).toBeCloseTo(400);
  });

  it("uses the same dimensions with a Y-axis footprint for crosswise infeed", () => {
    const conveyor = createCalculatedRobotConveyorModel(
      input({ inletOrientation: "crosswise" }),
    );

    expect(conveyor?.travelAxis).toBe("y");
    const obstacle = robotConveyorObstacle(conveyor!);
    expect(obstacle.boundsMm.minX).toBeCloseTo(-140);
    expect(obstacle.boundsMm.maxX).toBeCloseTo(360);
    expect(obstacle.boundsMm.minY).toBeCloseTo(-380);
    expect(obstacle.boundsMm.maxY).toBeCloseTo(820);
  });

  it("does not infer equipment for imported, explicit, unresolved, or non-finite cycles", () => {
    expect(
      createCalculatedRobotConveyorModel(
        input({ projectSourceKind: "rob-import" }),
      ),
    ).toBeNull();
    expect(
      createCalculatedRobotConveyorModel(
        input({
          cycles: [
            cycle({
              provenance: {
                ...cycle().provenance,
                cycleSource: "explicit-project-cycle",
              },
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      createCalculatedRobotConveyorModel(
        input({
          cycles: [
            cycle({
              pickPose: {
                ...cycle().pickPose,
                frame: "pallet",
              },
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      createCalculatedRobotConveyorModel(
        input({
          cycles: [
            cycle({
              transferPose: {
                ...cycle().transferPose,
                positionMm: {
                  ...cycle().transferPose.positionMm,
                  z: Number.NaN,
                },
              },
            }),
          ],
        }),
      ),
    ).toBeNull();
    expect(
      createCalculatedRobotConveyorModel(
        input({ stack: { packageLayers: [] } }),
      ),
    ).toBeNull();
    expect(
      createCalculatedRobotConveyorModel(input({ cycles: [] })),
    ).toBeNull();
  });
});
