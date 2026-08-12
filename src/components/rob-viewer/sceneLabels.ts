import * as THREE from "three";
import type { ResourceTracker } from "~/components/rob-viewer/sceneResources";

const DIGIT_SEGMENTS: Readonly<Record<string, readonly string[]>> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"],
};

const SEGMENTS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  a: [0.12, 0.88, 0.48, 0.1],
  b: [0.5, 0.51, 0.1, 0.4],
  c: [0.5, 0.09, 0.1, 0.4],
  d: [0.12, 0.02, 0.48, 0.1],
  e: [0.02, 0.09, 0.1, 0.4],
  f: [0.02, 0.51, 0.1, 0.4],
  g: [0.12, 0.45, 0.48, 0.1],
};

function addQuad(
  positions: number[],
  indices: number[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const start = positions.length / 3;
  positions.push(
    x,
    y,
    0.01,
    x + width,
    y,
    0.01,
    x + width,
    y + height,
    0.01,
    x,
    y + height,
    0.01,
  );
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

/** Create an SSR-safe billboard label without DOM canvas or font loading. */
export function createLayerLabelObject(
  layerNumber: number,
  resources: ResourceTracker,
): THREE.Group {
  const text = `L${Math.max(1, Math.trunc(layerNumber))}`;
  const characterWidth = 0.7;
  const characterGap = 0.12;
  const contentWidth =
    text.length * characterWidth + Math.max(0, text.length - 1) * characterGap;
  const group = new THREE.Group();
  group.name = `layer-label-${layerNumber}`;
  group.userData.label = text;

  const background = new THREE.Mesh(
    resources.trackGeometry(new THREE.PlaneGeometry(contentWidth + 0.3, 1.3)),
    resources.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x18181b,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  background.position.set(0, 0.5, 0);
  background.renderOrder = 9;
  group.add(background);

  const positions: number[] = [];
  const indices: number[] = [];
  [...text].forEach((character, characterIndex) => {
    const offsetX = characterIndex * (characterWidth + characterGap);
    if (character === "L") {
      addQuad(positions, indices, offsetX + 0.05, 0.05, 0.1, 0.9);
      addQuad(positions, indices, offsetX + 0.05, 0.05, 0.5, 0.1);
      return;
    }
    for (const segmentName of DIGIT_SEGMENTS[character] ?? []) {
      const segment = SEGMENTS[segmentName];
      if (!segment) continue;
      addQuad(
        positions,
        indices,
        offsetX + segment[0],
        segment[1],
        segment[2],
        segment[3],
      );
    }
  });
  const geometry = resources.trackGeometry(new THREE.BufferGeometry());
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  const textMesh = new THREE.Mesh(
    geometry,
    resources.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: 0xf4f4f5,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  textMesh.position.x = -contentWidth / 2;
  textMesh.renderOrder = 10;
  group.add(textMesh);
  group.scale.setScalar(70);
  return group;
}
