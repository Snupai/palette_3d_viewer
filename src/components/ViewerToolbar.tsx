"use client";

import type { ChangeEvent, RefObject } from "react";
import type { PlanView } from "~/lib/palletTypes";

type ViewerToolbarProps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  requestFileImport: () => void;
  originalRawText: string | null;
  selectedRawText: string | null;
  planView: PlanView;
  selectPlanView: (view: PlanView) => void;
  hasUnsavedEdits: boolean;
  onDownloadCurrent: () => void;
  onModifyPlan: () => void;
  toggleEditMode: () => void;
  hasData: boolean;
  editMode: boolean;
  downloadDisabled: boolean;
  modifyDisabled: boolean;
};

export function ViewerToolbar({
  fileInputRef,
  onFileChange,
  requestFileImport,
  originalRawText,
  selectedRawText,
  planView,
  selectPlanView,
  hasUnsavedEdits,
  onDownloadCurrent,
  onModifyPlan,
  toggleEditMode,
  hasData,
  editMode,
  downloadDisabled,
  modifyDisabled,
}: ViewerToolbarProps) {
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
          disabled={!hasData}
          aria-pressed={editMode}
          className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
            !hasData
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
}
