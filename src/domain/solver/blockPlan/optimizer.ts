import {
  emitKombiFamily,
  emitSimpleFamily,
  type FamilyContext,
  type FamilySlot,
  type BlockPlanPackageDmm,
} from "~/domain/solver/blockPlan/families";
import {
  truncDiv,
  finalizeMusterBlock,
  type Muster,
  type MusterBlock,
  type MusterOrient,
  type MusterSubOrient,
} from "~/domain/solver/blockPlan/muster";
import { eliminateMusterOverlaps } from "~/domain/solver/blockPlan/overlap";
import { subOrientForBlock } from "~/domain/solver/blockPlan/orientation";
import {
  MIRROR_REFERENCE_X,
  MIRROR_REFERENCE_Y,
  REPLICATION_OFFSET_X,
  REPLICATION_OFFSET_Y,
  replicateMirrorMuster,
  replicateMuster2x2,
} from "~/domain/solver/blockPlan/replication";

/**
 * Block-plan layer optimizer for rectangular packages: centering,
 * pattern-family slots, optional 2×2 / mirror replication, the final edge
 * pass and the optional robot-order swap pass.
 *
 * All coordinates are integer 0.1 mm. Round, oval and complex packages and
 * stored standard patterns are not supported.
 */

/**
 * Block alignment mode:
 *
 * - 0: near X / far Y
 * - 1: near X / near Y
 * - 2: far X / far Y
 * - 3: far X / near Y
 *
 * The far coordinate is `offset + span - coordinate - pitch*count`, which
 * places the block against the opposite block edge.
 */
export type BlockPlanAlignmentMode = 0 | 1 | 2 | 3;

export type BlockPlanSolution = {
  paletteDmm: { x: number; y: number };
  /** Pattern block extent the optimizer centers on the palette. */
  blockDmm: { x: number; y: number };
  package: BlockPlanPackageDmm;
  clearanceDmm: number;
  /** The optimizer evaluates the first five enabled slots. */
  slots: readonly FamilySlot[];
  /** Block alignment mode; the pinned 100-package golden layout uses 1. */
  alignMode?: BlockPlanAlignmentMode;
  /** Copy the pattern by +600 mm in X, then +400 mm in Y. */
  replicate2x2?: boolean;
  /** Transpose every block and append a mirrored copy. */
  replicateMirror?: boolean;
  /**
   * Mirror axis of the mirror replication.
   * 2 shifts the source by `-minY` and mirrors the source itself; 1 mirrors
   * the appended copy around X = 600 mm; any other value offsets the copy by
   * `-2*(6000 - maxY)`. Defaults to 1.
   */
  mirrorAxis?: number;
  /** Swap the block at the current index with the last overlap. */
  swapEliminate?: boolean;
  /**
   * Emit one block per package instead of one block per slot run.
   * Defaults to on.
   */
  interactiveQuality?: boolean;
  /** Stored as the Muster `layerOrient`; defaults to 2. */
  layerOrient?: number;
};

export const BLOCK_PLAN_SLOT_LIMIT = 5;

/** Effective block extent and centering offset after the centering pre-pass. */
export type BlockPlanCenteringFrame = {
  offsetX: number;
  offsetY: number;
  spanX: number;
  spanY: number;
};

/**
 * Centering pre-pass.
 *
 * - normal: `(palette - block) div 2`
 * - 2×2: shrink the block by the 6000/4000 reference frame
 *   (or halve it above 12000/8000), then center it in that frame
 * - mirror: swap the block dimensions first, shrink the new Y
 *   extent against 6000 (halve above 12000), center X in 8000 and Y in 6000
 *
 * The modified spans are also the `blockSpanX`/`blockSpanY` the family
 * generators see, so they are returned together with the offsets.
 */
export function blockPlanCenteringFrame(
  solution: BlockPlanSolution,
): BlockPlanCenteringFrame {
  let spanX = solution.blockDmm.x;
  let spanY = solution.blockDmm.y;

  if (solution.replicate2x2) {
    spanX = spanX < 12001 ? spanX - REPLICATION_OFFSET_X : truncDiv(spanX, 2);
    spanY = spanY < 8001 ? spanY - REPLICATION_OFFSET_Y : truncDiv(spanY, 2);
    return {
      spanX,
      spanY,
      offsetX:
        spanX > REPLICATION_OFFSET_X
          ? REPLICATION_OFFSET_X - spanX
          : truncDiv(REPLICATION_OFFSET_X - spanX, 2),
      offsetY:
        spanY > REPLICATION_OFFSET_Y
          ? REPLICATION_OFFSET_Y - spanY
          : truncDiv(REPLICATION_OFFSET_Y - spanY, 2),
    };
  }

  if (solution.replicateMirror) {
    // Swap X/Y first; the shrink then applies to the new Y extent.
    spanX = solution.blockDmm.y;
    spanY = solution.blockDmm.x;
    spanY = spanY < 12001 ? spanY - MIRROR_REFERENCE_Y : truncDiv(spanY, 2);
    return {
      spanX,
      spanY,
      offsetX: truncDiv(MIRROR_REFERENCE_X - spanX, 2),
      offsetY:
        spanY > MIRROR_REFERENCE_Y
          ? MIRROR_REFERENCE_Y - spanY
          : truncDiv(MIRROR_REFERENCE_Y - spanY, 2),
    };
  }

  return {
    spanX,
    spanY,
    offsetX: truncDiv(solution.paletteDmm.x - spanX, 2),
    offsetY: truncDiv(solution.paletteDmm.y - spanY, 2),
  };
}

/** Centering offset only; see `blockPlanCenteringFrame` for the spans. */
export function blockPlanCenteringOffset(solution: BlockPlanSolution): {
  x: number;
  y: number;
} {
  const frame = blockPlanCenteringFrame(solution);
  return { x: frame.offsetX, y: frame.offsetY };
}

export function generateBlockPlanMuster(solution: BlockPlanSolution): Muster {
  const alignMode = solution.alignMode ?? 1;
  if (
    alignMode !== 0 &&
    alignMode !== 1 &&
    alignMode !== 2 &&
    alignMode !== 3
  ) {
    throw new Error(
      `Unsupported block-plan alignment mode ${Number(alignMode)}.`,
    );
  }

  const layerOrient = solution.layerOrient ?? 2;
  const frame = blockPlanCenteringFrame(solution);
  const context: FamilyContext = {
    package: solution.package,
    clearance: solution.clearanceDmm,
    blockSpanX: frame.spanX,
    blockSpanY: frame.spanY,
    // Edge fill is forced on for the whole generation.
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
      // Orient follows SubOrient (1 or 2).
      orient: (subOrient === 1 ? 1 : 2) as MusterOrient,
    });
  };

  for (const slot of solution.slots.slice(0, BLOCK_PLAN_SLOT_LIMIT)) {
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
