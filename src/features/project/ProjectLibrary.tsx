"use client";

import { useRef, useState, type ChangeEvent } from "react";
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

const controlClass = "ui-input text-xs";
const buttonClass = "ui-btn text-xs";
const itemActionClass = "ui-btn ui-btn-sm ui-btn-ghost";

function projectTitle(project: Project): string {
  return project.productNumber || project.projectNumber || "Untitled project";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  // In-app confirmation; native window.confirm is not shown in every host.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const changeImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };

  return (
    <aside className="app-chrome flex h-full min-h-0 w-full flex-col bg-surface">
      <div className="grid gap-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Projects</h2>
          <button
            type="button"
            onClick={onCreate}
            className="ui-btn-primary px-2.5 py-1.5 text-xs"
          >
            New
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className={controlClass}
          aria-label="Search projects"
          placeholder="ID, line, product, file…"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-micro text-muted">
            Line filter
            <input
              type="search"
              value={projectNumberFilter}
              onChange={(event) =>
                onProjectNumberFilterChange(event.target.value)
              }
              className={controlClass}
              aria-label="Filter line number"
              placeholder="Line no."
            />
          </label>
          <label className="grid gap-1 text-micro text-muted">
            Product filter
            <input
              type="search"
              value={productNumberFilter}
              onChange={(event) =>
                onProductNumberFilterChange(event.target.value)
              }
              className={controlClass}
              aria-label="Filter product number"
              placeholder="Product no."
            />
          </label>
        </div>
        <label className="grid gap-1 text-micro text-muted">
          Sort
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
            <option value="updatedAt:desc">Recently updated</option>
            <option value="updatedAt:asc">Oldest update</option>
            <option value="projectNumber:asc">Line number A–Z</option>
            <option value="projectNumber:desc">Line number Z–A</option>
            <option value="productNumber:asc">Product number A–Z</option>
            <option value="productNumber:desc">Product number Z–A</option>
            <option value="createdAt:desc">Recently created</option>
          </select>
        </label>
      </div>

      <div className="scrollbar-thin min-h-[160px] flex-1 overflow-auto p-2">
        {loading ? (
          <p className="p-2 text-xs text-muted">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="p-2 text-xs leading-5 text-muted">
            No projects match the current search.
          </p>
        ) : (
          <div role="list" aria-label="Project library" className="grid gap-1">
            {projects.map((project) => {
              const selected = project.id === selectedId;
              const title = projectTitle(project);
              return (
                <div
                  key={project.id}
                  role="listitem"
                  className={`group border ${
                    selected
                      ? "border-brand bg-plan-fill"
                      : "border-transparent hover:border-line hover:bg-surface-hover"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => onSelect(project.id)}
                    className="grid w-full min-w-0 gap-1 px-3 pt-2 pb-1 text-left focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    <span className="truncate text-sm font-medium text-ink">
                      {title}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {project.projectNumber || "No line number"}
                    </span>
                    <span className="text-micro text-muted">
                      {new Date(project.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <div
                    role="group"
                    aria-label={`Actions for ${title}`}
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
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(project.id)}
                      className={itemActionClass}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onSaveAs(project.id)}
                      className={itemActionClass}
                    >
                      Save as
                    </button>
                    <button
                      type="button"
                      onClick={() => onExportSelected(project.id)}
                      className={itemActionClass}
                    >
                      Export
                    </button>
                    {hasRobPlan(project) ? (
                      <button
                        type="button"
                        title={
                          project.source.kind === "rob-import"
                            ? "Download the imported .rob file"
                            : "Download the .rob plan derived from the saved stack"
                        }
                        onClick={() => onDownloadRob(project.id)}
                        className={itemActionClass}
                      >
                        Download .rob
                      </button>
                    ) : null}
                    {pendingDeleteId === project.id ? (
                      <span className="ml-auto flex items-center gap-0.5">
                        <span className="px-1 text-micro text-danger">
                          Delete project?
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
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className={itemActionClass}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        title="Shift+click deletes without confirmation"
                        onClick={(event) => {
                          if (event.shiftKey) {
                            setPendingDeleteId(null);
                            onDelete(project.id);
                          } else {
                            setPendingDeleteId(project.id);
                          }
                        }}
                        className={`${itemActionClass} ml-auto text-danger hover:bg-danger/10`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <button
          type="button"
          onClick={onExportAll}
          className={`${buttonClass} col-span-2`}
        >
          Export all projects
        </button>
        <label className="grid gap-1 text-micro text-muted">
          Project conflict
          <select
            aria-label="Project import conflict policy"
            value={projectConflictPolicy}
            onChange={(event) =>
              onProjectConflictPolicyChange(
                event.target.value as ProjectConflictPolicy,
              )
            }
            className={controlClass}
          >
            <option value="rename">Rename incoming</option>
            <option value="skip">Skip incoming</option>
            <option value="overwrite">Overwrite existing</option>
          </select>
        </label>
        <label className="grid gap-1 text-micro text-muted">
          Resource conflict
          <select
            aria-label="Resource import conflict policy"
            value={resourceConflictPolicy}
            onChange={(event) =>
              onResourceConflictPolicyChange(
                event.target.value as ProjectConflictPolicy,
              )
            }
            className={controlClass}
          >
            <option value="rename">Rename incoming</option>
            <option value="skip">Skip incoming</option>
            <option value="overwrite">Overwrite existing</option>
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
          Import project + resource package
        </button>
      </div>
    </aside>
  );
}
