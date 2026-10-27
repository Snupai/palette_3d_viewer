import type { MusterBlock } from "~/domain/solver/multipack/muster";

/**
 * Robot-order swap pass (`FUN_00a464a4`, 0x00a46b9e–0x00a46c91).
 *
 * For every anchor except the last block, the legacy loop tracks a `last`
 * block, starting at the anchor, and scans the candidates from the anchor
 * onwards for a hit:
 *
 *   last.xMax > candidate.x && candidate.yMax > last.y
 *
 * A hit makes the candidate the new `last`. While fewer than 30 hits were
 * counted the scan restarts at the anchor but keeps `last` (asm `MOV
 * EDX,ECX` at 0x00a46c20 before `JL 0x00a46bde`), so hits chain; two
 * mutually overlapping blocks ping-pong until the 30th hit. Afterwards the
 * scan continues past the hit. Finally the anchor and `last` are swapped.
 */
export const OVERLAP_RESTART_HITS = 30;

export function eliminateMusterOverlaps(
  blocks: readonly MusterBlock[],
): MusterBlock[] {
  const result = blocks.map((block) => ({ ...block }));
  const count = result.length;

  for (let anchor = 0; anchor < count - 1; anchor += 1) {
    let last = anchor;
    let hits = 0;
    let candidate = anchor;

    while (candidate < count) {
      if (candidate !== last) {
        const lastBlock = result[last]!;
        const candidateBlock = result[candidate]!;
        if (
          lastBlock.xMax > candidateBlock.x &&
          candidateBlock.yMax > lastBlock.y
        ) {
          last = candidate;
          hits += 1;
          if (hits < OVERLAP_RESTART_HITS) {
            candidate = anchor;
            continue;
          }
        }
      }
      candidate += 1;
    }

    if (last !== anchor) {
      const swap = result[anchor]!;
      result[anchor] = result[last]!;
      result[last] = swap;
    }
  }

  return result;
}
