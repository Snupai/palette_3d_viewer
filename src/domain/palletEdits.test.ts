import { describe, expect, it } from "vitest";
import {
  applyBaseInterlayerEdit,
  applyGripEdit,
  applyInterlayerAfterLayerEdit,
  mergeGrips,
  splitGrip,
} from "~/domain/palletEdits";
import { gripsToBoxes } from "~/domain/palletGeometry";
import type { Grip, PalletData } from "~/domain/palletTypes";

const packageSize = { width: 200, length: 300, height: 150 };

function grip(id: string, overrides?: Partial<Grip>): Grip {
  return {
    id,
    pickX: 100,
    pickY: -150,
    pickRotation: 0,
    x: 600,
    y: 400,
    rotation: 0,
    numPackages: 1,
    dx: 0,
    dy: 0,
    ...overrides,
  };
}

function palletData(): PalletData {
  const firstLayerGrips = [grip("first")];
  const secondLayerGrips = [grip("second", { x: 300 })];
  return {
    layers: [
      {
        unique_layer_id: 1,
        boxes: gripsToBoxes(
          firstLayerGrips,
          packageSize.width,
          packageSize.length,
          packageSize.height,
          0,
        ),
        zwischenlage: 1,
      },
      {
        unique_layer_id: 2,
        boxes: gripsToBoxes(
          secondLayerGrips,
          packageSize.width,
          packageSize.length,
          packageSize.height,
          0,
        ),
        zwischenlage: 0,
      },
      {
        unique_layer_id: 1,
        boxes: gripsToBoxes(
          firstLayerGrips,
          packageSize.width,
          packageSize.length,
          packageSize.height,
          0,
        ),
        zwischenlage: 1,
      },
    ],
    uniqueLayers: { 1: firstLayerGrips, 2: secondLayerGrips },
    layer_count: 3,
    total_boxes: 3,
    package: packageSize,
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
    inputDirectionExplicit: false,
    trailingZwischenlage: 0,
  };
}

describe("pallet grip edits", () => {
  it("updates a unique layer and every physical layer that references it", () => {
    const original = palletData();
    const nextGrips = [
      grip("group", {
        pickX: 200,
        x: 600,
        numPackages: 2,
      }),
    ];

    const edited = applyGripEdit(original, 1, nextGrips);

    expect(edited).not.toBe(original);
    expect(edited.uniqueLayers[1]).not.toBe(nextGrips);
    expect(edited.uniqueLayers[1]?.[0]).not.toBe(nextGrips[0]);
    expect(edited.layers.map((layer) => layer.boxes.length)).toEqual([2, 1, 2]);
    expect(edited.layer_count).toBe(3);
    expect(edited.total_boxes).toBe(5);
  });

  it("splits a grouped grip into stable single-package geometry", () => {
    const source = grip("group", {
      pickX: 200,
      pickY: -150,
      x: 600,
      numPackages: 2,
    });

    const split = splitGrip(source, packageSize.width, packageSize.length, 0);

    expect(split.map(({ x, y }) => [x, y])).toEqual([
      [500, 400],
      [700, 400],
    ]);
    expect(split.map(({ pickX, pickY }) => [pickX, pickY])).toEqual([
      [100, -150],
      [100, -150],
    ]);
    expect(split.every((item) => item.numPackages === 1)).toBe(true);
    expect(new Set(split.map(({ id }) => id).concat(source.id)).size).toBe(3);
  });

  it("merges aligned touching singles and preserves rotated pose semantics", () => {
    const first = grip("first", {
      pickX: 160,
      pickY: 120,
      pickRotation: 90,
      x: 700,
      rotation: 180,
      dx: 1,
    });
    const second = grip("second", {
      pickX: 160,
      pickY: 120,
      pickRotation: 90,
      x: 500,
      rotation: 180,
      dx: 1,
    });

    const merged = mergeGrips(
      [first, second],
      packageSize.width,
      packageSize.length,
      0,
    );

    expect(merged).toMatchObject({
      pickX: 160,
      pickY: 220,
      pickRotation: 90,
      x: 600,
      y: 400,
      rotation: 180,
      numPackages: 2,
      dx: 1,
      dy: 0,
    });
    expect(merged?.id).not.toBe(first.id);
    expect(merged?.id).not.toBe(second.id);
  });
});

describe("pallet interlayer edits", () => {
  it("persists base, middle, and trailing interlayer changes", () => {
    const original = palletData();
    const withBase = applyBaseInterlayerEdit(original, 2);
    const afterFirstLayer = applyInterlayerAfterLayerEdit(withBase, 0, 3);
    const afterMiddleLayer = applyInterlayerAfterLayerEdit(
      afterFirstLayer,
      1,
      4,
    );
    const afterLastLayer = applyInterlayerAfterLayerEdit(
      afterMiddleLayer,
      2,
      5,
    );

    expect(afterLastLayer.layers.map((layer) => layer.zwischenlage)).toEqual([
      2, 3, 4,
    ]);
    expect(afterLastLayer.trailingZwischenlage).toBe(5);
  });

  it("normalizes negative and fractional interlayer values", () => {
    const original = palletData();
    const withBase = applyBaseInterlayerEdit(original, -2.5);
    const withTrailing = applyInterlayerAfterLayerEdit(withBase, 2, 2.9);

    expect(withTrailing.layers[0]?.zwischenlage).toBe(0);
    expect(withTrailing.trailingZwischenlage).toBe(2);
  });

  it("returns the original object for invalid or unchanged edits", () => {
    const original = palletData();

    expect(applyBaseInterlayerEdit(original, 1)).toBe(original);
    expect(applyInterlayerAfterLayerEdit(original, -1, 2)).toBe(original);
    expect(applyInterlayerAfterLayerEdit(original, 99, 2)).toBe(original);
    expect(applyInterlayerAfterLayerEdit(original, 2, 0)).toBe(original);
  });
});
