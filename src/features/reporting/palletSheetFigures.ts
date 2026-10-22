import type { PalletData } from "~/domain/palletTypes";
import {
  layerInterlayerHeightMm,
  layerZBottom,
  trailingInterlayerHeightMm,
} from "~/domain/palletGeometry";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

/**
 * Figures for the printed pallet sheet, following the MultiPack sheet the
 * production line already uses:
 * - Flächennutzung = package footprint area of the fullest layer / pallet area
 * - Volumennutzung = total package volume / (pallet length × width × storage height)
 */
export type PalletSheetFigures = {
  packageMm: { length: number; width: number; height: number };
  palletMm: { length: number; width: number; height: number };
  /** Load space above the pallet; null when no storage height is configured. */
  storageMm: { length: number; width: number; height: number | null };
  blockMm: { length: number; width: number; height: number };
  /** Block height plus pallet height. */
  totalHeightMm: number;
  packageCount: number;
  layerCount: number;
  /** Packages per layer when every layer has the same count, else null. */
  uniformPackagesPerLayer: number | null;
  minPackagesPerLayer: number;
  maxPackagesPerLayer: number;
  areaUtilizationPercent: number | null;
  volumeUtilizationPercent: number | null;
};

export type SheetBox = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

export type SheetLayer = {
  index: number;
  boxes: SheetBox[];
  /** Interlayer sheets directly below this layer (z of each sheet's bottom). */
  sheetsBelow: { zBottom: number; thicknessMm: number }[];
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Physical boxes per layer in pallet millimetres (z = 0 is the pallet deck). */
export function sheetLayers(data: PalletData): SheetLayer[] {
  const packageHeight = data.package.height;
  return data.layers.map((layer, index) => {
    const zBottom = layerZBottom(data.layers, index, packageHeight);
    const preview = palletLayerToPatternPreview(data, index);
    const sheetHeight = layerInterlayerHeightMm(layer);
    const sheetCount = sheetHeight > 0 ? 1 : 0;
    return {
      index,
      boxes: preview.items.map((item) => ({
        min: {
          x: item.centerMm.x - item.sizeMm.x / 2,
          y: item.centerMm.y - item.sizeMm.y / 2,
          z: zBottom,
        },
        max: {
          x: item.centerMm.x + item.sizeMm.x / 2,
          y: item.centerMm.y + item.sizeMm.y / 2,
          z: zBottom + packageHeight,
        },
      })),
      sheetsBelow:
        sheetCount > 0
          ? [{ zBottom: zBottom - sheetHeight, thicknessMm: sheetHeight }]
          : [],
    };
  });
}

export function palletSheetFigures(input: {
  data: PalletData;
  /** Load space height above the pallet (Palettenstauraum), if configured. */
  storageHeightMm: number | null;
}): PalletSheetFigures {
  const { data } = input;
  const pallet = data.pallet ?? { width: 1200, length: 800, height: 144 };
  const layers = sheetLayers(data);
  const counts = layers.map(({ boxes }) => boxes.length);
  const packageCount = counts.reduce((total, count) => total + count, 0);
  const allBoxes = layers.flatMap(({ boxes }) => boxes);
  const minX = Math.min(...allBoxes.map(({ min }) => min.x));
  const maxX = Math.max(...allBoxes.map(({ max }) => max.x));
  const minY = Math.min(...allBoxes.map(({ min }) => min.y));
  const maxY = Math.max(...allBoxes.map(({ max }) => max.y));
  const topLayerIndex = data.layers.length - 1;
  const blockHeight =
    topLayerIndex < 0
      ? 0
      : layerZBottom(data.layers, topLayerIndex, data.package.height) +
        data.package.height +
        trailingInterlayerHeightMm(data);
  const footprint = data.package.length * data.package.width;
  const palletArea = pallet.width * pallet.length;
  const maxPerLayer = counts.length ? Math.max(...counts) : 0;
  const minPerLayer = counts.length ? Math.min(...counts) : 0;
  const storageHeight = input.storageHeightMm;
  const packageVolume = footprint * data.package.height * packageCount;

  return {
    packageMm: {
      length: data.package.length,
      width: data.package.width,
      height: data.package.height,
    },
    // The sheet lists the pallet long side first (1200 × 800).
    palletMm: {
      length: Math.max(pallet.width, pallet.length),
      width: Math.min(pallet.width, pallet.length),
      height: pallet.height,
    },
    storageMm: {
      length: Math.max(pallet.width, pallet.length),
      width: Math.min(pallet.width, pallet.length),
      height: storageHeight,
    },
    blockMm:
      allBoxes.length === 0
        ? { length: 0, width: 0, height: 0 }
        : {
            length: round1(Math.max(maxX - minX, maxY - minY)),
            width: round1(Math.min(maxX - minX, maxY - minY)),
            height: round1(blockHeight),
          },
    totalHeightMm: round1(blockHeight + pallet.height),
    packageCount,
    layerCount: layers.length,
    uniformPackagesPerLayer:
      counts.length > 0 && minPerLayer === maxPerLayer ? maxPerLayer : null,
    minPackagesPerLayer: minPerLayer,
    maxPackagesPerLayer: maxPerLayer,
    areaUtilizationPercent:
      palletArea > 0
        ? round1(((footprint * maxPerLayer) / palletArea) * 100)
        : null,
    volumeUtilizationPercent:
      storageHeight !== null && storageHeight > 0 && palletArea > 0
        ? round1((packageVolume / (palletArea * storageHeight)) * 100)
        : null,
  };
}

/** German number format used on the printed sheet: 308,0 */
export function formatSheetNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}
