import type {
  EditableStackLayer,
  MaterializedSheetRule,
  MetricProvenance,
  StackInterlayerRules,
  StackSheetSpecification,
} from "~/domain/stack/types";

export type NormalizedSheetSpecification = {
  thicknessMm: number;
  quantity: number;
  weightKg: number | null;
  resourceId: string | null;
  provenance: MetricProvenance;
};

export type ResolvedBetweenLayerSheets = {
  specification: NormalizedSheetSpecification;
  rule: Extract<
    MaterializedSheetRule,
    | "all-between-layers"
    | "all-between-layers-override"
    | "individual-between-layers"
  >;
};

const configuredSheetProvenance: MetricProvenance = {
  status: "derived",
  source: "stack-interlayer-configuration",
  detail: "Thickness and quantity are taken from the editable stack rules.",
};

export function createSheetSpecification(
  thicknessMm: number,
  input: Omit<StackSheetSpecification, "thicknessMm"> = {},
): StackSheetSpecification {
  return { thicknessMm, ...input };
}

export function normalizeSheetSpecification(
  input: StackSheetSpecification,
  field = "sheet",
): NormalizedSheetSpecification {
  if (!Number.isFinite(input.thicknessMm) || input.thicknessMm <= 0) {
    throw new Error(`${field}.thicknessMm must be a positive finite number.`);
  }
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`${field}.quantity must be a positive integer.`);
  }
  const weightKg = input.weightKg ?? null;
  if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0)) {
    throw new Error(`${field}.weightKg must be null or a non-negative number.`);
  }
  const resourceId = input.resourceId ?? null;
  if (resourceId !== null && resourceId.trim().length === 0) {
    throw new Error(`${field}.resourceId must be null or a non-empty string.`);
  }

  return {
    thicknessMm: Object.is(input.thicknessMm, -0) ? 0 : input.thicknessMm,
    quantity,
    weightKg,
    resourceId,
    provenance: input.provenance ?? configuredSheetProvenance,
  };
}

export function sheetSpecificationHeightMm(
  specification: NormalizedSheetSpecification,
): number {
  return specification.thicknessMm * specification.quantity;
}

export function sheetSpecificationWeightKg(
  specification: NormalizedSheetSpecification,
): number | null {
  return specification.weightKg === null
    ? null
    : specification.weightKg * specification.quantity;
}

export function resolveBaseSheet(
  rules: StackInterlayerRules,
): NormalizedSheetSpecification | null {
  return rules.baseSheet
    ? normalizeSheetSpecification(rules.baseSheet, "baseSheet")
    : null;
}

export function resolveDeckSheet(
  rules: StackInterlayerRules,
): NormalizedSheetSpecification | null {
  return rules.deckSheet
    ? normalizeSheetSpecification(rules.deckSheet, "deckSheet")
    : null;
}

export function resolveBetweenLayerSheets(
  rules: StackInterlayerRules,
  upperLayer: EditableStackLayer,
): ResolvedBetweenLayerSheets | null {
  if (rules.mode === "all") {
    const override = rules.overridesBeforeLayer?.[upperLayer.id];
    return {
      specification: normalizeSheetSpecification(
        override ?? rules.betweenLayers,
        override ? `overridesBeforeLayer.${upperLayer.id}` : "betweenLayers",
      ),
      rule: override ? "all-between-layers-override" : "all-between-layers",
    };
  }

  const individual = rules.beforeLayer[upperLayer.id];
  if (!individual) return null;
  return {
    specification: normalizeSheetSpecification(
      individual,
      `beforeLayer.${upperLayer.id}`,
    ),
    rule: "individual-between-layers",
  };
}

export function interlayerHeightForPrefix(
  layers: readonly EditableStackLayer[],
  layerCount: number,
  rules: StackInterlayerRules,
): { baseMm: number; betweenMm: number; deckMm: number; totalMm: number } {
  if (
    !Number.isInteger(layerCount) ||
    layerCount < 0 ||
    layerCount > layers.length
  ) {
    throw new Error("layerCount must be within the editable layer sequence.");
  }
  const base = resolveBaseSheet(rules);
  const deck = resolveDeckSheet(rules);
  let betweenMm = 0;
  for (let index = 1; index < layerCount; index += 1) {
    const resolved = resolveBetweenLayerSheets(rules, layers[index]!);
    if (resolved) {
      betweenMm += sheetSpecificationHeightMm(resolved.specification);
    }
  }
  const baseMm = base ? sheetSpecificationHeightMm(base) : 0;
  const deckMm = deck ? sheetSpecificationHeightMm(deck) : 0;
  return {
    baseMm,
    betweenMm,
    deckMm,
    totalMm: baseMm + betweenMm + deckMm,
  };
}
