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

    fireEvent.change(screen.getByLabelText("Length (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Pallet name"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Maximum gross (kg)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

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
        onSave={async (project) => {
          savedProject = await repository.saveProject(project);
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project number"), {
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

    view.rerender(
      <ProjectDialog
        open
        project={reopened.project}
        onClose={() => undefined}
        onSave={() => undefined}
      />,
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Project number").value,
    ).toBe("AP-5006");
    expect(screen.getByLabelText<HTMLInputElement>("Length (mm)").value).toBe(
      "157",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("Allow multipick").checked,
    ).toBe(true);
  });
});
