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
      <h1 className="text-center text-lg font-semibold text-zinc-100 sm:text-left">
        Pallet 3D Viewer (.rob)
      </h1>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
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
          className="col-span-2 w-full cursor-pointer rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white sm:w-auto"
        >
          Import .rob file(s)
        </button>
        <div
          role="group"
          aria-label="Plan view"
          className="grid w-full grid-cols-2 rounded-md border border-zinc-800 bg-zinc-950 p-0.5 sm:w-auto"
        >
          <button
            type="button"
            onClick={() => selectPlanView("original")}
            disabled={!originalRawText}
            aria-pressed={planView === "original"}
            className={`rounded px-3 py-1.5 text-sm font-medium transition ${
              !originalRawText
                ? "cursor-not-allowed text-zinc-600"
                : planView === "original"
                  ? "cursor-pointer bg-zinc-800 text-zinc-100"
                  : "cursor-pointer text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Original
          </button>
          <button
            type="button"
            onClick={() => selectPlanView("edited")}
            disabled={!selectedRawText}
            aria-pressed={planView === "edited"}
            className={`flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition ${
              !selectedRawText
                ? "cursor-not-allowed text-zinc-600"
                : planView === "edited"
                  ? "cursor-pointer bg-zinc-800 text-zinc-100"
                  : "cursor-pointer text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Edited
            {hasUnsavedEdits ? (
              <span
                className="h-2 w-2 rounded-full bg-amber-400"
                aria-label="Unsaved changes"
              />
            ) : null}
          </button>
        </div>
        <button
          type="button"
          onClick={onDownloadCurrent}
          disabled={downloadDisabled}
          className={`w-full rounded-md border px-4 py-2 text-sm font-medium transition sm:w-auto ${
            downloadDisabled
              ? "cursor-not-allowed border-zinc-800 text-zinc-600"
              : "cursor-pointer border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          Download current plan
        </button>
        <button
          type="button"
          onClick={onModifyPlan}
          disabled={modifyDisabled}
          className={`w-full rounded-md border px-4 py-2 text-sm font-medium transition sm:w-auto ${
            modifyDisabled
              ? "cursor-not-allowed border-zinc-800 text-zinc-600"
              : "cursor-pointer border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          Modify plan (rotate 180°)
        </button>
        <button
          type="button"
          onClick={toggleEditMode}
          disabled={!hasData}
          aria-pressed={editMode}
          className={`w-full rounded-md px-4 py-2 text-sm font-medium transition sm:w-auto ${
            !hasData
              ? "cursor-not-allowed border border-zinc-800 text-zinc-600"
              : editMode
                ? "cursor-pointer bg-amber-400 text-zinc-950 hover:bg-amber-300"
                : "cursor-pointer border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          {editMode ? "Exit edit mode" : "Edit mode"}
        </button>
      </div>
    </div>
  );
}
