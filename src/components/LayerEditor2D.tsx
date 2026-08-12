"use client";

import type { ReactNode } from "react";
import { GripInspector } from "~/components/layer-editor/GripInspector";
import { LayerCanvas } from "~/components/layer-editor/LayerCanvas";
import type { Grip } from "~/domain/palletTypes";
import { useLayerEditor } from "~/hooks/useLayerEditor";

const BASE_BUTTON_CLASS =
  "min-h-11 cursor-pointer touch-manipulation rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
const NEUTRAL_BUTTON_CLASS = `${BASE_BUTTON_CLASS} border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100`;
const DANGER_BUTTON_CLASS = `${BASE_BUTTON_CLASS} border border-red-500/30 text-red-300 hover:bg-red-500/10`;

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
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
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
              className="min-h-11 cursor-pointer touch-manipulation rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {history.isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={history.onDiscard}
              disabled={!history.hasUnsavedChanges || history.isSaving}
              className={NEUTRAL_BUTTON_CLASS}
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={history.onUndo}
              disabled={!history.canUndo || history.isSaving}
              className={NEUTRAL_BUTTON_CLASS}
            >
              Undo
            </button>
            <button
              type="button"
              onClick={history.onRedo}
              disabled={!history.canRedo || history.isSaving}
              className={NEUTRAL_BUTTON_CLASS}
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
              className={DANGER_BUTTON_CLASS}
            >
              Reset to original
            </button>
          </div>
          <div
            role="group"
            aria-label="Package editing"
            className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end"
          >
            <button
              type="button"
              onClick={editor.addPackage}
              className={NEUTRAL_BUTTON_CLASS}
            >
              Add package
            </button>
            <button
              type="button"
              onClick={editor.splitSelected}
              disabled={
                !editor.selectedGrip || editor.selectedGrip.numPackages <= 1
              }
              className={NEUTRAL_BUTTON_CLASS}
            >
              Split group
            </button>
            <button
              type="button"
              onClick={editor.toggleGroupingMode}
              aria-pressed={editor.groupingMode}
              className={`${BASE_BUTTON_CLASS} border ${
                editor.groupingMode
                  ? "border-amber-300 bg-amber-400 text-zinc-950 hover:bg-amber-300"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              Grouping mode
            </button>
            <button
              type="button"
              onClick={editor.mergeSelected}
              disabled={editor.mergeSelection.size < 2}
              className={NEUTRAL_BUTTON_CLASS}
            >
              Merge group ({editor.mergeSelection.size})
            </button>
            <button
              type="button"
              onClick={editor.clearSelection}
              disabled={
                editor.mergeSelection.size === 0 && !editor.selectedGrip
              }
              className={NEUTRAL_BUTTON_CLASS}
            >
              Clear group
            </button>
            <button
              type="button"
              onClick={editor.deleteSelected}
              disabled={!editor.selectedGrip}
              className={DANGER_BUTTON_CLASS}
            >
              Delete group
            </button>
          </div>
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
          groupingMode={editor.groupingMode}
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
          onNudge={editor.moveSelectedGrip}
        />
      </div>
    </section>
  );
}
