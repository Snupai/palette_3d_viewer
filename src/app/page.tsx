"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayerEditor2D } from "~/components/LayerEditor2D";
import { LayerSlider } from "~/components/LayerSlider";
import { RobViewer, type BoxSelection } from "~/components/RobViewer";
import {
  applyGripEdit,
  parseRobText,
  serializeRobText,
  type Grip,
} from "~/lib/robParser";
import {
  clearPallets,
  deletePalletById,
  getAllPallets,
  putPallets,
} from "~/lib/storage";

/** Re-parse from raw .rob when present so newer fields (place coords) are available. */
function resolvePalletData(entry: {
  data: ReturnType<typeof parseRobText>;
  rawText?: string;
}) {
  if (entry.rawText) {
    try {
      return parseRobText(entry.rawText);
    } catch {
      return entry.data;
    }
  }
  try {
    return parseRobText(serializeRobText(entry.data));
  } catch {
    return entry.data;
  }
}

type SavedPallet = {
  id: string;
  name: string;
  createdAt: number;
  data: ReturnType<typeof parseRobText>;
  rawText?: string;
  originalRawText?: string;
};

type PlanView = "original" | "edited";

type EditHistory = {
  entries: string[];
  index: number;
};

const STORAGE_KEY = "saved_pallets_v1";
const MAX_EDIT_HISTORY = 100;

function createEditHistory(rawText: string | null): EditHistory {
  return rawText === null
    ? { entries: [], index: -1 }
    : { entries: [rawText], index: 0 };
}

function planDownloadName(name: string, view: PlanView): string {
  const stem = name.toLowerCase().endsWith(".rob") ? name.slice(0, -4) : name;
  return view === "original" ? `${stem}.rob` : `${stem}.edited.rob`;
}

