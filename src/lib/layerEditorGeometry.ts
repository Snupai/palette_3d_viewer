import type { Grip } from "~/lib/robParser";
import {
  findGripCollision,
  footprintSize,
  gripsToBoxes,
} from "~/lib/robParser";

export const MIN_PALLET_SUPPORT_RATIO = 0.65;

type PalletSize = {
  width: number;
  length: number;
};

type PackageSize = {
  width: number;
  length: number;
};

type EditorGeometry = {
  packageSize: PackageSize;
  inputDirection: 0 | 1;
};

export type ClampDragPositionOptions = EditorGeometry & {
  grips: Grip[];
  gripIndex: number;
  grip: Grip;
  pallet: PalletSize;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export type ClampedDragPosition = {
  x: number;
  y: number;
  collided: boolean;
  insufficientSupport: boolean;
};

export function hasGripCollision(
  grips: Grip[],
  packageSize: PackageSize,
  inputDirection: 0 | 1,
): boolean {
  return (
    findGripCollision(
      grips,
      packageSize.width,
      packageSize.length,
      inputDirection,
    ) !== null
  );
}

export function palletSupportRatio(
  grip: Grip,
  pallet: PalletSize,
  packageSize: PackageSize,
  inputDirection: 0 | 1,
): number {
  const boxes = gripsToBoxes(
    [grip],
    packageSize.width,
    packageSize.length,
    0,
    inputDirection,
  );
  if (boxes.length === 0) return 0;

  return Math.min(
    ...boxes.map((box) => {
      const size = footprintSize(box);
      const left = box.rect.x - size.width / 2;
      const right = box.rect.x + size.width / 2;
      const bottom = box.rect.y - size.length / 2;
      const top = box.rect.y + size.length / 2;
      const supportedWidth = Math.max(
        0,
        Math.min(right, pallet.width) - Math.max(left, 0),
      );
      const supportedLength = Math.max(
        0,
        Math.min(top, pallet.length) - Math.max(bottom, 0),
      );
      return (supportedWidth * supportedLength) / (size.width * size.length);
    }),
  );
}

export function hasSufficientPalletSupport(
  grip: Grip,
  pallet: PalletSize,
  packageSize: PackageSize,
  inputDirection: 0 | 1,
): boolean {
  return (
    palletSupportRatio(grip, pallet, packageSize, inputDirection) >=
    MIN_PALLET_SUPPORT_RATIO
  );
}

export function clampDragPosition({
  grips,
  gripIndex,
  grip,
  pallet,
  packageSize,
  inputDirection,
  fromX,
  fromY,
  toX,
  toY,
}: ClampDragPositionOptions): ClampedDragPosition {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  let x = fromX;
  let y = fromY;
  if (steps === 0) {
    return { x, y, collided: false, insufficientSupport: false };
  }

  const otherBounds: Array<{
    left: number;
    right: number;
    bottom: number;
    top: number;
  }> = [];
  for (let index = 0; index < grips.length; index++) {
    if (index === gripIndex) continue;
    const other = grips[index];
    if (!other) continue;
    for (const box of gripsToBoxes(
      [other],
      packageSize.width,
      packageSize.length,
      0,
      inputDirection,
    )) {
      const size = footprintSize(box);
      otherBounds.push({
        left: box.rect.x - size.width / 2,
        right: box.rect.x + size.width / 2,
        bottom: box.rect.y - size.length / 2,
        top: box.rect.y + size.length / 2,
      });
    }
  }
  const collisionTolerance = 0.500_001;

  for (let step = 1; step <= steps; step++) {
    const candidateX = Math.round(fromX + ((toX - fromX) * step) / steps);
    const candidateY = Math.round(fromY + ((toY - fromY) * step) / steps);
    if (candidateX === x && candidateY === y) continue;
    const candidate = { ...grip, x: candidateX, y: candidateY };
    const insufficientSupport = !hasSufficientPalletSupport(
      candidate,
      pallet,
      packageSize,
      inputDirection,
    );
    let collides = false;
    if (!insufficientSupport && otherBounds.length > 0) {
      for (const box of gripsToBoxes(
        [candidate],
        packageSize.width,
        packageSize.length,
        0,
        inputDirection,
      )) {
        const size = footprintSize(box);
        const left = box.rect.x - size.width / 2;
        const right = box.rect.x + size.width / 2;
        const bottom = box.rect.y - size.length / 2;
        const top = box.rect.y + size.length / 2;
        if (
          otherBounds.some(
            (other) =>
              Math.min(right, other.right) - Math.max(left, other.left) >
                collisionTolerance &&
              Math.min(top, other.top) - Math.max(bottom, other.bottom) >
                collisionTolerance,
          )
        ) {
          collides = true;
          break;
        }
      }
    }
    if (insufficientSupport || collides) {
      return { x, y, collided: collides, insufficientSupport };
    }
    x = candidateX;
    y = candidateY;
  }

  return { x, y, collided: false, insufficientSupport: false };
}
