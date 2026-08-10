import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function plannerProject(id: string, projectNumber: string, now: number) {
  return createProject(
    {
      id,
      projectNumber,
      productNumber: `${projectNumber}-BOX`,
      package: {
        dimensionsMm: { length: 400, width: 300, height: 200 },
        multiPickAllowed: true,
      },
      pallet: "euro",
    },
    { now: () => now, createId: (kind) => `${kind}-${id}` },
  );
}

async function repositoryWithProjects() {
  let now = 10;
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => now++,
    createId: (kind) => `${kind}-repository`,
  });
  const second = plannerProject("robot-project-b", "M5-ROBOT-B", 2);
  const first = plannerProject("robot-project-a", "M5-ROBOT-A", 1);
  await repository.saveProject(second);
  await repository.saveProject(first);
  return { repository };
}

describe("PlannerProjectWorkspace robotics integration", () => {
  it("keeps session settings for the same project and resets them after switching projects", async () => {
    const { repository } = await repositoryWithProjects();

    render(<PlannerProjectWorkspace repository={repository} />);

    expect(
      await screen.findByRole("heading", { name: "M5-ROBOT-B" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Production tools" }));
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("X (mm)"), {
      target: { value: "321" },
    });
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("321");

    fireEvent.click(screen.getByRole("button", { name: "Close Robotics" }));
    await waitFor(() => {
      expect(screen.queryByTestId("robotics-workspace")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Production tools" }));
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("321");

    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(
      await screen.findByRole("dialog", { name: "Planner projects" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /M5-ROBOT-A/ }));

    expect(
      await screen.findByRole("heading", { name: "M5-ROBOT-A" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Production tools" }));
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("");
  });
});
