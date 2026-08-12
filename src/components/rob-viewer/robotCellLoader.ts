import {
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
import { BUNDLED_ROBOT_CELL } from "./bundledRobotCell";
import type { ViewerRobotCellAssetConfig } from "./viewerTypes";

export type LoadedRobotCell = {
  root: Object3D;
  fixed: Object3D;
  liftCarriage: Object3D;
  setLiftCarriageMm(value: number | null): number;
  dispose(): void;
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
  // while the procedural arm is suppressed; otherwise both robots would render.
  if (config.nodes.staticArm) {
    namedNode(root, config.nodes.staticArm).visible =
      config.replacesProcedural.robot;
  }

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
  const response = await fetch(config.assetUrl, { signal });
  if (!response.ok) {
    throw new Error(
      `Robot-cell asset request failed with HTTP ${response.status}.`,
    );
  }

  const bytes = await response.arrayBuffer();
  if (signal?.aborted) {
    throw abortError();
  }

  const gltf = await parseGlb(bytes);
  if (signal?.aborted) {
    disposeRobotCellObject(gltf.scene);
    throw abortError();
  }

  try {
    return prepareRobotCell(gltf.scene, config);
  } catch (error) {
    disposeRobotCellObject(gltf.scene);
    throw error;
  }
};
