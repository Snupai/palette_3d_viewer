import { describe, expect, it } from "vitest";
import type { MusterBlock } from "~/domain/solver/multipack/muster";
import { eliminateMusterOverlaps } from "~/domain/solver/multipack/overlap";

function block(x: number, y: number, xMax: number, yMax: number): MusterBlock {
  return {
    x,
    y,
    dX: xMax - x,
    dY: yMax - y,
    xMax,
    yMax,
    xCount: 1,
    yCount: 1,
    subOrient: 1,
    orient: 1,
  };
}

describe("robot-order swap elimination", () => {
  it("chains hits across restarts like the legacy loop", () => {
    const blocks = [
      block(0, 0, 10, 10),
      block(0, 0, 10, 10),
      block(5, 5, 15, 15),
      block(100, 100, 110, 110),
    ];
    const result = eliminateMusterOverlaps(blocks);
    expect(result.map(({ x, y }) => [x, y])).toEqual([
      [5, 5],
      [0, 0],
      [0, 0],
      [100, 100],
    ]);
  });

  it("leaves a separated pattern untouched", () => {
    const blocks = [
      block(0, 0, 10, 10),
      block(20, 0, 30, 10),
      block(40, 0, 50, 10),
    ];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });

  it("uses the first block as an anchor", () => {
    const blocks = [block(0, 0, 10, 10), block(5, 5, 15, 15)];
    expect(eliminateMusterOverlaps(blocks).map(({ x }) => x)).toEqual([5, 0]);
  });

  it("rejects a candidate that ends at or below the last block's Y", () => {
    const blocks = [
      block(0, 10, 10, 20),
      block(5, 0, 15, 10),
      block(100, 100, 110, 110),
    ];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });

  it("rejects a candidate that starts at or right of the last block's X", () => {
    const blocks = [block(0, 0, 10, 10), block(10, 0, 20, 10)];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });

  it("keeps a single block", () => {
    const blocks = [block(0, 0, 10, 10)];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });
});
