"use client";

import { useRef, type ChangeEvent } from "react";
import type { Project } from "~/domain/project/projectSchema";
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
  onEdit: () => void;
  onDuplicate: () => void;
  onSaveAs: () => void;
  onDelete: () => void;
  onExportSelected: () => void;
  onExportAll: () => void;
  onImport: (file: File) => void;
};

const controlClass =
  "rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25";
const buttonClass =
  "rounded-md border border-zinc-700 px-2.5 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

function projectTitle(project: Project): string {
  return project.projectNumber || project.productNumber || "Untitled project";
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
  onExportAll,
  onImport,
}: ProjectLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSelection = selectedId !== null;

  const changeImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImport(file);
  };

  return (
    <aside className="app-chrome flex h-full min-h-0 w-full flex-col bg-zinc-900">
      <div className="grid gap-2 border-b border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">Projects</h2>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-md bg-amber-400 px-2.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-300 focus:ring-2 focus:ring-amber-200 focus:outline-none"
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
          placeholder="ID, project, product, file…"
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] text-zinc-500">
            Project filter
            <input
              type="search"
              value={projectNumberFilter}
              onChange={(event) =>
                onProjectNumberFilterChange(event.target.value)
              }
              className={controlClass}
              aria-label="Filter project number"
              placeholder="Project no."
            />
          </label>
          <label className="grid gap-1 text-[11px] text-zinc-500">
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
        <label className="grid gap-1 text-[11px] text-zinc-500">
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
            <option value="projectNumber:asc">Project number A–Z</option>
            <option value="projectNumber:desc">Project number Z–A</option>
            <option value="productNumber:asc">Product number A–Z</option>
            <option value="productNumber:desc">Product number Z–A</option>
            <option value="createdAt:desc">Recently created</option>
          </select>
        </label>
      </div>

      <div className="scrollbar-thin min-h-[160px] flex-1 overflow-auto p-2">
        {loading ? (
          <p className="p-2 text-xs text-zinc-500">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="p-2 text-xs leading-5 text-zinc-500">
            No projects match the current search.
          </p>
        ) : (
          <div role="list" aria-label="Project library" className="grid gap-1">
            {projects.map((project) => (
              <div key={project.id} role="listitem">
                <button
                  type="button"
                  aria-current={project.id === selectedId ? "true" : undefined}
                  onClick={() => onSelect(project.id)}
                  className={`grid w-full min-w-0 gap-1 rounded-md border px-3 py-2 text-left focus:ring-2 focus:ring-amber-400/40 focus:outline-none ${
                    project.id === selectedId
                      ? "border-zinc-600 bg-zinc-800"
                      : "border-transparent hover:border-zinc-800 hover:bg-zinc-800/60"
                  }`}
                >
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {projectTitle(project)}
                  </span>
                  <span className="truncate text-xs text-zinc-500">
                    {project.productNumber || "No product number"}
                  </span>
                  <span className="text-[11px] text-zinc-600">
                    {new Date(project.updatedAt).toLocaleString()}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-3">
        <button
          type="button"
          onClick={onEdit}
          disabled={!hasSelection}
          className={buttonClass}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!hasSelection}
          className={buttonClass}
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onSaveAs}
          disabled={!hasSelection}
          className={buttonClass}
        >
          Save as
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!hasSelection}
          className={`${buttonClass} enabled:text-red-300 enabled:hover:bg-red-500/10`}
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onExportSelected}
          disabled={!hasSelection}
          className={buttonClass}
        >
          Export selected
        </button>
        <button type="button" onClick={onExportAll} className={buttonClass}>
          Export all
        </button>
        <label className="grid gap-1 text-[11px] text-zinc-500">
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
        <label className="grid gap-1 text-[11px] text-zinc-500">
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