function rotateRobPlanBy180(rawText: string): string {
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r?\n/);
  const coordinatePattern = /^(\s*-?\d+(?:\s+-?\d+){4}\s+)(-?\d+)(.*)$/;
  const rotated = lines.map((line) => {
    if (!coordinatePattern.test(line)) return line;
    return line.replace(
      coordinatePattern,
      (_full, prefix: string, rotationRaw: string, suffix: string) => {
        const rotation = Number.parseInt(rotationRaw, 10);
        if (!Number.isFinite(rotation)) return line;
        const rotatedValue = (((rotation + 180) % 360) + 360) % 360;
        return `${prefix}${rotatedValue}${suffix}`;
      },
    );
  });
  return rotated.join(newline);
}

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReturnType<typeof parseRobText> | null>(
    null,
  );
  const [saved, setSaved] = useState<SavedPallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterL, setFilterL] = useState("");
  const [filterW, setFilterW] = useState("");
  const [filterH, setFilterH] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRawText, setSelectedRawText] = useState<string | null>(null);
  const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
  /** 1-based from bottom: show layers 1..N solid; above hidden. */
  const [visibleUpToLayer, setVisibleUpToLayer] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [planView, setPlanView] = useState<PlanView>("edited");
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [selectedUniqueLayerId, setSelectedUniqueLayerId] = useState<
    number | null
  >(null);
  const [selectedGripIndex, setSelectedGripIndex] = useState<number | null>(
    null,
  );
  const [editHistory, setEditHistory] = useState<EditHistory>(() =>
    createEditHistory(null),
  );

  const resetEditHistory = useCallback((rawText: string | null) => {
    setEditHistory(createEditHistory(rawText));
  }, []);

  // Load saved pallets on mount, migrating from localStorage if present
  useEffect(() => {
    void (async () => {
      try {
        const existing = await getAllPallets<ReturnType<typeof parseRobText>>();
        if (existing.length > 0) {
          setSaved(existing);
          setSelectedId(existing[0]!.id);
          setData(resolvePalletData(existing[0]!));
          setSelectedRawText(existing[0]!.rawText ?? null);
          resetEditHistory(existing[0]!.rawText ?? null);
          setBoxSelection(null);
          setSelectedGripIndex(null);
          return;
        }
        // Migrate from localStorage once
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedPallet[];
          if (parsed.length > 0) {
            await putPallets(parsed);
            localStorage.removeItem(STORAGE_KEY);
            const migrated =
              await getAllPallets<ReturnType<typeof parseRobText>>();
            setSaved(migrated);
            setSelectedId(migrated[0]!.id);
            setData(resolvePalletData(migrated[0]!));
            setSelectedRawText(migrated[0]!.rawText ?? null);
            resetEditHistory(migrated[0]!.rawText ?? null);
            setBoxSelection(null);
            setSelectedGripIndex(null);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [resetEditHistory]);

  //

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const fileList = e.target.files ? Array.from(e.target.files) : [];
      if (fileList.length === 0) return;
      const newEntries: SavedPallet[] = [];
      const failed: string[] = [];
      for (const file of fileList) {
        try {
          const text = await file.text();
          const parsed = parseRobText(text);
          if (process.env.NODE_ENV !== "production") {
            console.log(
              ".rob file selected:",
              file.name,
              `(${text.length} chars)`,
            );
            console.log("Parsed pallet:", {
              layers: parsed.layer_count,
              total_boxes: parsed.total_boxes,
              first_layer_boxes: parsed.layers[0]?.boxes.length ?? 0,
              sample_box: parsed.layers[0]?.boxes[0] ?? null,
            });
          }
          const entry: SavedPallet = {
            id:
              (globalThis.crypto?.randomUUID?.() as string | undefined) ??
              `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name ?? `Pallet ${new Date().toLocaleString()}`,
            createdAt: Date.now(),
            data: parsed,
            rawText: text,
            originalRawText: text,
          };
          newEntries.push(entry);
        } catch {
          failed.push(file.name);
        }
      }
      if (newEntries.length > 0) {
        await putPallets<ReturnType<typeof parseRobText>>(newEntries);
        const next = await getAllPallets<ReturnType<typeof parseRobText>>();
        setSaved(next);
        const last = newEntries[newEntries.length - 1]!;
        setSelectedId(last.id);
        setData(resolvePalletData(last));
        setSelectedRawText(last.rawText ?? null);
        resetEditHistory(last.rawText ?? null);
        setBoxSelection(null);
        setSelectedGripIndex(null);
      }
      if (failed.length > 0) {
        setError(`Failed to parse: ${failed.join(", ")}`);
      }
    },
    [resetEditHistory],
  );

  //

  const selectedEntry = useMemo(
    () => saved.find((p) => p.id === selectedId) ?? null,
    [saved, selectedId],
  );
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
  const layerCount = viewedData?.layer_count ?? 0;
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

  // Reset layer slider to show all layers when pallet data changes
  useEffect(() => {
    if (layerCount > 0) setVisibleUpToLayer(layerCount);
  }, [layerCount, planView, selectedId]);

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

  const applyEditedRawText = useCallback((newRawText: string): boolean => {
    try {
      const parsed = parseRobText(newRawText);
      setError(null);
      setData(parsed);
      setSelectedRawText(newRawText);
      return true;
    } catch (error) {
      console.error("Failed to apply edited pallet draft", error);
      setError("Unable to apply this edit to the .rob plan.");
      return false;
    }
  }, []);

  const commitEditedRawText = useCallback(
    (newRawText: string) => {
      if (!applyEditedRawText(newRawText)) return;
      setEditHistory((current) => {
        if (current.entries[current.index] === newRawText) return current;
        const nextEntries = [
          ...current.entries.slice(0, current.index + 1),
          newRawText,
        ];
        const limitedEntries = nextEntries.slice(-MAX_EDIT_HISTORY);
        return {
          entries: limitedEntries,
          index: limitedEntries.length - 1,
        };
      });
    },
    [applyEditedRawText],
  );

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

    const updated: SavedPallet = {
      ...selectedEntry,
      data,
      rawText: selectedRawText,
      originalRawText:
        selectedEntry.originalRawText ??
        selectedEntry.rawText ??
        selectedRawText,
    };

    setIsSavingEdits(true);
    setError(null);
    try {
      await putPallets([updated]);
      setSaved((previous) =>
        previous.map((pallet) => (pallet.id === updated.id ? updated : pallet)),
      );
    } catch (error) {
      console.error("Failed to save edited pallet", error);
      setError("Unable to save changes. The current edits remain unsaved.");
    } finally {
      setIsSavingEdits(false);
    }
  }, [data, hasUnsavedEdits, isSavingEdits, selectedEntry, selectedRawText]);

  const restorePersistedPlan = useCallback(() => {
    if (!selectedEntry) return;
    setData(resolvePalletData(selectedEntry));
    setSelectedRawText(selectedEntry.rawText ?? null);
    resetEditHistory(selectedEntry.rawText ?? null);
    setBoxSelection(null);
    setSelectedGripIndex(null);
    setError(null);
  }, [resetEditHistory, selectedEntry]);

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
    (nextIndex: number) => {
      const rawText = editHistory.entries[nextIndex];
      if (rawText === undefined || !applyEditedRawText(rawText)) return;
      setEditHistory((current) => ({ ...current, index: nextIndex }));
      setBoxSelection(null);
      setSelectedGripIndex(null);
    },
    [applyEditedRawText, editHistory.entries],
  );

  const undoEdit = useCallback(() => {
    if (editHistory.index <= 0) return;
    applyHistoryIndex(editHistory.index - 1);
  }, [applyHistoryIndex, editHistory.index]);

  const redoEdit = useCallback(() => {
    if (editHistory.index >= editHistory.entries.length - 1) return;
    applyHistoryIndex(editHistory.index + 1);
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
    if (editMode && hasUnsavedEdits) {
      const discard = window.confirm(
        "Exit edit mode and discard all unsaved changes?",
      );
      if (!discard) return;
      restorePersistedPlan();
    }
    setEditMode(false);
  }, [editMode, hasUnsavedEdits, restorePersistedPlan]);

  const requestFileImport = useCallback(() => {
    if (
      hasUnsavedEdits &&
      !window.confirm("Import another plan and discard unsaved changes?")
    ) {
      return;
    }
    fileInputRef.current?.click();
  }, [hasUnsavedEdits]);

  const commitGripEdit = useCallback(
    (nextGrips: Grip[]) => {
      if (!data || selectedUniqueLayerId === null) return;
      const edited = applyGripEdit(data, selectedUniqueLayerId, nextGrips);
      const newline =
        selectedRawText?.includes("\r\n") === true ? "\r\n" : "\n";
      commitEditedRawText(serializeRobText(edited, { newline }));
    },
    [commitEditedRawText, data, selectedRawText, selectedUniqueLayerId],
  );

  const triggerDownload = useCallback((filename: string, contents: string) => {
    const blob = new Blob([contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const onModifyPlan = useCallback(() => {
    setError(null);
    if (!viewedData) {
      setError("Load a plan before modifying it.");
      return;
    }
    if (!viewedRawText) {
      setError(
        "Cannot modify the currently viewed plan because its .rob text is unavailable.",
      );
      return;
    }
    try {
      const rotatedRaw = rotateRobPlanBy180(viewedRawText);
      const baseName = selectedEntry?.name ?? "pallet.rob";
      const downloadName = planDownloadName(baseName, planView);
      triggerDownload(downloadName, rotatedRaw);
    } catch (err) {
      console.error("Failed to modify plan", err);
      setError("Unable to modify the plan at this time.");
    }
  }, [planView, selectedEntry, triggerDownload, viewedData, viewedRawText]);

  const onDownloadCurrent = useCallback(() => {
    setError(null);
    if (!viewedRawText) {
      setError(
        "Cannot download the currently viewed plan because its .rob text is unavailable.",
      );
      return;
    }
    try {
      const baseName = selectedEntry?.name ?? "pallet.rob";
      triggerDownload(planDownloadName(baseName, planView), viewedRawText);
    } catch (err) {
      console.error("Failed to download current plan", err);
      setError("Unable to download the currently viewed plan at this time.");
    }
  }, [planView, selectedEntry, triggerDownload, viewedRawText]);

  const header = useMemo(() => {
    const downloadDisabled = !viewedRawText;
    const modifyDisabled = !viewedData || !viewedRawText;
    return (
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-center text-2xl font-bold text-cyan-100 sm:text-left">
          Pallet 3D Viewer (.rob)
        </h1>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <input
            ref={fileInputRef}
            type="file"
            accept=".rob,text/plain"
            multiple
            onChange={onFileChange}
            className="hidden"
          />
          <button
            onClick={requestFileImport}
            className="w-full cursor-pointer rounded bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-cyan-400 sm:w-auto"
          >
            Import .rob file(s)
          </button>
          <div
            role="group"
            aria-label="Plan view"
            className="grid w-full grid-cols-2 rounded border border-cyan-400/30 bg-slate-950/60 p-0.5 sm:w-auto"
          >
            <button
              type="button"
              onClick={() => selectPlanView("original")}
              disabled={!originalRawText}
              aria-pressed={planView === "original"}
              className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                !originalRawText
                  ? "cursor-not-allowed text-slate-600"
                  : planView === "original"
                    ? "cursor-pointer bg-cyan-400 text-slate-950"
                    : "cursor-pointer text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-100"
              }`}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => selectPlanView("edited")}
              disabled={!selectedRawText}
              aria-pressed={planView === "edited"}
              className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold transition ${
                !selectedRawText
                  ? "cursor-not-allowed text-slate-600"
                  : planView === "edited"
                    ? "cursor-pointer bg-cyan-400 text-slate-950"
                    : "cursor-pointer text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-100"
              }`}
            >
              Edited
              {hasUnsavedEdits ? (
                <span
                  className="h-2 w-2 rounded-full bg-amber-300"
                  aria-label="Unsaved changes"
                />
              ) : null}
            </button>
          </div>
          <button
            type="button"
            onClick={onDownloadCurrent}
            disabled={downloadDisabled}
            className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
              downloadDisabled
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "cursor-pointer bg-slate-200 text-slate-900 hover:bg-white"
            }`}
          >
            Download current plan
          </button>
          <button
            type="button"
            onClick={onModifyPlan}
            disabled={modifyDisabled}
            className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
              modifyDisabled
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "cursor-pointer bg-emerald-500 text-slate-900 hover:bg-emerald-400"
            }`}
          >
            Modify plan (rotate 180°)
          </button>
          <button
            type="button"
            onClick={toggleEditMode}
            disabled={!data}
            aria-pressed={editMode}
            className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
              !data
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : editMode
                  ? "cursor-pointer bg-amber-300 text-slate-950 hover:bg-amber-200"
                  : "cursor-pointer border border-cyan-400/40 bg-slate-900 text-cyan-100 hover:bg-cyan-500/10"
            }`}
          >
            {editMode ? "Exit edit mode" : "Edit mode"}
          </button>
        </div>
      </div>
    );
  }, [
    data,
    editMode,
    hasUnsavedEdits,
    onDownloadCurrent,
    onFileChange,
    onModifyPlan,
    originalRawText,
    planView,
    requestFileImport,
    selectPlanView,
    selectedRawText,
    toggleEditMode,
    viewedData,
    viewedRawText,
  ]);

  const filteredSaved = useMemo(() => {
    const l = filterL.trim() === "" ? null : Number(filterL);
    const w = filterW.trim() === "" ? null : Number(filterW);
    const h = filterH.trim() === "" ? null : Number(filterH);
    return saved.filter((p) => {
      const { length, width, height } = p.data.package;
      // Note: UI's L corresponds to stored width, and W corresponds to stored length
      const matchL = l === null || width === l;
      const matchW = w === null || length === w;
      const matchH = h === null || height === h;
      return matchL && matchW && matchH;
    });
  }, [saved, filterL, filterW, filterH]);

  return (
    <main className="flex min-h-screen flex-col items-stretch bg-gradient-to-b from-[#07152f] via-[#040d1d] to-[#010409] text-slate-100">
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-4 py-8">
        {header}
        {error && (
          <div className="rounded border border-red-400 bg-red-500/20 p-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {!viewedData && (
          <div className="flex flex-1 items-center justify-center rounded border border-cyan-500/10 bg-slate-900/50">
            <p className="text-center text-slate-200">
              Upload a .rob file to visualize the pallet
            </p>
          </div>
        )}
        {viewedData && viewedData.total_boxes === 0 && (
          <div className="flex flex-1 items-center justify-center rounded border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            Parsed 0 boxes. The .rob format may differ from the expected
            structure.
          </div>
        )}
        {viewedData && viewedData.total_boxes > 0 && (
          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,280px)] xl:items-start xl:gap-8">
            {/* Left: saved list */}
            <aside className="order-2 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-1 xl:w-[240px] xl:shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-cyan-200">
                  Saved Pallets
                </h2>
                {saved.length > 0 && (
                  <button
                    onClick={async (e) => {
                      const allow =
                        e.ctrlKey || window.confirm("Clear all saved pallets?");
                      if (!allow) return;
                      await clearPallets();
                      setData(null);
                      setSelectedId(null);
                      setSaved([]);
                      setSelectedRawText(null);
                      resetEditHistory(null);
                      setBoxSelection(null);
                      setSelectedUniqueLayerId(null);
                      setSelectedGripIndex(null);
                    }}
                    className="rounded border border-cyan-500/20 bg-transparent px-2 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <input
                  value={filterL}
                  onChange={(e) => setFilterL(e.target.value)}
                  inputMode="numeric"
                  placeholder="L"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
                />
                <input
                  value={filterW}
                  onChange={(e) => setFilterW(e.target.value)}
                  inputMode="numeric"
                  placeholder="W"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
                />
                <input
                  value={filterH}
                  onChange={(e) => setFilterH(e.target.value)}
                  inputMode="numeric"
                  placeholder="H"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
                />
                <button
                  onClick={() => {
                    setFilterL("");
                    setFilterW("");
                    setFilterH("");
                  }}
                  className="col-span-2 rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-200 transition hover:border-cyan-400/40 hover:bg-slate-900/50 sm:col-span-3"
                >
                  Reset Filters
                </button>
              </div>
              <div className="scrollbar-thin flex max-h-[70vh] flex-col gap-1 overflow-auto pr-1">
                {filteredSaved.length === 0 && (
                  <div className="text-slate-400">No saved pallets yet.</div>
                )}
                {filteredSaved.map((p) => (
                  <div
                    key={p.id}
                    className={`group flex items-start justify-between gap-2 rounded border px-3 py-2 transition ${
                      p.id === selectedId
                        ? "border-cyan-400/60 bg-cyan-500/10 shadow-lg shadow-cyan-500/20"
                        : "border-cyan-500/10 bg-slate-900/50 hover:border-cyan-400/40 hover:bg-slate-900/70"
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() => {
                        if (
                          p.id !== selectedId &&
                          hasUnsavedEdits &&
                          !window.confirm(
                            "Switch plans and discard unsaved changes?",
                          )
                        ) {
                          return;
                        }
                        setSelectedId(p.id);
                        setData(resolvePalletData(p));
                        setSelectedRawText(p.rawText ?? null);
                        resetEditHistory(p.rawText ?? null);
                        setBoxSelection(null);
                        setSelectedUniqueLayerId(null);
                        setSelectedGripIndex(null);
                      }}
                    >
                      <span className="truncate text-slate-100">{p.name}</span>
                      <span className="text-xs text-slate-400">
                        {p.data.layer_count} layers x {p.data.total_boxes} boxes
                      </span>
                    </button>
                    <button
                      aria-label="Delete"
                      className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/25"
                      onClick={async (e) => {
                        const allow =
                          e.ctrlKey || window.confirm(`Delete "${p.name}"?`);
                        if (!allow) return;
                        await deletePalletById(p.id);
                        const next =
                          await getAllPallets<
                            ReturnType<typeof parseRobText>
                          >();
                        setSaved(next);
                        if (selectedId === p.id) {
                          if (next[0]) {
                            setSelectedId(next[0].id);
                            setData(resolvePalletData(next[0]));
                            setSelectedRawText(next[0].rawText ?? null);
                            resetEditHistory(next[0].rawText ?? null);
                            setBoxSelection(null);
                            setSelectedUniqueLayerId(null);
                            setSelectedGripIndex(null);
                          } else {
                            setSelectedId(null);
                            setData(null);
                            setSelectedRawText(null);
                            resetEditHistory(null);
                            setBoxSelection(null);
                            setSelectedUniqueLayerId(null);
                            setSelectedGripIndex(null);
                          }
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            {/* Center: viewer with layer rail alongside */}
            <div className="order-1 flex min-w-0 flex-1 items-stretch gap-1 xl:order-2">
              <div className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden rounded border border-cyan-500/15 bg-slate-950/70 shadow-inner shadow-cyan-500/10 sm:min-h-[420px] xl:h-[70vh]">
                <RobViewer
                  data={viewedData}
                  visibleUpToLayer={visibleUpToLayer}
                  onBoxSelect={(selection) => {
                    setBoxSelection(selection);
                    if (selection) {
                      setVisibleUpToLayer(selection.layerIndex + 1);
                      if (editMode) {
                        const uniqueLayerId =
                          viewedData.layers[selection.layerIndex]
                            ?.unique_layer_id;
                        if (uniqueLayerId !== undefined && uniqueLayerId > 0) {
                          setSelectedUniqueLayerId(uniqueLayerId);
                          setSelectedGripIndex(selection.blueNumber - 1);
                        }
                      }
                    }
                  }}
                />
              </div>
              <LayerSlider
                layerCount={viewedData.layer_count}
                value={visibleUpToLayer}
                onChange={setVisibleUpToLayer}
              />
            </div>
            {/* Right: info */}
            <aside className="order-3 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-3 xl:w-[260px] xl:shrink-0">
              <h2 className="mb-3 text-base font-semibold text-cyan-200">
                Pallet Info
              </h2>
              <div className="space-y-2 text-slate-100">
                <div>
                  <span className="text-slate-400">Layers:</span>{" "}
                  {viewedData.layer_count}
                </div>
                <div>
                  <span className="text-slate-400">Total boxes:</span>{" "}
                  {viewedData.total_boxes}
                </div>
                <div className="pt-2 font-medium text-slate-200">
                  Package (LxWxH)
                </div>
                <div>
                  {viewedData.package.width} x {viewedData.package.length} x{" "}
                  {viewedData.package.height}
                </div>
                <div className="pt-2 font-medium text-slate-200">
                  Pallet (LxWxH)
                </div>
                <div>
                  {viewedData.pallet ? (
                    <span>
                      {viewedData.pallet.width} x {viewedData.pallet.length} x{" "}
                      {viewedData.pallet.height}
                    </span>
                  ) : (
                    <span className="text-slate-500">unknown</span>
                  )}
                </div>
              </div>

              <h2 className="mt-5 mb-3 text-base font-semibold text-cyan-200">
                Selected Box
              </h2>
              {boxSelection ? (
                <div className="space-y-2 text-slate-100">
                  <div>
                    <span className="text-slate-400">Place X:</span>{" "}
                    {boxSelection.placeX}
                  </div>
                  <div>
                    <span className="text-slate-400">Place Y:</span>{" "}
                    {boxSelection.placeY}
                  </div>
                  <div>
                    <span className="text-slate-400">Place Z:</span>{" "}
                    {boxSelection.placeZ}
                    <span className="text-slate-500">
                      {" "}
                      (Oberkante, ohne Palette)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Grip packages:</span>{" "}
                    {boxSelection.numPackages}
                    {boxSelection.gripBoxCount !== boxSelection.numPackages
                      ? ` (${boxSelection.gripBoxCount} highlighted)`
                      : null}
                  </div>
                  <div>
                    <span className="text-slate-400">Rotation:</span>{" "}
                    {boxSelection.rotation}°
                  </div>
                  <div>
                    <span className="text-slate-400">Layer (from bottom):</span>{" "}
                    {boxSelection.layerIndex + 1}
                  </div>
                  <div>
                    <span className="text-slate-400">Zwischenlage:</span>{" "}
                    {boxSelection.zwischenlage
                      ? `yes (${boxSelection.zwischenlage})`
                      : "no"}
                  </div>
                  <div>
                    <span className="text-slate-400">Grip #:</span>{" "}
                    {boxSelection.blueNumber}
                  </div>
                  <div className="pt-1 text-xs text-slate-400">
                    Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  Click a box to highlight its grip group and show place
                  coordinates.
                </p>
              )}
            </aside>
          </div>
        )}
        {data && editMode && selectedUniqueLayerId !== null && (
          <LayerEditor2D
            uniqueLayerId={selectedUniqueLayerId}
            grips={data.uniqueLayers[selectedUniqueLayerId] ?? []}
            packageWidth={data.package.width}
            packageLength={data.package.length}
            inputDirection={data.inputDirection}
            pallet={data.pallet}
            selectedGripIndex={selectedGripIndex}
            onSelectGrip={setSelectedGripIndex}
            onCommitGrips={commitGripEdit}
            hasUnsavedChanges={hasUnsavedEdits}
            isSaving={isSavingEdits}
            onSave={() => void saveEditedPlan()}
            onDiscard={discardEditedPlan}
            canUndo={editHistory.index > 0}
            canRedo={editHistory.index < editHistory.entries.length - 1}
            historyPosition={editHistory.index + 1}
            historyLength={editHistory.entries.length}
            canResetToOriginal={
              originalRawText !== null && selectedRawText !== originalRawText
            }
            onUndo={undoEdit}
            onRedo={redoEdit}
            onResetToOriginal={resetToOriginal}
            layerSelector={
              <label className="flex min-w-[250px] flex-col gap-1 text-xs text-slate-400">
                <span>Layer pattern</span>
                <select
                  value={selectedUniqueLayerId}
                  onChange={(event) => {
                    setSelectedUniqueLayerId(Number(event.target.value));
                    setSelectedGripIndex(null);
                  }}
                  className="cursor-pointer rounded border border-cyan-500/20 bg-slate-950/50 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-0"
                >
                  {uniqueLayerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      Unique Layer {option.id} (stacked at layers{" "}
                      {option.layers.join(", ")})
                    </option>
                  ))}
                </select>
              </label>
            }
          />
        )}
        {data &&
          editMode &&
          selectedUniqueLayerId === null &&
          uniqueLayerOptions.length === 0 && (
            <div className="rounded border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
              This plan has no editable unique layer pattern.
            </div>
          )}
      </div>
    </main>
  );
}
