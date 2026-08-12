import * as THREE from "three";
import { createResourceTracker } from "~/components/rob-viewer/sceneResources";
import type {
  ViewerEquipmentConfig,
  ViewerRobotConfig,
  ViewerScenePose,
} from "~/components/rob-viewer/viewerTypes";

export type ViewerRobotJoints = {
  base: { x: number; y: number; z: number };
  shoulder: { x: number; y: number; z: number };
  elbow: { x: number; y: number; z: number };
  wrist: { x: number; y: number; z: number };
};

export type ViewerEquipmentController = {
  root: THREE.Group;
  setConfig(config: ViewerEquipmentConfig): void;
  setGripperModel(model: THREE.Group | null): void;
  setRobotCell(root: THREE.Object3D | null): void;
  setSimulationPose(pose: ViewerScenePose | null): void;
  getBounds(): THREE.Box3 | null;
  dispose(): void;
};

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Pure two-link visualization geometry; this is not a robot kinematics validator. */
export function resolveArticulatedRobotJoints(
  config: ViewerRobotConfig,
  pose: ViewerScenePose,
): ViewerRobotJoints {
  const base = { ...config.baseMm };
  const shoulder = {
    x: base.x,
    y: base.y,
    z: base.z + positive(config.baseHeightMm, 300),
  };
  const wrist = { ...pose.positionMm };
  const upper = positive(config.upperArmLengthMm, 700);
  const forearm = positive(config.forearmLengthMm, 700);
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const dz = wrist.z - shoulder.z;
  const rawDistance = Math.hypot(dx, dy, dz);
  const distance = Math.max(
    Math.abs(upper - forearm) + 0.001,
    Math.min(upper + forearm - 0.001, Math.max(rawDistance, 0.001)),
  );
  const radialDistance = Math.hypot(dx, dy);
  const radialX = radialDistance > 0.001 ? dx / radialDistance : 1;
  const radialY = radialDistance > 0.001 ? dy / radialDistance : 0;
  const direction =
    rawDistance > 0.001
      ? { x: dx / rawDistance, y: dy / rawDistance, z: dz / rawDistance }
      : { x: 1, y: 0, z: 0 };
  const along =
    (upper * upper - forearm * forearm + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  const radialRatio = radialDistance / Math.max(rawDistance, 0.001);
  const verticalRatio = dz / Math.max(rawDistance, 0.001);
  const perpendicular = {
    x: -radialX * verticalRatio,
    y: -radialY * verticalRatio,
    z: radialRatio,
  };

  return {
    base,
    shoulder,
    elbow: {
      x: shoulder.x + direction.x * along + perpendicular.x * bend,
      y: shoulder.y + direction.y * along + perpendicular.y * bend,
      z: shoulder.z + direction.z * along + perpendicular.z * bend,
    },
    wrist,
  };
}

function setLinkBetween(
  mesh: THREE.Mesh,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): void {
  const start = new THREE.Vector3(from.x, from.y, from.z);
  const end = new THREE.Vector3(to.x, to.y, to.z);
  const direction = end.clone().sub(start);
  const length = Math.max(direction.length(), 0.001);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.normalize(),
  );
}

