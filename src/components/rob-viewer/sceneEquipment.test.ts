import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BUNDLED_ROBOT_CELL } from "~/components/rob-viewer/bundledRobotCell";
import {
  createViewerEquipment,
  resolveArticulatedRobotJoints,
} from "~/components/rob-viewer/sceneEquipment";
import type {
  ViewerEquipmentConfig,
  ViewerRobotConfig,
  ViewerScenePose,
} from "~/components/rob-viewer/viewerTypes";

const robot: ViewerRobotConfig = {
  baseMm: { x: -800, y: 400, z: 0 },
  baseHeightMm: 300,
  upperArmLengthMm: 700,
  forearmLengthMm: 600,
};

const pose: ViewerScenePose = {
  positionMm: { x: 100, y: 300, z: 700 },
  yawDeg: 90,
};

function config(): ViewerEquipmentConfig {
  return {
    conveyor: {
      centerMm: { x: -300, y: 400, z: 100 },
      dimensionsMm: { length: 900, width: 420, height: 160 },
      travelAxis: "x",
    },
    selectedGripper: {
      pose,
      envelopeMm: {
        negativeX: 100,
        positiveX: 120,
        negativeY: 80,
        positiveY: 90,
        belowZ: 40,
        aboveZ: 110,
      },
    },
    robot,
  };
}

describe("viewer equipment", () => {
  it("resolves a deterministic simplified articulated pose", () => {
    const joints = resolveArticulatedRobotJoints(robot, pose);
    const upperLength = Math.hypot(
      joints.elbow.x - joints.shoulder.x,
      joints.elbow.y - joints.shoulder.y,
      joints.elbow.z - joints.shoulder.z,
    );
    const forearmLength = Math.hypot(
      joints.wrist.x - joints.elbow.x,
      joints.wrist.y - joints.elbow.y,
      joints.wrist.z - joints.elbow.z,
    );

    expect(joints.base).toEqual(robot.baseMm);
    expect(joints.wrist).toEqual(pose.positionMm);
    expect(upperLength).toBeCloseTo(robot.upperArmLengthMm);
    expect(forearmLength).toBeCloseTo(robot.forearmLengthMm);
  });

  it("builds conveyor, selected gripper envelope, and robot then follows external poses", () => {
    const scene = new THREE.Scene();
    const equipment = createViewerEquipment(scene, config());

    expect(scene.children).toContain(equipment.root);
    const conveyorBed = equipment.root.getObjectByName(
      "conveyor-bed",
    ) as THREE.Mesh;
    const conveyorGeometryDispose = vi.spyOn(conveyorBed.geometry, "dispose");
    expect(conveyorBed).toBeTruthy();
    expect(
      equipment.root.getObjectByName("selected-gripper-envelope"),
    ).toBeTruthy();
    expect(equipment.root.getObjectByName("robot-upper-arm")).toBeTruthy();
    expect(
      equipment.root
        .getObjectByName("selected-gripper-pose")
        ?.position.toArray(),
    ).toEqual([100, 300, 700]);

    equipment.setSimulationPose({
      positionMm: { x: 400, y: 500, z: 900 },
      yawDeg: 180,
    });

    expect(
      equipment.root
        .getObjectByName("selected-gripper-pose")
        ?.position.toArray(),
    ).toEqual([400, 500, 900]);
    expect(
      equipment.root.getObjectByName("selected-gripper-pose")?.rotation.z,
    ).toBeCloseTo(Math.PI);
    expect(
      equipment.root.getObjectByName("robot-wrist")?.position.toArray(),
    ).toEqual([400, 500, 900]);
    expect(equipment.getBounds()?.isEmpty()).toBe(false);

    equipment.dispose();
    equipment.dispose();
    expect(scene.children).not.toContain(equipment.root);
    expect(conveyorGeometryDispose).toHaveBeenCalledTimes(1);
  });

  it("orients a Y-axis conveyor bed and rollers consistently with travel", () => {
    const scene = new THREE.Scene();
    const yAxisConfig = config();
    yAxisConfig.conveyor = {
      ...yAxisConfig.conveyor!,
      travelAxis: "y",
    };
    const equipment = createViewerEquipment(scene, yAxisConfig);

    const bed = equipment.root.getObjectByName(
      "conveyor-bed",
    ) as THREE.Mesh<THREE.BoxGeometry>;
    expect(bed.geometry.parameters).toMatchObject({
      width: 420,
      height: 900,
      depth: 160,
    });

    const rollers = equipment.root.children.filter(({ name }) =>
      name.startsWith("conveyor-roller-"),
    );
    expect(rollers).toHaveLength(6);
    expect(rollers[0]!.position.x).toBe(-300);
    expect(rollers[0]!.position.y).toBeCloseTo(25);
    expect(rollers.at(-1)!.position.x).toBe(-300);
    expect(rollers.at(-1)!.position.y).toBeCloseTo(775);
    for (const roller of rollers) {
      expect(roller.rotation.z).toBeCloseTo(Math.PI / 2);
    }

    equipment.dispose();
  });

  it("mounts the CAD cell, replaces matching fallbacks, and restores them on unload", () => {
    const scene = new THREE.Scene();
    const cellConfig = config();
    cellConfig.robotCell = BUNDLED_ROBOT_CELL;
    const equipment = createViewerEquipment(scene, cellConfig);
    const cellRoot = new THREE.Group();
    cellRoot.name = "robot-cell";
    const geometry = new THREE.BoxGeometry(100, 100, 100);
    const material = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    cellRoot.add(new THREE.Mesh(geometry, material));

    expect(equipment.root.getObjectByName("conveyor-bed")).toBeTruthy();
    expect(equipment.root.getObjectByName("robot-upper-arm")).toBeTruthy();

    equipment.setRobotCell(cellRoot);

    expect(equipment.root.getObjectByName("robot-cell")).toBe(cellRoot);
    expect(equipment.root.getObjectByName("conveyor-bed")).toBeUndefined();
    expect(equipment.root.getObjectByName("robot-upper-arm")).toBeTruthy();
    expect(
      equipment.root.getObjectByName("selected-gripper-envelope"),
    ).toBeTruthy();

    equipment.setRobotCell(null);

    expect(equipment.root.getObjectByName("robot-cell")).toBeUndefined();
    expect(equipment.root.getObjectByName("conveyor-bed")).toBeTruthy();
    expect(equipment.root.getObjectByName("robot-upper-arm")).toBeTruthy();
    expect(geometryDispose).not.toHaveBeenCalled();

    equipment.dispose();
    expect(geometryDispose).not.toHaveBeenCalled();
    geometry.dispose();
    material.dispose();
  });

  it("clones the loaded gripper without taking ownership of shared CAD resources", () => {
    const scene = new THREE.Scene();
    const equipment = createViewerEquipment(scene, config());
    const geometry = new THREE.BoxGeometry(20, 30, 40);
    const material = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const model = new THREE.Group();
    model.add(new THREE.Mesh(geometry, material));

    equipment.setGripperModel(model);
    const renderedModel = equipment.root.getObjectByName(
      "simulation-gripper-model",
    );
    expect(renderedModel).toBeTruthy();
    expect(renderedModel).not.toBe(model);

    equipment.dispose();
    equipment.dispose();

    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});
