export type Side = "top" | "right" | "bottom" | "left";
export type Corner = "top_right" | "bottom_right" | "bottom_left" | "top_left";

export type Rotation = 0 | 90 | 180 | 270;

export interface Rectangle {
  width: number;
  length: number;
  x: number;
  y: number;
}

export interface Box {
  blueNumber: number;
  blueLine: Side | Corner | null;
  rotation: Rotation;
  rect: Rectangle;
  height: number;
  /** Place/grip center from the .rob coordinate line (shared by multi-package grips). */
  placeX: number;
  placeY: number;
  /** Number of packages gripped together on this coordinate line. */
  numPackages: number;
}

export interface Layer {
  unique_layer_id: number;
  boxes: Box[];
  /**
   * Zwischenlage under this layer (from .rob layer-order column 2).
   * Typically 0 or 1; multiplied by {@link ZWISCHENLAGE_HEIGHT_MM} for Z.
   */
  zwischenlage: number;
}

export interface PalletData {
  layers: Layer[];
  layer_count: number;
  total_boxes: number;
  package: { width: number; length: number; height: number };
  pallet: { width: number; length: number; height: number } | null;
}

/** Thickness of one Zwischenlage in mm (matches robot `Dicke_ZwLagen`). */
export const ZWISCHENLAGE_HEIGHT_MM = 3;

/**
 * Z of the bottom face of packages on `layerIndex` (0 = bottom layer).
 * Sum of package heights below + Zwischenlagen under this layer and below.
 * Does not include pallet height.
 */
export function layerZBottom(
  layers: Layer[],
  layerIndex: number,
  packageHeight: number,
  zwischenlageHeight = ZWISCHENLAGE_HEIGHT_MM,
): number {
  let z = 0;
  const last = Math.min(layerIndex, layers.length - 1);
  for (let i = 0; i <= last; i++) {
    z += (layers[i]?.zwischenlage ?? 0) * zwischenlageHeight;
    if (i < layerIndex) z += packageHeight;
  }
  return z;
}

/**
 * Robot place Z (top of packages on this layer): bottom + package height.
 * First layer with Zwischenlage → Zwischenlage + box height, and so on.
 */
export function layerPlaceZ(
  layers: Layer[],
  layerIndex: number,
  packageHeight: number,
  zwischenlageHeight = ZWISCHENLAGE_HEIGHT_MM,
): number {
  return layerZBottom(layers, layerIndex, packageHeight, zwischenlageHeight) + packageHeight;
}

function calculatePackageCenters(
  center: [number, number],
  width: number,
  length: number,
  rotation: Rotation,
  numPackages: number,
): Array<[number, number]> {
  const centers: Array<[number, number]> = [];
  for (let i = 0; i < numPackages; i++) {
    let x: number;
    let y: number;
    if (rotation === 0) {
      x = center[0] + (i - (numPackages - 1) / 2) * width;
      y = center[1];
    } else if (rotation === 90) {
      x = center[0];
      y = center[1] + (i - (numPackages - 1) / 2) * width;
    } else if (rotation === 180) {
      x = center[0] - (i - (numPackages - 1) / 2) * width;
      y = center[1];
    } else if (rotation === 270) {
      x = center[0];
      y = center[1] - (i - (numPackages - 1) / 2) * width;
    } else {
      throw new Error("Invalid rotation angle. Must be one of [0, 90, 180, 270].");
    }
    centers.push([x, y]);
  }
  return centers;
}

function parseBlueLine(dx: number, dy: number): Side | Corner | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 0 && dy > 0) return "bottom";
  if (dx === 0 && dy < 0) return "top";
  if (dx > 0 && dy === 0) return "left";
  if (dx < 0 && dy === 0) return "right";
  if (dx > 0 && dy > 0) return "bottom_left";
  if (dx > 0 && dy < 0) return "top_right";
  if (dx < 0 && dy > 0) return "bottom_right";
  if (dx < 0 && dy < 0) return "top_left";
  return null;
}

function expectIndex<T>(arr: T[], idx: number, label: string): T {
  const v = arr[idx];
  if (v === undefined || v === null) {
    throw new Error(`Unexpected .rob format: missing ${label}`);
  }
  return v as T;
}

