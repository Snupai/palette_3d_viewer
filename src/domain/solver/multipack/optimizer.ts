import {
  emitKombiFamily,
  emitSimpleFamily,
  type FamilyContext,
  type FamilySlot,
  type MultiPackPackageDmm,
} from "~/domain/solver/multipack/families";
import { MultiPackMPWinUnsupportedError } from "~/domain/solver/multipack/mpwin";
import {
  delphiDiv,
  finalizeMusterBlock,
  type Muster,
  type MusterBlock,
  type MusterOrient,
  type MusterSubOrient,
} from "~/domain/solver/multipack/muster";
import { eliminateMusterOverlaps } from "~/domain/solver/multipack/overlap";
import { subOrientForBlock } from "~/domain/solver/multipack/orientation";
import {
  replicateMirrorMuster,
  replicateMuster2x2,
} from "~/domain/solver/multipack/replication";

/**
 * Rectangular path of the MultiPack layer optimizer (`FUN_00a464a4`):
 * centering, pattern-family slots, optional 2×2 / mirror replication, the
 * final edge pass and the optional robot-order swap pass.
 *
 * All coordinates are integer 0.1 mm. The Round/Oval/Complex path
 * (`FUN_00a3f0b8`, selected by MPWin mode) and the stored-standard-pattern
 * path (`FUN_00a4632c`) are not ported; see the individual options.
 */

/**
 * `AddBlock` alignment (`param_2` of `FUN_00a464a4`, stored at `EBP-0x9d`,
 * used at 0x00a45b3e):
 *
 * - 0: near X / far Y
 * - 1: near X / near Y
 * - 2: far X / far Y
 * - 3: far X / near Y
 *
 * The far coordinate is `offset + span - coordinate - pitch*count`, which
 * places the block against the opposite block edge.
 */
export type MultiPackAlignmentMode = 0 | 1 | 2 | 3;

export type MultiPackSolution = {
  paletteDmm: { x: number; y: number };
  /** Pattern block extent the optimizer centers on the palette. */
  blockDmm: { x: number; y: number };
  package: MultiPackPackageDmm;
  clearanceDmm: number;
  /** The optimizer evaluates the first five enabled slots. */
  slots: readonly FamilySlot[];
  /** `AddBlock` alignment mode; the captured 100-package layer uses 1. */
  alignMode?: MultiPackAlignmentMode;
  /** Flag `00d28de4`: copy the pattern by +600 mm in X, then +400 mm in Y. */
  replicate2x2?: boolean;
  /** Flag `00d277e0`: transpose every block and append a mirrored copy. */
  replicateMirror?: boolean;
  /**
   * Mirror axis read as Real48 from solution `+0x10` (`FUN_004060dc`).
   * 2 shifts the source by `-minY` and mirrors the source itself; 1 mirrors
   * the appended copy around X = 600 mm; any other value offsets the copy by
   * `-2*(6000 - maxY)`. The captured layer never enables the pass, so the
   * default 1 is a modelling choice for callers that do.
   */
  mirrorAxis?: number;
  /** `param_6`: swap the block at the current index with the last overlap. */
  swapEliminate?: boolean;
  /** MPWin flag `00d26fb0`: routes generation to the unsupported round path. */
  mpWin?: boolean;
  /**
   * One entry per package (`FUN_00a45c14` / `FUN_00a45ebc`). The legacy
   * rectangular path forces the frame flag on and additionally requires the
   * solution's leading word to be below 250; the capture at 0xa13f780 has
   * 100 one-package blocks, so this port defaults the combined switch on.
   */
  interactiveQuality?: boolean;
  /** Written to `Muster[2]`; the control-file path passes 2. */
  layerOrient?: number;
};

export const MULTIPACK_SLOT_LIMIT = 5;

const REPLICATION_REFERENCE_X = 6000;
const REPLICATION_REFERENCE_Y = 4000;
const MIRROR_REFERENCE_X = 8000;
const MIRROR_REFERENCE_Y = 6000;

/** Effective block extent and centering offset after the legacy pre-pass. */
export type MultiPackCenteringFrame = {
  offsetX: number;
  offsetY: number;
  spanX: number;
  spanY: number;
};

/**
 * Centering pre-pass of `FUN_00a464a4` (0x00a465d6–0x00a4672f).
 *
 * - normal: `(palette - block) div 2`
 * - 2×2 (`00d28de4`): shrink the block by the 6000/4000 reference frame
 *   (or halve it above 12000/8000), then center it in that frame
 * - mirror (`00d277e0`): swap the block dimensions first, shrink the new Y
 *   extent against 6000 (halve above 12000), center X in 8000 and Y in 6000
 *
 * The modified spans are also the `blockSpanX`/`blockSpanY` the family
 * generators see, so they are returned together with the offsets.
 */
