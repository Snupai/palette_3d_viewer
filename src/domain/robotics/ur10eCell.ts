import { interpolateRobotPose } from "~/domain/robotics/frames";
import {
  createRobotCycleMotionRoute,
  createRobotCycleTransitionRoute,
  type RobotMotionWaypoint,
} from "~/domain/robotics/motionRoute";
import type {
  RobotCycle,
  RobotDiagnostic,
  RobotDiagnosticCode,
  Vector3Mm,
} from "~/domain/robotics/types";
import {
  UR10E,
  downwardToolTransform,
  invertRigidTransform,
  jointDistance,
  multiplyTransforms,
  rotationZTransform,
  sameBranch,
  selectUr10eSolution,
  translationTransform,
  ur10eForwardKinematics,
  ur10eInverseKinematics,
  ur10eSingularityMargins,
  unwrapJointsNear,
  type Transform4,
  type Ur10eBranch,
  type Ur10eJoints,
  type Ur10eSingularityMargins,
} from "~/domain/robotics/ur10eKinematics";

/**
 * Distance from the UR10e flange (`tool0`) to the gripper suction face along
 * the tool axis. Measured on `public/models/gripper/10_01_43_00016.obj`: the
 * Ø 63 mm flange adapter face sits at CAD y = 111.0 (the Ø 31.5 mm centring
 * spigot above it, up to y = 117.0, enters the robot flange recess), the
 * suction face at y = −20.4. This is the single place to change it.
 */
export const GRIPPER_FLANGE_TO_SUCTION_MM = 131.4;

/**
 * Horizontal offset of the flange axis from the suction-face centre along the
 * gripper's local X axis (which turns with the tool yaw). Measured on the same
 * model: flange adapter centre at CAD x = −102.0, suction face centre at
 * x = −51.1.
 */
export const GRIPPER_FLANGE_OFFSET_X_MM = -50.9;

export type Ur10eSingularityKind = "shoulder" | "elbow" | "wrist";

export type Ur10eCellInstallation = {
  id: string;
  /** UR base frame origin at zero lift travel, in the cell (viewer) frame. */
  baseMm: Vector3Mm;
  /** Rotation of the UR base frame about the cell Z axis. */
  baseYawDeg: number;
  /** Vertical lift axis carrying the robot base. */
  liftTravelMm: { min: number; max: number };
  flangeToSuctionMm: number;
  /** Flange axis offset from the suction centre along the tool's local X. */
  flangeOffsetXMm: number;
  /** Gripper mass counted against the payload; null when not recorded. */
  gripperMassKg: number | null;
  /** Reference posture for the configuration choice and joint unwrapping. */
  homeJointsDeg: readonly [number, number, number, number, number, number];
  /** Lift target: TCP height above the robot base the lift tries to keep. */
  preferredTcpHeightAboveBaseMm: number;
  liftSearchStepMm: number;
  singularityLimits: {
    shoulderMm: number;
    elbowDeg: number;
    wristDeg: number;
  };
};

/**
 * UR10e on the lift carriage of the bundled CAD cell
 * (`public/models/robot-cell/ur10-palletizer.glb`, node `eSeries_UR10e_1`).
 * Base position and yaw are the CAD mount node mapped into the viewer frame
 * (source (-141.4, 890.1, 1400.5) m·10⁻³, −45° about the vertical), lowered by
 * `UR10E_MOUNT_BELOW_CAD_NODE_MM` onto the carriage plate; the CAD
 * base part does not show the cable outlet reliably, so the base yaw is the
 * mount yaw. Lift travel is the CAD Ewellix column travel.
 */
/**
 * The CAD mount node sits 13.2 mm above the lift-carriage plate (plate top at
 * source y = 876.9 mm, node at 890.1 mm, measured in `ur10-palletizer.glb`).
 * The URDF base frame is the bottom face of the base, so the articulated arm
 * is lowered by this amount to stand on the plate.
 */
