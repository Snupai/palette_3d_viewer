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

    expect(screen.getByLabelText<HTMLInputElement>("Length (mm)").value).toBe(
      "",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Width (mm)").value).toBe(
      "",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Height (mm)").value).toBe(
      "",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    expect(
      await screen.findByText(
        "Correct the marked project fields before saving.",
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

    fireEvent.change(screen.getByLabelText(/^Packages per layer/), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Length (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Width (mm)"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Height (mm)"), {
      target: { value: "200" },
    });
    fireEvent.change(screen.getByLabelText("Pallet name"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Maximum gross (kg)"), {
      target: { value: "10" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );

    expect(
      await screen.findByText(
        "Correct the marked project fields before saving.",
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

    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "AP-5006" },
    });
    fireEvent.change(screen.getByLabelText("Product number"), {
      target: { value: "1329-00004" },
    });
    fireEvent.change(screen.getByLabelText("Length (mm)"), {
      target: { value: "157" },
    });
    fireEvent.change(screen.getByLabelText("Width (mm)"), {
      target: { value: "106" },
    });
    fireEvent.change(screen.getByLabelText("Height (mm)"), {
      target: { value: "150" },
    });
    fireEvent.click(screen.getByLabelText("Allow multipick"));
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(savedProject).not.toBeNull();
    const reopened = await repository.getProject(savedProject!.id);
    expect(reopened.project).toMatchObject({
      projectNumber: "AP-5006",
      productNumber: "1329-00004",
      package: {
        dimensionsMm: { length: 157, width: 106, height: 150 },
        multiPickAllowed: true,
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
    expect(screen.getByLabelText<HTMLInputElement>("Line number").value).toBe(
      "AP-5006",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Length (mm)").value).toBe(
      "157",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Width (mm)").value).toBe(
      "106",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Height (mm)").value).toBe(
      "150",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Allow multipick").checked,
    ).toBe(true);
    expect(screen.queryByLabelText("Packages per layer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save project" }));
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
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );
    expect(
      await screen.findByText(
        "Enter the exact packages per layer, or choose Save project.",
      ),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Packages per layer/), {
      target: { value: "2.5" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Save and generate patterns" })
        .closest("form")!,
    );
    expect(
      await screen.findByText("Enter a positive whole number."),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Length (mm)"), {
      target: { value: "157" },
    });
    fireEvent.change(screen.getByLabelText("Width (mm)"), {
      target: { value: "106" },
    });
    fireEvent.change(screen.getByLabelText("Height (mm)"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText(/^Packages per layer/), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
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
