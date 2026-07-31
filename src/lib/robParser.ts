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

export interface Grip {
  /** Client-only stable id for drag tracking and React keys. */
  id: string;
  /** Robot pick pose: the first three values of a .rob coordinate line. */
  pickX: number;
  pickY: number;
  pickRotation: Rotation;
  /** Robot place pose: values four through six of a .rob coordinate line. */
  x: number;
  y: number;
  rotation: Rotation;
  numPackages: number;
  dx: number;
  dy: number;
  /** Migration fallback for editor data saved before pick fields were named. */
  rawLead?: [number, number, number];
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
  /** Editable source data, keyed by 1-based unique layer id. */
  uniqueLayers: Record<number, Grip[]>;
  layer_count: number;
  total_boxes: number;
  package: { width: number; length: number; height: number };
  pallet: { width: number; length: number; height: number } | null;
  inputDirection: 0 | 1;
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
  return (
    layerZBottom(layers, layerIndex, packageHeight, zwischenlageHeight) +
    packageHeight
  );
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
      throw new Error(
        "Invalid rotation angle. Must be one of [0, 90, 180, 270].",
      );
    }
    centers.push([x, y]);
  }
  return centers;
}

export function parseBlueLine(dx: number, dy: number): Side | Corner | null {
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

let gripIdCounter = 0;

function createGripId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  gripIdCounter += 1;
  return `grip-${Date.now()}-${gripIdCounter}`;
}

export function footprintSize(box: Pick<Box, "rotation" | "rect">): {
  width: number;
  length: number;
} {
  if (box.rotation === 90 || box.rotation === 270) {
    return { width: box.rect.width, length: box.rect.length };
  }
  return { width: box.rect.length, length: box.rect.width };
}

/**
 * Pick-center offset from the conveyor/reference origin for one grip.
 * Existing .rob plans encode this as half the grouped package span on X and
 * half the package depth on negative Y (rotated with the pick pose).
 */
export function pickOffsetForCount(
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
  pickRotation: Rotation,
  numPackages: number,
): { x: number; y: number } {
  const width = inputDirection === 1 ? packageLength : packageWidth;
  const length = inputDirection === 1 ? packageWidth : packageLength;
  const baseX = (Math.max(1, numPackages) * width) / 2;
  const baseY = -length / 2;
  const rotated =
    pickRotation === 0
      ? { x: baseX, y: baseY }
      : pickRotation === 90
        ? { x: -baseY, y: baseX }
        : pickRotation === 180
          ? { x: -baseX, y: -baseY }
          : { x: baseY, y: -baseX };

  // .rob coordinates are integer-based and the existing plans truncate halves.
  return { x: Math.trunc(rotated.x), y: Math.trunc(rotated.y) };
}

export function gripsToBoxes(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  packageHeight: number,
  inputDirection: 0 | 1,
): Box[] {
  const boxes: Box[] = [];
  const rectWidth = inputDirection === 1 ? packageWidth : packageLength;
  const rectLength = inputDirection === 1 ? packageLength : packageWidth;
  const centerWidth = inputDirection === 1 ? packageLength : packageWidth;
  const centerLength = inputDirection === 1 ? packageWidth : packageLength;

  grips.forEach((grip, gripIndex) => {
    const centers =
      grip.numPackages === 1
        ? [[grip.x, grip.y] satisfies [number, number]]
        : calculatePackageCenters(
            [grip.x, grip.y],
            centerWidth,
            centerLength,
            grip.rotation,
            grip.numPackages,
          );

    for (const [x, y] of centers) {
      boxes.push({
        blueNumber: gripIndex + 1,
        blueLine: parseBlueLine(grip.dx, grip.dy),
        rotation: grip.rotation,
        rect: { width: rectWidth, length: rectLength, x, y },
        height: packageHeight,
        placeX: grip.x,
        placeY: grip.y,
        numPackages: grip.numPackages,
      });
    }
  });

  return boxes;
}

export type GripCollision = {
  firstGripIndex: number;
  secondGripIndex: number;
};

/**
 * Finds the first pair of grip groups whose package footprints overlap.
 * Boxes that only touch at an edge or corner are valid and do not collide.
 */
