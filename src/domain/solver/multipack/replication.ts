import {
  finalizeMusterBlock,
  type MusterBlock,
} from "~/domain/solver/multipack/muster";
import {
  mirrorReplicationOrient,
  swapMusterSubOrient,
} from "~/domain/solver/multipack/orientation";

/**
 * Replication passes of the MultiPack optimizer (`FUN_00a464a4`,
 * 0x00a467b6–0x00a46b38). Both passes run before the final edge pass and
 * append copies, so the original entries keep their order.
 */

/** `00d28de4` 2×2 replication reference frame. */
export const REPLICATION_OFFSET_X = 6000;
export const REPLICATION_OFFSET_Y = 4000;

/** `00d277e0` mirror-replication reference frame. */
export const MIRROR_REFERENCE_X = 8000;
export const MIRROR_REFERENCE_Y = 6000;

/**
 * Copies the pattern by +600 mm in X and then by +400 mm in Y
 * (`00d28de4`). The legacy code copies the first `Count` entries in each
 * pass, doubling the count, which yields
 * `[originals, x-copies, y-copies, xy-copies]`.
 */
export function replicateMuster2x2(
  blocks: readonly MusterBlock[],
): MusterBlock[] {
  const xCopies = blocks.map((block) => ({
    ...block,
    x: block.x + REPLICATION_OFFSET_X,
    xMax: block.xMax + REPLICATION_OFFSET_X,
  }));
  const afterX = [...blocks, ...xCopies];
  const yCopies = afterX.map((block) => ({
    ...block,
    y: block.y + REPLICATION_OFFSET_Y,
    yMax: block.yMax + REPLICATION_OFFSET_Y,
  }));
  return [...afterX, ...yCopies];
}

/**
 * Mirror/rotate replication (`00d277e0`, 0x00a468f2–0x00a46b38).
 *
 * Every block is transposed (X↔Y, dX↔dY, counts, SubOrient, `3 − Orient`)
 * and shifted into the mirror reference frame, then a mirrored copy is
 * appended. The `axis` is the legacy Real48 value at solution `+0x10`
 * (`FUN_004060dc`): 1 mirrors the appended copy around X = 600 mm, 2
 * applies the legacy mirror to the *source* entry, and any other value
 * offsets the copy by `−2·(6000 − maxY)` before the common `+6000` shift.
 * AddBlock only emits Orient 1/2, so `3 − Orient` stays inside 1..2.
 */
export function replicateMirrorMuster(
  blocks: readonly MusterBlock[],
  axis: number,
): MusterBlock[] {
  if (blocks.length === 0) return [];

  const finalized = blocks.map(finalizeMusterBlock);
  let maxY = 0;
  let minY = 0x7fffffff;
  for (const block of finalized) {
    maxY = Math.max(maxY, block.yMax);
    minY = Math.min(minY, block.y);
  }

  const sources: MusterBlock[] = [];
  const copies: MusterBlock[] = [];
  for (const block of finalized) {
    const source: MusterBlock = {
      x: block.y,
      y: block.x,
      dX: block.dY,
      dY: block.dX,
      xMax: block.yMax,
      yMax: block.xMax,
      xCount: block.yCount,
      yCount: block.xCount,
      subOrient: swapMusterSubOrient(block.subOrient),
      orient: mirrorReplicationOrient(block.orient),
    };

    if (axis === 2) {
      source.x -= minY;
      source.xMax -= minY;
    } else {
      const shift = MIRROR_REFERENCE_Y - maxY;
      source.x += shift;
      source.xMax += shift;
    }

    // The appended copy is made from the already transposed source.
    const copy: MusterBlock = { ...source };
    if (axis === 1) {
      copy.xMax = copy.x + copy.dX * copy.xCount;
      copy.x = MIRROR_REFERENCE_Y - copy.x;
      copy.xMax = MIRROR_REFERENCE_Y - copy.xMax;
      [copy.x, copy.xMax] = [copy.xMax, copy.x];
    } else if (axis === 2) {
      // Legacy quirk: the axis-2 mirror mutates the existing entry, not
      // the appended copy.
      source.xMax = source.x + source.dX * source.xCount;
      source.x = MIRROR_REFERENCE_Y - source.x;
      source.xMax = MIRROR_REFERENCE_Y - source.xMax;
      [source.x, source.xMax] = [source.xMax, source.x];
    } else {
      const shift = 2 * (MIRROR_REFERENCE_Y - maxY);
      copy.x -= shift;
      copy.xMax -= shift;
    }

    copy.x += MIRROR_REFERENCE_Y;
    copy.xMax += MIRROR_REFERENCE_Y;
    sources.push(source);
    copies.push(copy);
  }
  return [...sources, ...copies];
}
