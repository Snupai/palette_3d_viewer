import { z } from "zod";

/**
 * Accepts numbers as the model returns them: JSON numbers, or strings in German
 * notation ("1.200,0", "148,0 mm"). Anything unreadable becomes `null` so one bad
 * field never rejects the whole sheet.
 */
export function parseSheetNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value.replace(/[^\d.,-]/g, "");
  if (text === "") return null;
  if (text.includes(",")) {
    // German: "." groups thousands, "," is the decimal separator.
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, "");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const sheetNumber = z.unknown().transform(parseSheetNumber);
const sheetText = z
  .unknown()
  .transform((value) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null,
  );

const dimensions3 = z
  .object({ length: sheetNumber, width: sheetNumber, height: sheetNumber })
  .partial()
  .nullish()
  .transform((value) => ({
    length: value?.length ?? null,
    width: value?.width ?? null,
    height: value?.height ?? null,
  }));

const dimensions2 = z
  .object({ length: sheetNumber, width: sheetNumber })
  .partial()
  .nullish()
  .transform((value) => ({
    length: value?.length ?? null,
    width: value?.width ?? null,
  }));

/** Lenient parse of the raw model answer; validation happens afterwards. */
export const rawPalletSheetSchema = z.object({
  sheetType: sheetText.optional().transform((value) => value ?? null),
  productName: sheetText.optional().transform((value) => value ?? null),
  productNumber: sheetText.optional().transform((value) => value ?? null),
  cartonId: sheetText.optional().transform((value) => value ?? null),
  cartonMm: dimensions3,
  blockMm: dimensions3,
  palletMm: dimensions2,
  loadSpaceHeightMm: sheetNumber.optional().transform((v) => v ?? null),
  totalHeightMm: sheetNumber.optional().transform((v) => v ?? null),
  cartonsPerLayer: sheetNumber.optional().transform((v) => v ?? null),
  layers: sheetNumber.optional().transform((v) => v ?? null),
  cartonsPerPallet: sheetNumber.optional().transform((v) => v ?? null),
  unitsPerCarton: sheetNumber.optional().transform((v) => v ?? null),
  cartonWeightKg: sheetNumber.optional().transform((v) => v ?? null),
  handwrittenNotes: sheetText.optional().transform((value) => value ?? null),
});

export type RawPalletSheet = z.output<typeof rawPalletSheetSchema>;

/**
 * JSON schema handed to the local model (Ollama `format`), so the answer is
 * always parseable JSON with exactly these keys.
 */
export const palletSheetJsonSchema = {
  type: "object",
  properties: {
    sheetType: { type: "string" },
    productName: { type: "string" },
    // Plain strings ("" when absent): with a nullable optional type the local
    // model always answered null, even when the number was on the sheet.
    productNumber: { type: "string" },
    cartonId: { type: "string" },
    cartonMm: dimensionSchema(["length", "width", "height"]),
    blockMm: dimensionSchema(["length", "width", "height"]),
    palletMm: dimensionSchema(["length", "width"]),
    loadSpaceHeightMm: { type: ["number", "null"] },
    totalHeightMm: { type: ["number", "null"] },
    cartonsPerLayer: { type: "integer" },
    layers: { type: "integer" },
    cartonsPerPallet: { type: "integer" },
    unitsPerCarton: { type: ["integer", "null"] },
    cartonWeightKg: { type: ["number", "null"] },
    handwrittenNotes: { type: ["string", "null"] },
  },
  required: [
    "sheetType",
    "productName",
    "productNumber",
    "cartonId",
    "cartonMm",
    "blockMm",
    "palletMm",
    "loadSpaceHeightMm",
    "totalHeightMm",
    "cartonsPerLayer",
    "layers",
    "cartonsPerPallet",
    "unitsPerCarton",
    "cartonWeightKg",
    "handwrittenNotes",
  ],
} as const;

function dimensionSchema(keys: readonly string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: ["number", "null"] }]),
    ),
    required: keys,
  };
}
