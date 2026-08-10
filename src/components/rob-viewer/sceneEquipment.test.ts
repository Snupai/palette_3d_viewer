import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
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
