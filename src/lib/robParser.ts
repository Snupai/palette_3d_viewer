import { createGripId } from "~/domain/gripId";
import { gripsToBoxes, pickOffsetForCount } from "~/domain/palletGeometry";
import type {
  Box,
  Grip,
  Layer,
  PalletData,
  Rotation,
} from "~/domain/palletTypes";

export type {
  Box,
  Corner,
  Grip,
  GripCollision,
  Layer,
  PalletData,
  Rectangle,
  Rotation,
  Side,
} from "~/domain/palletTypes";
export { ZWISCHENLAGE_HEIGHT_MM } from "~/domain/palletTypes";
export {
  findGripCollision,
  footprintSize,
  gripsToBoxes,
  layerPlaceZ,
  layerZBottom,
  parseBlueLine,
  pickOffsetForCount,
  toRobInt,
} from "~/domain/palletGeometry";
export { insertMergedGripByDeltaDependencies } from "~/domain/gripDependencies";
export {
  applyBaseInterlayerEdit,
  applyGripEdit,
  applyInterlayerAfterLayerEdit,
  mergeGrips,
  splitGrip,
} from "~/domain/palletEdits";

function robError(lineNumber: number, message: string): Error {
  return new Error(`.rob line ${lineNumber}: ${message}`);
}

function splitTokens(line: string): string[] {
  const trimmed = line.trim();
  if (trimmed === "") return [];
  return trimmed.split(/\s+/);
}

function parseRequiredIntToken(
  token: string | undefined,
  lineNumber: number,
  field: string,
): number {
  if (token === undefined || token === "") {
    throw robError(lineNumber, `missing field "${field}"`);
  }
  if (!/^-?\d+$/.test(token)) {
    throw robError(
      lineNumber,
      `field "${field}" must be an integer (got "${token}")`,
    );
  }
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value)) {
    throw robError(lineNumber, `field "${field}" is not a finite integer`);
  }
  return value;
}

function parseOptionalNonNegIntToken(
  token: string | undefined,
  lineNumber: number,
  field: string,
  fallback = 0,
): number {
  if (token === undefined || token === "") return fallback;
  const value = parseRequiredIntToken(token, lineNumber, field);
  if (value < 0) {
    throw robError(lineNumber, `field "${field}" must be >= 0`);
  }
  return value;
}

function parsePositiveDimension(
  token: string | undefined,
  lineNumber: number,
  field: string,
): number {
  const value = parseRequiredIntToken(token, lineNumber, field);
  if (value <= 0) {
    throw robError(lineNumber, `field "${field}" must be > 0`);
  }
  return value;
}

function parseNonNegativeCount(
  token: string | undefined,
  lineNumber: number,
  field: string,
): number {
  const value = parseRequiredIntToken(token, lineNumber, field);
  if (value < 0) {
    throw robError(lineNumber, `field "${field}" must be >= 0`);
  }
  return value;
}

function parsePositiveCount(
  token: string | undefined,
  lineNumber: number,
  field: string,
): number {
  const value = parseRequiredIntToken(token, lineNumber, field);
  if (value <= 0) {
    throw robError(lineNumber, `field "${field}" must be > 0`);
  }
  return value;
}

function parseRotationToken(
  token: string | undefined,
  lineNumber: number,
  field: string,
): Rotation {
  const value = parseRequiredIntToken(token, lineNumber, field);
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    throw robError(
      lineNumber,
      `field "${field}" must be 0, 90, 180, or 270 (got ${value})`,
    );
  }
  return value;
}

