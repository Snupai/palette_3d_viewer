import { useEffect, useMemo, useState } from "react";
import { createGripId } from "~/domain/gripId";
import { insertMergedGripByDeltaDependencies } from "~/domain/gripDependencies";
import {
  clampDragPosition,
  hasGripCollision,
  hasSufficientPalletSupport,
} from "~/domain/layerEditorGeometry";
import { mergeGrips, splitGrip } from "~/domain/palletEdits";
import {
  footprintSize,
  gripsToBoxes,
  pickOffsetForCount,
  toRobInt,
} from "~/domain/palletGeometry";
import type { Grip, Rotation } from "~/domain/palletTypes";

export type LayerEditorDraft = {
  pickX: string;
  pickY: string;
  pickRotation: string;
  x: string;
  y: string;
  rotation: string;
  dx: string;
  dy: string;
};

export type LayerEditorDraftField = keyof LayerEditorDraft;

export type PalletPoint = {
  x: number;
  y: number;
};

type DragState = {
  gripIndex: number;
  gripId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  pickX: number;
  pickY: number;
  pickPlaceOffsetX: number;
  pickPlaceOffsetY: number;
};

export type UseLayerEditorOptions = {
  uniqueLayerId: number;
  grips: Grip[];
  packageWidth: number;
  packageLength: number;
  inputDirection: 0 | 1;
  pallet: { width: number; length: number } | null;
  selectedGripIndex: number | null;
  onSelectGrip: (index: number | null) => void;
  onCommitGrips: (nextGrips: Grip[]) => void;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyPosition: number;
  historyLength: number;
  canResetToOriginal: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetToOriginal: () => void;
};

export type LayerEditorHistory = {
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  canUndo: boolean;
  canRedo: boolean;
  position: number;
  length: number;
  canResetToOriginal: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onResetToOriginal: () => void;
};

export type LayerEditorController = {
  palletWidth: number;
  palletLength: number;
  previewGrips: Grip[];
  selectedGrip: Grip | null;
  mergeSelection: ReadonlySet<number>;
  groupingMode: boolean;
  message: string | null;
  draft: LayerEditorDraft;
  history: LayerEditorHistory;
  clearSelection: () => void;
  selectGrip: (gripIndex: number) => void;
  toggleGroupingMode: () => void;
  moveSelectedGrip: (deltaX: number, deltaY: number) => void;
  beginPointerInteraction: (
    gripIndex: number,
    point: PalletPoint | null,
    extendMergeSelection: boolean,
  ) => boolean;
  updatePointerDrag: (point: PalletPoint) => void;
  commitPointerDrag: (point: PalletPoint | null) => void;
  cancelPointerDrag: () => void;
  setDraftField: (field: LayerEditorDraftField, value: string) => void;
  commitDraftField: (field: LayerEditorDraftField) => void;
  resetDraft: () => void;
  rotateSelected: () => void;
  splitSelected: () => void;
  mergeSelected: () => void;
  deleteSelected: () => void;
  addPackage: () => void;
};

const COLLISION_MESSAGE = "Boxes cannot overlap. Position restored.";
const INSUFFICIENT_SUPPORT_MESSAGE =
  "At least 65% of every package must rest on the pallet. Position restored.";
const DRAG_COLLISION_MESSAGE =
  "Boxes cannot overlap. Stopped at the last valid position.";
const DRAG_INSUFFICIENT_SUPPORT_MESSAGE =
  "At least 65% of every package must rest on the pallet. Stopped at the last valid position.";

function gripDraft(grip: Grip | null): LayerEditorDraft {
  return {
    pickX: grip ? String(grip.pickX) : "",
    pickY: grip ? String(grip.pickY) : "",
    pickRotation: grip ? String(grip.pickRotation) : "",
    x: grip ? String(grip.x) : "",
    y: grip ? String(grip.y) : "",
    rotation: grip ? String(grip.rotation) : "",
    dx: grip ? String(grip.dx) : "",
    dy: grip ? String(grip.dy) : "",
  };
}

