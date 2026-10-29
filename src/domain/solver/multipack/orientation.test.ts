import { describe, expect, it } from "vitest";
import {
  displayMusterOrient,
  mirrorReplicationOrient,
  musterOrientRotation,
  subOrientForBlock,
  swapMusterSubOrient,
  wrapMusterOrient,
} from "~/domain/solver/multipack/orientation";

describe("legacy orientation helpers", () => {
  it("wraps the 1-based orient byte, including the 5 → 1 reset", () => {
    expect([1, 2, 3, 4, 5, 6, 0, -3].map(wrapMusterOrient)).toEqual([
      1, 2, 3, 4, 1, 2, 4, 1,
    ]);
  });

  it("maps Orient 1..4 to 0/90/180/270 degrees", () => {
    expect(
      [1, 2, 3, 4, 5].map((value) =>
        musterOrientRotation(wrapMusterOrient(value)),
      ),
    ).toEqual([0, 90, 180, 270, 0]);
  });

  it("adds the rotated flag and wraps 5 back to 1", () => {
    expect(displayMusterOrient(1, false)).toBe(1);
    expect(displayMusterOrient(1, true)).toBe(2);
    expect(displayMusterOrient(4, true)).toBe(1);
  });

  it("uses 3 − Orient for mirror replication", () => {
    expect(mirrorReplicationOrient(1)).toBe(2);
    expect(mirrorReplicationOrient(2)).toBe(1);
  });

  it("swaps the SubOrient byte", () => {
    expect(swapMusterSubOrient(1)).toBe(2);
    expect(swapMusterSubOrient(2)).toBe(1);
  });

  it("derives SubOrient from layerOrient and the footprint", () => {
    // layerOrient 2 compares the pitches.
    expect(subOrientForBlock(2, 1120, 760, 1120, 760)).toBe(1);
    expect(subOrientForBlock(2, 760, 1120, 1120, 760)).toBe(2);
    // layerOrient 1 compares dX with the package length.
    expect(subOrientForBlock(1, 1120, 760, 1120, 760)).toBe(1);
    expect(subOrientForBlock(1, 760, 1120, 1120, 760)).toBe(2);
    // layerOrient 0 compares dX with the package width.
    expect(subOrientForBlock(0, 760, 1120, 1120, 760)).toBe(1);
    expect(subOrientForBlock(0, 1120, 760, 1120, 760)).toBe(2);
    // Unhandled layerOrient leaves a zeroed byte (SubOrient 2).
    expect(subOrientForBlock(7, 1120, 760, 1120, 760)).toBe(2);
  });
});