/** Build optional conveyor/tool/robot visuals without owning planner or timeline state. */
export function createViewerEquipment(
  scene: THREE.Scene,
  initialConfig: ViewerEquipmentConfig = {},
): ViewerEquipmentController {
  const root = new THREE.Group();
  root.name = "viewer-equipment";
  scene.add(root);
  const resources = createResourceTracker();
  let config = initialConfig;
  let simulationPose: ViewerScenePose | null = null;
  let externalGripperModel: THREE.Group | null = null;
  let robotCellRoot: THREE.Object3D | null = null;
  let gripperHolder: THREE.Group | null = null;
  let gripperModelHolder: THREE.Group | null = null;
  let upperArm: THREE.Mesh | null = null;
  let forearm: THREE.Mesh | null = null;
  let shoulderJoint: THREE.Mesh | null = null;
  let elbowJoint: THREE.Mesh | null = null;
  let wristJoint: THREE.Mesh | null = null;
  let disposed = false;

  const attachGripperModel = () => {
    if (!gripperModelHolder) return;
    gripperModelHolder.clear();
    if (externalGripperModel && config.selectedGripper?.showModel !== false) {
      const clone = externalGripperModel.clone(true);
      clone.name = "simulation-gripper-model";
      gripperModelHolder.add(clone);
    }
  };

  const buildConveyor = () => {
    const conveyor = config.conveyor;
    if (
      !conveyor ||
      (robotCellRoot && config.robotCell?.replacesProcedural.conveyor)
    ) {
      return;
    }
    const length = positive(conveyor.dimensionsMm.length, 1200);
    const width = positive(conveyor.dimensionsMm.width, 500);
    const height = positive(conveyor.dimensionsMm.height, 180);
    const travelAxis = conveyor.travelAxis ?? "x";
    const bedSizeX = travelAxis === "x" ? length : width;
    const bedSizeY = travelAxis === "x" ? width : length;
    const bedGeometry = resources.trackGeometry(
      new THREE.BoxGeometry(bedSizeX, bedSizeY, height),
    );
    const bedMaterial = resources.trackMaterial(
      new THREE.MeshPhongMaterial({ color: 0x3f3f46, shininess: 8 }),
    );
    const bed = new THREE.Mesh(bedGeometry, bedMaterial);
    bed.name = "conveyor-bed";
    bed.position.set(
      conveyor.centerMm.x,
      conveyor.centerMm.y,
      conveyor.centerMm.z,
    );
    root.add(bed);

    const edgeMaterial = resources.trackMaterial(
      new THREE.LineBasicMaterial({ color: 0x71717a }),
    );
    const edges = new THREE.LineSegments(
      resources.trackGeometry(new THREE.EdgesGeometry(bedGeometry)),
      edgeMaterial,
    );
    edges.position.copy(bed.position);
    root.add(edges);

    const travelLength = length;
    const crossWidth = width;
    const rollerCount = Math.max(
      4,
      Math.min(12, Math.round(travelLength / 140)),
    );
    const rollerGeometry = resources.trackGeometry(
      new THREE.CylinderGeometry(
        Math.min(22, height * 0.12),
        Math.min(22, height * 0.12),
        crossWidth * 0.92,
        12,
      ),
    );
    const rollerMaterial = resources.trackMaterial(
      new THREE.MeshPhongMaterial({ color: 0x71717a, shininess: 15 }),
    );
    for (let index = 0; index < rollerCount; index += 1) {
      const offset =
        -travelLength / 2 + ((index + 0.5) / rollerCount) * travelLength;
      const roller = new THREE.Mesh(rollerGeometry, rollerMaterial);
      roller.name = `conveyor-roller-${index + 1}`;
      roller.position.set(
        conveyor.centerMm.x + (travelAxis === "x" ? offset : 0),
        conveyor.centerMm.y + (travelAxis === "y" ? offset : 0),
        conveyor.centerMm.z + height / 2 + Math.min(22, height * 0.12),
      );
      if (travelAxis === "y") roller.rotation.z = Math.PI / 2;
      root.add(roller);
    }
  };

  const buildGripper = () => {
    const selectedGripper = config.selectedGripper;
    if (!selectedGripper) return;
    gripperHolder = new THREE.Group();
    gripperHolder.name = "selected-gripper-pose";
    root.add(gripperHolder);

    gripperModelHolder = new THREE.Group();
    gripperHolder.add(gripperModelHolder);

    const envelope = selectedGripper.envelopeMm;
    if (envelope) {
      const sizeX = positive(envelope.negativeX + envelope.positiveX, 1);
      const sizeY = positive(envelope.negativeY + envelope.positiveY, 1);
      const sizeZ = positive(envelope.belowZ + envelope.aboveZ, 1);
      const geometry = resources.trackGeometry(
        new THREE.BoxGeometry(sizeX, sizeY, sizeZ),
      );
      const material = resources.trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xfbbf24,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
        }),
      );
      const envelopeMesh = new THREE.Mesh(geometry, material);
      envelopeMesh.name = "selected-gripper-envelope";
      envelopeMesh.position.set(
        (envelope.positiveX - envelope.negativeX) / 2,
        (envelope.positiveY - envelope.negativeY) / 2,
        (envelope.aboveZ - envelope.belowZ) / 2,
      );
      gripperHolder.add(envelopeMesh);
      const edges = new THREE.LineSegments(
        resources.trackGeometry(new THREE.EdgesGeometry(geometry)),
        resources.trackMaterial(
          new THREE.LineBasicMaterial({ color: 0xfbbf24, opacity: 0.8 }),
        ),
      );
      edges.position.copy(envelopeMesh.position);
      gripperHolder.add(edges);
    }
    attachGripperModel();
  };

  const buildRobot = () => {
    const robot = config.robot;
    if (
      !robot ||
      (robotCellRoot && config.robotCell?.replacesProcedural.robot)
    ) {
      return;
    }
    const baseHeight = positive(robot.baseHeightMm, 300);
    const linkRadius = Math.max(
      35,
      Math.min(90, positive(robot.upperArmLengthMm, 700) * 0.08),
    );
    const robotMaterial = resources.trackMaterial(
      new THREE.MeshPhongMaterial({ color: 0x71717a, shininess: 12 }),
    );
    const jointMaterial = resources.trackMaterial(
      new THREE.MeshPhongMaterial({ color: 0xa1a1aa, shininess: 18 }),
    );
    const base = new THREE.Mesh(
      resources.trackGeometry(
        new THREE.CylinderGeometry(
          linkRadius * 1.25,
          linkRadius * 1.5,
          baseHeight,
          16,
        ),
      ),
      robotMaterial,
    );
    base.name = "robot-base";
    base.rotation.x = Math.PI / 2;
    base.position.set(
      robot.baseMm.x,
      robot.baseMm.y,
      robot.baseMm.z + baseHeight / 2,
    );
    root.add(base);

    const linkGeometry = resources.trackGeometry(
      new THREE.CylinderGeometry(linkRadius, linkRadius, 1, 12),
    );
    upperArm = new THREE.Mesh(linkGeometry, robotMaterial);
    upperArm.name = "robot-upper-arm";
    forearm = new THREE.Mesh(linkGeometry, robotMaterial);
    forearm.name = "robot-forearm";
    root.add(upperArm, forearm);

    const jointGeometry = resources.trackGeometry(
      new THREE.SphereGeometry(linkRadius * 1.2, 12, 8),
    );
    shoulderJoint = new THREE.Mesh(jointGeometry, jointMaterial);
    shoulderJoint.name = "robot-shoulder";
    elbowJoint = new THREE.Mesh(jointGeometry, jointMaterial);
    elbowJoint.name = "robot-elbow";
    wristJoint = new THREE.Mesh(jointGeometry, jointMaterial);
    wristJoint.name = "robot-wrist";
    root.add(shoulderJoint, elbowJoint, wristJoint);
  };

  const applyPose = () => {
    const selectedGripper = config.selectedGripper;
    const toolPose = simulationPose ?? selectedGripper?.pose ?? null;
    if (gripperHolder) {
      gripperHolder.visible = toolPose !== null;
      if (toolPose) {
        gripperHolder.position.set(
          toolPose.positionMm.x,
          toolPose.positionMm.y,
          toolPose.positionMm.z,
        );
        gripperHolder.rotation.z = THREE.MathUtils.degToRad(toolPose.yawDeg);
      }
    }

    const robot = config.robot;
    if (
      !robot ||
      !upperArm ||
      !forearm ||
      !shoulderJoint ||
      !elbowJoint ||
      !wristJoint
    ) {
      return;
    }
    const targetPose = simulationPose ??
      robot.homePose ?? {
        positionMm: {
          x:
            robot.baseMm.x +
            (positive(robot.upperArmLengthMm, 700) +
              positive(robot.forearmLengthMm, 700)) *
              0.65,
          y: robot.baseMm.y,
          z: robot.baseMm.z + positive(robot.baseHeightMm, 300),
        },
        yawDeg: 0,
      };
    const joints = resolveArticulatedRobotJoints(robot, targetPose);
    setLinkBetween(upperArm, joints.shoulder, joints.elbow);
    setLinkBetween(forearm, joints.elbow, joints.wrist);
    shoulderJoint.position.set(
      joints.shoulder.x,
      joints.shoulder.y,
      joints.shoulder.z,
    );
    elbowJoint.position.set(joints.elbow.x, joints.elbow.y, joints.elbow.z);
    wristJoint.position.set(joints.wrist.x, joints.wrist.y, joints.wrist.z);
  };

  const rebuild = () => {
    root.clear();
    resources.disposeAll();
    gripperHolder = null;
    gripperModelHolder = null;
    upperArm = null;
    forearm = null;
    shoulderJoint = null;
    elbowJoint = null;
    wristJoint = null;
    if (robotCellRoot) {
      root.add(robotCellRoot);
    }
    buildConveyor();
    buildGripper();
    buildRobot();
    applyPose();
  };

  rebuild();

  return {
    root,
    setConfig(nextConfig) {
      if (disposed) return;
      config = nextConfig;
      rebuild();
    },
    setGripperModel(model) {
      if (disposed) return;
      externalGripperModel = model;
      attachGripperModel();
    },
    setRobotCell(nextRoot) {
      if (disposed || robotCellRoot === nextRoot) return;
      robotCellRoot = nextRoot;
      rebuild();
    },
    setSimulationPose(pose) {
      if (disposed) return;
      simulationPose = pose;
      applyPose();
    },
    getBounds() {
      if (disposed || root.children.length === 0) return null;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      return bounds.isEmpty() ? null : bounds;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.clear();
      scene.remove(root);
      resources.disposeAll();
      externalGripperModel = null;
      robotCellRoot = null;
    },
  };
}
