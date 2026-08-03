"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { InterlayerControls } from "~/components/InterlayerControls";
import { LayerSlider } from "~/components/LayerSlider";
import { PalletInfoPanel } from "~/components/PalletInfoPanel";
import { SavedPalletSidebar } from "~/components/SavedPalletSidebar";
import { ViewerToolbar } from "~/components/ViewerToolbar";
import { usePalletLibrary } from "~/hooks/usePalletLibrary";
import { usePlanEditor } from "~/hooks/usePlanEditor";
import {
  applyBaseInterlayerEdit,
  applyInterlayerAfterLayerEdit,
} from "~/lib/robParser";
import type { PlanView } from "~/lib/palletTypes";

const RobViewer = dynamic(
  () => import("~/components/RobViewer").then((module) => module.RobViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-cyan-100/80 sm:min-h-[420px]">
        Loading viewer…
      </div>
    ),
  },
);

const LayerEditor2D = dynamic(
  () =>
    import("~/components/LayerEditor2D").then((module) => module.LayerEditor2D),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[60vh] items-center justify-center rounded border border-cyan-500/15 bg-slate-900/70 text-sm text-cyan-100/80">
        Loading editor…
      </div>
    ),
  },
);

function planDownloadName(name: string, view: PlanView): string {
  const stem = name.toLowerCase().endsWith(".rob") ? name.slice(0, -4) : name;
  return view === "original" ? `${stem}.rob` : `${stem}.edited.rob`;
}

function rotateRobPlanBy180(rawText: string): string {
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r?\n/);
  const coordinatePattern = /^(\s*-?\d+(?:\s+-?\d+){4}\s+)(-?\d+)(.*)$/;
  return lines
    .map((line) => {
      if (!coordinatePattern.test(line)) return line;
      return line.replace(
        coordinatePattern,
        (_full, prefix: string, rotationRaw: string, suffix: string) => {
          const rotation = Number.parseInt(rotationRaw, 10);
          if (!Number.isFinite(rotation)) return line;
          return `${prefix}${(((rotation + 180) % 360) + 360) % 360}${suffix}`;
        },
      );
    })
    .join(newline);
}

