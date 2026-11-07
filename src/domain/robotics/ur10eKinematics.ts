/**
 * Universal Robots UR10e kinematics in millimetres and radians.
 *
 * The DH parameters are UR's published values ("DH parameters for calculations
 * of kinematics and dynamics"); the URDF link chain is the one generated from
 * Universal_Robots_ROS2_Description (commit 0eb1a861) that the bundled
 * `public/models/ur10e/ur10e.glb` meshes belong to. Both describe the same
 * flange pose, which the unit tests pin. Pure and deterministic: no React,
 * no Three.js, no randomness.
 */

export type Ur10eJoints = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Row-major homogeneous 4×4 transform; translation in millimetres. */
export type Transform4 = readonly number[];

export type Ur10eBranch = {
  /** Index 0/1 of the shoulder-pan solution (the two `acos(d4 / r)` signs). */
  shoulder: 0 | 1;
  /** Index 0/1 of the wrist-2 solution (`θ5 = ±acos`). */
  wrist: 0 | 1;
  /** Index 0/1 of the elbow solution (`θ3 = ±acos`). */
  elbow: 0 | 1;
};

export type Ur10eIkSolution = {
  joints: Ur10eJoints;
  branch: Ur10eBranch;
};

export const UR10E_JOINT_NAMES = [
  "shoulder_pan_joint",
  "shoulder_lift_joint",
  "elbow_joint",
  "wrist_1_joint",
  "wrist_2_joint",
  "wrist_3_joint",
] as const;

export const UR10E = {
  model: "UR10e",
  dhMm: {
    d1: 180.7,
    a2: -612.7,
    a3: -571.55,
    d4: 174.15,
    d5: 119.85,
    d6: 116.55,
  },
  /** URDF limits: ±360° for every joint except the elbow (±180°). */
  jointLimitsRad: [
    [-2 * Math.PI, 2 * Math.PI],
    [-2 * Math.PI, 2 * Math.PI],
    [-Math.PI, Math.PI],
    [-2 * Math.PI, 2 * Math.PI],
    [-2 * Math.PI, 2 * Math.PI],
    [-2 * Math.PI, 2 * Math.PI],
  ] as const satisfies ReadonlyArray<readonly [number, number]>,
  payloadKg: 12.5,
  reachMm: 1_300,
} as const;

const { d1, a2, a3, d4, d5, d6 } = UR10E.dhMm;
const DH_D = [d1, 0, 0, d4, d5, d6] as const;
const DH_A = [0, a2, a3, 0, 0, 0] as const;
const DH_ALPHA = [Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2, 0] as const;

export const IDENTITY_TRANSFORM: Transform4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

export function multiplyTransforms(
  left: Transform4,
  right: Transform4,
): Transform4 {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += left[row * 4 + k]! * right[k * 4 + column]!;
      }
      result[row * 4 + column] = sum;
    }
  }
  return result;
}

/** Inverse of a rigid transform (orthonormal rotation + translation). */
export function invertRigidTransform(transform: Transform4): Transform4 {
  const r = (row: number, column: number) => transform[row * 4 + column]!;
  const t = [r(0, 3), r(1, 3), r(2, 3)];
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row * 4 + column] = r(column, row);
    }
    result[row * 4 + 3] = -(
      r(0, row) * t[0]! +
      r(1, row) * t[1]! +
      r(2, row) * t[2]!
    );
  }
  result[15] = 1;
  return result;
}

export function translationTransform(x: number, y: number, z: number) {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1] as Transform4;
}

export function rotationXTransform(angle: number): Transform4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

export function rotationYTransform(angle: number): Transform4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

export function rotationZTransform(angle: number): Transform4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** URDF `<origin rpy xyz>`: translation, then Rz(yaw)·Ry(pitch)·Rx(roll). */
export function urdfOriginTransform(
  xyzMm: readonly [number, number, number],
  rpy: readonly [number, number, number],
): Transform4 {
  return [
    translationTransform(xyzMm[0], xyzMm[1], xyzMm[2]),
    rotationZTransform(rpy[2]),
    rotationYTransform(rpy[1]),
    rotationXTransform(rpy[0]),
  ].reduce(multiplyTransforms);
}

