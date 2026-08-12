import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_ROBOT_CELL } from "~/components/rob-viewer/bundledRobotCell";
import type { RobViewerProps } from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/domain/palletTypes";
import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import { SimulationWorkspace } from "~/features/simulation/SimulationWorkspace";

const robViewerSpy = vi.hoisted(() => vi.fn());

vi.mock("~/components/RobViewer", () => ({
  RobViewer: (props: RobViewerProps) => {
    robViewerSpy(props);
    return <div data-testid="rob-viewer" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function previewData(): PalletData {
  return {
    layers: [{ unique_layer_id: 1, zwischenlage: 0, boxes: [] }],
    uniqueLayers: {},
    layer_count: 1,
    total_boxes: 0,
    package: { width: 300, length: 400, height: 200 },
    pallet: { width: 800, length: 1_200, height: 144 },
    inputDirection: 0,
  };
}

function materialization(project: Project): RobotCycleMaterialization {
  return {
    kind: "robot-cycle-materialization",
    project,
    projectId: project.id,
    solutionId: null,
    gripper: null,
    station: null,
    direction: null,
    stack: null,
    conveyor: null,
    layers: [],
    cycles: [],
    diagnostics: [],
    valid: false,
  };
}

function latestViewerProps(): RobViewerProps {
  const calls = robViewerSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as RobViewerProps;
}

describe("SimulationWorkspace robot cell integration", () => {
  it("mounts the bundled cell and forwards the independent Ewellix lift value for ordinary projects", async () => {
    const project = createProject(
      { id: "ordinary-project" },
      { createId: (kind) => `${kind}-ordinary`, now: () => 1 },
    );

    render(
      <SimulationWorkspace
        project={project}
        materialization={materialization(project)}
        previewData={previewData()}
      />,
    );

    const lift = screen.getByRole<HTMLInputElement>("slider", {
      name: "Ewellix lift position",
    });
    expect(lift.min).toBe("0");
    expect(lift.max).toBe("900");
    expect(lift.step).toBe("10");
    expect(lift.value).toBe("0");
    expect(latestViewerProps().equipment?.robotCell).toBe(BUNDLED_ROBOT_CELL);
    expect(latestViewerProps().liftCarriageMm).toBe(0);

    fireEvent.change(lift, { target: { value: "450" } });

    await waitFor(() => {
      expect(latestViewerProps().liftCarriageMm).toBe(450);
    });
    expect(screen.getByText("450 mm")).toBeTruthy();
  });

  it("does not infer the bundled cell or expose the lift control for ROB imports", () => {
    const project = createProject(
      {
        id: "imported-project",
        source: { kind: "rob-import", fileName: "fixture.rob" },
      },
      { createId: (kind) => `${kind}-imported`, now: () => 2 },
    );

    render(
      <SimulationWorkspace
        project={project}
        materialization={materialization(project)}
        previewData={previewData()}
      />,
    );

    expect(
      screen.queryByRole("slider", { name: "Ewellix lift position" }),
    ).toBeNull();
    expect(latestViewerProps().equipment?.robotCell).toBeNull();
    expect(latestViewerProps().liftCarriageMm).toBeNull();
  });
});