export function parseRobText(text: string): PalletData {
  // Do NOT filter blank lines; positions are significant in the Python version
  const lines = text.split(/\r?\n/);
  if (lines.length < 6) throw new Error("Unexpected .rob format");

  const palletDimensionsRaw = lines[0]?.trim()?.split(/\s+/).map((n) => parseInt(n, 10)) ?? [];
  const palletDims = palletDimensionsRaw.length >= 3
    ? { width: palletDimensionsRaw[0]!, length: palletDimensionsRaw[1]!, height: palletDimensionsRaw[2]! }
    : null;

  const packageLine = lines[1];
  if (!packageLine) throw new Error("Unexpected .rob format: missing package dimensions line");
  const packageDimensions = packageLine.trim().split(/\s+/).map((n) => parseInt(n, 10));
  const package_width = expectIndex(packageDimensions, 0, "package width");
  const package_length = expectIndex(packageDimensions, 1, "package length");
  const package_height = expectIndex(packageDimensions, 2, "package height");
  // Optional input direction flag (packages come in rotated 90°). If 1, flip
  // width/length for boxes only (do not change stored package dims).
  const input_direction = packageDimensions.length > 3 && packageDimensions[3] === 1 ? 1 : 0;

  const uniqueLayersLine = lines[2];
  const layersCountLine = lines[3];
  if (!uniqueLayersLine || !layersCountLine) throw new Error("Unexpected .rob format: missing layer count lines");
  const num_unique_layers = parseInt(uniqueLayersLine.trim(), 10);
  const num_layers = parseInt(layersCountLine.trim(), 10);

  const layer_order: Array<{ unique_layer_id: number; zwischenlage: number }> = [];
  let current_line = 5;
  for (let i = 0; i < num_layers; i++) {
    const lo = lines[current_line];
    if (!lo) throw new Error("Unexpected .rob format: missing layer order entry");
    const parts = lo.trim().split(/\s+/).map((n) => parseInt(n, 10));
    const unique_layer_id = expectIndex(parts, 0, "unique layer id");
    const zwischenlage = parts.length > 1 && Number.isFinite(parts[1]) ? parts[1]! : 0;
    layer_order.push({ unique_layer_id, zwischenlage });
    current_line += 1;
  }

  const parseLayerBoxes = (): Box[] => {
    // Skip over any empty lines before the count line
    while (current_line < lines.length && lines[current_line]?.trim() === "") current_line += 1;
    const countLine = lines[current_line] ?? "";
    if (!countLine) throw new Error("Unexpected .rob format: missing coordinates count");
    const num_coordinates = parseInt(countLine.trim(), 10);
    current_line += 1;
    const boxes: Box[] = [];
    let boxCount = 1;
    for (let i = 0; i < num_coordinates; i++) {
      // Move past accidental blank lines within coordinate block
      while (current_line < lines.length && lines[current_line]?.trim() === "") current_line += 1;
      const coordLine = lines[current_line] ?? "";
      if (!coordLine) throw new Error("Unexpected .rob format: missing coordinate line");
      const rawParts = coordLine.trim().split(/\s+/).map((n) => parseInt(n, 10));
      // ensure array has at least 9 entries, with explicit numeric copy
      const parts: number[] = new Array<number>(9);
      for (let p = 0; p < 9; p++) {
        const v = rawParts[p];
        parts[p] = typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
      const x = expectIndex(parts, 3, "x");
      const y = expectIndex(parts, 4, "y");
      const rotation = expectIndex(parts, 5, "rotation") as Rotation;
      const num_packages = expectIndex(parts, 6, "num_packages");
      const dx = expectIndex(parts, 7, "dx");
      const dy = expectIndex(parts, 8, "dy");

      const blue_line = parseBlueLine(dx, dy);

      if (num_packages === 1) {
        const rectWidth = input_direction === 1 ? package_width : package_length;
        const rectLength = input_direction === 1 ? package_length : package_width;
        const rect: Rectangle = { width: rectWidth, length: rectLength, x, y };
        boxes.push({
          blueNumber: boxCount,
          blueLine: blue_line,
          rotation,
          rect,
          height: package_height,
          placeX: x,
          placeY: y,
          numPackages: num_packages,
        });
      } else {
        const centerWidth = input_direction === 1 ? package_length : package_width;
        const centerLength = input_direction === 1 ? package_width : package_length;
        const centers = calculatePackageCenters([x, y], centerWidth, centerLength, rotation, num_packages);
        for (const c of centers) {
          const cx = (c as number[])[0]!;
          const cy = (c as number[])[1]!;
          const rectWidth = input_direction === 1 ? package_width : package_length;
          const rectLength = input_direction === 1 ? package_length : package_width;
          const rect: Rectangle = { width: rectWidth, length: rectLength, x: cx, y: cy };
          boxes.push({
            blueNumber: boxCount,
            blueLine: blue_line,
            rotation,
            rect,
            height: package_height,
            placeX: x,
            placeY: y,
            numPackages: num_packages,
          });
        }
      }
      boxCount += 1;
      current_line += 1;
    }
    return boxes;
  };

  const unique_layers: Layer[] = [];
  for (let i = 0; i < Math.max(1, num_unique_layers); i++) {
    unique_layers.push({ unique_layer_id: i + 1, boxes: parseLayerBoxes(), zwischenlage: 0 });
  }

  const layers: Layer[] = [];
  for (const entry of layer_order) {
    let idx = entry.unique_layer_id - 1;
    if (idx < 0) idx = unique_layers.length - 1; // mimic Python negative index behavior when num==0
    const src = unique_layers[idx];
    layers.push({
      unique_layer_id: entry.unique_layer_id,
      boxes: src ? src.boxes : [],
      zwischenlage: entry.zwischenlage,
    });
  }

  const total_boxes = layers.reduce((acc, l) => acc + l.boxes.length, 0);
  return {
    layers,
    layer_count: layers.length,
    total_boxes,
    package: { width: package_width, length: package_length, height: package_height },
    pallet: palletDims,
  };
}


