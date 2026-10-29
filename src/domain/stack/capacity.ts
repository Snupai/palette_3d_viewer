import { interlayerHeightForPrefix } from "~/domain/stack/interlayers";
import type {
  EditableStackLayer,
  StackCapacityResult,
  StackInterlayerRules,
  UniformStackCapacityInput,
} from "~/domain/stack/types";

export type SequenceStackCapacityInput = {
  storageHeightMm: number;
  packageHeightMm: number;
  layers: readonly EditableStackLayer[];
  interlayers: StackInterlayerRules;
};

const invalidResult = (
  requestedLayerCount: number,
  message: string,
): StackCapacityResult => ({
  status: "invalid-input",
  capacityLayers: 0,
  requestedLayerCount,
  heightAtCapacityMm: 0,
  requiredHeightForNextLayerMm: null,
  baseSheetHeightMm: 0,
  deckSheetHeightMm: 0,
  message,
});

export function calculateStackCapacity(
  input: SequenceStackCapacityInput,
): StackCapacityResult {
  const requestedLayerCount = input.layers.length;
  if (!Number.isFinite(input.storageHeightMm)) {
    return invalidResult(
      requestedLayerCount,
      "Storage height must be a finite number.",
    );
  }
  if (!Number.isFinite(input.packageHeightMm) || input.packageHeightMm <= 0) {
    return invalidResult(
      requestedLayerCount,
      "Package height must be a positive finite number.",
    );
  }
  if (input.storageHeightMm <= 0) {
    return {
      ...invalidResult(
        requestedLayerCount,
        "No package layer fits in a non-positive storage height.",
      ),
      status: "impossible",
    };
  }
  if (requestedLayerCount === 0) {
    return {
      status: "empty-sequence",
      capacityLayers: 0,
      requestedLayerCount: 0,
      heightAtCapacityMm: 0,
      requiredHeightForNextLayerMm: null,
      baseSheetHeightMm: 0,
      deckSheetHeightMm: 0,
      message: "The editable layer sequence is empty.",
    };
  }

  try {
    const fixed = interlayerHeightForPrefix(input.layers, 0, input.interlayers);
    let capacityLayers = 0;
    let heightAtCapacityMm = 0;
    let requiredHeightForNextLayerMm: number | null = null;

    for (
      let layerCount = 1;
      layerCount <= requestedLayerCount;
      layerCount += 1
    ) {
      const sheetHeight = interlayerHeightForPrefix(
        input.layers,
        layerCount,
        input.interlayers,
      );
      const requiredHeight =
        layerCount * input.packageHeightMm + sheetHeight.totalMm;
      if (requiredHeight <= input.storageHeightMm) {
        capacityLayers = layerCount;
        heightAtCapacityMm = requiredHeight;
      } else {
        requiredHeightForNextLayerMm = requiredHeight;
        break;
      }
    }

    if (
      capacityLayers === requestedLayerCount &&
      requestedLayerCount < Number.MAX_SAFE_INTEGER
    ) {
      requiredHeightForNextLayerMm = null;
    }

    return {
      status: capacityLayers === 0 ? "impossible" : "calculated",
      capacityLayers,
      requestedLayerCount,
      heightAtCapacityMm,
      requiredHeightForNextLayerMm,
      baseSheetHeightMm: fixed.baseMm,
      deckSheetHeightMm: fixed.deckMm,
      message:
        capacityLayers === 0
          ? "The first package layer plus configured base/deck sheets exceeds storage height."
          : capacityLayers === requestedLayerCount
            ? "The complete editable layer sequence fits the storage height."
            : `${capacityLayers} package layers fit before the next layer exceeds storage height.`,
    };
  } catch (cause) {
    return invalidResult(
      requestedLayerCount,
      cause instanceof Error ? cause.message : "Invalid interlayer rules.",
    );
  }
}

export function calculateUniformStackCapacity(
  input: UniformStackCapacityInput,
): StackCapacityResult {
  const between = input.betweenLayerThicknessMm ?? 0;
  const base = input.baseSheetThicknessMm ?? 0;
  const deck = input.deckSheetThicknessMm ?? 0;
  const numericValues = [
    input.storageHeightMm,
    input.packageHeightMm,
    between,
    base,
    deck,
  ];
  if (numericValues.some((value) => !Number.isFinite(value))) {
    return invalidResult(0, "All capacity dimensions must be finite numbers.");
  }
  if (input.packageHeightMm <= 0 || between < 0 || base < 0 || deck < 0) {
    return invalidResult(
      0,
      "Package height must be positive and sheet thicknesses must not be negative.",
    );
  }
  if (input.storageHeightMm <= 0) {
    return {
      ...invalidResult(
        0,
        "No package layer fits in a non-positive storage height.",
      ),
      status: "impossible",
      baseSheetHeightMm: base,
      deckSheetHeightMm: deck,
    };
  }

  const fixedHeight = base + deck;
  const firstLayerHeight = fixedHeight + input.packageHeightMm;
  if (firstLayerHeight > input.storageHeightMm) {
    return {
      status: "impossible",
      capacityLayers: 0,
      requestedLayerCount: 0,
      heightAtCapacityMm: 0,
      requiredHeightForNextLayerMm: firstLayerHeight,
      baseSheetHeightMm: base,
      deckSheetHeightMm: deck,
      message:
        "The first package layer plus configured base/deck sheets exceeds storage height.",
    };
  }

  const repeatHeight = input.packageHeightMm + between;
  const rawCapacity = Math.floor(
    (input.storageHeightMm - fixedHeight + between) / repeatHeight,
  );
  const capacityLayers = Math.max(
    0,
    Math.min(Number.MAX_SAFE_INTEGER, rawCapacity),
  );
  const heightAtCapacityMm =
    fixedHeight +
    capacityLayers * input.packageHeightMm +
    Math.max(0, capacityLayers - 1) * between;
  const requiredHeightForNextLayerMm =
    heightAtCapacityMm + between + input.packageHeightMm;

  return {
    status: "calculated",
    capacityLayers,
    requestedLayerCount: capacityLayers,
    heightAtCapacityMm,
    requiredHeightForNextLayerMm,
    baseSheetHeightMm: base,
    deckSheetHeightMm: deck,
    message: `${capacityLayers} package layers fit the uniform height rules.`,
  };
}
