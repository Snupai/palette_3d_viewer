import { describe, expect, it } from "vitest";
import {
  delphiDiv,
  finalizeMusterBlock,
} from "~/domain/solver/multipack/muster";
import {
  multiPackCenteringFrame,
  multiPackCenteringOffset,
  type MultiPackSolution,
} from "~/domain/solver/multipack/optimizer";

const PALETTE = { x: 12000, y: 8000 };
const PACKAGE = { length: 1120, width: 760 };

function solution(
  overrides: Partial<MultiPackSolution> = {},
): MultiPackSolution {
  return {
    paletteDmm: PALETTE,
    blockDmm: { x: 11400, y: 7560 },
    package: PACKAGE,
    clearanceDmm: 0,
    slots: [],
    ...overrides,
  };
}

describe("Delphi arithmetic", () => {
  it("truncates toward zero like Delphi div", () => {
    expect(delphiDiv(7, 2)).toBe(3);
    expect(delphiDiv(-7, 2)).toBe(-3);
    expect(delphiDiv(7, -2)).toBe(-3);
    expect(delphiDiv(6, 2)).toBe(3);
    expect(delphiDiv(-6, 2)).toBe(-3);
  });
});

describe("Muster finalize pass", () => {
  it("derives xMax/yMax from pitch and count", () => {
    expect(
      finalizeMusterBlock({
        x: 300,
        y: 220,
        dX: 760,
        dY: 1120,
        xMax: 0,
        yMax: 0,
        xCount: 15,
        yCount: 2,
        subOrient: 2,
        orient: 2,
      }),
    ).toEqual({
      x: 300,
      y: 220,
      dX: 760,
      dY: 1120,
      xMax: 11700,
      yMax: 2460,
      xCount: 15,
      yCount: 2,
      subOrient: 2,
      orient: 2,
    });
  });
});

describe("centering frame", () => {
  it("centers the plain block with Delphi div truncation", () => {
    expect(multiPackCenteringFrame(solution())).toEqual({
      offsetX: 300,
      offsetY: 220,
      spanX: 11400,
      spanY: 7560,
    });
    expect(
      multiPackCenteringOffset(solution({ blockDmm: { x: 11401, y: 7561 } })),
    ).toEqual({ x: 299, y: 219 });
    expect(
      multiPackCenteringOffset(solution({ blockDmm: { x: 12101, y: 8000 } })),
    ).toEqual({ x: -50, y: 0 });
  });

  it("shrinks the block for 2×2 replication and clamps against 6000/4000", () => {
    expect(multiPackCenteringFrame(solution({ replicate2x2: true }))).toEqual({
      offsetX: 300,
      offsetY: 220,
      spanX: 5400,
      spanY: 3560,
    });
    expect(
      multiPackCenteringFrame(
        solution({
          blockDmm: { x: 12002, y: 8002 },
          replicate2x2: true,
        }),
      ),
    ).toEqual({ offsetX: -1, offsetY: -1, spanX: 6001, spanY: 4001 });
  });

  it("swaps and shrinks the block for mirror replication", () => {
    expect(
      multiPackCenteringFrame(solution({ replicateMirror: true })),
    ).toEqual({
      offsetX: 220,
      offsetY: 300,
      spanX: 7560,
      spanY: 5400,
    });
    expect(
      multiPackCenteringFrame(
        solution({
          blockDmm: { x: 10000, y: 13000 },
          replicateMirror: true,
        }),
      ),
    ).toEqual({ offsetX: -2500, offsetY: 1000, spanX: 13000, spanY: 4000 });
    expect(
      multiPackCenteringFrame(
        solution({
          blockDmm: { x: 13000, y: 10000 },
          replicateMirror: true,
        }),
      ),
    ).toEqual({ offsetX: -1000, offsetY: -500, spanX: 10000, spanY: 6500 });
  });

  it("lets the 2×2 branch win when both replication flags are set", () => {
    expect(
      multiPackCenteringFrame(
        solution({ replicate2x2: true, replicateMirror: true }),
      ),
    ).toEqual({
      offsetX: 300,
      offsetY: 220,
      spanX: 5400,
      spanY: 3560,
    });
  });
});
