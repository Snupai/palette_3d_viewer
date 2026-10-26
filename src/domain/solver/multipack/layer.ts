import type { GeneratedPlacement } from "~/domain/solver/types";
import {
  MUSTER_BLOCK_CAP,
  musterOrientRotation,
  type Muster,
  type MusterPackage,
} from "~/domain/solver/multipack/muster";

/**
 * Tiling (`AssignFromLoesungType`, `FUN_00ca740c`): every block becomes
 * `xCount × yCount` packages at pitch `dX`/`dY`, X-major, in block order.
 *
 * The tiling loop range-checks the block index against 400 entries
 * (0x00ca748b–0x00ca7496), so the cap belongs here rather than in the
 * optimizer, which appends without a bound.
 */
export function tileMuster(muster: Muster): MusterPackage[] {
  if (muster.blocks.length > MUSTER_BLOCK_CAP) {
    throw new RangeError(
      `MultiPack Muster exceeds ${MUSTER_BLOCK_CAP} blocks (${muster.blocks.length}).`,
    );
  }
  const packages: MusterPackage[] = [];
  for (const block of muster.blocks) {
    for (let column = 0; column < block.xCount; column += 1) {
      for (let row = 0; row < block.yCount; row += 1) {
        const x = block.x + column * block.dX;
        const y = block.y + row * block.dY;
        packages.push({
          x,
          y,
          xMax: x + block.dX,
          yMax: y + block.dY,
          orient: block.orient,
        });
      }
    }
  }
  return packages;
}

/** `TVerbundType`: 0 Turm, 1 LaengsSpiegel, 2 QuerSpiegel, 3 Rotiert. */
export type VerbundType = 0 | 1 | 2 | 3;

type MirroredRect = {
  x: number;
  y: number;
  xMax: number;
  yMax: number;
};

/**
 * Coordinate mirror of `FUN_00ca2c08`: LaengsSpiegel (1) mirrors around the
 * palette Y extent, QuerSpiegel (2) around the X extent, Rotiert (3) both.
 * The legacy pass only rotates the grip-group orientation, which this model
 * does not carry; the Muster `Orient` byte stays unchanged (confirmed for
 * Verbund 1 by the 100-package capture).
 */
function mirrorRect(
  rect: MirroredRect,
  verbund: VerbundType,
  paletteDmm: { x: number; y: number },
): MirroredRect {
  let { x, y, xMax, yMax } = rect;
  if (verbund === 1 || verbund === 3) {
    [y, yMax] = [paletteDmm.y - yMax, paletteDmm.y - y];
  }
  if (verbund === 2 || verbund === 3) {
    [x, xMax] = [paletteDmm.x - xMax, paletteDmm.x - x];
  }
  return { x, y, xMax, yMax };
}

/** Block-level Verbund mirror, applied before tiling like the legacy export. */
export function mirrorMusterBlocks(
  muster: Muster,
  verbund: VerbundType,
  paletteDmm: { x: number; y: number },
): Muster {
  return {
    ...muster,
    blocks: muster.blocks.map((block) => ({
      ...block,
      ...mirrorRect(block, verbund, paletteDmm),
    })),
  };
}

/** Package-level Verbund mirror; equivalent geometry to `mirrorMusterBlocks`. */
export function mirrorMusterPackages(
  packages: readonly MusterPackage[],
  verbund: VerbundType,
  paletteDmm: { x: number; y: number },
): MusterPackage[] {
  return packages.map((item) => ({
    ...item,
    ...mirrorRect(item, verbund, paletteDmm),
  }));
}

/** Converts tiled packages to solver placements; `originMm` is the palette corner. */
export function musterPackagesToPlacements(
  packages: readonly MusterPackage[],
  originMm: { x: number; y: number },
): GeneratedPlacement[] {
  return packages.map((item) => ({
    positionMm: {
      x: originMm.x + (item.x + item.xMax) / 20,
      y: originMm.y + (item.y + item.yMax) / 20,
    },
    rotation: musterOrientRotation(item.orient),
  }));
}

/** Inside the palette and pairwise separated by at least `clearance` on one axis. */
export function isValidMusterLayer(
  packages: readonly MusterPackage[],
  paletteDmm: { x: number; y: number },
  clearance: number,
): boolean {
  for (const item of packages) {
    if (item.x < 0 || item.y < 0) return false;
    if (item.xMax > paletteDmm.x || item.yMax > paletteDmm.y) return false;
  }
  for (let left = 0; left < packages.length; left += 1) {
    const a = packages[left]!;
    for (let right = left + 1; right < packages.length; right += 1) {
      const b = packages[right]!;
      const separatedX = a.xMax + clearance <= b.x || b.xMax + clearance <= a.x;
      const separatedY = a.yMax + clearance <= b.y || b.yMax + clearance <= a.y;
      if (!separatedX && !separatedY) return false;
    }
  }
  return true;
}