export function useLayerEditor({
  uniqueLayerId,
  grips,
  packageWidth,
  packageLength,
  inputDirection,
  pallet,
  selectedGripIndex,
  onSelectGrip,
  onCommitGrips,
  hasUnsavedChanges,
  isSaving,
  onSave,
  onDiscard,
  canUndo,
  canRedo,
  historyPosition,
  historyLength,
  canResetToOriginal,
  onUndo,
  onRedo,
  onResetToOriginal,
}: UseLayerEditorOptions): LayerEditorController {
  const palletWidth = pallet?.width ?? 1200;
  const palletLength = pallet?.length ?? 800;
  const [drag, setDrag] = useState<DragState | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Set<number>>(new Set());
  const [groupingMode, setGroupingMode] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const previewGrips = useMemo(() => {
    if (!drag) return grips;
    return grips.map((grip, index) =>
      index === drag.gripIndex
        ? {
            ...grip,
            pickX: drag.pickX,
            pickY: drag.pickY,
            x: drag.x,
            y: drag.y,
          }
        : grip,
    );
  }, [drag, grips]);
  const selectedGrip =
    selectedGripIndex === null
      ? null
      : (previewGrips[selectedGripIndex] ?? null);
  const [draft, setDraft] = useState<LayerEditorDraft>(() =>
    gripDraft(selectedGrip),
  );

  useEffect(() => {
    setDrag(null);
    setMergeSelection(new Set());
    setGroupingMode(false);
    setMessage(null);
  }, [uniqueLayerId]);

  useEffect(() => {
    setDraft(gripDraft(selectedGrip));
  }, [selectedGrip]);

  useEffect(() => {
    if (selectedGripIndex === null || grips[selectedGripIndex]) return;
    const fallbackIndex = grips.length > 0 ? grips.length - 1 : null;
    setMergeSelection(
      fallbackIndex === null ? new Set() : new Set([fallbackIndex]),
    );
    onSelectGrip(fallbackIndex);
  }, [grips, onSelectGrip, selectedGripIndex]);

  const withReplacedGrip = (index: number, nextGrip: Grip) =>
    grips.map((grip, gripIndex) => (gripIndex === index ? nextGrip : grip));

  const hasCollision = (nextGrips: Grip[]) =>
    hasGripCollision(
      nextGrips,
      { width: packageWidth, length: packageLength },
      inputDirection,
    );

  const hasSufficientSupport = (grip: Grip) =>
    hasSufficientPalletSupport(
      grip,
      { width: palletWidth, length: palletLength },
      { width: packageWidth, length: packageLength },
      inputDirection,
    );

  const replaceGrip = (index: number, nextGrip: Grip) => {
    onCommitGrips(withReplacedGrip(index, nextGrip));
  };

  const clampGripMovement = (
    gripIndex: number,
    grip: Grip,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) =>
    clampDragPosition({
      grips,
      gripIndex,
      grip,
      pallet: { width: palletWidth, length: palletLength },
      packageSize: { width: packageWidth, length: packageLength },
      inputDirection,
      fromX,
      fromY,
      toX,
      toY,
    });

  const setMovementMessage = (
    clamped: ReturnType<typeof clampDragPosition>,
  ) => {
    setMessage(
      clamped.insufficientSupport
        ? DRAG_INSUFFICIENT_SUPPORT_MESSAGE
        : clamped.collided
          ? DRAG_COLLISION_MESSAGE
          : null,
    );
  };

  const replacePlacedGrip = (index: number, nextGrip: Grip) => {
    if (!hasSufficientSupport(nextGrip)) {
      setMessage(INSUFFICIENT_SUPPORT_MESSAGE);
      setDraft(gripDraft(grips[index] ?? null));
      return false;
    }
    const next = withReplacedGrip(index, nextGrip);
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      setDraft(gripDraft(grips[index] ?? null));
      return false;
    }
    setMessage(null);
    onCommitGrips(next);
    return true;
  };

  const clearSelection = () => {
    onSelectGrip(null);
    setMergeSelection(new Set());
    setMessage(null);
  };

  const toggleGroupingMode = () => {
    const nextGroupingMode = !groupingMode;
    setGroupingMode(nextGroupingMode);
    setMessage(null);
    if (
      nextGroupingMode &&
      mergeSelection.size === 0 &&
      selectedGripIndex !== null &&
      grips[selectedGripIndex]
    ) {
      setMergeSelection(new Set([selectedGripIndex]));
    }
  };

  const selectGrip = (gripIndex: number) => {
    if (!grips[gripIndex]) return;
    setDrag(null);
    setMergeSelection(new Set([gripIndex]));
    setMessage(null);
    onSelectGrip(gripIndex);
  };

  const toggleGripMergeSelection = (gripIndex: number) => {
    if (!grips[gripIndex]) return;
    setDrag(null);
    setMessage(null);
    const next = new Set(mergeSelection);
    if (next.has(gripIndex)) {
      next.delete(gripIndex);
      const fallbackIndex = [...next].sort((a, b) => a - b)[0] ?? null;
      onSelectGrip(fallbackIndex);
    } else {
      next.add(gripIndex);
      onSelectGrip(gripIndex);
    }
    setMergeSelection(next);
  };

  const moveSelectedGrip = (deltaX: number, deltaY: number) => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip) return;
    const clamped = clampGripMovement(
      selectedGripIndex,
      grip,
      grip.x,
      grip.y,
      grip.x + deltaX,
      grip.y + deltaY,
    );
    setMovementMessage(clamped);
    if (clamped.x === grip.x && clamped.y === grip.y) return;
    replaceGrip(selectedGripIndex, {
      ...grip,
      pickX: grip.pickX + clamped.x - grip.x,
      pickY: grip.pickY + clamped.y - grip.y,
      x: clamped.x,
      y: clamped.y,
    });
  };

  const beginPointerInteraction = (
    gripIndex: number,
    point: PalletPoint | null,
    extendMergeSelection: boolean,
  ) => {
    const grip = previewGrips[gripIndex];
    if (!grip) return false;
    setMessage(null);

    if (extendMergeSelection || groupingMode) {
      toggleGripMergeSelection(gripIndex);
      return false;
    }

    onSelectGrip(gripIndex);
    setMergeSelection(new Set([gripIndex]));
    if (!point) return false;
    setDrag({
      gripIndex,
      gripId: grip.id,
      offsetX: point.x - grip.x,
      offsetY: point.y - grip.y,
      x: grip.x,
      y: grip.y,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickPlaceOffsetX: grip.pickX - grip.x,
      pickPlaceOffsetY: grip.pickY - grip.y,
    });
    return true;
  };

  const updatePointerDrag = (point: PalletPoint) => {
    if (!drag) return;
    const x = Math.round(point.x - drag.offsetX);
    const y = Math.round(point.y - drag.offsetY);
    const currentGrip = grips[drag.gripIndex];
    if (!currentGrip || currentGrip.id !== drag.gripId) return;
    const clamped = clampGripMovement(
      drag.gripIndex,
      currentGrip,
      drag.x,
      drag.y,
      x,
      y,
    );
    setMovementMessage(clamped);
    setDrag((current) =>
      current
        ? {
            ...current,
            x: clamped.x,
            y: clamped.y,
            pickX: clamped.x + current.pickPlaceOffsetX,
            pickY: clamped.y + current.pickPlaceOffsetY,
          }
        : null,
    );
  };

  const commitPointerDrag = (point: PalletPoint | null) => {
    if (!drag) return;
    const currentGrip = grips[drag.gripIndex];
    setDrag(null);
    if (!point || !currentGrip || currentGrip.id !== drag.gripId) return;
    const pointerX = Math.round(point.x - drag.offsetX);
    const pointerY = Math.round(point.y - drag.offsetY);
    const clamped = clampGripMovement(
      drag.gripIndex,
      currentGrip,
      drag.x,
      drag.y,
      pointerX,
      pointerY,
    );
    const { x, y } = clamped;
    setMovementMessage(clamped);
    if (x === currentGrip.x && y === currentGrip.y) return;
    replaceGrip(drag.gripIndex, {
      ...currentGrip,
      pickX: x + drag.pickPlaceOffsetX,
      pickY: y + drag.pickPlaceOffsetY,
      x,
      y,
    });
  };

  const cancelPointerDrag = () => setDrag(null);

  const setDraftField = (field: LayerEditorDraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const resetDraft = () => setDraft(gripDraft(selectedGrip));

  const commitDraftField = (field: LayerEditorDraftField) => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip) return;
    if (draft[field].trim() === "") {
      setDraft(gripDraft(grip));
      return;
    }
    const value = Number(draft[field]);
    if (!Number.isFinite(value)) {
      setDraft(gripDraft(grip));
      return;
    }

    const rounded = Math.round(value);
    if (
      (field === "rotation" || field === "pickRotation") &&
      !([0, 90, 180, 270] as number[]).includes(rounded)
    ) {
      setMessage("Rotation must be 0°, 90°, 180°, or 270°.");
      setDraft(gripDraft(grip));
      return;
    }

    setMessage(null);
    if (field === "x") {
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickX: grip.pickX + rounded - grip.x,
        x: rounded,
      });
    } else if (field === "y") {
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickY: grip.pickY + rounded - grip.y,
        y: rounded,
      });
    } else if (field === "rotation") {
      const rotationDelta = (rounded - grip.rotation + 360) % 360;
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickRotation: ((grip.pickRotation + rotationDelta) % 360) as Rotation,
        rotation: rounded as Rotation,
      });
    } else if (field === "pickX") {
      replaceGrip(selectedGripIndex, { ...grip, pickX: rounded });
    } else if (field === "pickY") {
      replaceGrip(selectedGripIndex, { ...grip, pickY: rounded });
    } else if (field === "pickRotation") {
      replaceGrip(selectedGripIndex, {
        ...grip,
        pickRotation: rounded as Rotation,
      });
    } else if (field === "dx") {
      replaceGrip(selectedGripIndex, { ...grip, dx: rounded });
    } else {
      replaceGrip(selectedGripIndex, { ...grip, dy: rounded });
    }
  };

  const rotateSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip) return;
    const rotations: Rotation[] = [0, 90, 180, 270];
    const nextIndex = (rotations.indexOf(grip.rotation) + 1) % rotations.length;
    replacePlacedGrip(selectedGripIndex, {
      ...grip,
      pickRotation:
        rotations[
          (rotations.indexOf(grip.pickRotation) + 1) % rotations.length
        ]!,
      rotation: rotations[nextIndex]!,
    });
  };

  const splitSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip || grip.numPackages <= 1) return;
    const split = splitGrip(grip, packageWidth, packageLength, inputDirection);
    const next = [
      ...grips.slice(0, selectedGripIndex),
      ...split,
      ...grips.slice(selectedGripIndex + 1),
    ];
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      return;
    }
    setMergeSelection(
      new Set(split.map((_, index) => selectedGripIndex + index)),
    );
    setMessage(`${split.length} single packages created.`);
    onSelectGrip(selectedGripIndex);
    onCommitGrips(next);
  };

  const mergeSelected = () => {
    const selected = grips.filter((_, index) => mergeSelection.has(index));
    const merged = mergeGrips(
      selected,
      packageWidth,
      packageLength,
      inputDirection,
    );
    if (!merged) {
      setMessage(
        "Packages can only be grouped when they are single, aligned, and their width faces touch.",
      );
      return;
    }

    const placement = insertMergedGripByDeltaDependencies(
      grips,
      mergeSelection,
      merged,
      packageWidth,
      packageLength,
      inputDirection,
    );
    if (!placement) {
      setMessage(
        "These packages cannot be merged because their dx/dy placement dependencies conflict.",
      );
      return;
    }
    const { grips: next, mergedIndex } = placement;
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      return;
    }
    setMergeSelection(new Set([mergedIndex]));
    setMessage(
      `${selected.length} packages merged and aligned; dx/dy placement order preserved.`,
    );
    onSelectGrip(mergedIndex);
    onCommitGrips(next);
  };

  const deleteSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip || !window.confirm("Delete this grip group?")) return;
    const next = grips.filter((_, index) => index !== selectedGripIndex);
    const fallbackIndex =
      next.length > 0 ? Math.min(selectedGripIndex, next.length - 1) : null;
    setMergeSelection(
      fallbackIndex === null ? new Set() : new Set([fallbackIndex]),
    );
    setMessage("Grip group deleted.");
    onSelectGrip(fallbackIndex);
    onCommitGrips(next);
  };

  const addPackage = () => {
    const reference = selectedGrip ?? grips[0] ?? null;
    const pickRotation = reference?.pickRotation ?? 0;
    const referencePickOffset = reference
      ? pickOffsetForCount(
          packageWidth,
          packageLength,
          inputDirection,
          pickRotation,
          reference.numPackages,
        )
      : { x: 0, y: 0 };
    const singlePickOffset = pickOffsetForCount(
      packageWidth,
      packageLength,
      inputDirection,
      pickRotation,
      1,
    );
    const pickOriginX = reference ? reference.pickX - referencePickOffset.x : 0;
    const pickOriginY = reference ? reference.pickY - referencePickOffset.y : 0;
    const baseGrip: Grip = {
      id: createGripId(),
      pickX: pickOriginX + singlePickOffset.x,
      pickY: pickOriginY + singlePickOffset.y,
      pickRotation,
      x: Math.round(palletWidth / 2),
      y: Math.round(palletLength / 2),
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const box = gripsToBoxes(
      [baseGrip],
      packageWidth,
      packageLength,
      0,
      inputDirection,
    )[0];
    if (!box) return;
    const size = footprintSize(box);
    const existingBoxes = gripsToBoxes(
      grips,
      packageWidth,
      packageLength,
      0,
      inputDirection,
    );
    const xCandidates = new Set<number>([
      Math.round(palletWidth / 2),
      toRobInt(size.width / 2),
      toRobInt(palletWidth - size.width / 2),
    ]);
    const yCandidates = new Set<number>([
      Math.round(palletLength / 2),
      toRobInt(size.length / 2),
      toRobInt(palletLength - size.length / 2),
    ]);
    for (const existing of existingBoxes) {
      const existingSize = footprintSize(existing);
      xCandidates.add(
        toRobInt(existing.rect.x - existingSize.width / 2 - size.width / 2),
      );
      xCandidates.add(
        toRobInt(existing.rect.x + existingSize.width / 2 + size.width / 2),
      );
      yCandidates.add(
        toRobInt(existing.rect.y - existingSize.length / 2 - size.length / 2),
      );
      yCandidates.add(
        toRobInt(existing.rect.y + existingSize.length / 2 + size.length / 2),
      );
    }
    const candidates = [...xCandidates]
      .flatMap((x) => [...yCandidates].map((y) => ({ x, y })))
      .filter(
        ({ x, y }) =>
          x >= size.width / 2 &&
          x <= palletWidth - size.width / 2 &&
          y >= size.length / 2 &&
          y <= palletLength - size.length / 2,
      )
      .sort(
        (a, b) =>
          (a.x - palletWidth / 2) ** 2 +
          (a.y - palletLength / 2) ** 2 -
          ((b.x - palletWidth / 2) ** 2 + (b.y - palletLength / 2) ** 2),
      );
    const freePosition = candidates.find(
      ({ x, y }) => !hasCollision([...grips, { ...baseGrip, x, y }]),
    );
    if (!freePosition) {
      setMessage("No non-overlapping position is available on the pallet.");
      return;
    }
    const nextGrip = {
      ...baseGrip,
      x: toRobInt(freePosition.x),
      y: toRobInt(freePosition.y),
    };
    const next = [...grips, nextGrip];
    setMergeSelection(new Set([next.length - 1]));
    setMessage("Package added at the nearest free position.");
    onSelectGrip(next.length - 1);
    onCommitGrips(next);
  };

  return {
    palletWidth,
    palletLength,
    previewGrips,
    selectedGrip,
    mergeSelection,
    groupingMode,
    message,
    draft,
    history: {
      hasUnsavedChanges,
      isSaving,
      onSave,
      onDiscard,
      canUndo,
      canRedo,
      position: historyPosition,
      length: historyLength,
      canResetToOriginal,
      onUndo,
      onRedo,
      onResetToOriginal,
    },
    clearSelection,
    selectGrip,
    toggleGroupingMode,
    moveSelectedGrip,
    beginPointerInteraction,
    updatePointerDrag,
    commitPointerDrag,
    cancelPointerDrag,
    setDraftField,
    commitDraftField,
    resetDraft,
    rotateSelected,
    splitSelected,
    mergeSelected,
    deleteSelected,
    addPackage,
  };
}
