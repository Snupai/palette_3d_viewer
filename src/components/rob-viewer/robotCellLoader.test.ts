import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Texture,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UR10E_LINK_NAMES,
  ur10eForwardKinematics,
  type Ur10eJoints,
} from "~/domain/robotics/ur10eKinematics";
import { BUNDLED_ROBOT_CELL } from "./bundledRobotCell";
import {
  DEFAULT_ARM_JOINTS,
  loadBundledRobotCell,
  prepareRobotCell,
} from "./robotCellLoader";

const createArmScene = () => {
  const scene = new Group();
  for (const name of UR10E_LINK_NAMES) {
    const link = new Group();
    link.name = name;
    scene.add(link);
  }
  return scene;
};

const createCellScene = () => {
  const scene = new Group();
  const root = new Group();
  const fixed = new Group();
  const liftCarriage = new Group();
  const staticArm = new Group();
  root.name = BUNDLED_ROBOT_CELL.nodes.root;
  fixed.name = BUNDLED_ROBOT_CELL.nodes.fixed;
  liftCarriage.name = BUNDLED_ROBOT_CELL.nodes.liftCarriage;
  staticArm.name = BUNDLED_ROBOT_CELL.nodes.staticArm;
  liftCarriage.add(staticArm);
  root.add(fixed, liftCarriage);
  scene.add(root);
  return { scene, root, fixed, liftCarriage };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("robot-cell loader", () => {
  it("validates, aligns, and detaches the configured hierarchy", () => {
    const { scene, root, fixed, liftCarriage } = createCellScene();

    const cell = prepareRobotCell(scene);

    expect(cell.root).toBe(root);
    expect(cell.fixed).toBe(fixed);
    expect(cell.liftCarriage).toBe(liftCarriage);
    expect(root.parent).toBeNull();
    expect(root.scale.toArray()).toEqual([1_000, 1_000, 1_000]);
    expect(root.rotation.x).toBeCloseTo(Math.PI / 2);
    expect(root.position.toArray()).toEqual([
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.x,
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.y,
      BUNDLED_ROBOT_CELL.sourceToViewer.translationMm.z,
    ]);
    expect(cell.setLiftCarriageMm(450)).toBe(450);
    expect(liftCarriage.position.y).toBeCloseTo(0.45);
    expect(cell.setLiftCarriageMm(1_200)).toBe(900);
    expect(liftCarriage.position.y).toBeCloseTo(0.9);
    expect(cell.setLiftCarriageMm(null)).toBe(0);
    expect(liftCarriage.position.y).toBe(0);
  });

  it("mounts the articulated arm at the static arm frame and poses it from the kinematics", () => {
    const { scene, liftCarriage } = createCellScene();
    const staticArm = liftCarriage.getObjectByName(
      BUNDLED_ROBOT_CELL.nodes.staticArm,
    )!;
    // CAD mount: source (-0.1414, 0.8901, 1.4005) m, −45° about source Y.
    staticArm.position.set(-0.1414, 0.8901, 1.4005);
    staticArm.rotation.set(0, -Math.PI / 4, 0);
    staticArm.updateMatrix();

    const cell = prepareRobotCell(scene, BUNDLED_ROBOT_CELL, createArmScene());

    expect(staticArm.visible).toBe(false);
    expect(cell.arm?.parent).toBe(liftCarriage);
    expect(cell.arm!.children.map(({ name }) => name)).toEqual([
      ...UR10E_LINK_NAMES,
    ]);

    const joints: Ur10eJoints = [0.3, -1.2, 1.4, -1.9, -1.5708, 0.7];
    cell.setArmJoints(joints);
    cell.setLiftCarriageMm(450);
    cell.root.updateMatrixWorld(true);
    // The wrist-3 link origin is the flange; compare it in viewer millimetres.
    const flange = new Vector3().setFromMatrixPosition(
      cell.arm!.getObjectByName("wrist_3_link")!.matrixWorld,
    );
    const fk = ur10eForwardKinematics(joints);
    const yaw = -Math.PI / 4;
    const expected = {
      x: 1_058.6 + fk[3]! * Math.cos(yaw) - fk[7]! * Math.sin(yaw),
      y: 599.5 + fk[3]! * Math.sin(yaw) + fk[7]! * Math.cos(yaw),
      z: 746.1 + 450 + fk[11]!,
    };
    expect(flange.x).toBeCloseTo(expected.x, 3);
    expect(flange.y).toBeCloseTo(expected.y, 3);
    expect(flange.z).toBeCloseTo(expected.z, 3);

    cell.setArmJoints(null);
    const home = cell.arm!.getObjectByName("shoulder_link")!.matrix.clone();
    cell.setArmJoints(DEFAULT_ARM_JOINTS);
    expect(
      cell.arm!.getObjectByName("shoulder_link")!.matrix.equals(home),
    ).toBe(true);
  });

  it("rejects a carriage that is not a direct root child", () => {
    const { scene, fixed, liftCarriage } = createCellScene();
    fixed.add(liftCarriage);

    expect(() => prepareRobotCell(scene)).toThrow(
      "must be direct children of the robot-cell root",
    );
  });

  it("disposes shared render resources exactly once", () => {
    const { scene, fixed, liftCarriage } = createCellScene();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    fixed.add(new Mesh(geometry, material));
    liftCarriage.add(new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    const cell = prepareRobotCell(scene);
    cell.dispose();
    cell.dispose();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation after fetching and before parsing", async () => {
    const controller = new AbortController();
    let releaseBytes: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          new Promise<ArrayBuffer>((resolve) => {
            releaseBytes = () => resolve(new ArrayBuffer(0));
          }),
      }),
    );

    const loading = loadBundledRobotCell({ signal: controller.signal });
    await vi.waitFor(() => expect(releaseBytes).toBeTypeOf("function"));
    controller.abort();
    releaseBytes!();

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  });
});
