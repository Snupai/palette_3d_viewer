import type {
  EditableStackLayer,
  StackLayerProvenance,
  StackLayerTransform,
} from "~/domain/stack/types";

export type StackLayerUpdate = {
  patternRef?: string;
  transform?: StackLayerTransform;
  provenance?: StackLayerProvenance;
};

export type StackSequenceCommand =
  | { type: "reorder"; layerId: string; toIndex: number }
  | { type: "insert"; index: number; layer: EditableStackLayer }
  | { type: "delete"; layerId: string }
  | { type: "update"; layerId: string; changes: StackLayerUpdate };

export type StackSequenceCommandResult = {
  sequence: readonly EditableStackLayer[];
  changed: boolean;
  inverse: StackSequenceCommand | null;
};

function indexOfLayer(
  layers: readonly EditableStackLayer[],
  layerId: string,
): number {
  const index = layers.findIndex(({ id }) => id === layerId);
  if (index < 0) throw new Error(`Stack layer "${layerId}" does not exist.`);
  return index;
}

function assertUniqueLayerId(
  layers: readonly EditableStackLayer[],
  layerId: string,
): void {
  if (layerId.trim().length === 0) {
    throw new Error("Stack layer id must not be empty.");
  }
  if (layers.some(({ id }) => id === layerId)) {
    throw new Error(`Stack layer id "${layerId}" already exists.`);
  }
}

export function reorderStackLayer(
  layers: readonly EditableStackLayer[],
  layerId: string,
  toIndex: number,
): readonly EditableStackLayer[] {
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= layers.length) {
    throw new Error("toIndex must address an existing stack position.");
  }
  const fromIndex = indexOfLayer(layers, layerId);
  if (fromIndex === toIndex) return layers;

  const reordered = [...layers];
  const [layer] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, layer!);
  return reordered;
}

export function insertStackLayer(
  layers: readonly EditableStackLayer[],
  index: number,
  layer: EditableStackLayer,
): readonly EditableStackLayer[] {
  if (!Number.isInteger(index) || index < 0 || index > layers.length) {
    throw new Error("index must be a valid stack insertion position.");
  }
  assertUniqueLayerId(layers, layer.id);
  if (layer.patternRef.trim().length === 0) {
    throw new Error("Stack layer patternRef must not be empty.");
  }

  const inserted = [...layers];
  inserted.splice(index, 0, layer);
  return inserted;
}

export function deleteStackLayer(
  layers: readonly EditableStackLayer[],
  layerId: string,
): readonly EditableStackLayer[] {
  const index = indexOfLayer(layers, layerId);
  return [...layers.slice(0, index), ...layers.slice(index + 1)];
}

export function updateStackLayer(
  layers: readonly EditableStackLayer[],
  layerId: string,
  changes: StackLayerUpdate,
): readonly EditableStackLayer[] {
  const index = indexOfLayer(layers, layerId);
  const current = layers[index]!;
  const nextPatternRef = Object.hasOwn(changes, "patternRef")
    ? changes.patternRef!
    : current.patternRef;
  const nextTransform = Object.hasOwn(changes, "transform")
    ? changes.transform!
    : current.transform;
  const nextProvenance = Object.hasOwn(changes, "provenance")
    ? changes.provenance!
    : current.provenance;

  if (nextPatternRef.trim().length === 0) {
    throw new Error("Stack layer patternRef must not be empty.");
  }
  if (
    nextPatternRef === current.patternRef &&
    nextTransform === current.transform &&
    nextProvenance === current.provenance
  ) {
    return layers;
  }

  const updated = [...layers];
  updated[index] = {
    ...current,
    patternRef: nextPatternRef,
    transform: nextTransform,
    provenance: nextProvenance,
  };
  return updated;
}

export function applyStackSequenceCommand(
  layers: readonly EditableStackLayer[],
  command: StackSequenceCommand,
): StackSequenceCommandResult {
  switch (command.type) {
    case "reorder": {
      const fromIndex = indexOfLayer(layers, command.layerId);
      const sequence = reorderStackLayer(
        layers,
        command.layerId,
        command.toIndex,
      );
      return sequence === layers
        ? { sequence: layers, changed: false, inverse: null }
        : {
            sequence,
            changed: true,
            inverse: {
              type: "reorder",
              layerId: command.layerId,
              toIndex: fromIndex,
            },
          };
    }
    case "insert": {
      const sequence = insertStackLayer(layers, command.index, command.layer);
      return {
        sequence,
        changed: true,
        inverse: { type: "delete", layerId: command.layer.id },
      };
    }
    case "delete": {
      const index = indexOfLayer(layers, command.layerId);
      const layer = layers[index]!;
      const sequence = deleteStackLayer(layers, command.layerId);
      return {
        sequence,
        changed: true,
        inverse: { type: "insert", index, layer },
      };
    }
    case "update": {
      const index = indexOfLayer(layers, command.layerId);
      const current = layers[index]!;
      const inverseChanges: StackLayerUpdate = {};
      if (Object.hasOwn(command.changes, "patternRef")) {
        inverseChanges.patternRef = current.patternRef;
      }
      if (Object.hasOwn(command.changes, "transform")) {
        inverseChanges.transform = current.transform;
      }
      if (Object.hasOwn(command.changes, "provenance")) {
        inverseChanges.provenance = current.provenance;
      }
      const sequence = updateStackLayer(
        layers,
        command.layerId,
        command.changes,
      );
      return sequence === layers
        ? { sequence: layers, changed: false, inverse: null }
        : {
            sequence,
            changed: true,
            inverse: {
              type: "update",
              layerId: command.layerId,
              changes: inverseChanges,
            },
          };
    }
  }
}
