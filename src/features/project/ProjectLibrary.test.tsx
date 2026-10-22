import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { ProjectLibrary } from "~/features/project/ProjectLibrary";

afterEach(cleanup);

const project = createProject(
  { id: "project-1", projectNumber: "P-100", productNumber: "SKU-9" },
  { createId: (kind) => `${kind}-unused`, now: () => 1 },
);

describe("ProjectLibrary management controls", () => {
  it("exposes independent project/product filters, sorting, duplicate/save-as, and package conflict policies", () => {
    const onProjectNumberFilterChange = vi.fn();
    const onProductNumberFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onDuplicate = vi.fn();
    const onSaveAs = vi.fn();
    const onDelete = vi.fn();
    const onProjectConflictPolicyChange = vi.fn();
    const onResourceConflictPolicyChange = vi.fn();

    render(
      <ProjectLibrary
        projects={[project]}
        selectedId={project.id}
        loading={false}
        search=""
        projectNumberFilter=""
        productNumberFilter=""
        sortBy="updatedAt"
        sortDirection="desc"
        projectConflictPolicy="rename"
        resourceConflictPolicy="rename"
        onSearchChange={() => undefined}
        onProjectNumberFilterChange={onProjectNumberFilterChange}
        onProductNumberFilterChange={onProductNumberFilterChange}
        onSortChange={onSortChange}
        onProjectConflictPolicyChange={onProjectConflictPolicyChange}
        onResourceConflictPolicyChange={onResourceConflictPolicyChange}
        onSelect={() => undefined}
        onCreate={() => undefined}
        onEdit={() => undefined}
        onDuplicate={onDuplicate}
        onSaveAs={onSaveAs}
        onDelete={onDelete}
        onExportSelected={() => undefined}
        onDownloadRob={() => undefined}
        onExportAll={() => undefined}
        onImport={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter line number"), {
      target: { value: "P-1" },
    });
    fireEvent.change(screen.getByLabelText("Filter product number"), {
      target: { value: "SKU" },
    });
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "productNumber:asc" },
    });
    const actions = within(
      screen.getByRole("group", { name: "Actions for SKU-9" }),
    );
    fireEvent.click(actions.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(actions.getByRole("button", { name: "Save as" }));
    // A plain click asks inline first; Cancel backs out without deleting.
    fireEvent.click(actions.getByRole("button", { name: "Delete" }));
    expect(actions.getByText("Delete project?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(actions.getByRole("button", { name: "Cancel" }));
    expect(actions.queryByText("Delete project?")).toBeNull();
    // Confirming deletes once.
    fireEvent.click(actions.getByRole("button", { name: "Delete" }));
    fireEvent.click(actions.getByRole("button", { name: "Delete" }));
    // Shift+click skips the confirmation step.
    fireEvent.click(actions.getByRole("button", { name: "Delete" }), {
      shiftKey: true,
    });
    fireEvent.change(screen.getByLabelText("Project import conflict policy"), {
      target: { value: "skip" },
    });
    fireEvent.change(screen.getByLabelText("Resource import conflict policy"), {
      target: { value: "overwrite" },
    });

    expect(onProjectNumberFilterChange).toHaveBeenCalledWith("P-1");
    expect(onProductNumberFilterChange).toHaveBeenCalledWith("SKU");
    expect(onSortChange).toHaveBeenCalledWith("productNumber", "asc");
    // No stack and no imported file: there is no .rob plan to download.
    expect(actions.queryByRole("button", { name: "Download .rob" })).toBeNull();
    expect(onDuplicate).toHaveBeenCalledWith("project-1");
    expect(onSaveAs).toHaveBeenCalledWith("project-1");
    expect(onDelete.mock.calls).toEqual([["project-1"], ["project-1"]]);
    expect(onProjectConflictPolicyChange).toHaveBeenCalledWith("skip");
    expect(onResourceConflictPolicyChange).toHaveBeenCalledWith("overwrite");
  });
});
