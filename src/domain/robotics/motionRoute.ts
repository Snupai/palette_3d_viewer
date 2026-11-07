import type { RobotCycle, RobotPose } from "~/domain/robotics/types";

export type RobotMotionSegmentKind =
  | "cycle-retract"
  | "cycle-traverse"
  | "pick-approach"
  | "pick-lift"
  | "pick-traverse"
  | "transfer-traverse"
  | "place-approach"
  | "place-slide";

export type RobotMotionWaypointName =
  | "previous-place"
  | "previous-place-retract"
  | "pick-approach"
  | "pick"
  | "pick-lift"
  | "return-transfer"
  | "transfer"
  | "place-approach-above"
  | "place-approach"
  | "place";

export type RobotMotionWaypoint = {
  name: RobotMotionWaypointName;
  pose: RobotPose;
};

export type RobotMotionSegment = {
  kind: RobotMotionSegmentKind;
  from: RobotMotionWaypoint;
  to: RobotMotionWaypoint;
};

export type RobotMotionRoute = {
  waypoints: readonly RobotMotionWaypoint[];
  segments: readonly RobotMotionSegment[];
};

function poseAt(
  source: RobotPose,
  positionMm: RobotPose["positionMm"],
  yawDeg = source.yawDeg,
): RobotPose {
  return {
    frame: source.frame,
    positionMm: { ...positionMm },
    yawDeg,
  };
}

function assertOneFrame(poses: readonly RobotPose[], message: string): void {
  const frame = poses[0]?.frame;
  if (poses.some((pose) => pose.frame !== frame)) throw new Error(message);
}

function routeFrom(
  waypoints: readonly RobotMotionWaypoint[],
  kinds: readonly RobotMotionSegmentKind[],
): RobotMotionRoute {
  return {
    waypoints,
    segments: kinds.map((kind, index) => ({
      kind,
      from: waypoints[index]!,
      to: waypoints[index + 1]!,
    })),
  };
}

/**
 * Canonical carried route. Horizontal motion occurs only at the highest supplied
 * cycle Z, and pickup uses a same-X/Y vertical move.
 *
 * Without a place pre-position (`.rob` dx/dy `0 0`) the place is a same-X/Y
 * vertical move. With one, the robot traverses above the pre-position, lowers
 * to it (`place-approach`) and then moves diagonally into the final place
 * (`place-slide`), see `~/domain/placeApproach`.
 */
export function createRobotCycleMotionRoute(
  cycle: Pick<RobotCycle, "pickPose" | "transferPose" | "placePose"> &
    Partial<Pick<RobotCycle, "placeApproachPose">>,
): RobotMotionRoute {
  const approach = cycle.placeApproachPose ?? null;
  assertOneFrame(
    [
      cycle.pickPose,
      cycle.transferPose,
      cycle.placePose,
      ...(approach ? [approach] : []),
    ],
    "Cycle pick, transfer, place, and place-approach poses must use one coordinate frame.",
  );
  const safeZ = Math.max(
    cycle.pickPose.positionMm.z,
    cycle.transferPose.positionMm.z,
    cycle.placePose.positionMm.z,
    approach?.positionMm.z ?? Number.NEGATIVE_INFINITY,
  );
  const carried: RobotMotionWaypoint[] = [
    { name: "pick", pose: cycle.pickPose },
    {
      name: "pick-lift",
      pose: poseAt(cycle.pickPose, {
        ...cycle.pickPose.positionMm,
        z: safeZ,
      }),
    },
    {
      name: "transfer",
      pose: poseAt(
        cycle.transferPose,
        { ...cycle.transferPose.positionMm, z: safeZ },
        cycle.transferPose.yawDeg,
      ),
    },
  ];
  if (!approach) {
    return routeFrom(
      [
        ...carried,
        {
          name: "place-approach",
          pose: poseAt(
            cycle.placePose,
            { ...cycle.placePose.positionMm, z: safeZ },
            cycle.placePose.yawDeg,
          ),
        },
        { name: "place", pose: cycle.placePose },
      ],
      ["pick-lift", "pick-traverse", "transfer-traverse", "place-approach"],
    );
  }
  const above =
    approach.positionMm.z < safeZ
      ? [
          {
            name: "place-approach-above" as const,
            pose: poseAt(
              approach,
              { ...approach.positionMm, z: safeZ },
              approach.yawDeg,
            ),
          },
        ]
      : [];
  return routeFrom(
    [
      ...carried,
      ...above,
      { name: "place-approach", pose: approach },
      { name: "place", pose: cycle.placePose },
    ],
    [
      "pick-lift",
      "pick-traverse",
      ...(above.length > 0 ? (["transfer-traverse"] as const) : []),
      "place-approach",
      "place-slide",
    ],
  );
}

/** Return route between cycles, with vertical retract and vertical pick approach. */
export function createRobotCycleTransitionRoute(
  previous: Pick<RobotCycle, "transferPose" | "placePose">,
  next: Pick<RobotCycle, "pickPose" | "transferPose" | "returnTransferPose">,
): RobotMotionRoute {
  assertOneFrame(
    [
      previous.placePose,
      previous.transferPose,
      next.pickPose,
      next.transferPose,
      ...(next.returnTransferPose ? [next.returnTransferPose] : []),
    ],
    "Consecutive robot cycles must use one coordinate frame.",
  );
  const safeZ = Math.max(
    previous.placePose.positionMm.z,
    previous.transferPose.positionMm.z,
    next.pickPose.positionMm.z,
    next.transferPose.positionMm.z,
  );
  const via = next.returnTransferPose;
  const waypoints: RobotMotionWaypoint[] = [
    { name: "previous-place", pose: previous.placePose },
    {
      name: "previous-place-retract",
      pose: poseAt(previous.placePose, {
        ...previous.placePose.positionMm,
        z: safeZ,
      }),
    },
    ...(via
      ? [
          {
            name: "return-transfer" as const,
            pose: poseAt(via, { ...via.positionMm, z: safeZ }),
          },
        ]
      : []),
    {
      name: "pick-approach",
      pose: poseAt(
        next.pickPose,
        { ...next.pickPose.positionMm, z: safeZ },
        next.pickPose.yawDeg,
      ),
    },
    { name: "pick", pose: next.pickPose },
  ];
  return routeFrom(waypoints, [
    "cycle-retract",
    "cycle-traverse",
    ...(via ? (["cycle-traverse"] as const) : []),
    "pick-approach",
  ]);
}
