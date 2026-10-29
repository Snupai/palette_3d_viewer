import type { ReactNode } from "react";
import { useT } from "~/i18n";

/**
 * Technik: reusable template library plus the draft editor for one equipment
 * kind (gripper or pallet station).
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
  const t = useT();
  return (
    <details className="ed-sub-details">
      <summary>{title}</summary>
      <div>
        <div className="ed-actions">
          <select
            aria-label={libraryAriaLabel}
            value={libraryId}
            onChange={(event) => onLibraryIdChange(event.target.value)}
            className="ui-input"
            style={{ flex: "1 1 220px" }}
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
            className="ui-btn ui-btn-sm"
          >
            {t("robotics.apply")}
          </button>
          <button
            type="button"
            disabled={!libraryId}
            onClick={onRemoveTemplate}
            className="ui-btn ui-btn-sm ui-btn-danger"
          >
            {t("robotics.removeFromLibrary")}
          </button>
        </div>
        <div className="ed-actions">
          <button
            type="button"
            onClick={onCreateDraft}
            className="ui-btn ui-btn-sm"
          >
            {createDraftLabel}
          </button>
          {draftIsBuiltIn && hasDraft ? (
            <button
              type="button"
              onClick={onCreateEditableCopy}
              className="ui-btn ui-btn-sm"
            >
              {t("robotics.createEditableCopy")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!hasDraft || draftIsBuiltIn}
            onClick={onSaveToProject}
            className="ui-btn ui-btn-sm"
          >
            {t("robotics.saveToPlan")}
          </button>
          <button
            type="button"
            disabled={!hasDraft || draftIsBuiltIn}
            onClick={onSaveTemplate}
            className="ui-btn ui-btn-sm"
          >
            {t("robotics.saveAsTemplate")}
          </button>
        </div>
        {draftIsBuiltIn ? (
          <div className="ed-warn">{builtInNote}</div>
        ) : hasDraft ? (
          editor
        ) : (
          <p className="ed-panel-note">{emptyText}</p>
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
  const t = useT();
  return <p>{t("robotics.builtInNotice", { version })}</p>;
}