export function findGripCollision(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): GripCollision | null {
  const boxesByGrip = grips.map((grip) =>
    gripsToBoxes([grip], packageWidth, packageLength, 0, inputDirection),
  );
  // ROB place coordinates are integer-only. With odd package dimensions,
  // two edge-touching boxes can therefore appear to overlap by exactly 0.5 mm.
  const tolerance = 0.500_001;

  for (
    let firstGripIndex = 0;
    firstGripIndex < boxesByGrip.length;
    firstGripIndex++
  ) {
    const firstBoxes = boxesByGrip[firstGripIndex] ?? [];
    for (
      let secondGripIndex = firstGripIndex + 1;
      secondGripIndex < boxesByGrip.length;
      secondGripIndex++
    ) {
      const secondBoxes = boxesByGrip[secondGripIndex] ?? [];
      for (const first of firstBoxes) {
        const firstSize = footprintSize(first);
        const firstLeft = first.rect.x - firstSize.width / 2;
        const firstRight = first.rect.x + firstSize.width / 2;
        const firstBottom = first.rect.y - firstSize.length / 2;
        const firstTop = first.rect.y + firstSize.length / 2;

        for (const second of secondBoxes) {
          const secondSize = footprintSize(second);
          const secondLeft = second.rect.x - secondSize.width / 2;
          const secondRight = second.rect.x + secondSize.width / 2;
          const secondBottom = second.rect.y - secondSize.length / 2;
          const secondTop = second.rect.y + secondSize.length / 2;
          const overlapX =
            Math.min(firstRight, secondRight) -
              Math.max(firstLeft, secondLeft) >
            tolerance;
          const overlapY =
            Math.min(firstTop, secondTop) -
              Math.max(firstBottom, secondBottom) >
            tolerance;

          if (overlapX && overlapY) {
            return { firstGripIndex, secondGripIndex };
          }
        }
      }
    }
  }

  return null;
}

export function applyGripEdit(
  data: PalletData,
  uniqueLayerId: number,
  nextGrips: Grip[],
): PalletData {
  const uniqueLayers = {
    ...data.uniqueLayers,
    [uniqueLayerId]: nextGrips.map((grip) => ({ ...grip })),
  };
  const boxes = gripsToBoxes(
    uniqueLayers[uniqueLayerId] ?? [],
    data.package.width,
    data.package.length,
    data.package.height,
    data.inputDirection,
  );
  const layers = data.layers.map((layer) =>
    layer.unique_layer_id === uniqueLayerId ? { ...layer, boxes } : layer,
  );

  return {
    ...data,
    uniqueLayers,
    layers,
    layer_count: layers.length,
    total_boxes: layers.reduce((total, layer) => total + layer.boxes.length, 0),
  };
}

export function splitGrip(
  grip: Grip,
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): Grip[] {
  const groupedPickOffset = pickOffsetForCount(
    packageWidth,
    packageLength,
    inputDirection,
    grip.pickRotation,
    grip.numPackages,
  );
  const singlePickOffset = pickOffsetForCount(
    packageWidth,
    packageLength,
    inputDirection,
    grip.pickRotation,
    1,
  );
  const pickOriginX = grip.pickX - groupedPickOffset.x;
  const pickOriginY = grip.pickY - groupedPickOffset.y;

  return gripsToBoxes(
    [grip],
    packageWidth,
    packageLength,
    0,
    inputDirection,
  ).map((box) => ({
    id: createGripId(),
    pickX: pickOriginX + singlePickOffset.x,
    pickY: pickOriginY + singlePickOffset.y,
    pickRotation: grip.pickRotation,
    x: box.rect.x,
    y: box.rect.y,
    rotation: grip.rotation,
    numPackages: 1,
    dx: 0,
    dy: 0,
  }));
}

