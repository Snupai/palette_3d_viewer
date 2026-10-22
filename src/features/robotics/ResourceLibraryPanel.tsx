import type { ReactNode } from "react";
import {
  buttonClass,
  dangerButtonClass,
  disclosureSummaryClass,
  inputClass,
  sectionClass,
} from "~/features/robotics/roboticsStyles";

/**
 * Advanced engineering: reusable template library plus the draft editor for
 * one equipment kind (gripper or pallet station).
 */
export function ResourceLibraryPanel({
  title,
  libraryAriaLabel,
  libraryPlaceholder,
  libraryOptions,
  libraryId,
  onLibraryIdChange,
  onApplyTemplate,
  onRemoveTemplate,
  createDraftLabel,
  onCreateDraft,
  hasDraft,
  draftIsBuiltIn,
  onCreateEditableCopy,
  onSaveToProject,
  onSaveTemplate,
  builtInNote,
  editor,
  emptyText,
}: {
  title: string;
  libraryAriaLabel: string;
  libraryPlaceholder: string;
  libraryOptions: readonly { id: string; name: string }[];
  libraryId: string;
  onLibraryIdChange: (id: string) => void;
  onApplyTemplate: () => void;
  onRemoveTemplate: () => void;
  createDraftLabel: string;
  onCreateDraft: () => void;
  hasDraft: boolean;
  draftIsBuiltIn: boolean;
  onCreateEditableCopy: () => void;
  onSaveToProject: () => void;
  onSaveTemplate: () => void;
  builtInNote: ReactNode;
  editor: ReactNode;
  emptyText: string;
}) {
  return (
    <details className={sectionClass}>
      <summary className={disclosureSummaryClass}>{title}</summary>
      <div className="border-line grid gap-3 border-t p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <select
            aria-label={libraryAriaLabel}
            value={libraryId}
            onChange={(event) => onLibraryIdChange(event.target.value)}
            className={inputClass}
          >
            <option value="">{libraryPlaceholder}</option>
            {libraryOptions.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!libraryId}
            onClick={onApplyTemplate}
            className={buttonClass}
          >
            Apply
          </button>
          <button
            type="button"
            disabled={!libraryId}
            onClick={onRemoveTemplate}
            className={dangerButtonClass}
          >
            Remove
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onCreateDraft} className={buttonClass}>
            {createDraftLabel}
          </button>
          {draftIsBuiltIn && hasDraft ? (
            <button
              type="button"
              onClick={onCreateEditableCopy}
              className={buttonClass}
            >
              Create editable copy
            </button>
          ) : null}
          <button
            type="button"
            disabled={!hasDraft || draftIsBuiltIn}
            onClick={onSaveToProject}
            className={buttonClass}
          >
            Save to project
          </button>
          <button
            type="button"
            disabled={!hasDraft || draftIsBuiltIn}
            onClick={onSaveTemplate}
            className={buttonClass}
          >
            Save reusable template
          </button>
        </div>
        {draftIsBuiltIn ? (
          <div className="border-caution/40 bg-caution/5 text-muted grid gap-2 border p-3 text-xs leading-5">
            {builtInNote}
          </div>
        ) : hasDraft ? (
          editor
        ) : (
          <p className="text-muted text-xs">{emptyText}</p>
        )}
      </div>
    </details>
  );
}

/** Read-only notice line shared by both built-in Multipack resources. */
export function BuiltInProfileNotice({
  version,
}: {
  version: string | number;
}) {
  return (
    <p className="text-ink">
      Built-in Multipack profile v{version} is read-only. Create an editable
      copy before changing or saving it as a reusable template.
    </p>
  );
}
