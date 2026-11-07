import { describe, expect, it } from "vitest";
import {
  UR10E,
  downwardToolTransform,
  selectUr10eSolution,
  transformDeviation,
  unwrapJointsNear,
  ur10eForwardKinematics,
  ur10eInverseKinematics,
  ur10eLinkTransforms,
  ur10eSingularityMargins,
  wrapAngleRad,
  type Transform4,
  type Ur10eJoints,
} from "~/domain/robotics/ur10eKinematics";

const DEG = Math.PI / 180;
/** Fixed test vector of the URDF generator's `tools/check_fk.py`. */
const CHECK_FK_Q: Ur10eJoints = [0.3, -1.2, 1.4, -1.9, -1.5708, 0.7];

function position(transform: Transform4): [number, number, number] {
  return [transform[3]!, transform[7]!, transform[11]!];
}

function degrees(joints: Ur10eJoints): number[] {
  return joints.map((angle) => Math.round((angle / DEG) * 1e6) / 1e6);
}

describe("UR10e forward kinematics", () => {
  it("uses UR's published DH parameters, payload and reach", () => {
    expect(UR10E.dhMm).toEqual({
      d1: 180.7,
      a2: -612.7,
      a3: -571.55,
      d4: 174.15,
      d5: 119.85,
      d6: 116.55,
    });
    expect(UR10E.payloadKg).toBe(12.5);
    expect(UR10E.reachMm).toBe(1_300);
  });

  it("places the flange at (a2 + a3, −(d4 + d6), d1 − d5) in the zero pose", () => {
    const [x, y, z] = position(ur10eForwardKinematics([0, 0, 0, 0, 0, 0]));
    expect(x).toBeCloseTo(-1_184.25, 9);
    expect(y).toBeCloseTo(-290.7, 9);
    expect(z).toBeCloseTo(60.85, 9);
  });

  it("matches the generator's FK check for its fixed test vector", () => {
    const [x, y, z] = position(ur10eForwardKinematics(CHECK_FK_Q));
    expect(x).toBeCloseTo(-823.663155, 6);
    expect(y).toBeCloseTo(-437.080215, 6);
    expect(z).toBeCloseTo(538.074371, 6);
  });

  it("agrees with the URDF link chain of the bundled meshes", () => {
    const vectors: Ur10eJoints[] = [
      [0, 0, 0, 0, 0, 0],
      CHECK_FK_Q,
      [1.1, -2.3, -2.9, 0.4, 2.2, -3.1],
      [-3, 0.7, 1.9, -0.2, -0.6, 2.5],
    ];
    for (const joints of vectors) {
      const deviation = transformDeviation(
        ur10eLinkTransforms(joints).tool0,
        ur10eForwardKinematics(joints),
      );
      // The URDF rounds π/2 to 1.570796327, which moves the flange < 1 µm.
      expect(deviation.positionMm).toBeLessThan(1e-6);
      expect(deviation.rotation).toBeLessThan(1e-9);
    }
  });
});

describe("UR10e inverse kinematics", () => {
  it("returns the eight branch solutions in fixed order, including the source posture", () => {
    const solutions = ur10eInverseKinematics(
      ur10eForwardKinematics(CHECK_FK_Q),
    );

    expect(solutions.map(({ branch }) => branch)).toEqual([
      { shoulder: 0, wrist: 0, elbow: 0 },
      { shoulder: 0, wrist: 0, elbow: 1 },
      { shoulder: 0, wrist: 1, elbow: 0 },
      { shoulder: 0, wrist: 1, elbow: 1 },
      { shoulder: 1, wrist: 0, elbow: 0 },
      { shoulder: 1, wrist: 0, elbow: 1 },
      { shoulder: 1, wrist: 1, elbow: 0 },
      { shoulder: 1, wrist: 1, elbow: 1 },
    ]);
    expect(degrees(solutions[2]!.joints)).toEqual([
      17.188734, -68.754935, 80.214091, -108.861981, -90.00021, 40.107046,
    ]);
    for (const { joints } of solutions) {
      const deviation = transformDeviation(
        ur10eForwardKinematics(joints),
        ur10eForwardKinematics(CHECK_FK_Q),
      );
      expect(deviation.positionMm).toBeLessThan(1e-6);
    }
  });

  it("returns no solution outside the reach or inside the shoulder offset cylinder", () => {
    expect(
      ur10eInverseKinematics(
        downwardToolTransform({ x: 1_500, y: 0, z: 0 }, 0),
      ),
    ).toEqual([]);
    expect(
      ur10eInverseKinematics(downwardToolTransform({ x: 0, y: 0, z: -400 }, 0)),
    ).toEqual([]);
  });

  it("selects the same configuration regardless of the solution order", () => {
    const solutions = ur10eInverseKinematics(
      ur10eForwardKinematics(CHECK_FK_Q),
    );
    const reference: Ur10eJoints = [0, -Math.PI / 2, Math.PI / 2, 0, 0, 0];
    const preferred = { shoulder: 1, wrist: 1, elbow: 1 } as const;
    const forward = selectUr10eSolution(solutions, reference, preferred);
    const reversed = selectUr10eSolution(
      [...solutions].reverse(),
      reference,
      preferred,
    );
    const rotated = selectUr10eSolution(
      [...solutions.slice(3), ...solutions.slice(0, 3)],
      reference,
      preferred,
    );

    expect(forward?.branch).toEqual(preferred);
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
    expect(degrees(forward!.joints)).toEqual([
      -140.932793, -137.736741, -34.699272, 89.31088, -87.247833, -118.179812,
    ]);
  });

  it("unwraps joints to the turn closest to the reference within the limits", () => {
    expect(
      unwrapJointsNear(
        [3 * DEG, 0, 170 * DEG, -170 * DEG, 0, 0],
        [350 * DEG, 0, 0, 100 * DEG, 0, -300 * DEG],
      )!.map((angle) => Math.round(angle / DEG)),
      // 363° would be closest to 350°, but the base limit is ±360°.
    ).toEqual([3, 0, 170, 190, 0, -360]);
    expect(wrapAngleRad(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngleRad(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe("UR10e singularity margins", () => {
  it("reports zero margins at the stretched elbow and the shoulder axis", () => {
    expect(
      ur10eSingularityMargins([
        0,
        -Math.PI / 2,
        0,
        -Math.PI / 2,
        Math.PI / 2,
        0,
      ]),
    ).toEqual({ shoulderMm: 0, elbowDeg: 0, wristDeg: 90 });
  });

  it("reports the wrist-centre offset and joint angles of a regular posture", () => {
    const margins = ur10eSingularityMargins(CHECK_FK_Q);
    expect(margins.shoulderMm).toBeCloseTo(901.024676, 6);
    expect(margins.elbowDeg).toBeCloseTo(80.214091, 6);
    expect(margins.wristDeg).toBeCloseTo(89.99979, 5);
  });
});
