import type * as THREE from "three";

type Disposable = {
  dispose: () => void;
};

function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === "object" &&
    value !== null &&
    "dispose" in value &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

/** Collect geometries/materials/textures from an object tree without disposing yet. */
export function collectObjectResources(
  root: THREE.Object3D,
  target: {
    geometries: Set<THREE.BufferGeometry>;
    materials: Set<THREE.Material>;
    textures: Set<THREE.Texture>;
  },
): void {
  root.traverse((obj) => {
    const maybeGeometry = (obj as { geometry?: unknown }).geometry;
    if (isDisposable(maybeGeometry)) {
      target.geometries.add(maybeGeometry as THREE.BufferGeometry);
    }

    const maybeMaterial = (obj as { material?: unknown }).material;
    const materials = Array.isArray(maybeMaterial)
      ? maybeMaterial
      : maybeMaterial
        ? [maybeMaterial]
        : [];
    for (const material of materials) {
      if (!isDisposable(material)) continue;
      const mat = material as THREE.Material & Record<string, unknown>;
      target.materials.add(mat);
      for (const value of Object.values(mat)) {
        if (
          isDisposable(value) &&
          typeof value === "object" &&
          value !== null &&
          "isTexture" in value
        ) {
          target.textures.add(value as THREE.Texture);
        }
      }
    }
  });
}

/** Dispose each resource exactly once (shared materials stay safe). */
export function disposeResourceSets(sets: {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}): void {
  for (const texture of sets.textures) texture.dispose();
  for (const material of sets.materials) material.dispose();
  for (const geometry of sets.geometries) geometry.dispose();
  sets.textures.clear();
  sets.materials.clear();
  sets.geometries.clear();
}

export function disposeObject3D(root: THREE.Object3D): void {
  const sets = {
    geometries: new Set<THREE.BufferGeometry>(),
    materials: new Set<THREE.Material>(),
    textures: new Set<THREE.Texture>(),
  };
  collectObjectResources(root, sets);
  disposeResourceSets(sets);
}

export function createResourceTracker() {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  return {
    trackGeometry(geometry: THREE.BufferGeometry) {
      geometries.add(geometry);
      return geometry;
    },
    trackMaterial<T extends THREE.Material>(material: T) {
      materials.add(material);
      return material;
    },
    trackObject(root: THREE.Object3D) {
      collectObjectResources(root, { geometries, materials, textures });
    },
    disposeAll() {
      disposeResourceSets({ geometries, materials, textures });
    },
  };
}

export type ResourceTracker = ReturnType<typeof createResourceTracker>;
