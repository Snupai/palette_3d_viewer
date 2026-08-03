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
    <section className="flex min-h-[calc(100dvh-10rem)] flex-col rounded border border-cyan-500/15 bg-slate-900/70 p-4 shadow-lg shadow-cyan-500/10 backdrop-blur">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-cyan-200">
            Unique Layer {uniqueLayerId} Editor
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Dragging moves pick and place together. Shift-click packages to
            build a merge selection. Focus the canvas to select and move grips
            with the keyboard.
          </p>
          <div
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400"
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
                history.hasUnsavedChanges
                  ? "text-amber-200"
                  : "text-emerald-200"
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
              className="cursor-pointer rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {history.isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={history.onDiscard}
              disabled={!history.hasUnsavedChanges || history.isSaving}
              className="cursor-pointer rounded border border-amber-400/30 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={history.onUndo}
              disabled={!history.canUndo || history.isSaving}
              className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={history.onRedo}
              disabled={!history.canRedo || history.isSaving}
              className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Redo
            </button>
            <span
              className="self-center rounded bg-slate-950/50 px-2 py-1 font-mono text-[11px] text-slate-400"
              role="status"
            >
              History {history.position}/{history.length}
            </span>
            <button
              type="button"
              onClick={history.onResetToOriginal}
              disabled={!history.canResetToOriginal || history.isSaving}
              className="cursor-pointer rounded border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset to original
            </button>
          </div>
          <button
            type="button"
            onClick={editor.addPackage}
            className="cursor-pointer rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Add package
          </button>
          <button
            type="button"
            onClick={editor.splitSelected}
            disabled={
              !editor.selectedGrip || editor.selectedGrip.numPackages <= 1
            }
            className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Split into singles
          </button>
          <button
            type="button"
            onClick={editor.mergeSelected}
            disabled={editor.mergeSelection.size < 2}
            className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Merge selected ({editor.mergeSelection.size})
          </button>
          <button
            type="button"
            onClick={editor.deleteSelected}
            disabled={!editor.selectedGrip}
            className="cursor-pointer rounded border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete group
          </button>
        </div>
      </div>

      {interlayerEditor}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
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
