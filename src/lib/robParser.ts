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
}

export interface Layer {
  unique_layer_id: number;
  boxes: Box[];
}

export interface PalletData {
  layers: Layer[];
  layer_count: number;
  total_boxes: number;
  package: { width: number; length: number; height: number };
  pallet: { width: number; length: number; height: number } | null;
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

export function parseRobText(text: string): PalletData {
  // Do NOT filter blank lines; positions are significant in the Python version
  const lines = text.split(/\r?\n/);
  if (lines.length < 6) throw new Error("Unexpected .rob format");

  const palletDimensionsRaw = lines[0]?.trim()?.split(/\s+/).map((n) => parseInt(n, 10)) ?? [];
  const palletDims = palletDimensionsRaw.length >= 3
    ? { width: palletDimensionsRaw[0]!, length: palletDimensionsRaw[1]!, height: palletDimensionsRaw[2]! }
    : null;

  const packageDimensions = lines[1].trim().split(/\s+/).map((n) => parseInt(n, 10));
  const package_width = packageDimensions[0];
  const package_length = packageDimensions[1];
  const package_height = packageDimensions[2];

  const num_unique_layers = parseInt(lines[2].trim(), 10);
  const num_layers = parseInt(lines[3].trim(), 10);

  const layer_order: number[] = [];
  let current_line = 5;
  for (let i = 0; i < num_layers; i++) {
    const unique_layer_id = parseInt(lines[current_line].trim().split(/\s+/)[0]!, 10);
    layer_order.push(unique_layer_id);
    current_line += 1;
  }

  const parseLayerBoxes = (): Box[] => {
    // Skip over any empty lines before the count line
    while (current_line < lines.length && lines[current_line].trim() === "") current_line += 1;
    const num_coordinates = parseInt(lines[current_line].trim(), 10);
    current_line += 1;
    const boxes: Box[] = [];
    let boxCount = 1;
    for (let i = 0; i < num_coordinates; i++) {
      // Move past accidental blank lines within coordinate block
      while (current_line < lines.length && lines[current_line].trim() === "") current_line += 1;
      const parts = lines[current_line].trim().split(/\s+/).map((n) => parseInt(n, 10));
      const x = parts[3]!;
      const y = parts[4]!;
      const rotation = parts[5]! as Rotation;
      const num_packages = parts[6]!;
      const dx = parts[7]!;
      const dy = parts[8]!;

      const blue_line = parseBlueLine(dx, dy);

      if (num_packages === 1) {
        const rect: Rectangle = { width: package_length, length: package_width, x, y };
        boxes.push({ blueNumber: boxCount, blueLine: blue_line, rotation, rect, height: package_height });
      } else {
        const centers = calculatePackageCenters([x, y], package_width, package_length, rotation, num_packages);
        for (const c of centers) {
          const rect: Rectangle = { width: package_length, length: package_width, x: c[0], y: c[1] };
          boxes.push({ blueNumber: boxCount, blueLine: blue_line, rotation, rect, height: package_height });
        }
      }
      boxCount += 1;
      current_line += 1;
    }
    return boxes;
  };

  const unique_layers: Layer[] = [];
  for (let i = 0; i < Math.max(1, num_unique_layers); i++) {
    unique_layers.push({ unique_layer_id: i + 1, boxes: parseLayerBoxes() });
  }

  const layers: Layer[] = [];
  for (const num of layer_order) {
    let idx = num - 1;
    if (idx < 0) idx = unique_layers.length - 1; // mimic Python negative index behavior when num==0
    const src = unique_layers[idx];
    layers.push({ unique_layer_id: num, boxes: src ? src.boxes : [] });
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


