import { describe, expect, it } from "vitest";
import blocksGolden from "~/domain/solver/blockPlan/__fixtures__/golden-pattern-100pk.blocks.json";
import golden from "~/domain/solver/blockPlan/__fixtures__/golden-pattern-100pk.json";
import underhangGolden from "~/domain/solver/blockPlan/__fixtures__/golden-pattern-44pk-underhang.json";
import {
  mirrorMusterBlocks,
  mirrorMusterPackages,
  tileMuster,
} from "~/domain/solver/blockPlan/layer";
import {
  generateBlockPlanMuster,
  type BlockPlanSolution,
} from "~/domain/solver/blockPlan/optimizer";

const PALETTE = { x: 12000, y: 8000 };
const PACKAGE = { length: 1120, width: 760 };

/**
 * Solution for the pinned 100-package layout; see `__fixtures__/README.md`.
 * Slot 1 is the 15x2 band at the bottom (type 2), slot 2 the 10x7 band
 * above it (type 1). Per-package emission (`interactiveQuality`) is on, so
 * every block is a single package.
 */
const goldenSolution: BlockPlanSolution = {
  paletteDmm: PALETTE,
  blockDmm: { x: 11400, y: 7560 },
  package: PACKAGE,
  clearanceDmm: 0,
  slots: [
    {
      kind: "simple",
      type: 2,
      x0: 0,
      x1: 11400,
      y0: 0,
      y1: 2240,
      countX: 15,
      countY: 2,
    },
    {
      kind: "simple",
      type: 1,
      x0: 0,
      x1: 11400,
      y0: 2240,
      y1: 7560,
      countX: 10,
      countY: 7,
    },
  ],
  alignMode: 1,
  layerOrient: 2,
  interactiveQuality: true,
  replicate2x2: false,
  replicateMirror: false,
  swapEliminate: false,
};

describe("golden 100-package layer", () => {
  it("emits 100 one-package blocks with per-package emission", () => {
    const muster = generateBlockPlanMuster(goldenSolution);
    expect(muster.layerOrient).toBe(2);
    expect(muster.blocks).toHaveLength(100);
    expect(
      muster.blocks.every(({ xCount, yCount }) => xCount === 1 && yCount === 1),
    ).toBe(true);
    expect(muster.blocks[0]).toEqual({
      x: 300,
      y: 220,
      dX: 760,
      dY: 1120,
      xMax: 1060,
      yMax: 1340,
      xCount: 1,
      yCount: 1,
      subOrient: 2,
      orient: 2,
    });
  });

  it("matches the pinned Muster block for block after the Verbund mirror", () => {
    const muster = generateBlockPlanMuster(goldenSolution);
    const mirrored = mirrorMusterBlocks(muster, 1, PALETTE);
    expect(
      mirrored.blocks.map(
        ({ x, y, dX, dY, xMax, yMax, xCount, yCount, subOrient, orient }) => ({
          X: x,
          Y: y,
          dX,
          dY,
          xMax,
          yMax,
          XCount: xCount,
          YCount: yCount,
          SubOrient: subOrient,
          Orient: orient,
        }),
      ),
    ).toEqual(blocksGolden.entries);
  });

  it("matches the pinned tiled placements entry for entry", () => {
    const muster = generateBlockPlanMuster(goldenSolution);
    const packages = mirrorMusterPackages(tileMuster(muster), 1, PALETTE);
    expect(
      packages.map(({ x, y, xMax, yMax, orient }) => [
        x,
        y,
        xMax - x,
        yMax - y,
        orient,
      ]),
    ).toEqual(golden.entries);
  });
});

/**
 * Pinned 44-package layout: 157×110 mm package with an underhang of
 * -220 / -150 dmm. The pattern block is 11000 × 6910 and is
 * centered on the full palette, so the underhang only bounds the block.
 * The 7-package band spreads its 10 dmm of slack as 1 dmm edge-fill gaps.
 */
const underhangSolution: BlockPlanSolution = {
  ...goldenSolution,
  blockDmm: { x: 11000, y: 6910 },
  package: { length: 1570, width: 1100 },
  slots: [
    {
      kind: "simple",
      type: 2,
      x0: 0,
      x1: 11000,
      y0: 0,
      y1: 4710,
      countX: 10,
      countY: 3,
    },
    {
      kind: "simple",
      type: 1,
      x0: 0,
      x1: 11000,
      y0: 4710,
      y1: 6910,
      countX: 7,
      countY: 2,
    },
  ],
};

describe("golden 44-package underhang layer", () => {
  it("matches the pinned tiled placements entry for entry", () => {
    const muster = generateBlockPlanMuster(underhangSolution);
    const packages = mirrorMusterPackages(tileMuster(muster), 1, PALETTE);
    expect(muster.blocks).toHaveLength(44);
    expect(
      packages.map(({ x, y, xMax, yMax, orient }) => [
        x,
        y,
        xMax - x,
        yMax - y,
        orient,
      ]),
    ).toEqual(underhangGolden.entries);
  });
});

describe("alignment and Verbund equivalence", () => {
  const flatten = (solution: BlockPlanSolution, verbund: 0 | 1 | 2 | 3) =>
    mirrorMusterPackages(
      tileMuster(generateBlockPlanMuster(solution)),
      verbund,
      PALETTE,
    ).map(({ x, y, xMax, yMax, orient }) => [x, y, xMax - x, yMax - y, orient]);

  it("reproduces both pinned layouts with each alignment mode and its matching mirror", () => {
    for (const [alignMode, verbund] of [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ] as const) {
      expect(flatten({ ...goldenSolution, alignMode }, verbund)).toEqual(
        golden.entries,
      );
      expect(flatten({ ...underhangSolution, alignMode }, verbund)).toEqual(
        underhangGolden.entries,
      );
    }
  });
});
