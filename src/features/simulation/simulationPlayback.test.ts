import { describe, expect, it } from "vitest";
import { BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION } from "~/components/rob-viewer/bundledRobotCell";
import {
  createRobotTimeline,
  type RobotCycle,
  type RobotCycleMaterialization,
  type RobotPose,
} from "~/domain/robotics";
import {
  advanceTimelineCursor,
  clampTimelineCursor,
  createSimulationFrame,
  stepTimelineCursor,
  timelinePhaseLabel,
} from "~/features/simulation/simulationPlayback";
import {
  createViewerSimulationCycles,
  timelinePoseToViewerPose,
} from "~/features/simulation/viewerSimulationPlan";

function pose(x: number, y: number, yawDeg = 0, z = 100): RobotPose {
  return {
    frame: "station",
    positionMm: { x, y, z },
    yawDeg,
  };
}

function robotCycle(
  id: string,
  sequence: number,
  placementIds: readonly string[],
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
    placementIds,
    packageCount: placementIds.length,
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
      pickReferenceProvenance: {
        status: "verified",
        source: "test fixture",
      },
      coordinateConvention: "test",
      tcpOffsetConvention: "tcp-to-grasp-vector-subtracted",
      signConventionStatus: "project-defined",
    },
  };
}

const firstCycle = robotCycle(
  "cycle-1",
  0,
  ["placement-1", "placement-2"],
  pose(0, 0),
  pose(100, 0, 90, 300),
  pose(100, 100),
);
const secondCycle = robotCycle(
  "cycle-2",
  1,
  ["placement-3"],
  pose(0, 0),
  pose(200, 0, 0, 300),
  pose(200, 100),
);
const cycles = [firstCycle, secondCycle] as const;

function simulationMaterialization(): Pick<
  RobotCycleMaterialization,
  "cycles" | "stack"
> {
  return {
    cycles,
    stack: {
      packageLayers: [
        {
          packageLayerIndex: 0,
          zBottomMm: 0,
          zTopMm: 100,
          placements: [
            {
              id: "placement-1",
              positionMm: { x: 80, y: 100 },
              rotation: 0,
            },
            {
              id: "placement-2",
              positionMm: { x: 120, y: 100 },
              rotation: 0,
            },
          ],
        },
        {
          packageLayerIndex: 1,
          zBottomMm: 103,
          zTopMm: 203,
          placements: [
            {
              id: "placement-3",
              positionMm: { x: 200, y: 100 },
              rotation: 0,
            },
          ],
        },
      ],
    } as unknown as NonNullable<RobotCycleMaterialization["stack"]>,
  };
}

const timeline = createRobotTimeline(cycles, {
  linearSpeedMmPerSec: 100,
  angularSpeedDegPerSec: 90,
  pickDwellMs: 100,
  placeDwellMs: 100,
  betweenCycleDwellMs: 0,
});
const toViewerPose = (source: RobotPose) => ({
  positionMm: { ...source.positionMm },
  yawDeg: source.yawDeg,
});

describe("simulation playback controls", () => {
  it("advances forward and reverse deterministically with speed and clamps at both ends", () => {
    expect(advanceTimelineCursor(timeline, 0, 50, 2, "forward")).toEqual({
      timeMs: 100,
      reachedEnd: false,
    });
    expect(
      advanceTimelineCursor(
        timeline,
        timeline.durationMs - 10,
        50,
        1,
        "forward",
      ),
    ).toEqual({ timeMs: timeline.durationMs, reachedEnd: true });
    expect(advanceTimelineCursor(timeline, 10, 50, 1, "reverse")).toEqual({
      timeMs: 0,
      reachedEnd: true,
    });
    expect(clampTimelineCursor(timeline, -10)).toBe(0);
    expect(clampTimelineCursor(timeline, timeline.durationMs + 10)).toBe(
      timeline.durationMs,
    );
  });

  it("uses exact previous/next boundaries and stable safe-route labels", () => {
    const firstBoundary = timeline.boundariesMs[1]!;
    expect(stepTimelineCursor(timeline, 0, "forward")).toBe(firstBoundary);
    expect(stepTimelineCursor(timeline, firstBoundary, "reverse")).toBe(0);
    expect(timelinePhaseLabel(timeline.segments[0]!.kind)).toBe("Pick dwell");
    expect(timelinePhaseLabel(timeline.segments[1]!.kind)).toBe("Lift package");
    expect(
      timelinePhaseLabel(
        timeline.segments.find(({ kind }) => kind === "cycle-traverse")!.kind,
      ),
    ).toBe("Travel above feed");
  });
});