function dhTransform(index: number, theta: number): Transform4 {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const ca = Math.cos(DH_ALPHA[index]!);
  const sa = Math.sin(DH_ALPHA[index]!);
  const a = DH_A[index]!;
  return [
    ct,
    -st * ca,
    st * sa,
    a * ct,
    st,
    ct * ca,
    -ct * sa,
    a * st,
    0,
    sa,
    ca,
    DH_D[index]!,
    0,
    0,
    0,
    1,
  ];
}

/** Flange (`tool0`) pose in the UR base frame (DH convention). */
export function ur10eForwardKinematics(joints: Ur10eJoints): Transform4 {
  return joints.reduce<Transform4>(
    (transform, theta, index) =>
      multiplyTransforms(transform, dhTransform(index, theta)),
    IDENTITY_TRANSFORM,
  );
}

/** Link names of the bundled GLB, in chain order. */
export const UR10E_LINK_NAMES = [
  "base_link_inertia",
  "shoulder_link",
  "upper_arm_link",
  "forearm_link",
  "wrist_1_link",
  "wrist_2_link",
  "wrist_3_link",
] as const;

export type Ur10eLinkName = (typeof UR10E_LINK_NAMES)[number];

/**
 * URDF joint origins (`ur10e.urdf`, metres converted to mm). Joint `i`
 * rotates link `i + 1` about its local Z axis.
 */
const URDF_JOINT_ORIGINS: ReadonlyArray<Transform4> = [
  urdfOriginTransform([0, 0, 180.7], [0, 0, 0]),
  urdfOriginTransform([0, 0, 0], [1.570796327, 0, 0]),
  urdfOriginTransform([-612.7, 0, 0], [0, 0, 0]),
  urdfOriginTransform([-571.55, 0, 174.15], [0, 0, 0]),
  urdfOriginTransform([0, -119.85, -2.458164590756244e-8], [1.570796327, 0, 0]),
  urdfOriginTransform(
    [0, 116.55, -2.390480459346185e-8],
    [1.570796326589793, Math.PI, Math.PI],
  ),
];

/** URDF `base` (the DH base frame) is `base_link` turned 180° about Z. */
const BASE_TO_BASE_LINK = rotationZTransform(Math.PI);
const BASE_LINK_TO_INERTIA = rotationZTransform(Math.PI);
/** `wrist_3_link` → `flange` → `tool0` fixed joints. */
const WRIST3_TO_TOOL0 = multiplyTransforms(
  urdfOriginTransform([0, 0, 0], [0, -Math.PI / 2, -Math.PI / 2]),
  urdfOriginTransform([0, 0, 0], [Math.PI / 2, 0, Math.PI / 2]),
);

/**
 * World transforms of every visual link relative to the UR base frame,
 * following the URDF chain. The viewer places the GLB link nodes with these.
 */
export function ur10eLinkTransforms(
  joints: Ur10eJoints,
): Record<Ur10eLinkName, Transform4> & { tool0: Transform4 } {
  const inertia = multiplyTransforms(BASE_TO_BASE_LINK, BASE_LINK_TO_INERTIA);
  const frames: Transform4[] = [inertia];
  let current = inertia;
  for (let index = 0; index < 6; index += 1) {
    current = multiplyTransforms(
      multiplyTransforms(current, URDF_JOINT_ORIGINS[index]!),
      rotationZTransform(joints[index]!),
    );
    frames.push(current);
  }
  return {
    base_link_inertia: frames[0]!,
    shoulder_link: frames[1]!,
    upper_arm_link: frames[2]!,
    forearm_link: frames[3]!,
    wrist_1_link: frames[4]!,
    wrist_2_link: frames[5]!,
    wrist_3_link: frames[6]!,
    tool0: multiplyTransforms(frames[6]!, WRIST3_TO_TOOL0),
  };
}

/** Wrap an angle to (-π, π]. */
export function wrapAngleRad(angle: number): number {
  const wrapped =
    angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
  return wrapped <= -Math.PI ? wrapped + 2 * Math.PI : wrapped;
}

function transformPoint(
  transform: Transform4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    transform[0]! * x + transform[1]! * y + transform[2]! * z + transform[3]!,
    transform[4]! * x + transform[5]! * y + transform[6]! * z + transform[7]!,
    transform[8]! * x + transform[9]! * y + transform[10]! * z + transform[11]!,
  ];
}

