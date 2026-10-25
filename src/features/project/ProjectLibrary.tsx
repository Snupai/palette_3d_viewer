"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useT, type Translate } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import { hasRobPlan } from "~/features/project/projectRobDownload";
import type {
  ProjectConflictPolicy,
  ProjectSortField,
  SortDirection,
} from "~/lib/projectRepository";

export type ProjectLibraryProps = {
  projects: readonly Project[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  projectNumberFilter: string;
  productNumberFilter: string;
  sortBy: ProjectSortField;
  sortDirection: SortDirection;
  projectConflictPolicy: ProjectConflictPolicy;
  resourceConflictPolicy: ProjectConflictPolicy;
  onSearchChange: (value: string) => void;
  onProjectNumberFilterChange: (value: string) => void;
  onProductNumberFilterChange: (value: string) => void;
  onSortChange: (sortBy: ProjectSortField, direction: SortDirection) => void;
  onProjectConflictPolicyChange: (policy: ProjectConflictPolicy) => void;
  onResourceConflictPolicyChange: (policy: ProjectConflictPolicy) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSaveAs: (id: string) => void;
  /**
   * Called once deletion is confirmed: after the inline "Delete project?"
   * step, or straight away on Shift+click.
   */
  onDelete: (id: string) => void;
  onExportSelected: (id: string) => void;
  onDownloadRob: (id: string) => void;
  onExportAll: () => void;
  onImport: (file: File) => void;
};

const controlClass = "ui-input text-micro";
const buttonClass = "ui-btn text-micro";
const itemActionClass = "ui-btn ui-btn-sm ui-btn-ghost";

function projectTitle(project: Project, t: Translate): string {
  return (
    project.productNumber ||
    project.projectNumber ||
    t("project.library.untitled")
  );
}

export function ProjectLibrary({
  projects,
  selectedId,
  loading,
  search,
  projectNumberFilter,
  productNumberFilter,
  sortBy,
  sortDirection,
  projectConflictPolicy,
  resourceConflictPolicy,
  onSearchChange,
  onProjectNumberFilterChange,
  onProductNumberFilterChange,
  onSortChange,
  onProjectConflictPolicyChange,
  onResourceConflictPolicyChange,
  onSelect,
  onCreate,
  onEdit,
  onDuplicate,
  onSaveAs,
  onDelete,
  onExportSelected,
  onDownloadRob,
  onExportAll,
  onImport,
}: ProjectLibraryProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // In-app confirmation; native window.confirm is not shown in every host.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const changeImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };

  return (
    <aside className="app-chrome bg-surface flex h-full min-h-0 w-full flex-col">
      <div className="border-line grid gap-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-body text-ink font-semibold">
            {t("project.library.title")}
          </h2>
          <button
            type="button"
            onClick={onCreate}
            className="ui-btn-primary text-micro px-2.5 py-1.5"
          >
            {t("project.library.new")}
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className={controlClass}
          aria-label={t("project.library.searchLabel")}
          placeholder={t("project.library.searchPlaceholder")}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-micro text-muted grid gap-1">
            {t("project.library.lineFilter")}
            <input
              type="search"
              value={projectNumberFilter}
              onChange={(event) =>
                onProjectNumberFilterChange(event.target.value)
              }
              className={controlClass}
              aria-label={t("project.library.lineFilterLabel")}
              placeholder={t("project.library.lineFilterPlaceholder")}
            />
          </label>
          <label className="text-micro text-muted grid gap-1">
            {t("project.library.productFilter")}
            <input
              type="search"
              value={productNumberFilter}
              onChange={(event) =>
                onProductNumberFilterChange(event.target.value)
              }
              className={controlClass}
              aria-label={t("project.library.productFilterLabel")}
              placeholder={t("project.library.productFilterPlaceholder")}
            />
          </label>
        </div>
        <label className="text-micro text-muted grid gap-1">
          {t("project.library.sort")}
          <select
            value={`${sortBy}:${sortDirection}`}
            onChange={(event) => {
              const [field, direction] = event.target.value.split(":") as [
                ProjectSortField,
                SortDirection,
              ];
              onSortChange(field, direction);
            }}
            className={controlClass}
          >
            <option value="updatedAt:desc">
              {t("project.library.sort.updatedDesc")}
            </option>
            <option value="updatedAt:asc">
              {t("project.library.sort.updatedAsc")}
            </option>
            <option value="projectNumber:asc">
              {t("project.library.sort.lineAsc")}
            </option>
            <option value="projectNumber:desc">
              {t("project.library.sort.lineDesc")}
            </option>
            <option value="productNumber:asc">
              {t("project.library.sort.productAsc")}
            </option>
            <option value="productNumber:desc">
              {t("project.library.sort.productDesc")}
            </option>
            <option value="createdAt:desc">
              {t("project.library.sort.createdDesc")}
            </option>
          </select>
        </label>
      </div>

      <div className="scrollbar-thin min-h-[160px] flex-1 overflow-auto p-2">
        {loading ? (
          <p className="text-micro text-muted p-2">
            {t("project.library.loading")}
          </p>
        ) : projects.length === 0 ? (
          <p className="text-micro text-muted p-2 leading-5">
            {t("project.library.empty")}
          </p>
        ) : (
          <div
            role="list"
            aria-label={t("project.library.listLabel")}
            className="grid gap-1"
          >
            {projects.map((project) => {
              const selected = project.id === selectedId;
              const title = projectTitle(project, t);
              return (
                <div
                  key={project.id}
                  role="listitem"
                  className={`group border ${
                    selected
                      ? "border-brand bg-plan-fill"
                      : "hover:border-line hover:bg-surface-hover border-transparent"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(project.id)}
                    className="focus-visible:ring-focus grid w-full min-w-0 gap-1 px-3 pt-2 pb-1 text-left focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="text-body text-ink truncate font-medium">
                      {title}
                    </span>
                    <span className="text-micro text-muted truncate">
                      {project.projectNumber ||
                        t("project.library.noLineNumber")}
                    </span>
                    <span className="text-micro text-muted">
                      {new Date(project.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <div
                    role="group"
                    aria-label={t("project.library.actionsFor", { title })}
                    className={`flex flex-wrap items-center gap-0.5 px-1.5 pb-1.5 ${
                      selected || pendingDeleteId === project.id
                        ? ""
                        : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onEdit(project.id)}
                      className={itemActionClass}
                    >
                      {t("project.library.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(project.id)}
                      className={itemActionClass}
                    >
                      {t("project.library.duplicate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveAs(project.id)}
                      className={itemActionClass}
                    >
                      {t("project.library.saveAs")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportSelected(project.id)}
                      className={itemActionClass}
                    >
                      {t("project.library.export")}
                    </button>
                    {hasRobPlan(project) ? (
                      <button
                        type="button"
                        title={
                          project.source.kind === "rob-import"
                            ? t("project.library.downloadImportedTitle")
                            : t("project.library.downloadDerivedTitle")
                        }
                        onClick={() => onDownloadRob(project.id)}
                        className={itemActionClass}
                      >
                        {t("project.library.downloadRob")}
                      </button>
                    ) : null}
                    {pendingDeleteId === project.id ? (
                      <span className="ml-auto flex items-center gap-0.5">
                        <span className="text-micro text-danger px-1">
                          {t("project.library.deleteQuestion")}
                        </span>
                        <button
                          type="button"
                          autoFocus
                          onClick={() => {
                            setPendingDeleteId(null);
                            onDelete(project.id);
                          }}
                          className="ui-btn ui-btn-sm ui-btn-danger"
                        >
                          {t("project.library.delete")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className={itemActionClass}
                        >
                          {t("project.library.cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        title={t("project.library.deleteTitle")}
                        onClick={(event) => {
                          if (event.shiftKey) {
                            setPendingDeleteId(null);
                            onDelete(project.id);
                          } else {
                            setPendingDeleteId(project.id);
                          }
                        }}
                        className={`${itemActionClass} text-danger hover:bg-danger/10 ml-auto`}
                      >
                        {t("project.library.delete")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-line grid grid-cols-2 gap-2 border-t p-3">
        <button
          type="button"
          onClick={onExportAll}
          className={`${buttonClass} col-span-2`}
        >
          {t("project.library.exportAll")}
        </button>
        <label className="text-micro text-muted grid gap-1">
          {t("project.library.projectConflict")}
          <select
            aria-label={t("project.library.projectConflictLabel")}
            value={projectConflictPolicy}
            onChange={(event) =>
              onProjectConflictPolicyChange(
                event.target.value as ProjectConflictPolicy,
              )
            }
            className={controlClass}
          >
            <option value="rename">{t("project.library.policy.rename")}</option>
            <option value="skip">{t("project.library.policy.skip")}</option>
            <option value="overwrite">
              {t("project.library.policy.overwrite")}
            </option>
          </select>
        </label>
        <label className="text-micro text-muted grid gap-1">
          {t("project.library.resourceConflict")}
          <select
            aria-label={t("project.library.resourceConflictLabel")}
            value={resourceConflictPolicy}
            onChange={(event) =>
              onResourceConflictPolicyChange(
                event.target.value as ProjectConflictPolicy,
              )
            }
            className={controlClass}
          >
            <option value="rename">{t("project.library.policy.rename")}</option>
            <option value="skip">{t("project.library.policy.skip")}</option>
            <option value="overwrite">
              {t("project.library.policy.overwrite")}
            </option>
          </select>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={changeImport}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`${buttonClass} col-span-2`}
        >
          {t("project.library.import")}
        </button>
      </div>
    </aside>
  );
}