export function mergeGrips(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): Grip | null {
  if (
    grips.length < 2 ||
    grips.some(
      (grip) =>
        grip.numPackages !== 1 ||
        grip.rotation !== grips[0]?.rotation ||
        grip.pickRotation !== grips[0]?.pickRotation,
    )
  ) {
    return null;
  }

  const rotation = grips[0]!.rotation;
  const pickRotation = grips[0]!.pickRotation;
  const effectiveWidth = inputDirection === 1 ? packageLength : packageWidth;
  const horizontal = rotation === 0 || rotation === 180;
  const crossAxis = horizontal ? grips[0]!.y : grips[0]!.x;
  const tolerance = 0.001;
  if (
    grips.some(
      (grip) =>
        Math.abs((horizontal ? grip.y : grip.x) - crossAxis) > tolerance,
    )
  ) {
    return null;
  }

  const direction = rotation === 180 || rotation === 270 ? -1 : 1;
  const sorted = [...grips].sort(
    (a, b) => direction * ((horizontal ? a.x : a.y) - (horizontal ? b.x : b.y)),
  );
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const previousAxis = horizontal ? previous.x : previous.y;
    const currentAxis = horizontal ? current.x : current.y;
    if (
      Math.abs(direction * (currentAxis - previousAxis) - effectiveWidth) >
      tolerance
    ) {
      return null;
    }
  }

  const averageX =
    sorted.reduce((total, grip) => total + grip.x, 0) / sorted.length;
  const averageY =
    sorted.reduce((total, grip) => total + grip.y, 0) / sorted.length;
  // Coordinate lines are integer-based. After persisted singles are re-read,
  // an odd package width can leave their average at n ± 0.5; snap outward to
  // recover the original integer grip anchor.
  const snapAnchor = (value: number) =>
    Number.isInteger(value)
      ? value
      : value < 0
        ? Math.floor(value)
        : Math.ceil(value);
  const x = snapAnchor(averageX);
  const y = snapAnchor(averageY);
  const first = sorted[0]!;
  const singlePickOffset = pickOffsetForCount(
    packageWidth,
    packageLength,
    inputDirection,
    pickRotation,
    1,
  );
  const firstPickOrigin = {
    x: first.pickX - singlePickOffset.x,
    y: first.pickY - singlePickOffset.y,
  };
  if (
    sorted.some(
      (grip) =>
        Math.abs(grip.pickX - singlePickOffset.x - firstPickOrigin.x) >
          tolerance ||
        Math.abs(grip.pickY - singlePickOffset.y - firstPickOrigin.y) >
          tolerance,
    )
  ) {
    return null;
  }
  const mergedPickOffset = pickOffsetForCount(
    packageWidth,
    packageLength,
    inputDirection,
    pickRotation,
    sorted.length,
  );
  const sameOffset = sorted.every(
    (grip) => grip.dx === first.dx && grip.dy === first.dy,
  );

  return {
    id: createGripId(),
    pickX: firstPickOrigin.x + mergedPickOffset.x,
    pickY: firstPickOrigin.y + mergedPickOffset.y,
    pickRotation,
    x,
    y,
    rotation,
    numPackages: sorted.length,
    dx: sameOffset ? first.dx : 0,
    dy: sameOffset ? first.dy : 0,
  };
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

  const palletDimensionsRaw =
    lines[0]
      ?.trim()
      ?.split(/\s+/)
      .map((n) => parseInt(n, 10)) ?? [];
  const palletDims =
    palletDimensionsRaw.length >= 3
      ? {
          width: palletDimensionsRaw[0]!,
          length: palletDimensionsRaw[1]!,
          height: palletDimensionsRaw[2]!,
        }
      : null;

  const packageLine = lines[1];
  if (!packageLine)
    throw new Error("Unexpected .rob format: missing package dimensions line");
  const packageDimensions = packageLine
    .trim()
    .split(/\s+/)
    .map((n) => parseInt(n, 10));
  const package_width = expectIndex(packageDimensions, 0, "package width");
  const package_length = expectIndex(packageDimensions, 1, "package length");
  const package_height = expectIndex(packageDimensions, 2, "package height");
  // Optional input direction flag (packages come in rotated 90°). If 1, flip
  // width/length for boxes only (do not change stored package dims).
  const input_direction: 0 | 1 =
    packageDimensions.length > 3 && packageDimensions[3] === 1 ? 1 : 0;

  const uniqueLayersLine = lines[2];
  const layersCountLine = lines[3];
  if (!uniqueLayersLine || !layersCountLine)
    throw new Error("Unexpected .rob format: missing layer count lines");
  const num_unique_layers = parseInt(uniqueLayersLine.trim(), 10);
  const num_layers = parseInt(layersCountLine.trim(), 10);

  const layer_order: Array<{ unique_layer_id: number; zwischenlage: number }> =
    [];
  let current_line = 5;
  for (let i = 0; i < num_layers; i++) {
    const lo = lines[current_line];
    if (!lo)
      throw new Error("Unexpected .rob format: missing layer order entry");
    const parts = lo
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10));
    const unique_layer_id = expectIndex(parts, 0, "unique layer id");
    const zwischenlage =
      parts.length > 1 && Number.isFinite(parts[1]) ? parts[1]! : 0;
    layer_order.push({ unique_layer_id, zwischenlage });
    current_line += 1;
  }

  const parseLayerGrips = (): Grip[] => {
    // Skip over any empty lines before the count line
    while (current_line < lines.length && lines[current_line]?.trim() === "")
      current_line += 1;
    const countLine = lines[current_line] ?? "";
    if (!countLine)
      throw new Error("Unexpected .rob format: missing coordinates count");
    const num_coordinates = parseInt(countLine.trim(), 10);
    current_line += 1;
    const grips: Grip[] = [];
    for (let i = 0; i < num_coordinates; i++) {
      // Move past accidental blank lines within coordinate block
      while (current_line < lines.length && lines[current_line]?.trim() === "")
        current_line += 1;
      const coordLine = lines[current_line] ?? "";
      if (!coordLine)
        throw new Error("Unexpected .rob format: missing coordinate line");
      const rawParts = coordLine
        .trim()
        .split(/\s+/)
        .map((n) => parseInt(n, 10));
      // ensure array has at least 9 entries, with explicit numeric copy
      const parts: number[] = new Array<number>(9);
      for (let p = 0; p < 9; p++) {
        const v = rawParts[p];
        parts[p] = typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
      grips.push({
        id: createGripId(),
        pickX: expectIndex(parts, 0, "pick x"),
        pickY: expectIndex(parts, 1, "pick y"),
        pickRotation: expectIndex(parts, 2, "pick rotation") as Rotation,
        x: expectIndex(parts, 3, "x"),
        y: expectIndex(parts, 4, "y"),
        rotation: expectIndex(parts, 5, "rotation") as Rotation,
        numPackages: expectIndex(parts, 6, "num_packages"),
        dx: expectIndex(parts, 7, "dx"),
        dy: expectIndex(parts, 8, "dy"),
      });
      current_line += 1;
    }
    return grips;
  };

  const uniqueLayers: Record<number, Grip[]> = {};
  const unique_layers: Layer[] = [];
  for (let i = 0; i < Math.max(1, num_unique_layers); i++) {
    const uniqueLayerId = i + 1;
    const grips = parseLayerGrips();
    uniqueLayers[uniqueLayerId] = grips;
    unique_layers.push({
      unique_layer_id: uniqueLayerId,
      boxes: gripsToBoxes(
        grips,
        package_width,
        package_length,
        package_height,
        input_direction,
      ),
      zwischenlage: 0,
    });
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
    uniqueLayers,
    layer_count: layers.length,
    total_boxes,
    package: {
      width: package_width,
      length: package_length,
      height: package_height,
    },
    pallet: palletDims,
    inputDirection: input_direction,
  };
}