export const UR10E_MOUNT_BELOW_CAD_NODE_MM = -13.2;

export const BUNDLED_UR10E_CELL: Ur10eCellInstallation = {
  id: "bundled-ur10e-lift-cell",
  baseMm: { x: 1_058.6, y: 599.5, z: 746.1 + UR10E_MOUNT_BELOW_CAD_NODE_MM },
  baseYawDeg: -45,
  liftTravelMm: { min: 0, max: 900 },
  flangeToSuctionMm: GRIPPER_FLANGE_TO_SUCTION_MM,
  flangeOffsetXMm: GRIPPER_FLANGE_OFFSET_X_MM,
  gripperMassKg: null,
  // Tool-down posture; the base angle sits mid-way between the conveyor
  // (≈166°) and the far pallet side (≈−22°) so joint unwrapping never wraps
  // between pick and place.
  homeJointsDeg: [70, -90, 90, -90, -90, 0],
  preferredTcpHeightAboveBaseMm: -200,
  liftSearchStepMm: 10,
  singularityLimits: { shoulderMm: 100, elbowDeg: 10, wristDeg: 10 },
};

/** Pose in the cell frame: Z up, mm, yaw about Z in degrees; tool points down. */
export type Ur10eCellPose = {
  positionMm: Vector3Mm;
  yawDeg: number;
};

export type Ur10eCellSolution =
  | {
      status: "solved";
      liftMm: number;
      joints: Ur10eJoints;
      branch: Ur10eBranch;
      margins: Ur10eSingularityMargins;
      singularities: readonly Ur10eSingularityKind[];
    }
  | {
      /** IK solutions exist only outside the joint limits. */
      status: "joint-limit";
      liftMm: number;
    }
  | {
      status: "unreachable";
      /** Lift position closest to the target that was tried first. */
      liftMm: number;
      /** Wrist-centre distance from the shoulder at that lift. */
      wristDistanceMm: number;
    };

const DEG = Math.PI / 180;

