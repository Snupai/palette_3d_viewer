import { describe, expect, it } from "vitest";
import {
  mapMultiPackMPWinDimensions,
  MultiPackMPWinUnsupportedError,
} from "~/domain/solver/multipack/mpwin";
import {
  generateMultiPackMuster,
  type MultiPackSolution,
} from "~/domain/solver/multipack/optimizer";
import type { SimpleFamilySlot } from "~/domain/solver/multipack/families";

const PACKAGE = { length: 1120, width: 760 };

function simple(overrides: Partial<SimpleFamilySlot> = {}): SimpleFamilySlot {
  return {
    kind: "simple",
    type: 1,
    x0: 0,
    x1: 1120,
    y0: 0,
    y1: 760,
    countX: 1,
    countY: 1,
    ...overrides,
  };
}

function solution(
  overrides: Partial<MultiPackSolution> = {},
): MultiPackSolution {
  return {
    paletteDmm: { x: 3000, y: 2000 },
    blockDmm: { x: 3000, y: 2000 },
    package: PACKAGE,
    clearanceDmm: 0,
    slots: [
      simple({
        x1: 3000,
        y1: 2000,
        countX: 2,
        countY: 2,
      }),
    ],
    ...overrides,
  };
}

describe("AddBlock alignment modes", () => {
  const expected: Record<number, [number, number]> = {
    0: [0, 1240],
    1: [0, 0],
    2: [1880, 1240],
    3: [1880, 0],
  };

  for (const [mode, [x, y]] of Object.entries(expected)) {
    it(`places the first package for mode ${mode}`, () => {
      const block = generateMultiPackMuster(
        solution({ alignMode: Number(mode) as 0 | 1 | 2 | 3 }),
      ).blocks[0]!;
      expect([block.x, block.y]).toEqual([x, y]);
    });
  }

  it("rejects an unknown alignment mode", () => {
    expect(() =>
      generateMultiPackMuster(solution({ alignMode: 4 as unknown as 0 })),
    ).toThrow(/alignment mode/);
  });
});

describe("SubOrient/Orient assignment", () => {
  it("uses layerOrient 2 to compare the pitches", () => {
    const blocks = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 2240, y: 1520 },
        blockDmm: { x: 2240, y: 1520 },
        slots: [simple({ x1: 2240, y1: 1520, countX: 2, countY: 2 })],
        layerOrient: 2,
      }),
    ).blocks;
    expect(blocks[0]).toMatchObject({ subOrient: 1, orient: 1 });
  });

  it("uses layerOrient 1 to compare dX with the package length", () => {
    const blocks = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 2240, y: 1520 },
        blockDmm: { x: 2240, y: 1520 },
        slots: [simple({ x1: 2240, y1: 1520, countX: 2, countY: 2 })],
        layerOrient: 1,
      }),
    ).blocks;
    expect(blocks[0]).toMatchObject({ subOrient: 1, orient: 1 });

    const rotated = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 1520, y: 2240 },
        blockDmm: { x: 1520, y: 2240 },
        slots: [
          simple({
            type: 2,
            x1: 1520,
            y1: 2240,
            countX: 2,
            countY: 2,
          }),
        ],
        layerOrient: 1,
      }),
    ).blocks;
    expect(rotated[0]).toMatchObject({ subOrient: 2, orient: 2 });
  });

  it("uses layerOrient 0 to compare dX with the package width", () => {
    const rotated = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 1520, y: 2240 },
        blockDmm: { x: 1520, y: 2240 },
        slots: [
          simple({
            type: 2,
            x1: 1520,
            y1: 2240,
            countX: 2,
            countY: 2,
          }),
        ],
        layerOrient: 0,
      }),
    ).blocks;
    expect(rotated[0]).toMatchObject({ subOrient: 1, orient: 1 });
  });
});

describe("optimizer switches", () => {
  it("emits one entry per package by default and rings when disabled", () => {
    const perPackage = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 12000, y: 8000 },
        blockDmm: { x: 11400, y: 7560 },
        slots: [
          simple({
            type: 2,
            x1: 11400,
            y1: 2240,
            countX: 15,
            countY: 2,
          }),
        ],
      }),
    ).blocks;
    expect(perPackage).toHaveLength(30);
    expect(
      perPackage.every(({ xCount, yCount }) => xCount === 1 && yCount === 1),
    ).toBe(true);

    const ring = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 12000, y: 8000 },
        blockDmm: { x: 11400, y: 7560 },
        slots: [
          simple({
            type: 2,
            x1: 11400,
            y1: 2240,
            countX: 15,
            countY: 2,
          }),
        ],
        interactiveQuality: false,
      }),
    ).blocks;
    expect(ring).toHaveLength(1);
    expect(ring[0]).toMatchObject({
      x: 300,
      y: 220,
      xCount: 15,
      yCount: 2,
    });
  });

  it("runs the 2×2 replication after generation", () => {
    const blocks = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 12000, y: 8000 },
        blockDmm: { x: 11400, y: 7560 },
        slots: [
          simple({
            x1: 4480,
            y1: 2280,
            countX: 4,
            countY: 3,
          }),
        ],
        interactiveQuality: false,
        replicate2x2: true,
      }),
    ).blocks;
    expect(blocks.map(({ x, y }) => [x, y])).toEqual([
      [300, 220],
      [6300, 220],
      [300, 4220],
      [6300, 4220],
    ]);
    expect(blocks[0]).toMatchObject({ xCount: 4, yCount: 3, subOrient: 1 });
  });

  it("runs the mirror replication after generation", () => {
    const blocks = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 12000, y: 8000 },
        blockDmm: { x: 11400, y: 7560 },
        slots: [
          simple({
            x1: 2240,
            y1: 1520,
            countX: 2,
            countY: 2,
          }),
        ],
        interactiveQuality: false,
        replicateMirror: true,
        mirrorAxis: 1,
      }),
    ).blocks;
    expect(blocks.map(({ x, xMax }) => [x, xMax])).toEqual([
      [4480, 6000],
      [6000, 7520],
    ]);
    expect(blocks[0]).toMatchObject({
      y: 220,
      yMax: 2460,
      dX: 760,
      dY: 1120,
      xCount: 2,
      yCount: 2,
      subOrient: 2,
      orient: 2,
    });
  });

  it("evaluates only the first five slots", () => {
    const slots = Array.from({ length: 6 }, () => simple());
    const blocks = generateMultiPackMuster(
      solution({
        paletteDmm: { x: 1120, y: 760 },
        blockDmm: { x: 1120, y: 760 },
        slots,
        interactiveQuality: false,
      }),
    ).blocks;
    expect(blocks).toHaveLength(5);
  });

  it("rejects MPWin generation and maps its dimension swap", () => {
    expect(() => generateMultiPackMuster(solution({ mpWin: true }))).toThrow(
      MultiPackMPWinUnsupportedError,
    );
    expect(mapMultiPackMPWinDimensions(PACKAGE)).toEqual({
      length: 1120,
      width: 1120,
    });
  });
});