function triggerDownload(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function HomePage() {
  const [visibleUpToLayer, setVisibleUpToLayer] = useState(1);
  const library = usePalletLibrary();
  const editor = usePlanEditor({
    selectedEntry: library.selectedEntry,
    visibleUpToLayer,
    savePallet: library.savePallet,
    setError: library.setError,
  });

  const {
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
  } = editor;
  const layerCount = viewedData?.layer_count ?? 0;

  useEffect(() => {
    if (layerCount > 0) setVisibleUpToLayer(layerCount);
  }, [layerCount, planView, library.selectedId]);

  const requestFileImport = useCallback(() => {
    if (
      hasUnsavedEdits &&
      !window.confirm("Import another plan and discard unsaved changes?")
    ) {
      return;
    }
    library.fileInputRef.current?.click();
  }, [hasUnsavedEdits, library.fileInputRef]);

  const onModifyPlan = useCallback(() => {
    library.setError(null);
    if (!viewedData) {
      library.setError("Load a plan before modifying it.");
      return;
    }
    if (!viewedRawText) {
      library.setError(
        "Cannot modify the currently viewed plan because its .rob text is unavailable.",
      );
      return;
    }
    try {
      triggerDownload(
        planDownloadName(library.selectedEntry?.name ?? "pallet.rob", planView),
        rotateRobPlanBy180(viewedRawText),
      );
    } catch (cause) {
      console.error("Failed to modify plan", cause);
      library.setError("Unable to modify the plan at this time.");
    }
  }, [library, planView, viewedData, viewedRawText]);

  const onDownloadCurrent = useCallback(() => {
    library.setError(null);
    if (!viewedRawText) {
      library.setError(
        "Cannot download the currently viewed plan because its .rob text is unavailable.",
      );
      return;
    }
    try {
      triggerDownload(
        planDownloadName(library.selectedEntry?.name ?? "pallet.rob", planView),
        viewedRawText,
      );
    } catch (cause) {
      console.error("Failed to download current plan", cause);
      library.setError(
        "Unable to download the currently viewed plan at this time.",
      );
    }
  }, [library, planView, viewedRawText]);

  return (
    <main className="flex min-h-screen flex-col items-stretch bg-gradient-to-b from-[#07152f] via-[#040d1d] to-[#010409] text-slate-100">
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-4 py-8">
        <ViewerToolbar
          fileInputRef={library.fileInputRef}
          onFileChange={library.onFileChange}
          requestFileImport={requestFileImport}
          originalRawText={originalRawText}
          selectedRawText={selectedRawText}
          planView={planView}
          selectPlanView={editor.selectPlanView}
          hasUnsavedEdits={hasUnsavedEdits}
          onDownloadCurrent={onDownloadCurrent}
          onModifyPlan={onModifyPlan}
          toggleEditMode={editor.toggleEditMode}
          hasData={data !== null}
          editMode={editMode}
          downloadDisabled={!viewedRawText}
          modifyDisabled={!viewedData || !viewedRawText}
        />
        {library.error && (
          <div className="rounded border border-red-400 bg-red-500/20 p-3 text-sm text-red-100">
            {library.error}
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
        {viewedData && viewedData.total_boxes > 0 && !editMode && (
          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,280px)] xl:items-start xl:gap-8">
            <SavedPalletSidebar
              saved={library.saved}
              selectedId={library.selectedId}
              hasUnsavedEdits={hasUnsavedEdits}
              onSelect={(pallet) => library.selectPallet(pallet.id)}
              onDelete={library.deletePallet}
              onClear={library.clearLibrary}
            />
            <div className="order-1 flex min-w-0 flex-1 items-stretch gap-1 xl:order-2">
              <div className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden rounded border border-cyan-500/15 bg-slate-950/70 shadow-inner shadow-cyan-500/10 sm:min-h-[420px] xl:h-[70vh]">
                <RobViewer
                  data={viewedData}
                  visibleUpToLayer={visibleUpToLayer}
                  onBoxSelect={(selection) => {
                    editor.setBoxSelection(selection);
                    if (selection) {
                      setVisibleUpToLayer(selection.layerIndex + 1);
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
            <PalletInfoPanel data={viewedData} boxSelection={boxSelection} />
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
            onSelectGrip={editor.setSelectedGripIndex}
            onCommitGrips={editor.commitGripEdit}
            hasUnsavedChanges={hasUnsavedEdits}
            isSaving={isSavingEdits}
            onSave={() => void editor.saveEditedPlan()}
            onDiscard={editor.discardEditedPlan}
            canUndo={editHistory.index > 0}
            canRedo={editHistory.index < editHistory.entries.length - 1}
            historyPosition={editHistory.index + 1}
            historyLength={editHistory.entries.length}
            canResetToOriginal={
              originalRawText !== null && selectedRawText !== originalRawText
            }
            onUndo={editor.undoEdit}
            onRedo={editor.redoEdit}
            onResetToOriginal={editor.resetToOriginal}
            interlayerEditor={
              <InterlayerControls
                layers={data.layers}
                trailingZwischenlage={data.trailingZwischenlage ?? 0}
                onBaseChange={(zwischenlage) =>
                  editor.commitInterlayerEdit((current) =>
                    applyBaseInterlayerEdit(current, zwischenlage),
                  )
                }
                onLayerChange={(layerIndex, zwischenlage) =>
                  editor.commitInterlayerEdit((current) =>
                    applyInterlayerAfterLayerEdit(
                      current,
                      layerIndex,
                      zwischenlage,
                    ),
                  )
                }
              />
            }
            layerSelector={
              <label className="flex min-w-[250px] flex-col gap-1 text-xs text-slate-400">
                <span>Layer pattern</span>
                <select
                  value={selectedUniqueLayerId}
                  onChange={(event) => {
                    editor.setSelectedUniqueLayerId(Number(event.target.value));
                    editor.setSelectedGripIndex(null);
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
