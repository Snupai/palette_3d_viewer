import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
        onDelete={() => undefined}
        onExportSelected={() => undefined}
        onExportAll={() => undefined}
        onImport={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter project number"), {
      target: { value: "P-1" },
    });
    fireEvent.change(screen.getByLabelText("Filter product number"), {
      target: { value: "SKU" },
    });
    fireEvent.change(screen.getByLabelText("Sort"), {
      target: { value: "productNumber:asc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as" }));
    fireEvent.change(screen.getByLabelText("Project import conflict policy"), {
      target: { value: "skip" },
    });
    fireEvent.change(screen.getByLabelText("Resource import conflict policy"), {
      target: { value: "overwrite" },
    });

    expect(onProjectNumberFilterChange).toHaveBeenCalledWith("P-1");
    expect(onProductNumberFilterChange).toHaveBeenCalledWith("SKU");
    expect(onSortChange).toHaveBeenCalledWith("productNumber", "asc");
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onSaveAs).toHaveBeenCalledTimes(1);
    expect(onProjectConflictPolicyChange).toHaveBeenCalledWith("skip");
    expect(onResourceConflictPolicyChange).toHaveBeenCalledWith("overwrite");
  });
});