export function multiPackCenteringFrame(
  solution: MultiPackSolution,
): MultiPackCenteringFrame {
  let spanX = solution.blockDmm.x;
  let spanY = solution.blockDmm.y;

  if (solution.replicate2x2) {
    spanX =
      spanX < 12001 ? spanX - REPLICATION_REFERENCE_X : delphiDiv(spanX, 2);
    spanY =
      spanY < 8001 ? spanY - REPLICATION_REFERENCE_Y : delphiDiv(spanY, 2);
    return {
      spanX,
      spanY,
      offsetX:
        spanX > REPLICATION_REFERENCE_X
          ? REPLICATION_REFERENCE_X - spanX
          : delphiDiv(REPLICATION_REFERENCE_X - spanX, 2),
      offsetY:
        spanY > REPLICATION_REFERENCE_Y
          ? REPLICATION_REFERENCE_Y - spanY
          : delphiDiv(REPLICATION_REFERENCE_Y - spanY, 2),
    };
  }

  if (solution.replicateMirror) {
    // FUN_0051d73c swaps (+4,+8); the shrink then applies to the new +8.
    spanX = solution.blockDmm.y;
    spanY = solution.blockDmm.x;
    spanY = spanY < 12001 ? spanY - MIRROR_REFERENCE_Y : delphiDiv(spanY, 2);
    return {
      spanX,
      spanY,
      offsetX: delphiDiv(MIRROR_REFERENCE_X - spanX, 2),
      offsetY:
        spanY > MIRROR_REFERENCE_Y
          ? MIRROR_REFERENCE_Y - spanY
          : delphiDiv(MIRROR_REFERENCE_Y - spanY, 2),
    };
  }

  return {
    spanX,
    spanY,
    offsetX: delphiDiv(solution.paletteDmm.x - spanX, 2),
    offsetY: delphiDiv(solution.paletteDmm.y - spanY, 2),
  };
}

/** Centering offset only; see `multiPackCenteringFrame` for the spans. */
export function multiPackCenteringOffset(solution: MultiPackSolution): {
  x: number;
  y: number;
} {
  const frame = multiPackCenteringFrame(solution);
  return { x: frame.offsetX, y: frame.offsetY };
}

export function generateMultiPackMuster(solution: MultiPackSolution): Muster {
  if (solution.mpWin) throw new MultiPackMPWinUnsupportedError();

  const alignMode = solution.alignMode ?? 1;
  if (
    alignMode !== 0 &&
    alignMode !== 1 &&
    alignMode !== 2 &&
    alignMode !== 3
  ) {
    throw new Error(
      `Unsupported MultiPack alignment mode ${Number(alignMode)}.`,
    );
  }

  const layerOrient = solution.layerOrient ?? 2;
  const frame = multiPackCenteringFrame(solution);
  const context: FamilyContext = {
    package: solution.package,
    clearance: solution.clearanceDmm,
    blockSpanX: frame.spanX,
    blockSpanY: frame.spanY,
    // `00d27e4c` is saved and forced to 1 for the whole generation.
    edgeFill: true,
    interactiveQuality: solution.interactiveQuality ?? true,
  };

  const generated: MusterBlock[] = [];
  const add = ({
    x,
    y,
    xCount,
    yCount,
    lengthAlongX,
  }: {
    x: number;
    y: number;
    xCount: number;
    yCount: number;
    lengthAlongX: boolean;
  }) => {
    const dX = lengthAlongX ? solution.package.length : solution.package.width;
    const dY = lengthAlongX ? solution.package.width : solution.package.length;
    const subOrient: MusterSubOrient = subOrientForBlock(
      layerOrient,
      dX,
      dY,
      solution.package.length,
      solution.package.width,
    );
    const farX = frame.spanX - x - dX * xCount + frame.offsetX;
    const farY = frame.spanY - y - dY * yCount + frame.offsetY;
    const nearX = frame.offsetX + x;
    const nearY = frame.offsetY + y;
    let blockX: number;
    let blockY: number;
    switch (alignMode) {
      case 0:
        blockX = nearX;
        blockY = farY;
        break;
      case 1:
        blockX = nearX;
        blockY = nearY;
        break;
      case 2:
        blockX = farX;
        blockY = farY;
        break;
      case 3:
        blockX = farX;
        blockY = nearY;
        break;
    }
    generated.push({
      x: blockX,
      y: blockY,
      dX,
      dY,
      xMax: 0,
      yMax: 0,
      xCount,
      yCount,
      subOrient,
      // AddBlock mirrors the SubOrient byte into Orient (1 or 2).
      orient: (subOrient === 1 ? 1 : 2) as MusterOrient,
    });
  };

  for (const slot of solution.slots.slice(0, MULTIPACK_SLOT_LIMIT)) {
    if (slot.kind === "simple") emitSimpleFamily(slot, context, add);
    else emitKombiFamily(slot, context, add);
  }

  let blocks = generated;
  if (solution.replicate2x2) blocks = replicateMuster2x2(blocks);
  if (solution.replicateMirror) {
    blocks = replicateMirrorMuster(blocks, solution.mirrorAxis ?? 1);
  }

  blocks = blocks.map(finalizeMusterBlock);
  if (solution.swapEliminate) blocks = eliminateMusterOverlaps(blocks);

  return { layerOrient, blocks };
}