function legacyGripsForUniqueLayer(
  data: PalletData,
  uniqueLayerId: number,
): Grip[] {
  const sourceLayer = data.layers.find(
    (layer) => layer.unique_layer_id === uniqueLayerId,
  );
  if (!sourceLayer) return [];

  const grouped = new Map<number, Box[]>();
  for (const box of sourceLayer.boxes) {
    const boxes = grouped.get(box.blueNumber) ?? [];
    boxes.push(box);
    grouped.set(box.blueNumber, boxes);
  }

  return [...grouped.values()].map((boxes) => {
    const first = boxes[0]!;
    const numPackages = first.numPackages ?? boxes.length;
    const pickRotation: Rotation = 0;
    const pickOffset = pickOffsetForCount(
      data.package.width,
      data.package.length,
      data.inputDirection ?? 0,
      pickRotation,
      numPackages,
    );
    return {
      id: createGripId(),
      pickX: pickOffset.x,
      pickY: pickOffset.y,
      pickRotation,
      x: first.placeX ?? first.rect.x,
      y: first.placeY ?? first.rect.y,
      rotation: first.rotation,
      numPackages,
      dx: 0,
      dy: 0,
    };
  });
}

export function serializeRobText(
  data: PalletData,
  opts?: { newline?: "\n" | "\r\n" },
): string {
  const newline = opts?.newline ?? "\n";
  const uniqueLayerIds = Object.keys(data.uniqueLayers ?? {})
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const layerIds = data.layers
    .map((layer) => layer.unique_layer_id)
    .filter((id) => Number.isInteger(id) && id > 0);
  const numUniqueLayers = Math.max(0, ...uniqueLayerIds, ...layerIds);
  const palletLine = data.pallet
    ? `${data.pallet.width} ${data.pallet.length} ${data.pallet.height}`
    : "0 0 0";
  const inputDirection = data.inputDirection ?? 0;
  const packageLine =
    `${data.package.width} ${data.package.length} ${data.package.height}` +
    (inputDirection === 1 ? " 1" : "");
  const lines = [
    palletLine,
    packageLine,
    String(numUniqueLayers),
    String(data.layers.length),
    "",
    ...data.layers.map(
      (layer) => `${layer.unique_layer_id} ${layer.zwischenlage ?? 0}`,
    ),
  ];

  for (
    let uniqueLayerId = 1;
    uniqueLayerId <= numUniqueLayers;
    uniqueLayerId++
  ) {
    const grips =
      data.uniqueLayers?.[uniqueLayerId] ??
      legacyGripsForUniqueLayer(data, uniqueLayerId);
    lines.push(String(grips.length));
    for (const grip of grips) {
      const fallbackPickRotation = grip.rawLead?.[2] ?? 0;
      const fallbackPickOffset = pickOffsetForCount(
        data.package.width,
        data.package.length,
        inputDirection,
        fallbackPickRotation as Rotation,
        grip.numPackages,
      );
      lines.push(
        [
          grip.pickX ?? grip.rawLead?.[0] ?? fallbackPickOffset.x,
          grip.pickY ?? grip.rawLead?.[1] ?? fallbackPickOffset.y,
          grip.pickRotation ?? fallbackPickRotation,
          grip.x,
          grip.y,
          grip.rotation,
          grip.numPackages,
          grip.dx,
          grip.dy,
        ].join(" "),
      );
    }
  }

  return lines.join(newline);
}
