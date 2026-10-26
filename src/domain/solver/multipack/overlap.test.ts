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
  it("swaps the current block with the last overlapping block", () => {
    const blocks = [
      block(0, 0, 10, 10),
      block(0, 0, 10, 10),
      block(5, 5, 15, 15),
      block(100, 100, 110, 110),
    ];
    const result = eliminateMusterOverlaps(blocks);
    expect(result.map(({ x }) => x)).toEqual([0, 5, 0, 100]);
  });

  it("leaves a separated pattern untouched", () => {
    const blocks = [
      block(0, 0, 10, 10),
      block(20, 0, 30, 10),
      block(40, 0, 50, 10),
    ];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });

  it("requires both an X and a Y overlap", () => {
    const xOnly = [
      block(0, 10, 10, 20),
      block(5, 0, 15, 10),
      block(100, 100, 110, 110),
    ];
    expect(eliminateMusterOverlaps(xOnly).map(({ x }) => x)).toEqual([
      0, 5, 100,
    ]);
  });

  it("keeps a single block", () => {
    const blocks = [block(0, 0, 10, 10)];
    expect(eliminateMusterOverlaps(blocks)).toEqual(blocks);
  });
});
