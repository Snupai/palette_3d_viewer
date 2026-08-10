import type {
  EditableStackLayer,
  SpecialTopLayer,
  StackCompositionMode,
  StackLayerTransform,
} from "~/domain/stack/types";

export type CreateCompositionSequenceInput = {
  mode: StackCompositionMode;
  layerCount: number;
  primaryPatternRef: string;
  secondaryPatternRef?: string | null;
  createLayerId?: (index: number) => string;
};

/**
 * X follows pallet length and Y follows pallet width. A longitudinal mirror
 * keeps the longitudinal X axis and flips Y; a transverse mirror keeps Y and
 * flips X. Rotation is the envelope-preserving 180 degree stack rotation.
 */
export function transformForCompositionMode(
  mode: StackCompositionMode,
): StackLayerTransform {
  switch (mode) {
    case "tower":
      return "identity";
    case "longitudinal-mirror":
      return "mirror-y";
    case "transverse-mirror":
      return "mirror-x";
    case "rotation":
      return "rotate-180";
  }
}

export function createCompositionSequence(
  input: CreateCompositionSequenceInput,
): EditableStackLayer[] {
  if (!Number.isInteger(input.layerCount) || input.layerCount < 0) {
    throw new Error("layerCount must be a non-negative integer.");
  }
  if (input.primaryPatternRef.trim().length === 0) {
    throw new Error("primaryPatternRef must not be empty.");
  }
  if (
    input.secondaryPatternRef !== undefined &&
    input.secondaryPatternRef !== null &&
    input.secondaryPatternRef.trim().length === 0
  ) {
    throw new Error("secondaryPatternRef must be null or a non-empty string.");
  }

  const transformedPatternRef =
    input.secondaryPatternRef ?? input.primaryPatternRef;
  const alternateTransform = transformForCompositionMode(input.mode);
  const createLayerId =
    input.createLayerId ?? ((index: number) => `composed-layer-${index + 1}`);
  const ids = new Set<string>();

  return Array.from({ length: input.layerCount }, (_, index) => {
    const secondary = index % 2 === 1;
    const patternRef = secondary
      ? transformedPatternRef
      : input.primaryPatternRef;
    const id = createLayerId(index);
    if (id.trim().length === 0) {
      throw new Error(`createLayerId returned an empty id for layer ${index}.`);
    }
    if (ids.has(id)) {
      throw new Error(`createLayerId returned duplicate id "${id}".`);
    }
    ids.add(id);

    return {
      id,
      patternRef,
      transform: secondary ? alternateTransform : "identity",
      provenance: {
        kind: "composition",
        mode: input.mode,
        role: secondary ? "secondary" : "primary",
        sourcePatternRef: patternRef,
      },
    } satisfies EditableStackLayer;
  });
}

/** Applies a special top pattern as a non-destructive overlay on the sequence. */
export function applySpecialTopLayer(
  layers: readonly EditableStackLayer[],
  specialTopLayer: SpecialTopLayer = { enabled: false },
): readonly EditableStackLayer[] {
  if (!specialTopLayer.enabled || layers.length === 0) return layers;

  const topIndex = layers.length - 1;
  const currentTop = layers[topIndex]!;
  if (
    currentTop.patternRef === specialTopLayer.patternRef &&
    currentTop.transform === specialTopLayer.transform &&
    currentTop.provenance.kind === "special-top"
  ) {
    return layers;
  }

  const resolved = [...layers];
  resolved[topIndex] = {
    ...currentTop,
    patternRef: specialTopLayer.patternRef,
    transform: specialTopLayer.transform,
    provenance: {
      kind: "special-top",
      replacedPatternRef: currentTop.patternRef,
      sourcePatternRef: specialTopLayer.patternRef,
    },
  };
  return resolved;
}