describe("absolute-time package state", () => {
  const materialization = simulationMaterialization();
  const firstWindow = timeline.cycleWindows[0]!;
  const secondWindow = timeline.cycleWindows[1]!;

  it("shows only the current feed group on an otherwise empty pallet", () => {
    const frame = createSimulationFrame(
      timeline,
      0,
      materialization,
      toViewerPose,
    );

    expect([...frame.completedPlacementIds]).toEqual([]);
    expect(frame.completedPackageLayerIndexes).toEqual([]);
    expect(frame.feedPlacementIds).toEqual(["placement-1", "placement-2"]);
    expect(frame.attachedPlacementIds).toEqual([]);
    expect(frame.packages).toEqual([
      {
        placementId: "placement-1",
        phase: "feed",
        pose: {
          positionMm: { x: -20, y: 0, z: 50 },
          yawDeg: 0,
        },
      },
      {
        placementId: "placement-2",
        phase: "feed",
        pose: {
          positionMm: { x: 20, y: 0, z: 50 },
          yawDeg: 0,
        },
      },
    ]);
    expect(
      frame.packages.some(({ placementId }) => placementId === "placement-3"),
    ).toBe(false);
  });

  it("attaches exactly at pickup and keeps multipick offsets rigid with the TCP", () => {
    const pickup = createSimulationFrame(
      timeline,
      firstWindow.pickupMs,
      materialization,
      toViewerPose,
    );
    expect(pickup.feedPlacementIds).toEqual([]);
    expect(pickup.attachedPlacementIds).toEqual(["placement-1", "placement-2"]);
    expect(pickup.packages.every(({ phase }) => phase === "attached")).toBe(
      true,
    );

    const traverse = timeline.segments.find(
      ({ cycleIndex, kind }) => cycleIndex === 0 && kind === "pick-traverse",
    )!;
    const timeMs = (traverse.startMs + traverse.endMs) / 2;
    const moving = createSimulationFrame(
      timeline,
      timeMs,
      materialization,
      toViewerPose,
    );
    const [left, right] = moving.packages;
    const tcp = moving.tcpPose!;

    expect(moving.attachedPlacementIds).toEqual(["placement-1", "placement-2"]);
    expect(
      Math.hypot(
        right!.pose.positionMm.x - left!.pose.positionMm.x,
        right!.pose.positionMm.y - left!.pose.positionMm.y,
      ),
    ).toBeCloseTo(40);
    for (const item of moving.packages) {
      expect(
        Math.hypot(
          item.pose.positionMm.x - tcp.positionMm.x,
          item.pose.positionMm.y - tcp.positionMm.y,
        ),
      ).toBeCloseTo(20);
      expect(item.pose.positionMm.z - tcp.positionMm.z).toBeCloseTo(-50);
      expect(item.pose.yawDeg).toBeCloseTo(tcp.yawDeg);
    }
  });

  it("releases at canonical final poses, retains prior placements, and hides future groups", () => {
    const released = createSimulationFrame(
      timeline,
      firstWindow.placeMs,
      materialization,
      toViewerPose,
    );
    expect([...released.completedPlacementIds]).toEqual([
      "placement-1",
      "placement-2",
    ]);
    expect(released.completedPackageLayerIndexes).toEqual([0]);
    expect(released.packages).toEqual([
      {
        placementId: "placement-1",
        phase: "placed",
        pose: {
          positionMm: { x: 80, y: 100, z: 50 },
          yawDeg: 0,
        },
      },
      {
        placementId: "placement-2",
        phase: "placed",
        pose: {
          positionMm: { x: 120, y: 100, z: 50 },
          yawDeg: 0,
        },
      },
    ]);

    const nextCycle = createSimulationFrame(
      timeline,
      secondWindow.startMs,
      materialization,
      toViewerPose,
    );
    expect(nextCycle.completedPackageLayerIndexes).toEqual([0]);
    expect(
      nextCycle.packages.map(({ placementId, phase }) => [placementId, phase]),
    ).toEqual([
      ["placement-1", "placed"],
      ["placement-2", "placed"],
      ["placement-3", "feed"],
    ]);

    const finished = createSimulationFrame(
      timeline,
      timeline.durationMs,
      materialization,
      toViewerPose,
    );
    expect(finished.completedPackageLayerIndexes).toEqual([0, 1]);
    expect(finished.packages.map(({ phase }) => phase)).toEqual([
      "placed",
      "placed",
      "placed",
    ]);
  });

  it("spawns at the confirmed pickup and releases on the calibrated pallet", () => {
    const calibratedCycles = createViewerSimulationCycles(
      cycles,
      toViewerPose,
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
    );
    const calibratedTimeline = createRobotTimeline(calibratedCycles, {
      linearSpeedMmPerSec: 100,
      angularSpeedDegPerSec: 90,
      pickDwellMs: 100,
      placeDwellMs: 100,
      betweenCycleDwellMs: 0,
    });
    const calibratedMaterialization = {
      cycles: calibratedCycles,
      stack: materialization.stack,
    };
    const palletPose =
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION.palletPose;

    const feed = createSimulationFrame(
      calibratedTimeline,
      0,
      calibratedMaterialization,
      timelinePoseToViewerPose,
      palletPose,
    );
    expect(feed.tcpPose).toEqual({
      positionMm: { x: 1_492, y: 207, z: 962 },
      yawDeg: 270,
    });
    expect(feed.packages).toEqual([
      {
        placementId: "placement-1",
        phase: "feed",
        pose: {
          positionMm: { x: 1_492, y: 227, z: 912 },
          yawDeg: 270,
        },
      },
      {
        placementId: "placement-2",
        phase: "feed",
        pose: {
          positionMm: { x: 1_492, y: 187, z: 912 },
          yawDeg: 270,
        },
      },
    ]);

    const released = createSimulationFrame(
      calibratedTimeline,
      calibratedTimeline.cycleWindows[0]!.placeMs,
      calibratedMaterialization,
      timelinePoseToViewerPose,
      palletPose,
    );
    expect(released.packages).toEqual([
      {
        placementId: "placement-1",
        phase: "placed",
        pose: {
          positionMm: { x: 689, y: 75, z: 50 },
          yawDeg: 90,
        },
      },
      {
        placementId: "placement-2",
        phase: "placed",
        pose: {
          positionMm: { x: 689, y: 115, z: 50 },
          yawDeg: 90,
        },
      },
    ]);
  });

  it("returns identical physical state when the same timestamp is reached forward or in reverse", () => {
    const targetTimeMs =
      (timeline.segments[2]!.startMs + timeline.segments[2]!.endMs) / 2;
    const forwardCursor = advanceTimelineCursor(
      timeline,
      0,
      targetTimeMs,
      1,
      "forward",
    );
    const reverseCursor = advanceTimelineCursor(
      timeline,
      timeline.durationMs,
      timeline.durationMs - targetTimeMs,
      1,
      "reverse",
    );

    expect(reverseCursor.timeMs).toBeCloseTo(forwardCursor.timeMs);
    expect(
      createSimulationFrame(
        timeline,
        reverseCursor.timeMs,
        materialization,
        toViewerPose,
      ),
    ).toEqual(
      createSimulationFrame(
        timeline,
        forwardCursor.timeMs,
        materialization,
        toViewerPose,
      ),
    );
  });
});
