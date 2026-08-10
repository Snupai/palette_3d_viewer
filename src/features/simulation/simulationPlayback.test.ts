import { describe, expect, it } from "vitest";
import {
  createRobotTimeline,
  type RobotCycle,
  type RobotPose,
} from "~/domain/robotics";
import {
  advanceTimelineCursor,
  clampTimelineCursor,
  stepTimelineCursor,
  timelinePhaseLabel,
} from "~/features/simulation/simulationPlayback";

function pose(x: number, y: number, yawDeg = 0): RobotPose {
  return {
    frame: "station",
    positionMm: { x, y, z: 100 },
    yawDeg,
  };
}

const cycle: RobotCycle = {
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
  pickPose: pose(0, 0),
  transferPose: pose(100, 0, 90),
  placePose: pose(100, 100, 90),
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

describe("simulation playback controls", () => {
  const timeline = createRobotTimeline([cycle], {
    linearSpeedMmPerSec: 100,
    angularSpeedDegPerSec: 90,
    pickDwellMs: 100,
    placeDwellMs: 100,
    betweenCycleDwellMs: 0,
  });

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

  it("uses exact previous/next boundaries and stable phase labels", () => {
    const firstBoundary = timeline.boundariesMs[1]!;
    expect(stepTimelineCursor(timeline, 0, "forward")).toBe(firstBoundary);
    expect(stepTimelineCursor(timeline, firstBoundary, "reverse")).toBe(0);
    expect(timelinePhaseLabel(timeline.segments[0]!.kind)).toBe("Pick dwell");
    expect(timelinePhaseLabel(timeline.segments[1]!.kind)).toBe(
      "Pick → transfer",
    );
  });
});
