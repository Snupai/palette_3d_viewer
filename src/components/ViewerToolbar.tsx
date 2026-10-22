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
      <h1 className="text-center text-lg font-semibold text-ink sm:text-left">
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
          className="ui-btn col-span-2 w-full text-sm font-medium sm:w-auto"
        >
          Import .rob file(s)
        </button>
        <div
          role="group"
          aria-label="Plan view"
          className="grid w-full grid-cols-2 border border-line bg-canvas p-0.5 sm:w-auto"
        >
          <button
            type="button"
            onClick={() => selectPlanView("original")}
            disabled={!originalRawText}
            aria-pressed={planView === "original"}
            className={`px-3 py-1.5 text-sm font-medium transition ${
              !originalRawText
                ? "cursor-not-allowed text-muted opacity-50"
                : planView === "original"
                  ? "bg-surface-hover text-ink"
                  : "text-muted hover:text-ink"
            }`}
          >
            Original
          </button>
          <button
            type="button"
            onClick={() => selectPlanView("edited")}
            disabled={!selectedRawText}
            aria-pressed={planView === "edited"}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium transition ${
              !selectedRawText
                ? "cursor-not-allowed text-muted opacity-50"
                : planView === "edited"
                  ? "bg-surface-hover text-ink"
                  : "text-muted hover:text-ink"
            }`}
          >
            Edited
            {hasUnsavedEdits ? (
              <span
                className="h-2 w-2 bg-caution"
                aria-label="Unsaved changes"
              />
            ) : null}
          </button>
        </div>
        <button
          type="button"
          onClick={onDownloadCurrent}
          disabled={downloadDisabled}
          className="ui-btn w-full text-sm font-medium sm:w-auto"
        >
          Download current plan
        </button>
        <button
          type="button"
          onClick={onModifyPlan}
          disabled={modifyDisabled}
          className="ui-btn w-full text-sm font-medium sm:w-auto"
        >
          Modify plan (rotate 180°)
        </button>
        <button
          type="button"
          onClick={toggleEditMode}
          disabled={!hasData}
          aria-pressed={editMode}
          className={`${
            editMode && hasData ? "ui-btn-primary" : "ui-btn"
          } w-full text-sm font-medium sm:w-auto`}
        >
          {editMode ? "Exit edit mode" : "Edit mode"}
        </button>
      </div>
    </div>
  );
}
