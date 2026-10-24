import * as THREE from "three";
import type { ResourceTracker } from "~/components/rob-viewer/sceneResources";
import { SCENE_THEME, hexToCss } from "~/components/rob-viewer/sceneTheme";

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

/** Footprint of one layer's package block, in the scene root's frame. */
export type LayerLabelBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/** Distance from the block edge to the label centre (label is 140 mm wide). */
export const LAYER_LABEL_GAP_MM = 70 + 35;

/**
 * Where a layer label goes so it sits beside its block on the screen's right,
 * never behind or across the packages: the block centre pushed along the
 * camera's horizontal right vector past the block's extent in that direction.
 */
export function labelPositionBeside(
  bounds: LayerLabelBounds,
  right: { x: number; y: number },
  gapMm = LAYER_LABEL_GAP_MM,
): { x: number; y: number } {
  const length = Math.hypot(right.x, right.y);
  const direction =
    length < 1e-6
      ? { x: 1, y: 0 }
      : { x: right.x / length, y: right.y / length };
  const halfX = (bounds.maxX - bounds.minX) / 2;
  const halfY = (bounds.maxY - bounds.minY) / 2;
  const extent = Math.abs(direction.x) * halfX + Math.abs(direction.y) * halfY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: centerX + direction.x * (extent + gapMm),
    y: centerY + direction.y * (extent + gapMm),
  };
}

/** Label chip colours: stage line fill, steel rule and stage ink text. */
const CHIP = {
  fill: hexToCss(SCENE_THEME.line),
  rule: hexToCss(SCENE_THEME.placeMarker),
  text: hexToCss(SCENE_THEME.ink),
} as const;

/**
 * Draw "L4" as a crisp text chip. Returns null where no 2D canvas exists
 * (server rendering, jsdom), so callers fall back to the segment label.
 */
function createChipTexture(text: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  let context: CanvasRenderingContext2D | null = null;
  const canvas = document.createElement("canvas");
  try {
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!context) return null;
  const width = 256;
  const height = 128;
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = CHIP.fill;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = CHIP.rule;
  context.lineWidth = 6;
  context.strokeRect(3, 3, width - 6, height - 6);
  context.fillStyle = CHIP.text;
  context.font =
    '700 76px "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / 2, height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Create a billboard layer label; text chip in the browser, segments elsewhere. */
export function createLayerLabelObject(
  layerNumber: number,
  resources: ResourceTracker,
): THREE.Group {
  const text = `L${Math.max(1, Math.trunc(layerNumber))}`;
  const chip = createChipTexture(text);
  if (chip) {
    const group = new THREE.Group();
    group.name = `layer-label-${layerNumber}`;
    group.userData.label = text;
    const material = resources.trackMaterial(
      new THREE.MeshBasicMaterial({
        map: chip,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    // The material owns the texture; dispose it with the material.
    material.addEventListener("dispose", () => chip.dispose());
    const plane = new THREE.Mesh(
      resources.trackGeometry(new THREE.PlaneGeometry(2, 1)),
      material,
    );
    plane.renderOrder = 10;
    group.add(plane);
    group.scale.setScalar(70);
    return group;
  }
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
        color: SCENE_THEME.background,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
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
        color: SCENE_THEME.ink,
        toneMapped: false,
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