export function parseRobText(text: string): PalletData {
  // Do NOT filter blank lines; positions are significant in the Python version
  const lines = text.split(/\r?\n/);
  if (lines.length < 6) {
    throw new Error("Unexpected .rob format: expected at least 6 lines");
  }

  const palletTokens = splitTokens(lines[0] ?? "");
  let palletDims: PalletData["pallet"] = null;
  if (palletTokens.length > 0) {
    const width = parseRequiredIntToken(palletTokens[0], 1, "pallet width");
    const length = parseRequiredIntToken(palletTokens[1], 1, "pallet length");
    const height = parseRequiredIntToken(palletTokens[2], 1, "pallet height");
    if (width === 0 && length === 0 && height === 0) {
      palletDims = null;
    } else if (width <= 0 || length <= 0 || height <= 0) {
      throw robError(1, "pallet dimensions must be > 0 (or 0 0 0 for unknown)");
    } else {
      palletDims = { width, length, height };
    }
  }

  const packageLine = lines[1];
  if (packageLine === undefined) {
    throw robError(2, "missing package dimensions line");
  }
  const packageTokens = splitTokens(packageLine);
  const package_width = parsePositiveDimension(
    packageTokens[0],
    2,
    "package width",
  );
  const package_length = parsePositiveDimension(
    packageTokens[1],
    2,
    "package length",
  );
  const package_height = parsePositiveDimension(
    packageTokens[2],
    2,
    "package height",
  );
  // Optional input direction flag (packages come in rotated 90°). If 1, flip
  // width/length for boxes only (do not change stored package dims).
  let input_direction: 0 | 1 = 0;
  const inputDirectionExplicit = packageTokens.length > 3;
  if (inputDirectionExplicit) {
    const flag = parseRequiredIntToken(packageTokens[3], 2, "input direction");
    if (flag !== 0 && flag !== 1) {
      throw robError(2, `field "input direction" must be 0 or 1 (got ${flag})`);
    }
    input_direction = flag;
  }

  const uniqueLayersLine = lines[2];
  const layersCountLine = lines[3];
  if (uniqueLayersLine === undefined || layersCountLine === undefined) {
    throw robError(3, "missing layer count lines");
  }
  const num_unique_layers = parseNonNegativeCount(
    splitTokens(uniqueLayersLine)[0],
    3,
    "unique layer count",
  );
  const num_layers = parseNonNegativeCount(
    splitTokens(layersCountLine)[0],
    4,
    "total layer count",
  );

  const headerTokens = splitTokens(lines[4] ?? "");
  const firstLayerZwischenlage = parseOptionalNonNegIntToken(
    headerTokens[1],
    5,
    "base zwischenlage",
  );

  const layer_order: Array<{ unique_layer_id: number; zwischenlage: number }> =
    [];
  let current_line = 5;
  for (let i = 0; i < num_layers; i++) {
    const lineNumber = current_line + 1;
    const lo = lines[current_line];
    if (lo === undefined) {
      throw robError(lineNumber, "missing layer order entry");
    }
    const parts = splitTokens(lo);
    const unique_layer_id = parseRequiredIntToken(
      parts[0],
      lineNumber,
      "unique layer id",
    );
    const zwischenlage = parseOptionalNonNegIntToken(
      parts[1],
      lineNumber,
      "zwischenlage",
    );
    layer_order.push({ unique_layer_id, zwischenlage });
    current_line += 1;
  }

  const parseLayerGrips = (uniqueLayerId: number): Grip[] => {
    // Skip over any empty lines before the count line
    while (current_line < lines.length && lines[current_line]?.trim() === "")
      current_line += 1;
    const countLineNumber = current_line + 1;
    const countLine = lines[current_line];
    if (countLine === undefined) {
      throw robError(
        countLineNumber,
        `missing coordinates count for unique layer ${uniqueLayerId}`,
      );
    }
    const num_coordinates = parseNonNegativeCount(
      splitTokens(countLine)[0],
      countLineNumber,
      "coordinates count",
    );
    current_line += 1;
    const grips: Grip[] = [];
    for (let i = 0; i < num_coordinates; i++) {
      // Move past accidental blank lines within coordinate block
      while (current_line < lines.length && lines[current_line]?.trim() === "")
        current_line += 1;
      const lineNumber = current_line + 1;
      const coordLine = lines[current_line];
      if (coordLine === undefined) {
        throw robError(lineNumber, "missing coordinate line");
      }
      const rawParts = splitTokens(coordLine);
      if (rawParts.length < 9) {
        throw robError(
          lineNumber,
          `coordinate line needs 9 integer fields (got ${rawParts.length})`,
        );
      }
      grips.push({
        id: createGripId(),
        pickX: parseRequiredIntToken(rawParts[0], lineNumber, "pick x"),
        pickY: parseRequiredIntToken(rawParts[1], lineNumber, "pick y"),
        pickRotation: parseRotationToken(
          rawParts[2],
          lineNumber,
          "pick rotation",
        ),
        x: parseRequiredIntToken(rawParts[3], lineNumber, "x"),
        y: parseRequiredIntToken(rawParts[4], lineNumber, "y"),
        rotation: parseRotationToken(rawParts[5], lineNumber, "rotation"),
        numPackages: parsePositiveCount(
          rawParts[6],
          lineNumber,
          "num_packages",
        ),
        dx: parseRequiredIntToken(rawParts[7], lineNumber, "dx"),
        dy: parseRequiredIntToken(rawParts[8], lineNumber, "dy"),
      });
      current_line += 1;
    }
    return grips;
  };

  const uniqueLayerBlockCount = Math.max(1, num_unique_layers);
  const uniqueLayers: Record<number, Grip[]> = {};
  const unique_layers: Layer[] = [];
  for (let i = 0; i < uniqueLayerBlockCount; i++) {
    const uniqueLayerId = i + 1;
    const grips = parseLayerGrips(uniqueLayerId);
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
  for (let layerIndex = 0; layerIndex < layer_order.length; layerIndex++) {
    const entry = layer_order[layerIndex]!;
    const lineNumber = 6 + layerIndex;
    let idx = entry.unique_layer_id - 1;
    if (entry.unique_layer_id === 0) {
      // mimic Python negative-index behavior when id==0
      idx = unique_layers.length - 1;
    } else if (idx < 0 || idx >= unique_layers.length) {
      throw robError(
        lineNumber,
        `unique layer id ${entry.unique_layer_id} is not defined (have 1..${unique_layers.length})`,
      );
    }
    const src = unique_layers[idx];
    if (!src) {
      throw robError(
        lineNumber,
        `unique layer id ${entry.unique_layer_id} is not defined`,
      );
    }
    layers.push({
      unique_layer_id: entry.unique_layer_id,
      boxes: src.boxes,
      zwischenlage:
        layerIndex === 0
          ? firstLayerZwischenlage
          : (layer_order[layerIndex - 1]?.zwischenlage ?? 0),
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
    inputDirectionExplicit,
    trailingZwischenlage: layer_order.at(-1)?.zwischenlage ?? 0,
  };
}

function legacyGripsForUniqueLayer(
  data: PalletData,
  uniqueLayerId: number,
): Grip[] {
  let sourceLayer = data.layers.find(
    (layer) => layer.unique_layer_id === uniqueLayerId,
  );
  // Legacy stored pallets may lack uniqueLayers and use unique_layer_id <= 0.
  if (!sourceLayer && uniqueLayerId === 1) {
    sourceLayer =
      data.layers.find((layer) => layer.boxes.length > 0) ?? data.layers[0];
  }
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
  opts?: { newline?: "\n" | "\r\n"; separator?: " " | "\t" },
): string {
  const newline = opts?.newline ?? "\n";
  const separator = opts?.separator ?? " ";
  const uniqueLayerIds = Object.keys(data.uniqueLayers ?? {})
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  const layerIds = data.layers
    .map((layer) => layer.unique_layer_id)
    .filter((id) => Number.isInteger(id) && id > 0);
  // parseRobText always reads Math.max(1, num_unique_layers) coordinate blocks.
  // Keep at least one block whenever the pallet has layer rows so round-trips
  // stay valid for legacy entries without uniqueLayers / with id <= 0.
  const numUniqueLayers = Math.max(
    data.layers.length > 0 ? 1 : 0,
    ...uniqueLayerIds,
    ...layerIds,
  );
  const palletLine = data.pallet
    ? [data.pallet.width, data.pallet.length, data.pallet.height].join(
        separator,
      )
    : [0, 0, 0].join(separator);
  const inputDirection = data.inputDirection ?? 0;
  const packageLine = [
    data.package.width,
    data.package.length,
    data.package.height,
    ...(inputDirection === 1 || data.inputDirectionExplicit
      ? [inputDirection]
      : []),
  ].join(separator);
  const lines = [
    palletLine,
    packageLine,
    String(numUniqueLayers),
    String(data.layers.length),
    [0, data.layers[0]?.zwischenlage ?? 0].join(separator),
    ...data.layers.map((layer, layerIndex) =>
      [
        layer.unique_layer_id > 0 ? layer.unique_layer_id : 1,
        data.layers[layerIndex + 1]?.zwischenlage ??
          data.trailingZwischenlage ??
          0,
      ].join(separator),
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
        ].join(separator),
      );
    }
  }

  return lines.join(newline);
}
