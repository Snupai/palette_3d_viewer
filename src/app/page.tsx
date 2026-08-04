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
} from "~/domain/palletEdits";
import type { PlanView } from "~/lib/palletTypes";
import { rotateRobPlanBy180 } from "~/lib/planTransforms";

const RobViewer = dynamic(
  () => import("~/components/RobViewer").then((module) => module.RobViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-zinc-500 sm:min-h-[420px]">
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
      <div className="flex min-h-[60vh] items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-sm text-zinc-500">
        Loading editor…
      </div>
    ),
  },
);

function planDownloadName(name: string, view: PlanView): string {
  const stem = name.toLowerCase().endsWith(".rob") ? name.slice(0, -4) : name;
  return view === "original" ? `${stem}.rob` : `${stem}.edited.rob`;
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
    <main className="flex min-h-screen flex-col items-stretch bg-zinc-950 text-zinc-200">
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-4 px-4 py-4">
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
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm whitespace-pre-line text-red-200"
          >
            {library.error}
          </div>
        )}
        {!viewedData && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/40">
            <p className="text-center text-zinc-400">
              Upload a .rob file to visualize the pallet
            </p>
          </div>
        )}
        {viewedData && viewedData.total_boxes === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Parsed 0 boxes. The .rob format may differ from the expected
            structure.
          </div>
        )}
        {viewedData && viewedData.total_boxes > 0 && !editMode && (
          <div className="flex flex-col gap-4 md:flex-row md:flex-wrap xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,280px)] xl:items-start xl:gap-6">
            <SavedPalletSidebar
              saved={library.saved}
              selectedId={library.selectedId}
              hasUnsavedEdits={hasUnsavedEdits}
              onSelect={(pallet) => library.selectPallet(pallet.id)}
              onDelete={library.deletePallet}
              onClear={library.clearLibrary}
            />
            <div className="order-1 flex min-w-0 flex-1 items-stretch gap-1 md:basis-full xl:order-2 xl:basis-auto">
              <div className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden rounded-md border border-zinc-800 bg-[#101013] sm:min-h-[420px] md:min-h-[55vh] xl:h-[70vh]">
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
              <label className="flex min-w-[250px] flex-col gap-1 text-xs text-zinc-500">
                <span>Layer pattern</span>
                <select
                  value={selectedUniqueLayerId}
                  onChange={(event) => {
                    const nextUniqueLayerId = Number(event.target.value);
                    const nextGripCount =
                      data.uniqueLayers[nextUniqueLayerId]?.length ?? 0;
                    editor.setSelectedUniqueLayerId(nextUniqueLayerId);
                    editor.setSelectedGripIndex((current) =>
                      nextGripCount === 0
                        ? null
                        : Math.min(current ?? 0, nextGripCount - 1),
                    );
                  }}
                  className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 focus:ring-0"
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
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              This plan has no editable unique layer pattern.
            </div>
          )}
      </div>
    </main>
  );
}
