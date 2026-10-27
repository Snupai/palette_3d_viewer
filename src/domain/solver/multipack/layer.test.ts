import { describe, expect, it } from "vitest";
import {
  isValidMusterLayer,
  mirrorMusterBlocks,
  mirrorMusterPackages,
  musterPackagesToPlacements,
  tileMuster,
} from "~/domain/solver/multipack/layer";
import {
  MUSTER_BLOCK_CAP,
  type Muster,
  type MusterBlock,
  type MusterPackage,
} from "~/domain/solver/multipack/muster";

const PALETTE = { x: 12000, y: 8000 };

function block(overrides: Partial<MusterBlock> = {}): MusterBlock {
  return {
    x: 0,
    y: 0,
    dX: 10,
    dY: 5,
    xMax: 0,
    yMax: 0,
    xCount: 1,
    yCount: 1,
    subOrient: 1,
    orient: 1,
    ...overrides,
  };
}

function pack(overrides: Partial<MusterPackage> = {}): MusterPackage {
  return {
    x: 100,
    y: 200,
    xMax: 300,
    yMax: 400,
    orient: 2,
    ...overrides,
  };
}

describe("tiling order", () => {
  it("expands blocks X-major in block order", () => {
    const muster: Muster = {
      layerOrient: 2,
      blocks: [
        block({ xCount: 2, yCount: 2, dX: 10, dY: 5, orient: 2 }),
        block({ x: 100, y: 0, dX: 20, dY: 5, xCount: 1, yCount: 2 }),
      ],
    };
    expect(
      tileMuster(muster).map(({ x, y, xMax, yMax, orient }) => [
        x,
        y,
        xMax,
        yMax,
        orient,
      ]),
    ).toEqual([
      [0, 0, 10, 5, 2],
      [0, 5, 10, 10, 2],
      [10, 0, 20, 5, 2],
      [10, 5, 20, 10, 2],
      [100, 0, 120, 5, 1],
      [100, 5, 120, 10, 1],
    ]);
  });

  it("rejects more blocks than the legacy tiling loop accepts", () => {
    const blocks = Array.from({ length: MUSTER_BLOCK_CAP + 1 }, () => block());
    expect(() => tileMuster({ layerOrient: 2, blocks })).toThrow(RangeError);
  });
});

describe("Verbund mirror", () => {
  it("mirrors around the Y extent for LaengsSpiegel", () => {
    expect(mirrorMusterPackages([pack()], 1, PALETTE)).toEqual([
      pack({ y: 7600, yMax: 7800 }),
    ]);
  });

  it("mirrors around the X extent for QuerSpiegel", () => {
    expect(mirrorMusterPackages([pack()], 2, PALETTE)).toEqual([
      pack({ x: 11700, xMax: 11900 }),
    ]);
  });

  it("mirrors both axes for Rotiert", () => {
    expect(mirrorMusterPackages([pack()], 3, PALETTE)).toEqual([
      pack({ x: 11700, y: 7600, xMax: 11900, yMax: 7800 }),
    ]);
  });

  it("leaves Turm untouched", () => {
    const packages = [pack()];
    expect(mirrorMusterPackages(packages, 0, PALETTE)).toEqual(packages);
  });

  it("mirrors block rectangles before tiling", () => {
    const muster: Muster = {
      layerOrient: 2,
      blocks: [
        block({
          x: 100,
          y: 200,
          dX: 760,
          dY: 1120,
          xMax: 860,
          yMax: 1320,
          xCount: 1,
          yCount: 1,
          subOrient: 2,
          orient: 2,
        }),
      ],
    };
    const mirrored = mirrorMusterBlocks(muster, 1, PALETTE);
    expect(mirrored.blocks[0]).toEqual({
      x: 100,
      y: 6680,
      dX: 760,
      dY: 1120,
      xMax: 860,
      yMax: 7800,
      xCount: 1,
      yCount: 1,
      subOrient: 2,
      orient: 2,
    });
  });

  it("reverses package row order for a mirrored multi-row block", () => {
    // The legacy mirrors blocks and then tiles; a 1x2 block therefore emits
    // its far row first, unlike mirroring already-tiled packages.
    const mirrored = mirrorMusterBlocks(
      {
        layerOrient: 2,
        blocks: [block({ x: 0, y: 0, xMax: 10, yMax: 10, yCount: 2 })],
      },
      1,
      { x: 100, y: 100 },
    );
    expect(tileMuster(mirrored).map(({ y }) => y)).toEqual([90, 95]);
  });
});

describe("package conversion and validation", () => {
  it("converts 0.1 mm packages to centered solver placements", () => {
    expect(
      musterPackagesToPlacements(
        [{ x: 300, y: 220, xMax: 1060, yMax: 1340, orient: 2 }],
        { x: 10, y: 5 },
        { length: 1120, width: 760 },
        [0, 90, 180, 270],
      ),
    ).toEqual([{ positionMm: { x: 78, y: 83 }, rotation: 90 }]);
  });

  it("derives the rotation from the footprint when width exceeds length", () => {
    expect(
      musterPackagesToPlacements(
        [
          { x: 0, y: 0, xMax: 1120, yMax: 760, orient: 1 },
          { x: 0, y: 760, xMax: 760, yMax: 1880, orient: 2 },
        ],
        { x: 0, y: 0 },
        { length: 760, width: 1120 },
        [0, 90, 180, 270],
      ).map(({ rotation }) => rotation),
    ).toEqual([90, 0]);
  });

  it("uses the first allowed rotation for square packages and keeps the base yaw otherwise", () => {
    const square = [{ x: 0, y: 0, xMax: 500, yMax: 500, orient: 2 as const }];
    expect(
      musterPackagesToPlacements(
        square,
        { x: 0, y: 0 },
        { length: 500, width: 500 },
        [180],
      ).map(({ rotation }) => rotation),
    ).toEqual([180]);
    expect(
      musterPackagesToPlacements(
        [{ x: 0, y: 0, xMax: 1120, yMax: 760, orient: 1 }],
        { x: 0, y: 0 },
        { length: 1120, width: 760 },
        [90, 270],
      ).map(({ rotation }) => rotation),
    ).toEqual([0]);
  });

  it("accepts touching packages but rejects overlaps", () => {
    const touching = [
      pack({ x: 0, y: 0, xMax: 10, yMax: 10 }),
      pack({ x: 10, y: 0, xMax: 20, yMax: 10 }),
    ];
    expect(isValidMusterLayer(touching, PALETTE, 0)).toBe(true);
    const overlapping = [
      pack({ x: 0, y: 0, xMax: 10, yMax: 10 }),
      pack({ x: 5, y: 5, xMax: 15, yMax: 15 }),
    ];
    expect(isValidMusterLayer(overlapping, PALETTE, 0)).toBe(false);
  });

  it("rejects packages outside the palette", () => {
    expect(isValidMusterLayer([pack({ xMax: 12001 })], PALETTE, 0)).toBe(false);
  });
});
