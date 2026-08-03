"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { BoxSelection } from "~/components/RobViewer";
import {
  applyGripEdit,
  parseRobText,
  serializeRobText,
  type Grip,
} from "~/lib/robParser";
import type { PalletData, PlanView, SavedPallet } from "~/lib/palletTypes";
import { resolvePalletData } from "~/hooks/usePalletLibrary";

const MAX_EDIT_HISTORY = 100;

type EditHistory = {
  entries: string[];
  index: number;
};

type DraftState = {
  data: PalletData | null;
  selectedRawText: string | null;
  history: EditHistory;
};

type DraftAction =
  | {
      type: "reset";
      data: PalletData | null;
      rawText: string | null;
    }
  | { type: "commit"; data: PalletData; rawText: string }
  | {
      type: "history";
      data: PalletData;
      rawText: string;
      index: number;
    };

function createHistory(rawText: string | null): EditHistory {
  return rawText === null
    ? { entries: [], index: -1 }
    : { entries: [rawText], index: 0 };
}

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "reset":
      return {
        data: action.data,
        selectedRawText: action.rawText,
        history: createHistory(action.rawText),
      };
    case "commit": {
      if (state.history.entries[state.history.index] === action.rawText) {
        return { ...state, data: action.data, selectedRawText: action.rawText };
      }
      const entries = [
        ...state.history.entries.slice(0, state.history.index + 1),
        action.rawText,
      ].slice(-MAX_EDIT_HISTORY);
      return {
        data: action.data,
        selectedRawText: action.rawText,
        history: { entries, index: entries.length - 1 },
      };
    }
    case "history":
      return {
        data: action.data,
        selectedRawText: action.rawText,
        history: { ...state.history, index: action.index },
      };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

type UsePlanEditorOptions = {
  selectedEntry: SavedPallet | null;
  visibleUpToLayer: number;
  savePallet: (entry: SavedPallet) => Promise<boolean>;
  setError: (error: string | null) => void;
};

