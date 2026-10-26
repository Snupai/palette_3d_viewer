import { delphiDiv } from "~/domain/solver/multipack/muster";

/**
 * Pattern-family slot generators of the MultiPack optimizer
 * (`FUN_00a45c14` simple, `FUN_00a45ebc` kombi). Coordinates are 0.1 mm and
 * relative to the pattern block; the optimizer adds the centering offset.
 */

export type MultiPackPackageDmm = {
  /** Package length (`BlockLaenge` in the legacy layer). */
  length: number;
  /** Package width (`BlockBreite`). */
  width: number;
};

/** 1 = package length along X (LVert-like), 2 = package width along X. */
export type SlotType = 1 | 2;

export type SimpleFamilySlot = {
  kind: "simple";
  type: SlotType;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  countX: number;
  countY: number;
};

export type KombiFamilySlot = {
  kind: "kombi";
  type: SlotType;
  x0: number;
  /** Right reference edge; used by the descending direction. */
  x1: number;
  y0: number;
  y1: number;
  /** Package columns per staircase step (`countA`). */
  columns: number;
  /** Rows of the tallest step (`innerRatio`); divided evenly by `steps`. */
  ratio: number;
  steps: number;
  /** Rotated tooth columns (`outerCount`). */
  toothColumns: number;
  /** Rotated tooth rows (`extraCount`). */
  toothRows: number;
  /** `'d'` in the legacy record: steps run from `x1` towards `x0`. */
  descending: boolean;
};

export type FamilySlot = SimpleFamilySlot | KombiFamilySlot;

export type FamilyContext = {
  package: MultiPackPackageDmm;
  /** Minimum package clearance (Störkontur). */
  clearance: number;
  /** Pattern block extent; a single row/column snaps to the far edge when its slot ends there. */
  blockSpanX: number;
  blockSpanY: number;
  /** Edge-fill flag `00d27e4c`; the optimizer forces it on while generating. */
  edgeFill: boolean;
  /** Interactive-quality emission: one entry per package instead of blocks. */
  interactiveQuality: boolean;
};

export type BlockSink = (block: {
  x: number;
  y: number;
  xCount: number;
  yCount: number;
  lengthAlongX: boolean;
}) => void;

function footprint(type: SlotType, pkg: MultiPackPackageDmm) {
  return type === 1
    ? { dX: pkg.length, dY: pkg.width, lengthAlongX: true }
    : { dX: pkg.width, dY: pkg.length, lengthAlongX: false };
}

export function emitSimpleFamily(
  slot: SimpleFamilySlot,
  context: FamilyContext,
  add: BlockSink,
): void {
  const { dX, dY, lengthAlongX } = footprint(slot.type, context.package);
  const { x0, x1, y0, y1, countX, countY } = slot;
  const clearance = context.clearance;

  if (context.edgeFill) {
    let offsetY = 0;
    let gapY = 0;
    if (countY < 2) {
      if (context.blockSpanY === y1) offsetY = y1 - y0 - dY;
    } else {
      gapY = delphiDiv(y1 - y0 - countY * dY, countY - 1);
    }
    let offsetX = 0;
    let gapX = 0;
    if (countX < 2) {
      if (context.blockSpanX === x1) offsetX = x1 - x0 - dX;
    } else {
      gapX = delphiDiv(x1 - x0 - countX * dX, countX - 1);
    }
    if (gapX > 0 || gapY > 0 || context.interactiveQuality) {
      for (let column = 0; column < countX; column += 1) {
        for (let row = 0; row < countY; row += 1) {
          add({
            x: column * (gapX + dX) + x0 + offsetX,
            y: row * (gapY + dY) + y0 + offsetY,
            xCount: 1,
            yCount: 1,
            lengthAlongX,
          });
        }
      }
      return;
    }
  }

  // Centered block with far-edge rings.
  let mainX = countX * dX + x0 === x1 ? countX : countX >> 1;
  let mainY = countY * dY + y0 === y1 ? countY : countY >> 1;
  if (x0 === 0 && countX === 1) mainX = 1;
  if (y0 === 0 && countY === 1) mainY = 1;
  const restX = countX - mainX;
  const restY = countY - mainY;
  const farX = x1 - (clearance + dX) * restX;
  const farY = y1 - (clearance + dY) * restY;
  if (mainX !== 0 && mainY !== 0)
    add({ x: x0, y: y0, xCount: mainX, yCount: mainY, lengthAlongX });
  if (mainX !== 0 && restY > 0)
    add({ x: x0, y: farY, xCount: mainX, yCount: restY, lengthAlongX });
  if (restX > 0 && mainY > 0)
    add({ x: farX, y: y0, xCount: restX, yCount: mainY, lengthAlongX });
  if (restX > 0 && restY > 0)
    add({ x: farX, y: farY, xCount: restX, yCount: restY, lengthAlongX });
}

export function emitKombiFamily(
  slot: KombiFamilySlot,
  context: FamilyContext,
  add: BlockSink,
): void {
  const main = footprint(slot.type, context.package);
  const tooth = footprint(slot.type === 1 ? 2 : 1, context.package);
  const clearance = context.clearance;
  const stepPitch = (main.dX + clearance) * slot.columns;
  const rowPitch = main.dY + clearance;
  const toothSpan = rowPitch * slot.toothColumns;
  const rowsPerStep = delphiDiv(slot.ratio, slot.steps);
  const interlock = rowsPerStep * rowPitch;

  const emit = (
    x: number,
    y: number,
    xCount: number,
    yCount: number,
    lengthAlongX: boolean,
    pitchX: number,
    pitchY: number,
  ) => {
    if (!context.interactiveQuality || (xCount < 2 && yCount < 2)) {
      add({ x, y, xCount, yCount, lengthAlongX });
      return;
    }
    for (let column = 0; column < xCount; column += 1) {
      for (let row = 0; row < yCount; row += 1) {
        add({
          x: x + column * pitchX,
          y: y + row * pitchY,
          xCount: 1,
          yCount: 1,
          lengthAlongX,
        });
      }
    }
  };

  for (let step = 1; step <= slot.steps; step += 1) {
    const rows = rowsPerStep * (slot.steps - step + 1);
    const x = slot.descending
      ? slot.x1 - step * stepPitch + clearance
      : (step - 1) * stepPitch + slot.x0;
    emit(
      x,
      slot.y0,
      slot.columns,
      rows,
      main.lengthAlongX,
      clearance + main.dX,
      clearance + main.dY,
    );
  }

  for (let step = 1; step <= slot.steps; step += 1) {
    const rows = rowsPerStep * step;
    const x = slot.descending
      ? slot.x1 - step * stepPitch - toothSpan + clearance
      : (step - 1) * stepPitch + slot.x0 + toothSpan;
    const y = slot.y1 - rowPitch * rows + clearance;
    emit(
      x,
      y,
      slot.columns,
      rows,
      main.lengthAlongX,
      clearance + main.dX,
      clearance + main.dY,
    );
  }

  for (let step = 0; step <= slot.steps; step += 1) {
    const x = slot.descending
      ? slot.x1 -
        step * stepPitch -
        (clearance + tooth.dX) * slot.toothColumns +
        clearance
      : step * stepPitch + slot.x0;
    const y = (slot.steps - step) * interlock + slot.y0;
    emit(
      x,
      y,
      slot.toothColumns,
      slot.toothRows,
      tooth.lengthAlongX,
      clearance + tooth.dX,
      clearance + tooth.dY,
    );
  }
}
