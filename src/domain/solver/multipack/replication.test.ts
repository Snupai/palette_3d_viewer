import { describe, expect, it } from "vitest";
import {
  finalizeMusterBlock,
  type MusterBlock,
} from "~/domain/solver/multipack/muster";
import {
  replicateMirrorMuster,
  replicateMuster2x2,
} from "~/domain/solver/multipack/replication";

function block(overrides: Partial<MusterBlock> = {}): MusterBlock {
  return finalizeMusterBlock({
    x: 100,
    y: 1000,
    dX: 1120,
    dY: 760,
    xMax: 0,
    yMax: 0,
    xCount: 2,
    yCount: 3,
    subOrient: 1,
    orient: 1,
    ...overrides,
  });
}

describe("2×2 replication", () => {
  it("appends X copies, then Y copies of the whole list", () => {
    const result = replicateMuster2x2([block()]);
    expect(result.map(({ x, y }) => [x, y])).toEqual([
      [100, 1000],
      [6100, 1000],
      [100, 5000],
      [6100, 5000],
    ]);
    expect(result.map(({ xMax, yMax }) => [xMax, yMax])).toEqual([
      [2340, 3280],
      [8340, 3280],
      [2340, 7280],
      [8340, 7280],
    ]);
  });
});

describe("mirror replication", () => {
  const second = block({ y: 2000 });

  it("transposes and mirrors the appended copy for axis 1", () => {
    const result = replicateMirrorMuster([block(), second], 1);
    expect(result.map(({ x, xMax }) => [x, xMax])).toEqual([
      [2720, 5000],
      [3720, 6000],
      [7000, 9280],
      [6000, 8280],
    ]);
    expect(result[0]).toMatchObject({
      y: 100,
      yMax: 2340,
      dX: 760,
      dY: 1120,
      xCount: 3,
      yCount: 2,
      subOrient: 2,
      orient: 2,
    });
  });

  it("keeps the legacy axis-2 quirk: the source is mirrored, not the copy", () => {
    const result = replicateMirrorMuster([block(), second], 2);
    expect(result.map(({ x, xMax }) => [x, xMax])).toEqual([
      [3720, 6000],
      [2720, 5000],
      [6000, 8280],
      [7000, 9280],
    ]);
  });

  it("offsets the copy by the mirror reference for any other axis", () => {
    const result = replicateMirrorMuster([block()], 3);
    expect(result.map(({ x, xMax }) => [x, xMax])).toEqual([
      [3720, 6000],
      [4280, 6560],
    ]);
  });

  it("handles an empty pattern", () => {
    expect(replicateMirrorMuster([], 1)).toEqual([]);
  });
});
