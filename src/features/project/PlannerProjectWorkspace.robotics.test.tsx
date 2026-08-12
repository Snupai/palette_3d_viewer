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

function plannerProjectWithStack() {
  return createProject(
    {
      id: "robot-project-profile",
      projectNumber: "M5-ROBOT-PROFILE",
      package: {
        dimensionsMm: { length: 400, width: 300, height: 200 },
        multiPickAllowed: false,
      },
      pallet: "euro",
      solutions: [
        {
          id: "solution-1",
          name: "Calculated solution",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 300, y: 200 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer-1",
                patternId: "pattern-1",
                interlayerBefore: 0,
              },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    {
      now: () => 1,
      createId: (kind) => `${kind}-profile`,
    },
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
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-B" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Robot readiness").closest("summary")?.textContent,
    ).toContain("BLOCKED");
    expect(
      screen.getByText("Robot readiness").closest("summary")?.textContent,
    ).toContain("Complete the plan");
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
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-A" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Production tools" }));
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("");
  });

  it("keeps observed Multipack equipment out of a robot-readiness pass", async () => {
    let now = 10;
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
      now: () => now++,
      createId: (kind) => `${kind}-repository`,
    });
    await repository.saveProject(plannerProjectWithStack());

    render(<PlannerProjectWorkspace repository={repository} />);

    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-PROFILE" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Production tools" }));
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("X (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Y (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Z (mm)"), {
      target: { value: "300" },
    });

    await waitFor(() => {
      const row = screen.getByText("Robot readiness").closest("summary");
      expect(row?.textContent).toContain("OBSERVED");
      expect(row?.textContent).toContain(
        "observed Multipack equipment profile",
      );
      expect(row?.textContent).not.toContain("PASS");
    });
  });
});