function degToRad(values: readonly number[]): Ur10eJoints {
  return values.map((value) => value * DEG) as unknown as Ur10eJoints;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ur10eHomeJoints(
  installation: Ur10eCellInstallation,
): Ur10eJoints {
  return degToRad(installation.homeJointsDeg);
}

/** Branch of the home posture; the configuration the cell prefers. */
export function ur10ePreferredBranch(
  installation: Ur10eCellInstallation,
): Ur10eBranch {
  const home = ur10eHomeJoints(installation);
  // The home posture itself is one of the IK solutions of its own flange pose.
  const solution = ur10eInverseKinematics(ur10eForwardKinematics(home))
    .map((candidate) => ({
      branch: candidate.branch,
      joints: unwrapJointsNear(candidate.joints, home),
    }))
    .filter(({ joints }) => joints !== null)
    .sort(
      (left, right) =>
        jointDistance(left.joints!, home) - jointDistance(right.joints!, home),
    )[0];
  if (!solution) throw new Error("UR10e home posture has no IK solution.");
  return solution.branch;
}

/** Robot base transform in the cell frame at a lift position. */
export function ur10eBaseTransform(
  installation: Ur10eCellInstallation,
  liftMm: number,
): Transform4 {
  return multiplyTransforms(
    translationTransform(
      installation.baseMm.x,
      installation.baseMm.y,
      installation.baseMm.z + liftMm,
    ),
    rotationZTransform(installation.baseYawDeg * DEG),
  );
}

/** Flange target in the UR base frame for a TCP pose in the cell frame. */
export function ur10eFlangeTarget(
  pose: Ur10eCellPose,
  installation: Ur10eCellInstallation,
  liftMm: number,
): Transform4 {
  const yawRad = pose.yawDeg * DEG;
  const flangeInCell = downwardToolTransform(
    {
      x: pose.positionMm.x + installation.flangeOffsetXMm * Math.cos(yawRad),
      y: pose.positionMm.y + installation.flangeOffsetXMm * Math.sin(yawRad),
      z: pose.positionMm.z + installation.flangeToSuctionMm,
    },
    yawRad,
  );
  return multiplyTransforms(
    invertRigidTransform(ur10eBaseTransform(installation, liftMm)),
    flangeInCell,
  );
}

export function ur10eSingularities(
  margins: Ur10eSingularityMargins,
  limits: Ur10eCellInstallation["singularityLimits"],
): Ur10eSingularityKind[] {
  const result: Ur10eSingularityKind[] = [];
  if (margins.shoulderMm < limits.shoulderMm) result.push("shoulder");
  if (margins.elbowDeg < limits.elbowDeg) result.push("elbow");
  if (margins.wristDeg < limits.wristDeg) result.push("wrist");
  return result;
}

/** Lift positions in search order: preferred first, then outward, lower first on ties. */
export function ur10eLiftCandidates(
  pose: Ur10eCellPose,
  installation: Ur10eCellInstallation,
): number[] {
  const { min, max } = installation.liftTravelMm;
  const preferred = clamp(
    pose.positionMm.z +
      installation.flangeToSuctionMm -
      installation.baseMm.z -
      installation.preferredTcpHeightAboveBaseMm,
    min,
    max,
  );
  const step = installation.liftSearchStepMm;
  const candidates = [preferred];
  for (let offset = step; offset <= max - min + step; offset += step) {
    for (const value of [preferred - offset, preferred + offset]) {
      const bounded = clamp(value, min, max);
      if (!candidates.includes(bounded)) candidates.push(bounded);
    }
  }
  return candidates;
}

function wristDistanceMm(target: Transform4): number {
  const { d1, d6 } = UR10E.dhMm;
  // Wrist point above the flange along the tool axis, measured from the shoulder.
  const x = target[3]! - target[2]! * d6;
  const y = target[7]! - target[6]! * d6;
  const z = target[11]! - target[10]! * d6 - d1;
  return Math.hypot(x, y, z);
}

/**
 * Lift position and joint angles for one TCP pose. Deterministic and
 * independent of any other pose: the lift starts at the height that keeps the
 * TCP `preferredTcpHeightAboveBaseMm` above the base and searches outward in
 * `liftSearchStepMm` steps for a solution clear of singularities.
 */
export function solveUr10eCellPose(
  pose: Ur10eCellPose,
  installation: Ur10eCellInstallation = BUNDLED_UR10E_CELL,
): Ur10eCellSolution {
  const home = ur10eHomeJoints(installation);
  const preferredBranch = ur10ePreferredBranch(installation);
  const candidates = ur10eLiftCandidates(pose, installation);
  let firstSingular: Extract<Ur10eCellSolution, { status: "solved" }> | null =
    null;
  let firstJointLimit: number | null = null;
  for (const liftMm of candidates) {
    const solutions = ur10eInverseKinematics(
      ur10eFlangeTarget(pose, installation, liftMm),
    );
    if (solutions.length === 0) continue;
    const selected = selectUr10eSolution(solutions, home, preferredBranch);
    if (!selected) {
      firstJointLimit ??= liftMm;
      continue;
    }
    const margins = ur10eSingularityMargins(selected.joints);
    const singularities = ur10eSingularities(
      margins,
      installation.singularityLimits,
    );
    const solution = {
      status: "solved" as const,
      liftMm,
      joints: selected.joints,
      branch: selected.branch,
      margins,
      singularities,
    };
    if (singularities.length === 0) return solution;
    firstSingular ??= solution;
  }
  if (firstSingular) return firstSingular;
  if (firstJointLimit !== null) {
    return { status: "joint-limit", liftMm: firstJointLimit };
  }
  const liftMm = candidates[0]!;
  return {
    status: "unreachable",
    liftMm,
    wristDistanceMm: wristDistanceMm(
      ur10eFlangeTarget(pose, installation, liftMm),
    ),
  };
}

export type Ur10eWaypointResult = {
  cycleId: string;
  name: RobotMotionWaypoint["name"];
  pose: Ur10eCellPose;
  solution: Ur10eCellSolution;
};

export type Ur10ePayloadCheck =
  | {
      status: "checked";
      maxPayloadKg: number;
      limitKg: number;
      gripperMassIncluded: boolean;
      exceededCycleCount: number;
    }
  | { status: "not-checked"; reason: "missing-package-weight" };

export type Ur10eCellKinematicsSummary = {
  robot: typeof UR10E.model;
  installationId: string;
  cycleCount: number;
  waypointCount: number;
  solvedWaypointCount: number;
  unreachableWaypointCount: number;
  jointLimitWaypointCount: number;
  singularWaypointCount: number;
  configurationChangeCount: number;
  /** Interior samples of the straight moves between consecutive waypoints. */
  pathSampleCount: number;
  /** Path samples without a solution (out of reach or outside joint limits). */
  unsolvedPathSampleCount: number;
  liftUsedMm: { min: number; max: number } | null;
  payload: Ur10ePayloadCheck;
};

export type Ur10eCellKinematicsResult = {
  summary: Ur10eCellKinematicsSummary;
  waypoints: readonly Ur10eWaypointResult[];
  diagnostics: readonly RobotDiagnostic[];
};

function cycleWaypoints(
  cycles: readonly RobotCycle[],
  index: number,
): readonly RobotMotionWaypoint[] {
  const cycle = cycles[index]!;
  const carried = createRobotCycleMotionRoute(cycle).waypoints;
  const previous = cycles[index - 1];
  if (!previous) return carried;
  const transition = createRobotCycleTransitionRoute(previous, cycle).waypoints;
  // The transition starts at the previous place and ends at this pick, which
  // the previous cycle and the carried route already cover.
  return [...transition.slice(1, -1), ...carried];
}

/** Interior fractions sampled on every straight move between waypoints. */
export const UR10E_PATH_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75] as const;

