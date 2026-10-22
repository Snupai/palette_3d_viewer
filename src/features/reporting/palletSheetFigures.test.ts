// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Box, PalletData } from "~/domain/palletTypes";
import {
  formatSheetNumber,
  palletSheetFigures,
  sheetLayers,
} from "~/features/reporting/palletSheetFigures";

function box(x: number, y: number): Box {
  return {
    blueNumber: 1,
    blueLine: null,
    rotation: 0,
    // Rotation 0: the x footprint is rect.length, the y footprint rect.width.
    rect: { length: 308, width: 220, x, y },
    height: 188,
    placeX: x,
    placeY: y,
    numPackages: 1,
  };
}

/** Eleven 308 × 220 cartons per layer, like the MultiPack reference sheet. */
const elevenPerLayer = [
  ...[154, 462, 770].flatMap((x) => [110, 330, 550].map((y) => box(x, y))),
  box(1046, 110),
  box(1046, 330),
];

function referencePlan(layerCount: number, zwischenlage = 0): PalletData {
  return {
    layers: Array.from({ length: layerCount }, () => ({
      unique_layer_id: 1,
      boxes: elevenPerLayer,
      zwischenlage,
    })),
    uniqueLayers: {},
    layer_count: layerCount,
    total_boxes: layerCount * elevenPerLayer.length,
    package: { length: 308, width: 220, height: 188 },
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
  };
}

describe("palletSheetFigures", () => {
  it("reproduces the MultiPack reference sheet figures", () => {
    expect(
      palletSheetFigures({ data: referencePlan(6), storageHeightMm: 1500 }),
    ).toEqual({
      packageMm: { length: 308, width: 220, height: 188 },
      palletMm: { length: 1200, width: 800, height: 144 },
      storageMm: { length: 1200, width: 800, height: 1500 },
      blockMm: { length: 1200, width: 660, height: 1128 },
      totalHeightMm: 1272,
      packageCount: 66,
      layerCount: 6,
      uniformPackagesPerLayer: 11,
      minPackagesPerLayer: 11,
      maxPackagesPerLayer: 11,
      areaUtilizationPercent: 77.6,
      volumeUtilizationPercent: 58.4,
    });
  });

  it("leaves volume utilization open without a storage height", () => {
    expect(
      palletSheetFigures({ data: referencePlan(2), storageHeightMm: null })
        .volumeUtilizationPercent,
    ).toBeNull();
  });

  it("counts interlayer sheets into the block height", () => {
    const figures = palletSheetFigures({
      data: referencePlan(2, 1),
      storageHeightMm: null,
    });
    // Two 3 mm sheets (one under each layer) plus two 188 mm layers.
    expect(figures.blockMm.height).toBe(382);
    expect(figures.totalHeightMm).toBe(526);
  });
});

describe("sheetLayers", () => {
  it("stacks layer boxes and places sheets directly below their layer", () => {
    const layers = sheetLayers(referencePlan(2, 1));
    expect(layers[1]?.boxes[0]).toEqual({
      min: { x: 0, y: 0, z: 194 },
      max: { x: 308, y: 220, z: 382 },
    });
    expect(layers[1]?.sheetsBelow).toEqual([{ zBottom: 191, thicknessMm: 3 }]);
  });
});

describe("formatSheetNumber", () => {
  it("uses a decimal comma", () => {
    expect(formatSheetNumber(308)).toBe("308,0");
    expect(formatSheetNumber(77.6)).toBe("77,6");
  });
});
