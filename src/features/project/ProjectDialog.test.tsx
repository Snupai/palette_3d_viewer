import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "~/domain/project/projectSchema";
import { ProjectDialog } from "~/features/project/ProjectDialog";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

afterEach(cleanup);

describe("ProjectDialog", () => {
  it("starts create mode with empty package dimensions and does not save implicit defaults", async () => {
    const onSave = vi.fn();
    render(
      <ProjectDialog
        open
        project={null}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Länge (mm)").value).toBe(
      "",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Breite (mm)").value).toBe(
      "",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Höhe (mm)").value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Projekt speichern" }));

    expect(
      await screen.findByText(
        "Korrigieren Sie die markierten Projektfelder vor dem Speichern.",
      ),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows field-level Zod errors and blocks invalid saves", async () => {
    const onSave = vi.fn();
    render(
      <ProjectDialog
        open
        project={null}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Pakete pro Lage/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Länge (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Breite (mm)"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Höhe (mm)"), {
      target: { value: "200" },
    });
    fireEvent.change(screen.getByLabelText("Palettenname"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Maximales Bruttogewicht (kg)"), {
      target: { value: "10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Speichern und Muster erzeugen" }),
    );

    expect(
      await screen.findByText(
        "Korrigieren Sie die markierten Projektfelder vor dem Speichern.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Number must be greater than 0")).toBeTruthy();
    expect(
      screen.getByText("String must contain at least 1 character(s)"),
    ).toBeTruthy();
    expect(
      screen.getByText("must be greater than or equal to tareKg"),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a valid project through the repository and reopens its fields", async () => {
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
      now: () => 100,
      createId: (kind) => `${kind}-saved`,
    });
    const onClose = vi.fn();
    let savedProject: Project | null = null;
    const view = render(
      <ProjectDialog
        open
        project={null}
        onClose={onClose}
        onSave={async ({ project, generationIntent }) => {
          expect(generationIntent).toBeNull();
          savedProject = await repository.saveProject(project);
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Liniennummer"), {
      target: { value: "AP-5006" },
    });
    fireEvent.change(screen.getByLabelText("Produktnummer"), {
      target: { value: "1329-00004" },
    });
    fireEvent.change(screen.getByLabelText("Länge (mm)"), {
      target: { value: "157" },
    });
    fireEvent.change(screen.getByLabelText("Breite (mm)"), {
      target: { value: "106" },
    });
    fireEvent.change(screen.getByLabelText("Höhe (mm)"), {
      target: { value: "150" },
    });
    // New projects default to multipick on.
    expect(screen.getByLabelText("Multipick erlauben")).toHaveProperty(
      "checked",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Projekt speichern" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(savedProject).not.toBeNull();
    const reopened = await repository.getProject(savedProject!.id);
    expect(reopened.project).toMatchObject({
      projectNumber: "AP-5006",
      productNumber: "1329-00004",
      package: {
        dimensionsMm: { length: 157, width: 106, height: 150 },
        multiPickAllowed: true,
        labelSidesAtPickup: ["bottom"],
      },
    });

    const onEditSave = vi.fn();
    view.rerender(
      <ProjectDialog
        open
        project={reopened.project}
        onClose={() => undefined}
        onSave={onEditSave}
      />,
    );
    expect(screen.getByLabelText<HTMLInputElement>("Liniennummer").value).toBe(
      "AP-5006",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Länge (mm)").value).toBe(
      "157",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Breite (mm)").value).toBe(
      "106",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Höhe (mm)").value).toBe(
      "150",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Multipick erlauben").checked,
    ).toBe(true);
    expect(screen.queryByLabelText("Pakete pro Lage")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Projekt speichern" }));
    await waitFor(() => expect(onEditSave).toHaveBeenCalledTimes(1));
    expect(onEditSave.mock.calls[0]?.[0]).toMatchObject({
      project: {
        id: reopened.project?.id,
        package: {
          dimensionsMm: { length: 157, width: 106, height: 150 },
        },
      },
      generationIntent: null,
    });
  });

  it("submits an exact package count only for Save and generate patterns", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ProjectDialog open project={null} onClose={onClose} onSave={onSave} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Speichern und Muster erzeugen" }),
    );
    expect(
      await screen.findByText(
        "Geben Sie die genaue Anzahl Pakete pro Lage ein oder wählen Sie „Projekt speichern“.",
      ),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Pakete pro Lage/), {
      target: { value: "2.5" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Speichern und Muster erzeugen" })
        .closest("form")!,
    );
    expect(
      await screen.findByText("Geben Sie eine positive ganze Zahl ein."),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Länge (mm)"), {
      target: { value: "157" },
    });
    fireEvent.change(screen.getByLabelText("Breite (mm)"), {
      target: { value: "106" },
    });
    fireEvent.change(screen.getByLabelText("Höhe (mm)"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText(/^Pakete pro Lage/), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Speichern und Muster erzeugen" }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      project: {
        package: {
          dimensionsMm: { length: 157, width: 106, height: 150 },
        },
      },
      generationIntent: { exactPackageCount: 4 },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
