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

function plannerProject() {
  return createProject(
    {
      id: "planner-editor-project",
      projectNumber: "M5-EDITOR",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: false,
      },
      pallet: {
        id: "pallet-1",
        name: "Editor pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: { length: 400, width: 300, height: 500 },
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      solutions: [
        {
          id: "solution-1",
          name: "Solution 1",
          origin: "manual",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 600, y: 400 },
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
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
}

async function repositoryWithProject() {
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
  const project = plannerProject();
  await repository.saveProject(project);
  return { project, repository };
}

const referenceRob = [
  "1200 800 144",
  "200 300 150 1",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "100 50 0 600 400 0 1 0 0",
].join("\n");

describe("PlannerProjectWorkspace editor integration", () => {
  it("guards a dirty editor, propagates its draft, and saves through the repository", async () => {
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
      />,
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(await screen.findByTestId("project-editor-workspace")).toBeTruthy();

    const packageRect = document.querySelector<SVGRectElement>(
      '[data-placement-id="placement-1"] rect',
    )!;
    fireEvent.pointerDown(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerUp(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.change(screen.getByLabelText("Selected package label side"), {
      target: { value: "left" },
    });
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(true));

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(confirm).toHaveBeenCalledWith(
      "Open planner projects and discard unsaved changes in Pattern editor?",
    );
    expect(screen.getByTestId("project-editor-workspace")).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Planner projects" }),
    ).toBeNull();
    confirm.mockRestore();

    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    expect(await screen.findByText("Current canonical phase")).toBeTruthy();
    expect(screen.getByText("pick")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(
        saved.project?.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      ).toBe("left");
    });
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("attaches a session .rob reference, blocks comparison on physical input mismatch, and applies only encoded inputs", async () => {
    const { project, repository } = await repositoryWithProject();

    render(<PlannerProjectWorkspace repository={repository} />);
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /02 Reference/i }));

    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".rob,text/plain"]',
    )!;
    const file = new File([referenceRob], "reference.rob", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(referenceRob),
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findAllByText("reference.rob")).not.toHaveLength(0);
    expect(
      screen.getByText("Footprint recreation").closest("summary")?.textContent,
    ).toContain("BLOCKED");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Apply encoded dimensions + inlet",
      }),
    );

    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(saved.project?.package.dimensionsMm).toEqual({
        length: 200,
        width: 300,
        height: 150,
      });
      expect(saved.project?.package.inletOrientation).toBe("crosswise");
      expect(saved.project?.package.clearanceMm).toBe(
        project.package.clearanceMm,
      );
      expect(saved.project?.package.multiPickAllowed).toBe(false);
      expect(saved.project?.pallet?.dimensionsMm).toEqual({
        length: 1200,
        width: 800,
        height: 144,
      });
      expect(saved.project?.pallet?.allowedOverhangMm).toEqual({
        length: 0,
        width: 0,
      });
      expect(saved.project?.pallet?.storageEnvelopeMm).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /02 Reference/i }));
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Encoded inputs already match",
      }).disabled,
    ).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByText("Footprint recreation").closest("summary")
          ?.textContent,
      ).toContain("PASS"),
    );
  });
});
