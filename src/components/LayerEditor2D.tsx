"use client";

import type { ReactNode } from "react";
import { GripInspector } from "~/components/layer-editor/GripInspector";
import { LayerCanvas } from "~/components/layer-editor/LayerCanvas";
import type { Grip } from "~/domain/palletTypes";
import { useLayerEditor } from "~/hooks/useLayerEditor";

export type LayerEditor2DProps = {
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
  layerSelector?: ReactNode;
  interlayerEditor?: ReactNode;
};

export function LayerEditor2D({
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
  layerSelector,
  interlayerEditor,
}: LayerEditor2DProps) {
  const editor = useLayerEditor({
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
  });
  const { history } = editor;

  return (
    <section className="flex min-h-[calc(100dvh-7rem)] flex-col rounded-md border border-zinc-800 bg-zinc-900 p-3">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-zinc-100">
            Unique Layer {uniqueLayerId} Editor
          </h2>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500"
            aria-label="Delta marker legend"
          >
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1 w-5 rounded-full bg-sky-400"
                aria-hidden="true"
              />
              Cyan edge/corner = side selected by dx/dy
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg
                viewBox="0 0 24 8"
                className="h-2 w-6 text-amber-400"
                aria-hidden="true"
              >
                <circle cx="3" cy="4" r="2" fill="currentColor" />
                <path
                  d="M 5 4 H 19 M 16 1 L 20 4 L 16 7"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
              Yellow arrow = dx/dy direction from grip center
            </span>
          </div>
        </div>
        {layerSelector}
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-xs ${
                history.hasUnsavedChanges ? "text-amber-300" : "text-zinc-500"
              }`}
              role="status"
            >
              {history.hasUnsavedChanges
                ? "Unsaved changes"
                : "All changes saved"}
            </span>
            <button
              type="button"
              onClick={history.onSave}
              disabled={!history.hasUnsavedChanges || history.isSaving}
              className="cursor-pointer rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {history.isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={history.onDiscard}
              disabled={!history.hasUnsavedChanges || history.isSaving}
              className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={history.onUndo}
              disabled={!history.canUndo || history.isSaving}
              className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={history.onRedo}
              disabled={!history.canRedo || history.isSaving}
              className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Redo
            </button>
            <span
              className="self-center rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-500"
              role="status"
            >
              History {history.position}/{history.length}
            </span>
            <button
              type="button"
              onClick={history.onResetToOriginal}
              disabled={!history.canResetToOriginal || history.isSaving}
              className="cursor-pointer rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset to original
            </button>
          </div>
          <button
            type="button"
            onClick={editor.addPackage}
            className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            Add package
          </button>
          <button
            type="button"
            onClick={editor.splitSelected}
            disabled={
              !editor.selectedGrip || editor.selectedGrip.numPackages <= 1
            }
            className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Split into singles
          </button>
          <button
            type="button"
            onClick={editor.mergeSelected}
            disabled={editor.mergeSelection.size < 2}
            className="cursor-pointer rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Merge selected ({editor.mergeSelection.size})
          </button>
          <button
            type="button"
            onClick={editor.deleteSelected}
            disabled={!editor.selectedGrip}
            className="cursor-pointer rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete group
          </button>
        </div>
      </div>

      {interlayerEditor}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <LayerCanvas
          uniqueLayerId={uniqueLayerId}
          grips={editor.previewGrips}
          packageWidth={packageWidth}
          packageLength={packageLength}
          inputDirection={inputDirection}
          palletWidth={editor.palletWidth}
          palletLength={editor.palletLength}
          selectedGripIndex={selectedGripIndex}
          mergeSelection={editor.mergeSelection}
          onClearSelection={editor.clearSelection}
          onGripKeyboardSelect={editor.selectGrip}
          onSelectedGripMove={editor.moveSelectedGrip}
          onGripPointerStart={editor.beginPointerInteraction}
          onGripPointerMove={editor.updatePointerDrag}
          onGripPointerEnd={editor.commitPointerDrag}
          onGripPointerCancel={editor.cancelPointerDrag}
        />
        <GripInspector
          selectedGripIndex={selectedGripIndex}
          gripCount={grips.length}
          selectedGrip={editor.selectedGrip}
          draft={editor.draft}
          message={editor.message}
          onDraftChange={editor.setDraftField}
          onDraftCommit={editor.commitDraftField}
          onDraftReset={editor.resetDraft}
          onRotate={editor.rotateSelected}
        />
      </div>
    </section>
  );
}
