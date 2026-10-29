import {
  palletSpecSchema,
  type PalletSpec,
} from "~/domain/project/projectSchema";

export type PalletTemplateKind = "euro" | "industrial";

const templates: Record<PalletTemplateKind, PalletSpec> = {
  euro: palletSpecSchema.parse({
    id: "pallet-euro",
    name: "EURO pallet",
    kind: "euro",
    dimensionsMm: { length: 1200, width: 800, height: 144 },
    storageEnvelopeMm: null,
    allowedOverhangMm: { length: 0, width: 0 },
    tareKg: 25,
    maxGrossKg: 1500,
    subPalletPattern: "none",
  }),
  industrial: palletSpecSchema.parse({
    id: "pallet-industrial",
    name: "Industrial pallet",
    kind: "industrial",
    dimensionsMm: { length: 1200, width: 1000, height: 144 },
    storageEnvelopeMm: null,
    allowedOverhangMm: { length: 0, width: 0 },
    tareKg: 30,
    maxGrossKg: 1500,
    subPalletPattern: "none",
  }),
};

function clonePallet(pallet: PalletSpec): PalletSpec {
  return {
    ...pallet,
    dimensionsMm: { ...pallet.dimensionsMm },
    storageEnvelopeMm: pallet.storageEnvelopeMm
      ? { ...pallet.storageEnvelopeMm }
      : null,
    allowedOverhangMm: { ...pallet.allowedOverhangMm },
  };
}

export const EURO_PALLET_TEMPLATE = clonePallet(templates.euro);
export const INDUSTRIAL_PALLET_TEMPLATE = clonePallet(templates.industrial);

export function getPalletTemplate(kind: PalletTemplateKind): PalletSpec {
  return clonePallet(templates[kind]);
}

export type CustomPalletInput = {
  id?: string;
  name?: string;
  dimensionsMm: PalletSpec["dimensionsMm"];
  storageEnvelopeMm?: PalletSpec["storageEnvelopeMm"];
  allowedOverhangMm?: PalletSpec["allowedOverhangMm"];
  tareKg?: number | null;
  maxGrossKg?: number | null;
  subPalletPattern?: PalletSpec["subPalletPattern"];
};

export function createCustomPallet(
  input: CustomPalletInput,
  createId: () => string = () =>
    globalThis.crypto?.randomUUID?.() ??
    `custom-pallet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): PalletSpec {
  return palletSpecSchema.parse({
    id: input.id ?? createId(),
    name: input.name ?? "Custom pallet",
    kind: "custom",
    dimensionsMm: input.dimensionsMm,
    storageEnvelopeMm: input.storageEnvelopeMm ?? null,
    allowedOverhangMm: input.allowedOverhangMm ?? { length: 0, width: 0 },
    tareKg: input.tareKg ?? null,
    maxGrossKg: input.maxGrossKg ?? null,
    subPalletPattern: input.subPalletPattern ?? "none",
  });
}

export function palletLoadFootprintMm(pallet: PalletSpec): {
  length: number;
  width: number;
} {
  const validated = palletSpecSchema.parse(pallet);
  return {
    length:
      validated.dimensionsMm.length + validated.allowedOverhangMm.length * 2,
    width: validated.dimensionsMm.width + validated.allowedOverhangMm.width * 2,
  };
}

export type PalletLoadDiagnostic = {
  code: "gross-weight-exceeded" | "storage-height-exceeded";
  message: string;
  actual: number;
  limit: number;
};

export type PalletLoadValidationInput = {
  packageCount: number;
  packageWeightKg: number | null;
  loadHeightMm?: number | null;
};

export function validatePalletLoad(
  palletInput: PalletSpec,
  input: PalletLoadValidationInput,
): { grossWeightKg: number | null; diagnostics: PalletLoadDiagnostic[] } {
  const pallet = palletSpecSchema.parse(palletInput);
  if (!Number.isInteger(input.packageCount) || input.packageCount < 0) {
    throw new Error("packageCount must be a non-negative integer.");
  }
  if (
    input.packageWeightKg !== null &&
    (!Number.isFinite(input.packageWeightKg) || input.packageWeightKg < 0)
  ) {
    throw new Error("packageWeightKg must be null or a non-negative number.");
  }
  if (
    input.loadHeightMm !== undefined &&
    input.loadHeightMm !== null &&
    (!Number.isFinite(input.loadHeightMm) || input.loadHeightMm < 0)
  ) {
    throw new Error("loadHeightMm must be null or a non-negative number.");
  }

  const grossWeightKg =
    pallet.tareKg === null || input.packageWeightKg === null
      ? null
      : pallet.tareKg + input.packageWeightKg * input.packageCount;
  const diagnostics: PalletLoadDiagnostic[] = [];

  if (
    grossWeightKg !== null &&
    pallet.maxGrossKg !== null &&
    grossWeightKg > pallet.maxGrossKg
  ) {
    diagnostics.push({
      code: "gross-weight-exceeded",
      message: `Gross weight ${grossWeightKg} kg exceeds the ${pallet.maxGrossKg} kg pallet limit.`,
      actual: grossWeightKg,
      limit: pallet.maxGrossKg,
    });
  }

  if (
    input.loadHeightMm !== undefined &&
    input.loadHeightMm !== null &&
    pallet.storageEnvelopeMm !== null &&
    input.loadHeightMm > pallet.storageEnvelopeMm.height
  ) {
    diagnostics.push({
      code: "storage-height-exceeded",
      message: `Load height ${input.loadHeightMm} mm exceeds the ${pallet.storageEnvelopeMm.height} mm storage envelope.`,
      actual: input.loadHeightMm,
      limit: pallet.storageEnvelopeMm.height,
    });
  }

  return { grossWeightKg, diagnostics };
}
