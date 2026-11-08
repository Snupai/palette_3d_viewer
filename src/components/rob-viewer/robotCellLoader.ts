import {
  Group,
  Matrix4,
  Texture,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  UR10E_LINK_NAMES,
  ur10eLinkTransforms,
  type Ur10eJoints,
} from "~/domain/robotics/ur10eKinematics";
import {
  BUNDLED_UR10E_CELL,
  ur10eHomeJoints,
} from "~/domain/robotics/ur10eCell";
import { BUNDLED_ROBOT_CELL } from "./bundledRobotCell";
import type { ViewerRobotCellAssetConfig } from "./viewerTypes";

export type LoadedRobotCell = {
  root: Object3D;
  fixed: Object3D;
  liftCarriage: Object3D;
  /** Articulated arm mounted on the carriage, when the config provides one. */
  arm: Object3D | null;
  setLiftCarriageMm(value: number | null): number;
  /** Pose the articulated arm; null shows `defaultJoints`. */
  setArmJoints(joints: Ur10eJoints | null): void;
  dispose(): void;
};

/** Arm posture shown before the first kinematic solution arrives. */
export const DEFAULT_ARM_JOINTS: Ur10eJoints =
  ur10eHomeJoints(BUNDLED_UR10E_CELL);

const MM_PER_METER = 1_000;

/**
 * Mounts the URDF-link GLB at the static arm node frame. The URDF is Z-up and
 * the CAD source is Y-up, so the mount turns −90° about X; link transforms
 * from the domain kinematics are in millimetres and the GLB in metres.
 */
const mountArticulatedArm = (
  staticArm: Object3D,
  armScene: Object3D,
  mountHeightMm: number,
) => {
  const links = UR10E_LINK_NAMES.map((name) => namedNode(armScene, name));
  const mount = new Group();
  mount.name = "articulated-arm-mount";
  mount.matrixAutoUpdate = false;
  mount.matrix
    .copy(staticArm.matrix)
    .multiply(new Matrix4().makeTranslation(0, mountHeightMm / MM_PER_METER, 0))
    .multiply(new Matrix4().makeRotationX(-Math.PI / 2));
  for (const link of links) {
    link.removeFromParent();
    link.matrixAutoUpdate = false;
    mount.add(link);
  }
  staticArm.parent!.add(mount);
  const setJoints = (joints: Ur10eJoints) => {
    const transforms = ur10eLinkTransforms(joints);
    UR10E_LINK_NAMES.forEach((name, index) => {
      const t = transforms[name];
      links[index]!.matrix.set(
        t[0]!,
        t[1]!,
        t[2]!,
        t[3]! / MM_PER_METER,
        t[4]!,
        t[5]!,
        t[6]!,
        t[7]! / MM_PER_METER,
        t[8]!,
        t[9]!,
        t[10]!,
        t[11]! / MM_PER_METER,
        0,
        0,
        0,
        1,
      );
    });
    mount.updateMatrixWorld(true);
  };
  return { mount, setJoints };
};

export type RobotCellLoadOptions = {
  config?: ViewerRobotCellAssetConfig;
  signal?: AbortSignal;
};

type DisposableMesh = Mesh & {
  geometry: BufferGeometry;
  material: Material | Material[];
};

const abortError = () =>
  new DOMException("Robot-cell load was aborted.", "AbortError");

const namedNode = (root: Object3D, name: string) => {
  const matches: Object3D[] = [];
  root.traverse((node) => {
    if (node.name === name) {
      matches.push(node);
    }
  });
  if (matches.length !== 1) {
    throw new Error(
      `Robot-cell asset requires exactly one ${JSON.stringify(name)} node; found ${matches.length}.`,
    );
  }
  return matches[0]!;
};

const disposeMaterial = (material: Material, textures: Set<Texture>) => {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      textures.add(value);
    }
  }
  material.dispose();
};

export const disposeRobotCellObject = (root: Object3D) => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    const mesh = object as Partial<DisposableMesh>;
    if (mesh.geometry) {
      geometries.add(mesh.geometry);
    }
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) {
        materials.add(material);
      }
    } else if (mesh.material) {
      materials.add(mesh.material);
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    disposeMaterial(material, textures);
  }
  for (const texture of textures) {
    texture.dispose();
  }
};

