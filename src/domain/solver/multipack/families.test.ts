import { describe, expect, it } from "vitest";
import {
  emitKombiFamily,
  emitSimpleFamily,
  type FamilyContext,
} from "~/domain/solver/multipack/families";

const PACKAGE = { length: 1120, width: 760 };

function context(overrides: Partial<FamilyContext> = {}): FamilyContext {
  return {
    package: PACKAGE,
    clearance: 0,
    blockSpanX: 11400,
    blockSpanY: 7560,
    edgeFill: true,
    interactiveQuality: false,
    ...overrides,
  };
}

describe("simple slot family", () => {
  it("spreads leftover slot space as truncated gaps", () => {
    const blocks: number[][] = [];
    emitSimpleFamily(
      {
        kind: "simple",
        type: 1,
        x0: 0,
        x1: 3401,
        y0: 0,
        y1: 760,
        countX: 3,
        countY: 1,
      },
      context({ blockSpanX: 3401, blockSpanY: 760 }),
      ({ x, y, xCount, yCount }) => blocks.push([x, y, xCount, yCount]),
    );
    // gapX = (3401 - 3*1120) div 2 = 20; one dmm remains at the far edge.
    expect(blocks).toEqual([
      [0, 0, 1, 1],
      [1140, 0, 1, 1],
      [2280, 0, 1, 1],
    ]);
  });

  it("snaps a single row/column to the far block edge", () => {
    const blocks: number[][] = [];
    emitSimpleFamily(
      {
        kind: "simple",
        type: 1,
        x0: 0,
        x1: 2000,
        y0: 0,
        y1: 2000,
        countX: 1,
        countY: 1,
      },
      context({
        blockSpanX: 2000,
        blockSpanY: 2000,
        interactiveQuality: true,
      }),
      ({ x, y, xCount, yCount }) => blocks.push([x, y, xCount, yCount]),
    );
    expect(blocks).toEqual([[880, 1240, 1, 1]]);
  });

  it("splits an unfilled block into a main block and far-edge rings", () => {
    const blocks: number[][] = [];
    emitSimpleFamily(
      {
        kind: "simple",
        type: 1,
        x0: 0,
        x1: 5000,
        y0: 0,
        y1: 3000,
        countX: 5,
        countY: 4,
      },
      context({ edgeFill: false, clearance: 20 }),
      ({ x, y, xCount, yCount }) => blocks.push([x, y, xCount, yCount]),
    );
    expect(blocks).toEqual([
      [0, 0, 2, 2],
      [0, 1440, 2, 2],
      [1580, 0, 3, 2],
      [1580, 1440, 3, 2],
    ]);
  });

  it("never emits per-package blocks when the switch is off and there is no gap", () => {
    const blocks: number[][] = [];
    emitSimpleFamily(
      {
        kind: "simple",
        type: 1,
        x0: 0,
        x1: 2240,
        y0: 0,
        y1: 1520,
        countX: 2,
        countY: 2,
      },
      context({ blockSpanX: 2240, blockSpanY: 1520 }),
      ({ x, y, xCount, yCount }) => blocks.push([x, y, xCount, yCount]),
    );
    expect(blocks).toEqual([[0, 0, 2, 2]]);
  });
});

describe("kombi slot family", () => {
  it("builds the interlocked staircase with rotated teeth", () => {
    const blocks: (number | boolean)[][] = [];
    emitKombiFamily(
      {
        kind: "kombi",
        type: 1,
        x0: 0,
        x1: 6000,
        y0: 0,
        y1: 4560,
        columns: 2,
        ratio: 4,
        steps: 2,
        toothColumns: 1,
        toothRows: 1,
        descending: false,
      },
      context(),
      ({ x, y, xCount, yCount, lengthAlongX }) =>
        blocks.push([x, y, xCount, yCount, lengthAlongX]),
    );
    expect(blocks).toEqual([
      [0, 0, 2, 4, true],
      [2240, 0, 2, 2, true],
      [760, 3040, 2, 2, true],
      [3000, 1520, 2, 4, true],
      [0, 3040, 1, 1, false],
      [2240, 1520, 1, 1, false],
      [4480, 0, 1, 1, false],
    ]);
  });

  it("expands every multi-package block when the per-package switch is on", () => {
    const blocks: number[][] = [];
    emitKombiFamily(
      {
        kind: "kombi",
        type: 1,
        x0: 0,
        x1: 6000,
        y0: 0,
        y1: 4560,
        columns: 2,
        ratio: 4,
        steps: 2,
        toothColumns: 1,
        toothRows: 1,
        descending: false,
      },
      context({ interactiveQuality: true }),
      ({ x, y, xCount, yCount }) => blocks.push([x, y, xCount, yCount]),
    );
    // 2*4 + 2*2 + 2*2 + 2*4 packages plus three 1*1 teeth.
    expect(blocks).toHaveLength(27);
    expect(blocks.slice(0, 4)).toEqual([
      [0, 0, 1, 1],
      [0, 760, 1, 1],
      [0, 1520, 1, 1],
      [0, 2280, 1, 1],
    ]);
  });
});