/** Largest absolute element difference of position (mm) and rotation. */
export function transformDeviation(
  left: Transform4,
  right: Transform4,
): { positionMm: number; rotation: number } {
  let positionMm = 0;
  let rotation = 0;
  for (let row = 0; row < 3; row += 1) {
    positionMm = Math.max(
      positionMm,
      Math.abs(left[row * 4 + 3]! - right[row * 4 + 3]!),
    );
    for (let column = 0; column < 3; column += 1) {
      rotation = Math.max(
        rotation,
        Math.abs(left[row * 4 + column]! - right[row * 4 + column]!),
      );
    }
  }
  return { positionMm, rotation };
}

const IK_POSITION_TOLERANCE_MM = 1e-6;
const IK_ROTATION_TOLERANCE = 1e-9;
/** Numerical slack before `acos` arguments are treated as out of range. */
const ACOS_SLACK = 1e-12;

function clampedAcos(value: number): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > 1 + ACOS_SLACK) return null;
  return Math.acos(Math.max(-1, Math.min(1, value)));
}

/**
 * Analytic inverse kinematics of the flange pose (UR base frame). Returns up
 * to eight solutions in a fixed branch order (shoulder, wrist, elbow), each
 * verified by forward kinematics; angles are wrapped to (-π, π].
 */
export function ur10eInverseKinematics(target: Transform4): Ur10eIkSolution[] {
  const [p05x, p05y] = transformPoint(target, 0, 0, -d6);
  const radius = Math.hypot(p05x, p05y);
  const shoulderOffset = radius > 0 ? clampedAcos(d4 / radius) : null;
  if (shoulderOffset === null) return [];
  const psi = Math.atan2(p05y, p05x);
  const solutions: Ur10eIkSolution[] = [];
  const p06x = target[3]!;
  const p06y = target[7]!;
  for (const shoulder of [0, 1] as const) {
    const theta1 =
      psi + (shoulder === 0 ? shoulderOffset : -shoulderOffset) + Math.PI / 2;
    const s1 = Math.sin(theta1);
    const c1 = Math.cos(theta1);
    const wristAngle = clampedAcos((p06x * s1 - p06y * c1 - d4) / d6);
    if (wristAngle === null) continue;
    for (const wrist of [0, 1] as const) {
      const theta5 = wrist === 0 ? wristAngle : -wristAngle;
      const s5 = Math.sin(theta5);
      // Rows of the target rotation are the base axes expressed in frame 6.
      const theta6 =
        Math.abs(s5) < 1e-12
          ? 0
          : Math.atan2(
              (-target[1]! * s1 + target[5]! * c1) / s5,
              (target[0]! * s1 - target[4]! * c1) / s5,
            );
      const t14 = multiplyTransforms(
        multiplyTransforms(
          invertRigidTransform(dhTransform(0, theta1)),
          target,
        ),
        invertRigidTransform(
          multiplyTransforms(dhTransform(4, theta5), dhTransform(5, theta6)),
        ),
      );
      const p13 = transformPoint(t14, 0, -d4, 0);
      const p13Length = Math.hypot(p13[0], p13[1], p13[2]);
      const elbowAngle = clampedAcos(
        (p13Length * p13Length - a2 * a2 - a3 * a3) / (2 * a2 * a3),
      );
      if (elbowAngle === null) continue;
      for (const elbow of [0, 1] as const) {
        const theta3 = elbow === 0 ? elbowAngle : -elbowAngle;
        const theta2 =
          -Math.atan2(p13[1], -p13[0]) +
          Math.asin(
            Math.max(-1, Math.min(1, (a3 * Math.sin(theta3)) / p13Length)),
          );
        const t34 = multiplyTransforms(
          invertRigidTransform(
            multiplyTransforms(dhTransform(1, theta2), dhTransform(2, theta3)),
          ),
          t14,
        );
        const theta4 = Math.atan2(t34[4]!, t34[0]!);
        const joints = [theta1, theta2, theta3, theta4, theta5, theta6].map(
          wrapAngleRad,
        ) as unknown as Ur10eJoints;
        const deviation = transformDeviation(
          ur10eForwardKinematics(joints),
          target,
        );
        if (
          deviation.positionMm > IK_POSITION_TOLERANCE_MM ||
          deviation.rotation > IK_ROTATION_TOLERANCE
        ) {
          continue;
        }
        solutions.push({ joints, branch: { shoulder, wrist, elbow } });
      }
    }
  }
  return solutions;
}

export function jointsWithinLimits(joints: Ur10eJoints): boolean {
  return joints.every((angle, index) => {
    const [minimum, maximum] = UR10E.jointLimitsRad[index]!;
    return angle >= minimum - 1e-12 && angle <= maximum + 1e-12;
  });
}