export const prepareRobotCell = (
  scene: Object3D,
  config: ViewerRobotCellAssetConfig = BUNDLED_ROBOT_CELL,
  armScene: Object3D | null = null,
): LoadedRobotCell => {
  const root = namedNode(scene, config.nodes.root);
  const fixed = namedNode(root, config.nodes.fixed);
  const liftCarriage = namedNode(root, config.nodes.liftCarriage);

  if (fixed.parent !== root || liftCarriage.parent !== root) {
    throw new Error(
      "Robot-cell fixed and lift-carriage nodes must be direct children of the robot-cell root.",
    );
  }

  // The CAD arm is a rigid mesh group without joint frames. It can only be shown
  // while no other arm is drawn; otherwise two robots would render.
  const staticArm = config.nodes.staticArm
    ? namedNode(root, config.nodes.staticArm)
    : null;
  if (staticArm) {
    staticArm.visible = config.replacesProcedural.robot && !armScene;
  }
  if (armScene && !staticArm) {
    throw new Error(
      "An articulated robot-cell arm requires the static arm node as its mount.",
    );
  }
  const arm =
    armScene && staticArm
      ? mountArticulatedArm(
          staticArm,
          armScene,
          config.articulatedArm?.mountHeightMm ?? 0,
        )
      : null;
  arm?.setJoints(DEFAULT_ARM_JOINTS);

  root.removeFromParent();
  root.scale.setScalar(config.sourceToViewer.scaleMmPerMeter);
  root.rotation.set(config.sourceToViewer.rotationXRad, 0, 0);
  root.position.set(
    config.sourceToViewer.translationMm.x,
    config.sourceToViewer.translationMm.y,
    config.sourceToViewer.translationMm.z,
  );
  root.updateMatrix();
  root.updateMatrixWorld(true);

  const carriageSourceY = liftCarriage.position.y;
  let disposed = false;
  return {
    root,
    fixed,
    liftCarriage,
    arm: arm?.mount ?? null,
    setArmJoints(joints) {
      if (disposed) return;
      arm?.setJoints(joints ?? DEFAULT_ARM_JOINTS);
    },
    setLiftCarriageMm(value) {
      const requested = value ?? config.liftTravelMm.min;
      const finite = Number.isFinite(requested)
        ? requested
        : config.liftTravelMm.min;
      const clamped = Math.min(
        config.liftTravelMm.max,
        Math.max(config.liftTravelMm.min, finite),
      );
      liftCarriage.position.y =
        carriageSourceY + clamped / config.sourceToViewer.scaleMmPerMeter;
      liftCarriage.updateMatrix();
      liftCarriage.updateMatrixWorld(true);
      return clamped;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      root.removeFromParent();
      disposeRobotCellObject(root);
    },
  };
};

const parseGlb = (bytes: ArrayBuffer) =>
  new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(bytes, "", resolve, reject);
  });

export const loadBundledRobotCell = async ({
  signal,
  config = BUNDLED_ROBOT_CELL,
}: RobotCellLoadOptions = {}): Promise<LoadedRobotCell> => {
  const fetchBytes = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(
        `Robot-cell asset request failed with HTTP ${response.status}.`,
      );
    }
    const bytes = await response.arrayBuffer();
    if (signal?.aborted) {
      throw abortError();
    }
    return bytes;
  };

  const bytes = await fetchBytes(config.assetUrl);
  const armBytes = config.articulatedArm
    ? await fetchBytes(config.articulatedArm.assetUrl)
    : null;

  const gltf = await parseGlb(bytes);
  let armScene: Object3D | null = null;
  try {
    armScene = armBytes ? (await parseGlb(armBytes)).scene : null;
  } catch (error) {
    disposeRobotCellObject(gltf.scene);
    throw error;
  }
  const disposeParsed = () => {
    disposeRobotCellObject(gltf.scene);
    if (armScene) disposeRobotCellObject(armScene);
  };
  if (signal?.aborted) {
    disposeParsed();
    throw abortError();
  }

  try {
    return prepareRobotCell(gltf.scene, config, armScene);
  } catch (error) {
    disposeParsed();
    throw error;
  }
};
