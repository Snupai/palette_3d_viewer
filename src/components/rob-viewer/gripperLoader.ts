import * as THREE from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  createResourceTracker,
  type ResourceTracker,
} from "~/components/rob-viewer/sceneResources";

export type GripperMaterialLibrary = {
  preload: () => void;
  materials: Record<string, THREE.Material>;
};

export type GripperAssetResponse = Pick<Response, "ok" | "status" | "text">;

export type GripperLoaderDependencies = {
  fetchAsset: (
    url: string,
    signal: AbortSignal,
  ) => Promise<GripperAssetResponse>;
  parseMaterials: (text: string, basePath: string) => GripperMaterialLibrary;
  parseObject: (
    text: string,
    materials: GripperMaterialLibrary,
  ) => THREE.Object3D;
  prepareObject: (object: THREE.Object3D) => THREE.Group;
};

export type LoadedGripperModel = {
  model: THREE.Group;
  dispose: () => void;
};

/** OBJLoader turns a whole object into LineSegments if it contains any `l` edges — strip those first. */
export function stripObjLineElements(objText: string): string {
  return objText
    .split(/\r?\n/)
    .filter((line) => !/^\s*l\s/.test(line))
    .join("\n");
}

/** Normalize CAD model (Y-up) to scene Z-up with origin at bottom center. */
export function prepareGripperModel(object: THREE.Object3D): THREE.Group {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const mat of mats) {
      if (mat instanceof THREE.Material) {
        mat.side = THREE.DoubleSide;
        mat.visible = true;
        mat.transparent = true;
        mat.opacity = 0.3;
        mat.depthWrite = false;
        if ("wireframe" in mat) {
          (mat as THREE.MeshPhongMaterial).wireframe = false;
        }
      }
    }
    if (!geometry.getAttribute("normal")) {
      geometry.computeVertexNormals();
    }
  });

  const pivot = new THREE.Group();
  // CAD is Y-up; +90° around X maps CAD +Y → scene +Z (gripper top up).
  object.rotation.x = Math.PI / 2;
  pivot.add(object);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -center.y, -box.min.z);
  return pivot;
}

const defaultDependencies: GripperLoaderDependencies = {
  fetchAsset: (url, signal) => fetch(url, { signal }),
  parseMaterials: (text, basePath) => new MTLLoader().parse(text, basePath),
  parseObject: (text, materials) => {
    const loader = new OBJLoader();
    loader.setMaterials(materials as MTLLoader.MaterialCreator);
    return loader.parse(stripObjLineElements(text));
  },
  prepareObject: prepareGripperModel,
};

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw (
    signal.reason ??
    new DOMException("Gripper model load aborted", "AbortError")
  );
}

async function fetchAssetText(
  url: string,
  label: "MTL" | "OBJ",
  signal: AbortSignal,
  fetchAsset: GripperLoaderDependencies["fetchAsset"],
): Promise<string> {
  throwIfAborted(signal);
  const response = await fetchAsset(url, signal);
  throwIfAborted(signal);
  if (!response.ok) {
    throw new Error(`Failed to load gripper ${label} (${response.status})`);
  }
  const text = await response.text();
  throwIfAborted(signal);
  return text;
}

function trackMaterialLibrary(
  tracker: ResourceTracker,
  materials: GripperMaterialLibrary | null,
): void {
  if (!materials) return;
  for (const material of Object.values(materials.materials)) {
    tracker.trackMaterial(material);
  }
}

export async function loadGripperModel({
  basePath,
  objFile,
  mtlFile,
  signal,
  dependencies,
}: {
  basePath: string;
  objFile: string;
  mtlFile: string;
  signal: AbortSignal;
  dependencies?: Partial<GripperLoaderDependencies>;
}): Promise<LoadedGripperModel> {
  const loaderDependencies = { ...defaultDependencies, ...dependencies };
  const resources = createResourceTracker();
  let materials: GripperMaterialLibrary | null = null;
  let parsedObject: THREE.Object3D | null = null;

  try {
    const mtlText = await fetchAssetText(
      `${basePath}${mtlFile}`,
      "MTL",
      signal,
      loaderDependencies.fetchAsset,
    );
    materials = loaderDependencies.parseMaterials(mtlText, basePath);
    materials.preload();
    trackMaterialLibrary(resources, materials);
    throwIfAborted(signal);

    const objText = await fetchAssetText(
      `${basePath}${objFile}`,
      "OBJ",
      signal,
      loaderDependencies.fetchAsset,
    );
    parsedObject = loaderDependencies.parseObject(objText, materials);
    resources.trackObject(parsedObject);
    const model = loaderDependencies.prepareObject(parsedObject);
    resources.trackObject(model);
    throwIfAborted(signal);

    return {
      model,
      dispose: () => resources.disposeAll(),
    };
  } catch (error) {
    trackMaterialLibrary(resources, materials);
    if (parsedObject) resources.trackObject(parsedObject);
    resources.disposeAll();
    throw error;
  }
}
