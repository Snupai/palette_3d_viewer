/**
 * MultiPack für Roboter (mpick32.exe 2.1.315.25) Muster model.
 *
 * All coordinates are integers in 0.1 mm ("dmm"), like the legacy record.
 * One block is one optimizer Muster entry: a rectangle of
 * `xCount × yCount` identical packages with constant `dX`/`dY` pitch.
 */

import {
  musterOrientRotation,
  type MusterOrient,
  type MusterSubOrient,
} from "~/domain/solver/multipack/orientation";

export { musterOrientRotation };
export type { MusterOrient, MusterSubOrient };

export type MusterBlock = {
  x: number;
  y: number;
  dX: number;
  dY: number;
  xMax: number;
  yMax: number;
  xCount: number;
  yCount: number;
  subOrient: MusterSubOrient;
  orient: MusterOrient;
};

export type Muster = {
  layerOrient: number;
  blocks: MusterBlock[];
};

/** Export cap of the legacy record (`MakeMPMuster`, 0x00ca79ac). */
export const MUSTER_BLOCK_CAP = 400;

/** One tiled package placement (`TFreeLayer` PS item, display frame). */
export type MusterPackage = {
  x: number;
  y: number;
  xMax: number;
  yMax: number;
  orient: MusterOrient;
};

/** Delphi `div`: integer division truncating toward zero. */
export function delphiDiv(dividend: number, divisor: number): number {
  return Math.trunc(dividend / divisor);
}

/** Finalize pass of the optimizer: `xMax := x + dX*XCount`, `yMax := y + dY*YCount`. */
export function finalizeMusterBlock(block: MusterBlock): MusterBlock {
  return {
    ...block,
    xMax: block.x + block.dX * block.xCount,
    yMax: block.y + block.dY * block.yCount,
  };
}