const SINGULARITY_CODES: Record<Ur10eSingularityKind, RobotDiagnosticCode> = {
  shoulder: "kinematics-singularity-shoulder",
  elbow: "kinematics-singularity-elbow",
  wrist: "kinematics-singularity-wrist",
};

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * UR10e checks for cycles whose poses are expressed in the cell frame: reach
 * (an IK solution exists with the lift axis), joint limits, proximity to the
 * shoulder/elbow/wrist singularities, configuration changes between
 * consecutive route waypoints, and payload (gripper + packages). Results do
 * not depend on the order in which waypoints are evaluated.
 */
export function validateUr10eCellKinematics(
  cycles: readonly RobotCycle[],
  options: {
    installation?: Ur10eCellInstallation;
    packageWeightKg: number | null;
  },
): Ur10eCellKinematicsResult {
  const installation = options.installation ?? BUNDLED_UR10E_CELL;
  const diagnostics: RobotDiagnostic[] = [];
  const waypoints: Ur10eWaypointResult[] = [];
  let configurationChangeCount = 0;
  let pathSampleCount = 0;
  let unsolvedPathSampleCount = 0;

  for (let index = 0; index < cycles.length; index += 1) {
    const cycle = cycles[index]!;
    const route = cycleWaypoints(cycles, index);
    // Straight moves between waypoints: report the first unsolved interior
    // sample per move, since the animation interpolates the TCP linearly.
    for (let step = 1; step < route.length; step += 1) {
      const from = route[step - 1]!;
      const to = route[step]!;
      let reported = false;
      for (const fraction of UR10E_PATH_SAMPLE_FRACTIONS) {
        pathSampleCount += 1;
        const sample = interpolateRobotPose(from.pose, to.pose, fraction);
        const solution = solveUr10eCellPose(sample, installation);
        if (solution.status === "solved") continue;
        unsolvedPathSampleCount += 1;
        if (reported) continue;
        reported = true;
        const p = sample.positionMm;
        diagnostics.push({
          severity: "warning",
          phase: "kinematics",
          code:
            solution.status === "unreachable"
              ? "kinematics-unreachable"
              : "kinematics-joint-limit",
          message: `Cycle "${cycle.id}" move ${from.name} → ${to.name} passes TCP (${round3(p.x)}, ${round3(p.y)}, ${round3(p.z)}) mm, which the ${UR10E.model} cannot reach${solution.status === "joint-limit" ? " within its joint limits" : " at any lift position"}.`,
          cycleId: cycle.id,
          layerId: cycle.physicalLayerId,
          resourceId: installation.id,
          details: {
            phase: `${from.name}→${to.name}`,
            check: "path-sample",
            fraction,
          },
        });
      }
    }
    let previous: Ur10eWaypointResult | null = null;
    for (const waypoint of route) {
      const pose = {
        positionMm: { ...waypoint.pose.positionMm },
        yawDeg: waypoint.pose.yawDeg,
      };
      const solution = solveUr10eCellPose(pose, installation);
      const result = { cycleId: cycle.id, name: waypoint.name, pose, solution };
      waypoints.push(result);
      const context = {
        cycleId: cycle.id,
        layerId: cycle.physicalLayerId,
        resourceId: installation.id,
      };
      const where = `Cycle "${cycle.id}" ${waypoint.name} TCP (${round3(pose.positionMm.x)}, ${round3(pose.positionMm.y)}, ${round3(pose.positionMm.z)}) mm`;
      if (solution.status === "unreachable") {
        diagnostics.push({
          severity: "warning",
          phase: "kinematics",
          code: "kinematics-unreachable",
          message: `${where} is outside the ${UR10E.model} reach for every lift position (wrist ${round3(solution.wristDistanceMm)} mm from the shoulder at lift ${round3(solution.liftMm)} mm).`,
          ...context,
          details: {
            phase: waypoint.name,
            liftMm: round3(solution.liftMm),
            wristDistanceMm: round3(solution.wristDistanceMm),
            reachMm: UR10E.reachMm,
          },
        });
      } else if (solution.status === "joint-limit") {
        diagnostics.push({
          severity: "warning",
          phase: "kinematics",
          code: "kinematics-joint-limit",
          message: `${where} is reachable only outside the ${UR10E.model} joint limits.`,
          ...context,
          details: { phase: waypoint.name, liftMm: round3(solution.liftMm) },
        });
      } else {
        for (const kind of solution.singularities) {
          const margin =
            kind === "shoulder"
              ? `${round3(solution.margins.shoulderMm)} mm`
              : `${round3(kind === "elbow" ? solution.margins.elbowDeg : solution.margins.wristDeg)}°`;
          diagnostics.push({
            severity: "warning",
            phase: "kinematics",
            code: SINGULARITY_CODES[kind],
            message: `${where} is near the ${UR10E.model} ${kind} singularity (margin ${margin}).`,
            ...context,
            details: {
              phase: waypoint.name,
              liftMm: round3(solution.liftMm),
              marginMm:
                kind === "shoulder"
                  ? round3(solution.margins.shoulderMm)
                  : null,
              marginDeg:
                kind === "shoulder"
                  ? null
                  : round3(
                      kind === "elbow"
                        ? solution.margins.elbowDeg
                        : solution.margins.wristDeg,
                    ),
            },
          });
        }
        if (
          previous?.solution.status === "solved" &&
          !sameBranch(previous.solution.branch, solution.branch)
        ) {
          configurationChangeCount += 1;
          diagnostics.push({
            severity: "warning",
            phase: "kinematics",
            code: "kinematics-configuration-change",
            message: `Cycle "${cycle.id}" changes the ${UR10E.model} arm configuration between ${previous.name} and ${waypoint.name}.`,
            ...context,
            details: { from: previous.name, to: waypoint.name },
          });
        }
      }
      previous = result;
    }
  }

  let payload: Ur10ePayloadCheck;
  const weight = options.packageWeightKg;
  if (weight === null || !Number.isFinite(weight)) {
    payload = { status: "not-checked", reason: "missing-package-weight" };
    if (cycles.length > 0) {
      diagnostics.push({
        severity: "warning",
        phase: "kinematics",
        code: "kinematics-payload-not-checked",
        message: `Package weight is not set, so the ${UR10E.model} payload of ${UR10E.payloadKg} kg was not checked.`,
        resourceId: installation.id,
      });
    }
  } else {
    const gripperKg = installation.gripperMassKg ?? 0;
    let maxPayloadKg = 0;
    let exceededCycleCount = 0;
    for (const cycle of cycles) {
      const payloadKg = gripperKg + cycle.packageCount * weight;
      maxPayloadKg = Math.max(maxPayloadKg, payloadKg);
      if (payloadKg <= UR10E.payloadKg + 1e-9) continue;
      exceededCycleCount += 1;
      diagnostics.push({
        severity: "warning",
        phase: "kinematics",
        code: "kinematics-payload-exceeded",
        message: `Cycle "${cycle.id}" carries ${round3(payloadKg)} kg (${cycle.packageCount} × ${round3(weight)} kg${installation.gripperMassKg === null ? ", gripper mass not recorded" : ` + ${round3(gripperKg)} kg gripper`}), above the ${UR10E.model} payload of ${UR10E.payloadKg} kg.`,
        cycleId: cycle.id,
        layerId: cycle.physicalLayerId,
        resourceId: installation.id,
        details: {
          payloadKg: round3(payloadKg),
          limitKg: UR10E.payloadKg,
          packageCount: cycle.packageCount,
          gripperMassIncluded: installation.gripperMassKg !== null,
        },
      });
    }
    payload = {
      status: "checked",
      maxPayloadKg: round3(maxPayloadKg),
      limitKg: UR10E.payloadKg,
      gripperMassIncluded: installation.gripperMassKg !== null,
      exceededCycleCount,
    };
  }

  const solved = waypoints.flatMap(({ solution }) =>
    solution.status === "solved" ? [solution] : [],
  );
  const lifts = solved.map(({ liftMm }) => liftMm);
  return {
    summary: {
      robot: UR10E.model,
      installationId: installation.id,
      cycleCount: cycles.length,
      waypointCount: waypoints.length,
      solvedWaypointCount: solved.length,
      unreachableWaypointCount: waypoints.filter(
        ({ solution }) => solution.status === "unreachable",
      ).length,
      jointLimitWaypointCount: waypoints.filter(
        ({ solution }) => solution.status === "joint-limit",
      ).length,
      singularWaypointCount: solved.filter(
        ({ singularities }) => singularities.length > 0,
      ).length,
      configurationChangeCount,
      pathSampleCount,
      unsolvedPathSampleCount,
      liftUsedMm:
        lifts.length > 0
          ? { min: Math.min(...lifts), max: Math.max(...lifts) }
          : null,
      payload,
    },
    waypoints,
    diagnostics,
  };
}

/**
 * Joint-space blend between the solutions of a move's end poses. The
 * simulation uses it for frames whose straight-line TCP pose has no IK
 * solution, so the arm keeps moving instead of snapping to its home posture.
 */
export function blendUr10eCellPoses(
  from: Ur10eCellPose,
  to: Ur10eCellPose,
  progress: number,
  installation: Ur10eCellInstallation = BUNDLED_UR10E_CELL,
): { liftMm: number; joints: Ur10eJoints } | null {
  const start = solveUr10eCellPose(from, installation);
  const end = solveUr10eCellPose(to, installation);
  if (start.status !== "solved" || end.status !== "solved") return null;
  const t = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return {
    liftMm: start.liftMm + (end.liftMm - start.liftMm) * t,
    joints: start.joints.map(
      (angle, index) => angle + (end.joints[index]! - angle) * t,
    ) as unknown as Ur10eJoints,
  };
}
