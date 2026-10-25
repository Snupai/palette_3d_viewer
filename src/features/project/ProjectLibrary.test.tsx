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

    fireEvent.change(screen.getByLabelText("Nach Liniennummer filtern"), {
      target: { value: "P-1" },
    });
    fireEvent.change(screen.getByLabelText("Nach Produktnummer filtern"), {
      target: { value: "SKU" },
    });
    fireEvent.change(screen.getByLabelText("Sortierung"), {
      target: { value: "productNumber:asc" },
    });
    const actions = within(
      screen.getByRole("group", { name: "Aktionen für SKU-9" }),
    );
    fireEvent.click(actions.getByRole("button", { name: "Duplizieren" }));
    fireEvent.click(actions.getByRole("button", { name: "Speichern unter" }));
    // A plain click asks inline first; Cancel backs out without deleting.
    fireEvent.click(actions.getByRole("button", { name: "Löschen" }));
    expect(actions.getByText("Projekt löschen?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(actions.getByRole("button", { name: "Abbrechen" }));
    expect(actions.queryByText("Projekt löschen?")).toBeNull();
    // Confirming deletes once.
    fireEvent.click(actions.getByRole("button", { name: "Löschen" }));
    fireEvent.click(actions.getByRole("button", { name: "Löschen" }));
    // Shift+click skips the confirmation step.
    fireEvent.click(actions.getByRole("button", { name: "Löschen" }), {
      shiftKey: true,
    });
    fireEvent.change(
      screen.getByLabelText("Konfliktrichtlinie beim Projektimport"),
      {
        target: { value: "skip" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Konfliktrichtlinie beim Ressourcenimport"),
      {
        target: { value: "overwrite" },
      },
    );

    expect(onProjectNumberFilterChange).toHaveBeenCalledWith("P-1");
    expect(onProductNumberFilterChange).toHaveBeenCalledWith("SKU");
    expect(onSortChange).toHaveBeenCalledWith("productNumber", "asc");
    // No stack and no imported file: there is no .rob plan to download.
    expect(
      actions.queryByRole("button", { name: ".rob herunterladen" }),
    ).toBeNull();
    expect(onDuplicate).toHaveBeenCalledWith("project-1");
    expect(onSaveAs).toHaveBeenCalledWith("project-1");
    expect(onDelete.mock.calls).toEqual([["project-1"], ["project-1"]]);
    expect(onProjectConflictPolicyChange).toHaveBeenCalledWith("skip");
    expect(onResourceConflictPolicyChange).toHaveBeenCalledWith("overwrite");
  });
});
