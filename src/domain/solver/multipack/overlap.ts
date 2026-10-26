import type { MusterBlock } from "~/domain/solver/multipack/muster";

/**
 * Robot-order swap pass (`FUN_00a464a4`, 0x00a46b9e–0x00a46c91).
 *
 * The legacy loop walks the finalized blocks from index 1 and looks for a
 * later block that overlaps the current one:
 *
 *   last.xMax > candidate.x && last.y < candidate.yMax
 *
 * The first hit is found 30 times because the inner scan restarts from the
 * current index while fewer than 30 hits were counted (asm `CMP
 * [EBP-0xac],0x1e`). After the 30th hit the scan continues from the hit,
 * so later hits chain onto that block. Finally the current block and the
 * last hit are swapped. A zeroed slot past the last block cannot satisfy the
 * test, so the port scans real entries only.
 */
export const OVERLAP_RESTART_HITS = 30;

export function eliminateMusterOverlaps(
  blocks: readonly MusterBlock[],
): MusterBlock[] {
  const result = blocks.map((block) => ({ ...block }));
  const count = result.length;
  if (count <= 1) return result;

  for (let index = 1; index < count; index += 1) {
    let last = index;
    let hits = 0;
    let candidate = index;

    while (candidate < count) {
      if (candidate !== last) {
        const lastBlock = result[last]!;
        const candidateBlock = result[candidate]!;
        if (
          lastBlock.xMax > candidateBlock.x &&
          lastBlock.y < candidateBlock.yMax
        ) {
          last = candidate;
          hits += 1;
          if (hits < OVERLAP_RESTART_HITS) {
            candidate = index;
            last = index;
            continue;
          }
        }
      }
      candidate += 1;
    }

    if (last !== index) {
      const swap = result[index]!;
      result[index] = result[last]!;
      result[last] = swap;
    }
  }

  return result;
}
