import type {
  Box,
  Corner,
  Grip,
  GripCollision,
  Layer,
  Rotation,
  Side,
} from "~/domain/palletTypes";
import { ZWISCHENLAGE_HEIGHT_MM } from "~/domain/palletTypes";

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

/**
 * Finds the first pair of grip groups whose package footprints overlap.
 * Boxes that only touch at an edge or corner are valid and do not collide.
 */
export function findGripCollision(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
  focusGripIndex?: number,
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
      if (
        focusGripIndex !== undefined &&
        firstGripIndex !== focusGripIndex &&
        secondGripIndex !== focusGripIndex
      ) {
        continue;
      }
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

/** Truncate toward zero — .rob coordinates are integer tokens. */
export function toRobInt(value: number): number {
  return Math.trunc(value);
}