/**
 * Shift every joint by whole turns to the equivalent closest to `reference`
 * that still respects the joint limits. Returns null when the limits exclude
 * every equivalent (only possible for the ±180° elbow at exactly ±π).
 */
export function unwrapJointsNear(
  joints: Ur10eJoints,
  reference: Ur10eJoints,
): Ur10eJoints | null {
  const result: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const [minimum, maximum] = UR10E.jointLimitsRad[index]!;
    const base = joints[index]!;
    const turns = Math.round((reference[index]! - base) / (2 * Math.PI));
    const candidates = [turns - 1, turns, turns + 1]
      .map((turn) => base + turn * 2 * Math.PI)
      .filter((angle) => angle >= minimum - 1e-12 && angle <= maximum + 1e-12)
      .sort(
        (left, right) =>
          Math.abs(left - reference[index]!) -
            Math.abs(right - reference[index]!) || left - right,
      );
    if (candidates.length === 0) return null;
    result.push(candidates[0]!);
  }
  return result as unknown as Ur10eJoints;
}

export function jointDistance(left: Ur10eJoints, right: Ur10eJoints): number {
  return left.reduce(
    (sum, angle, index) => sum + Math.abs(angle - right[index]!),
    0,
  );
}

export function sameBranch(left: Ur10eBranch, right: Ur10eBranch): boolean {
  return (
    left.shoulder === right.shoulder &&
    left.wrist === right.wrist &&
    left.elbow === right.elbow
  );
}

/**
 * Deterministic configuration choice: solutions on `preferredBranch` first,
 * then the smallest summed joint distance to `reference`, then the fixed
 * branch order. The result is independent of the order of `solutions`.
 */
export function selectUr10eSolution(
  solutions: readonly Ur10eIkSolution[],
  reference: Ur10eJoints,
  preferredBranch: Ur10eBranch,
): Ur10eIkSolution | null {
  const branchRank = ({ shoulder, wrist, elbow }: Ur10eBranch) =>
    shoulder * 4 + wrist * 2 + elbow;
  const candidates = solutions
    .map((solution) => {
      const joints = unwrapJointsNear(solution.joints, reference);
      return joints ? { joints, branch: solution.branch } : null;
    })
    .filter((solution): solution is Ur10eIkSolution => solution !== null)
    .sort((left, right) => {
      const preferred =
        Number(!sameBranch(left.branch, preferredBranch)) -
        Number(!sameBranch(right.branch, preferredBranch));
      if (preferred !== 0) return preferred;
      const distance =
        jointDistance(left.joints, reference) -
        jointDistance(right.joints, reference);
      if (Math.abs(distance) > 1e-12) return distance;
      return branchRank(left.branch) - branchRank(right.branch);
    });
  return candidates[0] ?? null;
}

export type Ur10eSingularityMargins = {
  /** Lateral distance of the wrist centre beyond the d4 shoulder offset. */
  shoulderMm: number;
  /** |sin θ3| expressed as an angle from the stretched/folded elbow. */
  elbowDeg: number;
  /** |sin θ5| expressed as an angle from wrist-1/wrist-3 alignment. */
  wristDeg: number;
};

export function ur10eSingularityMargins(
  joints: Ur10eJoints,
): Ur10eSingularityMargins {
  const flange = ur10eForwardKinematics(joints);
  const [x, y] = transformPoint(flange, 0, 0, -d6);
  const radiusSquared = x * x + y * y;
  const toDeg = (value: number) =>
    (Math.asin(Math.min(1, value)) * 180) / Math.PI;
  return {
    shoulderMm: Math.sqrt(Math.max(0, radiusSquared - d4 * d4)),
    elbowDeg: toDeg(Math.abs(Math.sin(joints[2]))),
    wristDeg: toDeg(Math.abs(Math.sin(joints[4]))),
  };
}

/** Tool pointing straight down (tool Z = −base Z), rotated `yawRad` about Z. */
export function downwardToolTransform(
  positionMm: { x: number; y: number; z: number },
  yawRad: number,
): Transform4 {
  return multiplyTransforms(
    multiplyTransforms(
      translationTransform(positionMm.x, positionMm.y, positionMm.z),
      rotationZTransform(yawRad),
    ),
    rotationXTransform(Math.PI),
  );
}
