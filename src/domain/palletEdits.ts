import { createGripId } from "~/domain/gripId";
import {
  footprintSize,
  gripsToBoxes,
  pickOffsetForCount,
} from "~/domain/palletGeometry";
import type { Grip, PalletData } from "~/domain/palletTypes";

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

function normalizedInterlayerValue(zwischenlage: number): number {
  return Math.max(0, Math.trunc(zwischenlage));
}

export function applyBaseInterlayerEdit(
  data: PalletData,
  zwischenlage: number,
): PalletData {
  if (data.layers.length === 0) return data;
  const normalized = normalizedInterlayerValue(zwischenlage);
  if (data.layers[0]?.zwischenlage === normalized) return data;

  return {
    ...data,
    layers: data.layers.map((layer, index) =>
      index === 0
        ? {
            ...layer,
            zwischenlage: normalized,
            interlayerThicknessesMm: undefined,
          }
        : layer,
    ),
  };
}

export function applyInterlayerAfterLayerEdit(
  data: PalletData,
  layerIndex: number,
  zwischenlage: number,
): PalletData {
  if (layerIndex < 0 || layerIndex >= data.layers.length) return data;
  const normalized = normalizedInterlayerValue(zwischenlage);
  if (layerIndex === data.layers.length - 1) {
    if ((data.trailingZwischenlage ?? 0) === normalized) return data;
    return {
      ...data,
      trailingZwischenlage: normalized,
      trailingInterlayerThicknessesMm: undefined,
    };
  }

  const nextLayerIndex = layerIndex + 1;
  if (data.layers[nextLayerIndex]?.zwischenlage === normalized) return data;
  return {
    ...data,
    layers: data.layers.map((layer, index) =>
      index === nextLayerIndex
        ? {
            ...layer,
            zwischenlage: normalized,
            interlayerThicknessesMm: undefined,
          }
        : layer,
    ),
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
  const first = grips[0];
  if (
    !first ||
    grips.length < 2 ||
    grips.some(
      (grip) =>
        grip.numPackages !== 1 ||
        grip.rotation % 180 !== first.rotation % 180 ||
        grip.pickRotation !== first.pickRotation,
    )
  ) {
    return null;
  }

  const rotation = first.rotation;
  const pickRotation = first.pickRotation;
  const firstBox = gripsToBoxes(
    [first],
    packageWidth,
    packageLength,
    0,
    inputDirection,
  )[0];
  if (!firstBox) return null;
  const firstFootprint = footprintSize(firstBox);
  // Allow only small manual placement inaccuracies. A successful merge then
  // snaps every package onto one axis with their grouping faces touching.
  const alignmentTolerance = Math.max(
    2,
    Math.min(10, Math.min(firstFootprint.width, firstFootprint.length) * 0.05),
  );
  const horizontal = rotation === 0 || rotation === 180;
  const groupingSpan = horizontal
    ? firstFootprint.width
    : firstFootprint.length;
  const crossAxisValues = grips.map((grip) => (horizontal ? grip.y : grip.x));
  if (
    Math.max(...crossAxisValues) - Math.min(...crossAxisValues) >
    alignmentTolerance
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
      Math.abs(direction * (currentAxis - previousAxis) - groupingSpan) >
      alignmentTolerance
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
  const pickOrigins = sorted.map((grip) => {
    const singlePickOffset = pickOffsetForCount(
      packageWidth,
      packageLength,
      inputDirection,
      grip.pickRotation,
      1,
    );
    return {
      x: grip.pickX - singlePickOffset.x,
      y: grip.pickY - singlePickOffset.y,
    };
  });
  const pickOriginXs = pickOrigins.map((origin) => origin.x);
  const pickOriginYs = pickOrigins.map((origin) => origin.y);
  const averagePickOriginX =
    pickOriginXs.reduce((total, value) => total + value, 0) /
    pickOriginXs.length;
  const averagePickOriginY =
    pickOriginYs.reduce((total, value) => total + value, 0) /
    pickOriginYs.length;
  const mergedPickOffset = pickOffsetForCount(
    packageWidth,
    packageLength,
    inputDirection,
    pickRotation,
    sorted.length,
  );
  const sameOffset = sorted.every(
    (grip) => grip.dx === sorted[0]!.dx && grip.dy === sorted[0]!.dy,
  );

  return {
    id: createGripId(),
    pickX: snapAnchor(averagePickOriginX + mergedPickOffset.x),
    pickY: snapAnchor(averagePickOriginY + mergedPickOffset.y),
    pickRotation,
    x,
    y,
    rotation,
    numPackages: sorted.length,
    dx: sameOffset ? sorted[0]!.dx : 0,
    dy: sameOffset ? sorted[0]!.dy : 0,
  };
}
