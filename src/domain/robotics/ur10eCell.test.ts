import { describe, expect, it } from "vitest";
import type { RobotCycle, RobotPose } from "~/domain/robotics/types";
import {
  BUNDLED_UR10E_CELL,
  GRIPPER_FLANGE_TO_SUCTION_MM,
  blendUr10eCellPoses,
  solveUr10eCellPose,
  ur10eBaseTransform,
  ur10eLiftCandidates,
  ur10ePreferredBranch,
  validateUr10eCellKinematics,
  type Ur10eCellPose,
} from "~/domain/robotics/ur10eCell";
import {
  downwardToolTransform,
  multiplyTransforms,
  transformDeviation,
  ur10eForwardKinematics,
} from "~/domain/robotics/ur10eKinematics";

const DEG = Math.PI / 180;
const PICKUP: Ur10eCellPose = {
  positionMm: { x: 1_492, y: 207, z: 962 },
  yawDeg: -90,
};

function degrees(joints: readonly number[]): number[] {
  return joints.map((angle) => Math.round((angle / DEG) * 1e6) / 1e6);
}

function pose(x: number, y: number, z: number, yawDeg: number): RobotPose {
  return { frame: "pallet", positionMm: { x, y, z }, yawDeg };
}

function cycle(
  id: string,
  sequence: number,
  placePose: RobotPose,
  packageCount = 1,
): RobotCycle {
  const pickPose = pose(1_492, 207, 962, -90);
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
    packageCount,
    gripperId: "gripper-1",
    stationId: "station-1",
    pickPose,
    transferPose: pose(942, 16, 1_162, -180),
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

describe("bundled UR10e lift cell", () => {
  it("keeps the flange-to-suction offset as one provisional 0 mm parameter", () => {
    expect(GRIPPER_FLANGE_TO_SUCTION_MM).toBe(0);
    expect(BUNDLED_UR10E_CELL.flangeToSuctionMm).toBe(0);
    expect(BUNDLED_UR10E_CELL.baseMm).toEqual({
      x: 1_058.6,
      y: 599.5,
      z: 746.1,
    });
    expect(BUNDLED_UR10E_CELL.baseYawDeg).toBe(-45);
    expect(BUNDLED_UR10E_CELL.liftTravelMm).toEqual({ min: 0, max: 900 });
    expect(ur10ePreferredBranch(BUNDLED_UR10E_CELL)).toEqual({
      shoulder: 0,
      wrist: 1,
      elbow: 0,
    });
  });

  it("starts the lift search at the preferred TCP height and widens symmetrically", () => {
    const candidates = ur10eLiftCandidates(PICKUP, BUNDLED_UR10E_CELL);
    expect(
      candidates.slice(0, 5).map((value) => Math.round(value * 10) / 10),
    ).toEqual([415.9, 405.9, 425.9, 395.9, 435.9]);
    // 5.9 … 895.9 mm in 10 mm steps plus both end stops.
    expect(candidates).toHaveLength(92);
    expect(
      ur10eLiftCandidates(
        { positionMm: { x: 0, y: 0, z: 0 }, yawDeg: 0 },
        BUNDLED_UR10E_CELL,
      ).slice(0, 4),
    ).toEqual([0, 10, 20, 30]);
  });

  it("solves the calibrated conveyor pickup and reproduces it by forward kinematics", () => {
    const solution = solveUr10eCellPose(PICKUP);

    expect(solution.status).toBe("solved");
    if (solution.status !== "solved") return;
    expect(solution.liftMm).toBeCloseTo(415.9, 9);
    expect(degrees(solution.joints)).toEqual([
      165.507316, -29.233318, 128.937033, -189.703715, -90, -59.492684,
    ]);
    expect(solution.branch).toEqual({ shoulder: 0, wrist: 1, elbow: 0 });
    expect(solution.singularities).toEqual([]);

    const tcpInCell = multiplyTransforms(
      ur10eBaseTransform(BUNDLED_UR10E_CELL, solution.liftMm),
      ur10eForwardKinematics(solution.joints),
    );
    const deviation = transformDeviation(
      tcpInCell,
      downwardToolTransform(PICKUP.positionMm, PICKUP.yawDeg * DEG),
    );
    expect(deviation.positionMm).toBeLessThan(1e-6);
    expect(deviation.rotation).toBeLessThan(1e-9);
  });

  it("moves the flange up by the configured flange-to-suction offset", () => {
    const offsetCell = { ...BUNDLED_UR10E_CELL, flangeToSuctionMm: 150 };
    const withOffset = solveUr10eCellPose(PICKUP, offsetCell);
    const raised = solveUr10eCellPose(
      { ...PICKUP, positionMm: { ...PICKUP.positionMm, z: 1_112 } },
      BUNDLED_UR10E_CELL,
    );
    expect(withOffset).toEqual(raised);
  });

  it("reports unreachable poses with the wrist distance at the first lift tried", () => {
    expect(
      solveUr10eCellPose({
        positionMm: { x: 3_000, y: 3_000, z: 500 },
        yawDeg: 0,
      }),
    ).toEqual({
      status: "unreachable",
      liftMm: 0,
      wristDistanceMm: expect.closeTo(3_102.851797, 6) as number,
    });
    // Straight below the base the wrist stays inside the d4 shoulder offset.
    expect(
      solveUr10eCellPose({
        positionMm: { x: 1_058.6, y: 599.5, z: 500 },
        yawDeg: 0,
      }),
    ).toEqual({
      status: "unreachable",
      liftMm: 0,
      wristDistanceMm: expect.closeTo(310.25, 9) as number,
    });
  });

  it("flags a TCP close to the base axis as near the shoulder singularity", () => {
    const solution = solveUr10eCellPose({
      positionMm: { x: 1_058.6 - 180, y: 599.5, z: 900 },
      yawDeg: 0,
    });
    expect(solution.status).toBe("solved");
    if (solution.status !== "solved") return;
    expect(solution.singularities).toEqual(["shoulder"]);
    expect(solution.margins.shoulderMm).toBeCloseTo(45.516783, 6);
    expect(solution.liftMm).toBeCloseTo(353.9, 9);
  });
});

describe("UR10e cycle checks", () => {
  const reachable = cycle("cycle-1", 0, pose(789, 795, 250, 90));
  const unreachable = cycle("cycle-2", 1, pose(-900, -900, 250, 90));

  it("reports an unreachable place pose with its own code", () => {
    const result = validateUr10eCellKinematics([reachable, unreachable], {
      packageWeightKg: 5,
    });

    expect(result.summary).toEqual({
      robot: "UR10e",
      installationId: "bundled-ur10e-lift-cell",
      cycleCount: 2,
      waypointCount: 12,
      solvedWaypointCount: 10,
      unreachableWaypointCount: 2,
      jointLimitWaypointCount: 0,
      singularWaypointCount: 0,
      configurationChangeCount: 0,
      pathSampleCount: 30,
      unsolvedPathSampleCount: 7,
      liftUsedMm: { min: 0, max: expect.closeTo(615.9, 9) as number },
      payload: {
        status: "checked",
        maxPayloadKg: 5,
        limitKg: 12.5,
        gripperMassIncluded: false,
        exceededCycleCount: 0,
      },
    });
    expect(
      result.diagnostics.map(({ code, cycleId, details }) => [
        code,
        cycleId,
        details?.phase,
      ]),
    ).toEqual([
      // Straight moves first (one finding per move), then the waypoints.
      [
        "kinematics-unreachable",
        "cycle-2",
        "previous-place-retract→pick-approach",
      ],
      ["kinematics-unreachable", "cycle-2", "transfer→place-approach"],
      ["kinematics-unreachable", "cycle-2", "place-approach→place"],
      ["kinematics-unreachable", "cycle-2", "place-approach"],
      ["kinematics-unreachable", "cycle-2", "place"],
    ]);
    expect(result.diagnostics[4]).toMatchObject({
      severity: "warning",
      phase: "kinematics",
      layerId: "layer-1",
      resourceId: "bundled-ur10e-lift-cell",
      message:
        'Cycle "cycle-2" place TCP (-900, -900, 250) mm is outside the UR10e reach for every lift position (wrist 2529.525 mm from the shoulder at lift 0 mm).',
    });
  });

  it("reports payload above 12.5 kg and skips the check without a package weight", () => {
    const heavy = validateUr10eCellKinematics(
      [cycle("cycle-1", 0, pose(789, 795, 250, 90), 3)],
      { packageWeightKg: 5 },
    );
    expect(heavy.summary.payload).toEqual({
      status: "checked",
      maxPayloadKg: 15,
      limitKg: 12.5,
      gripperMassIncluded: false,
      exceededCycleCount: 1,
    });
    expect(heavy.diagnostics).toEqual([
      {
        severity: "warning",
        phase: "kinematics",
        code: "kinematics-payload-exceeded",
        message:
          'Cycle "cycle-1" carries 15 kg (3 × 5 kg, gripper mass not recorded), above the UR10e payload of 12.5 kg.',
        cycleId: "cycle-1",
        layerId: "layer-1",
        resourceId: "bundled-ur10e-lift-cell",
        details: {
          payloadKg: 15,
          limitKg: 12.5,
          packageCount: 3,
          gripperMassIncluded: false,
        },
      },
    ]);

    const withGripper = validateUr10eCellKinematics([reachable], {
      installation: { ...BUNDLED_UR10E_CELL, gripperMassKg: 8 },
      packageWeightKg: 5,
    });
    expect(withGripper.diagnostics.map(({ code }) => code)).toEqual([
      "kinematics-payload-exceeded",
    ]);
    expect(withGripper.summary.payload).toMatchObject({
      maxPayloadKg: 13,
      gripperMassIncluded: true,
    });

    const unweighted = validateUr10eCellKinematics([reachable], {
      packageWeightKg: null,
    });
    expect(unweighted.summary.payload).toEqual({
      status: "not-checked",
      reason: "missing-package-weight",
    });
    expect(unweighted.diagnostics.map(({ code }) => code)).toEqual([
      "kinematics-payload-not-checked",
    ]);
  });

  it("finds an unreachable straight return and clears it with a via point", () => {
    const direct = validateUr10eCellKinematics(
      [reachable, cycle("cycle-2", 1, pose(789, 795, 250, 90))],
      { packageWeightKg: 5 },
    );
    expect(direct.summary).toMatchObject({
      waypointCount: 12,
      solvedWaypointCount: 12,
      pathSampleCount: 30,
      unsolvedPathSampleCount: 2,
    });
    expect(direct.diagnostics).toEqual([
      {
        severity: "warning",
        phase: "kinematics",
        code: "kinematics-unreachable",
        message:
          'Cycle "cycle-2" move previous-place-retract → pick-approach passes TCP (964.75, 648, 1162) mm, which the UR10e cannot reach at any lift position.',
        cycleId: "cycle-2",
        layerId: "layer-1",
        resourceId: "bundled-ur10e-lift-cell",
        details: {
          phase: "previous-place-retract→pick-approach",
          check: "path-sample",
          fraction: 0.25,
        },
      },
    ]);

    const viaBase = validateUr10eCellKinematics(
      [
        reachable,
        {
          ...cycle("cycle-2", 1, pose(789, 795, 250, 90)),
          returnTransferPose: pose(942, 16, 1_162, 0),
        },
      ],
      { packageWeightKg: 5 },
    );
    expect(viaBase.summary).toMatchObject({
      waypointCount: 13,
      solvedWaypointCount: 13,
      pathSampleCount: 33,
      unsolvedPathSampleCount: 0,
    });
    expect(viaBase.diagnostics).toEqual([]);
  });

  it("solves the place pre-position and samples the diagonal slide", () => {
    const vertical = validateUr10eCellKinematics([reachable], {
      packageWeightKg: 5,
    });
    const lateral = validateUr10eCellKinematics(
      [{ ...reachable, placeApproachPose: pose(789, 875, 300, 90) }],
      { packageWeightKg: 5 },
    );
    expect(vertical.summary).toMatchObject({
      waypointCount: 5,
      solvedWaypointCount: 5,
      pathSampleCount: 12,
    });
    // + place-approach-above and the pre-position; + one slide segment.
    expect(lateral.summary).toMatchObject({
      waypointCount: 6,
      solvedWaypointCount: 6,
      pathSampleCount: 15,
      unsolvedPathSampleCount: 0,
    });
    expect(lateral.waypoints.map(({ name }) => name).slice(-3)).toEqual([
      "place-approach-above",
      "place-approach",
      "place",
    ]);
  });

  it("blends joints between the solved ends of a move", () => {
    const blend = blendUr10eCellPoses(
      { positionMm: { x: 1_492, y: 207, z: 1_162 }, yawDeg: -90 },
      { positionMm: { x: 789, y: 795, z: 1_162 }, yawDeg: 90 },
      0.5,
    );
    expect(blend?.liftMm).toBeCloseTo(615.9, 9);
    expect(degrees(blend!.joints)).toEqual([
      71.515095, -19.317098, 139.374849, -210.057751, -90, -63.484905,
    ]);
    expect(
      blendUr10eCellPoses(
        { positionMm: { x: 3_000, y: 3_000, z: 500 }, yawDeg: 0 },
        PICKUP,
        0.5,
      ),
    ).toBeNull();
  });

  it("solves every pose identically regardless of the cycle order", () => {
    const cycles = [
      reachable,
      cycle("cycle-3", 2, pose(389, 795, 500, 0)),
      cycle("cycle-4", 3, pose(389, 395, 750, 180)),
    ];
    const key = ({ pose: value }: { pose: Ur10eCellPose }) =>
      `${value.positionMm.x}/${value.positionMm.y}/${value.positionMm.z}/${value.yawDeg}`;
    const byPose = (result: ReturnType<typeof validateUr10eCellKinematics>) =>
      new Map(
        result.waypoints.map((waypoint) => [key(waypoint), waypoint.solution]),
      );

    const forward = byPose(
      validateUr10eCellKinematics(cycles, { packageWeightKg: 5 }),
    );
    const reversed = byPose(
      validateUr10eCellKinematics([...cycles].reverse(), {
        packageWeightKg: 5,
      }),
    );

    // Pick, pick-lift and transfer are shared; each place adds two poses.
    expect(forward.size).toBe(9);
    for (const [poseKey, solution] of forward) {
      expect(reversed.get(poseKey)).toEqual(solution);
    }
  });
});
