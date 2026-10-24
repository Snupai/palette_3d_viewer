import type { PalletSheet } from "~/domain/sheetExtraction";
import {
  palletTemplateFormValues,
  type ProjectFormValues,
} from "~/features/project/projectForm";
import type { SheetExtractionResult } from "~/lib/sheetExtraction/ollamaSheetExtractor";

export type SheetFormPatch = {
  values: ProjectFormValues;
  /** Packages per layer for the generator; empty when the sheet has no count. */
  exactPackageCount: string;
};

/**
 * Total over both sides: pallet − block, e.g. 1200 − 1162 = 38 mm. The form field
 * is signed (positive = overhang, negative = underhang) and the project stores
 * half of it per side, so a block smaller than the pallet is entered as −38.
 */
export function sheetOverhangTotalMm(
  blockMm: number,
  palletMm: number,
): number {
  const underhang = palletMm - blockMm;
  return underhang === 0 ? 0 : -underhang;
}

/**
 * Pre-fills the project form from a read sheet on a EURO pallet. The block footprint becomes the
 * load area (via signed overhang/underhang), so the generator searches for the
 * layer that the sheet shows instead of any layer that fits the pallet.
 */
export function applySheetToFormValues(
  current: ProjectFormValues,
  sheet: PalletSheet,
): SheetFormPatch {
  const { cartonMm, blockMm } = sheet;
  // Every sheet line runs on EURO pallets (1200 × 800), whatever the sheet prints.
  let values = palletTemplateFormValues("euro", current);
  const palletLength = Number(values.palletLengthMm);
  const palletWidth = Number(values.palletWidthMm);

  values = {
    ...values,
    productNumber:
      sheet.productNumber ?? sheet.cartonId ?? current.productNumber,
  };
  if (cartonMm) {
    values = {
      ...values,
      packageLengthMm: String(cartonMm.length),
      packageWidthMm: String(cartonMm.width),
      packageHeightMm: String(cartonMm.height),
      packageClearanceMm: "0",
    };
  }
  if (sheet.cartonWeightKg !== null) {
    values = { ...values, packageWeightKg: String(sheet.cartonWeightKg) };
  }
  if (blockMm) {
    values = {
      ...values,
      overhangLengthMm: String(
        sheetOverhangTotalMm(blockMm.length, palletLength),
      ),
      overhangWidthMm: String(sheetOverhangTotalMm(blockMm.width, palletWidth)),
    };
  }

  const stackHeight =
    blockMm && blockMm.height > 0
      ? blockMm.height
      : cartonMm && sheet.layers !== null
        ? cartonMm.height * sheet.layers
        : null;
  if (stackHeight !== null) {
    values = {
      ...values,
      hasStorageEnvelope: true,
      storageLengthMm: String(Math.max(palletLength, blockMm?.length ?? 0)),
      storageWidthMm: String(Math.max(palletWidth, blockMm?.width ?? 0)),
      storageHeightMm: String(stackHeight),
    };
  }

  return {
    values,
    exactPackageCount:
      sheet.cartonsPerLayer === null ? "" : String(sheet.cartonsPerLayer),
  };
}

const MAX_UPLOAD_EDGE_PX = 2048;

/** Phone photos are 12+ MP; the model reads a 2048 px JPEG just as well. */
async function downscalePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(
      1,
      MAX_UPLOAD_EDGE_PX / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function requestSheetExtraction(
  file: File,
  signal?: AbortSignal,
): Promise<SheetExtractionResult> {
  const body = new FormData();
  body.append("image", await downscalePhoto(file), "sheet.jpg");
  const response = await fetch("/api/sheet-extraction", {
    method: "POST",
    body,
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | (SheetExtractionResult & { error?: undefined })
    | { error: string }
    | null;
  if (!response.ok || payload === null || payload.error !== undefined) {
    throw new Error(
      payload?.error ?? `Sheet extraction failed (${response.status}).`,
    );
  }
  return payload;
}