export function usePlanEditor({
  selectedEntry,
  visibleUpToLayer,
  savePallet,
  setError,
}: UsePlanEditorOptions) {
  const [draft, dispatch] = useReducer(draftReducer, {
    data: null,
    selectedRawText: null,
    history: createHistory(null),
  });
  const [planView, setPlanView] = useState<PlanView>("edited");
  const [editMode, setEditMode] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
  const [selectedUniqueLayerId, setSelectedUniqueLayerId] = useState<
    number | null
  >(null);
  const [selectedGripIndex, setSelectedGripIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    dispatch({
      type: "reset",
      data: selectedEntry ? resolvePalletData(selectedEntry) : null,
      rawText: selectedEntry?.rawText ?? null,
    });
    setBoxSelection(null);
    setSelectedUniqueLayerId(null);
    setSelectedGripIndex(null);
    // A persisted update replaces the selected entry object too. Reset only
    // when the actual plan selection changes so saving keeps editor selection
    // and history intact.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntry?.id]);

  const data = draft.data;
  const selectedRawText = draft.selectedRawText;
  const editHistory = draft.history;
  const persistedRawText = selectedEntry?.rawText ?? null;
  const hasUnsavedEdits =
    selectedEntry !== null && selectedRawText !== persistedRawText;
  const originalRawText =
    selectedEntry?.originalRawText ?? selectedEntry?.rawText ?? selectedRawText;
  const originalData = useMemo(() => {
    if (!selectedEntry) return null;
    if (!originalRawText) return selectedEntry.data;
    try {
      return parseRobText(originalRawText);
    } catch {
      return selectedEntry.data;
    }
  }, [originalRawText, selectedEntry]);
  const viewedRawText =
    planView === "original" ? originalRawText : selectedRawText;
  const viewedData = planView === "original" ? originalData : data;

  const uniqueLayerOptions = useMemo(() => {
    if (!data) return [];
    const stackedAt = new Map<number, number[]>();
    data.layers.forEach((layer, index) => {
      if (layer.unique_layer_id <= 0) return;
      const positions = stackedAt.get(layer.unique_layer_id) ?? [];
      positions.push(index + 1);
      stackedAt.set(layer.unique_layer_id, positions);
    });
    return [...stackedAt.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, layers]) => ({ id, layers }));
  }, [data]);

  useEffect(() => {
    if (!data || !editMode) {
      setSelectedUniqueLayerId(null);
      setSelectedGripIndex(null);
      return;
    }
    const selectableIds = uniqueLayerOptions.map((option) => option.id);
    const visibleUniqueLayerId =
      data.layers[Math.max(0, visibleUpToLayer - 1)]?.unique_layer_id;
    setSelectedUniqueLayerId((current) => {
      if (current !== null && selectableIds.includes(current)) return current;
      if (
        visibleUniqueLayerId !== undefined &&
        selectableIds.includes(visibleUniqueLayerId)
      ) {
        return visibleUniqueLayerId;
      }
      return selectableIds[0] ?? null;
    });
  }, [data, editMode, uniqueLayerOptions, visibleUpToLayer]);

  const commitEditedRawText = useCallback(
    (rawText: string) => {
      try {
        dispatch({ type: "commit", data: parseRobText(rawText), rawText });
        setError(null);
      } catch (cause) {
        console.error("Failed to apply edited pallet draft", cause);
        setError("Unable to apply this edit to the .rob plan.");
      }
    },
    [setError],
  );

  const restorePersistedPlan = useCallback(() => {
    dispatch({
      type: "reset",
      data: selectedEntry ? resolvePalletData(selectedEntry) : null,
      rawText: selectedEntry?.rawText ?? null,
    });
    setBoxSelection(null);
    setSelectedGripIndex(null);
    setError(null);
  }, [selectedEntry, setError]);

  const saveEditedPlan = useCallback(async () => {
    if (
      !selectedEntry ||
      !data ||
      !selectedRawText ||
      !hasUnsavedEdits ||
      isSavingEdits
    ) {
      return;
    }
    setIsSavingEdits(true);
    setError(null);
    const updated: SavedPallet = {
      ...selectedEntry,
      data,
      rawText: selectedRawText,
      originalRawText:
        selectedEntry.originalRawText ??
        selectedEntry.rawText ??
        selectedRawText,
    };
    await savePallet(updated);
    setIsSavingEdits(false);
  }, [
    data,
    hasUnsavedEdits,
    isSavingEdits,
    savePallet,
    selectedEntry,
    selectedRawText,
    setError,
  ]);

  const discardEditedPlan = useCallback(() => {
    if (
      hasUnsavedEdits &&
      !window.confirm("Discard all unsaved changes to this plan?")
    ) {
      return;
    }
    restorePersistedPlan();
  }, [hasUnsavedEdits, restorePersistedPlan]);

  const applyHistoryIndex = useCallback(
    (index: number) => {
      const rawText = editHistory.entries[index];
      if (rawText === undefined) return;
      try {
        dispatch({
          type: "history",
          data: parseRobText(rawText),
          rawText,
          index,
        });
        setError(null);
        setBoxSelection(null);
        setSelectedGripIndex(null);
      } catch (cause) {
        console.error("Failed to restore edit history", cause);
        setError("Unable to apply this edit to the .rob plan.");
      }
    },
    [editHistory.entries, setError],
  );

  const undoEdit = useCallback(() => {
    if (editHistory.index > 0) applyHistoryIndex(editHistory.index - 1);
  }, [applyHistoryIndex, editHistory.index]);

  const redoEdit = useCallback(() => {
    if (editHistory.index < editHistory.entries.length - 1) {
      applyHistoryIndex(editHistory.index + 1);
    }
  }, [applyHistoryIndex, editHistory.entries.length, editHistory.index]);

  const resetToOriginal = useCallback(() => {
    if (!originalRawText || selectedRawText === originalRawText) return;
    commitEditedRawText(originalRawText);
    setPlanView("edited");
    setBoxSelection(null);
    setSelectedGripIndex(null);
  }, [commitEditedRawText, originalRawText, selectedRawText]);

  const selectPlanView = useCallback((nextView: PlanView) => {
    setPlanView(nextView);
    setBoxSelection(null);
    setSelectedGripIndex(null);
    if (nextView === "original") setEditMode(false);
  }, []);

  const toggleEditMode = useCallback(() => {
    if (!editMode) {
      setPlanView("edited");
      setBoxSelection(null);
      setEditMode(true);
      return;
    }
    if (
      hasUnsavedEdits &&
      !window.confirm("Exit edit mode and discard all unsaved changes?")
    ) {
      return;
    }
    if (hasUnsavedEdits) restorePersistedPlan();
    setEditMode(false);
  }, [editMode, hasUnsavedEdits, restorePersistedPlan]);

  const commitGripEdit = useCallback(
    (nextGrips: Grip[]) => {
      if (!data || selectedUniqueLayerId === null) return;
      const edited = applyGripEdit(data, selectedUniqueLayerId, nextGrips);
      const newline = selectedRawText?.includes("\r\n") ? "\r\n" : "\n";
      commitEditedRawText(
        serializeRobText(edited, { newline, separator: "\t" }),
      );
    },
    [commitEditedRawText, data, selectedRawText, selectedUniqueLayerId],
  );

  const commitInterlayerEdit = useCallback(
    (edit: (current: PalletData) => PalletData) => {
      if (!data) return;
      const edited = edit(data);
      if (edited === data) return;
      const newline = selectedRawText?.includes("\r\n") ? "\r\n" : "\n";
      commitEditedRawText(
        serializeRobText(edited, { newline, separator: "\t" }),
      );
    },
    [commitEditedRawText, data, selectedRawText],
  );

  return {
    data,
    selectedRawText,
    planView,
    editMode,
    editHistory,
    isSavingEdits,
    boxSelection,
    selectedUniqueLayerId,
    selectedGripIndex,
    originalRawText,
    viewedRawText,
    viewedData,
    uniqueLayerOptions,
    hasUnsavedEdits,
    setBoxSelection,
    setSelectedUniqueLayerId,
    setSelectedGripIndex,
    saveEditedPlan,
    discardEditedPlan,
    undoEdit,
    redoEdit,
    resetToOriginal,
    selectPlanView,
    toggleEditMode,
    commitGripEdit,
    commitInterlayerEdit,
  };
}
