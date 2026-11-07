import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_ROBOT_CELL,
  BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
} from "~/components/rob-viewer/bundledRobotCell";
import type { RobViewerProps } from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/domain/palletTypes";
import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import {
  createInitialRobotWorkspaceSettings,
  materializeRobotWorkspace,
} from "~/features/robotics/robotWorkspaceModel";
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
      name: "Hubposition Ewellix",
    });
    expect(lift.min).toBe("0");
    expect(lift.max).toBe("900");
    expect(lift.step).toBe("10");
    expect(lift.value).toBe("0");
    expect(latestViewerProps().equipment?.robotCell).toBe(BUNDLED_ROBOT_CELL);
    expect(latestViewerProps().liftCarriageMm).toBe(0);
    expect(latestViewerProps().sceneCalibration).toEqual(
      BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
    );
    expect(latestViewerProps().temporaryCalibration).toEqual({
      resetKey: `ordinary-project:no-cycle:${BUNDLED_ROBOT_CELL.revision}`,
      palletPose: {
        positionMm: { x: 789, y: -5, z: 0 },
        yawDeg: 90,
      },
      pickupPose: {
        positionMm: { x: 1_492, y: 207, z: 962 },
        yawDeg: -90,
      },
    });

    fireEvent.change(lift, { target: { value: "450" } });

    await waitFor(() => {
      expect(latestViewerProps().liftCarriageMm).toBe(450);
    });
    expect(screen.getByText("450 mm")).toBeTruthy();
  });

  it("drives the articulated UR10e and the lift from the inverse kinematics", () => {
    const project = createProject(
      {
        id: "kinematic-project",
        package: {
          dimensionsMm: { length: 400, width: 300, height: 250 },
          multiPickAllowed: false,
          palletizingDirection: "x-negative-y-positive",
        },
        solutions: [
          {
            id: "solution-1",
            name: "Solution",
            origin: "calculated",
            patterns: [
              {
                id: "pattern-1",
                name: "Pattern",
                grips: [],
                placements: [
                  {
                    id: "placement-1",
                    sequence: 0,
                    positionMm: { x: 0, y: 0 },
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
                { id: "layer-1", patternId: "pattern-1", interlayerBefore: 0 },
              ],
              trailingInterlayer: 0,
            },
            robotCycles: [],
          },
        ],
        activeSolutionId: "solution-1",
      },
      { createId: (kind) => `${kind}-kinematic`, now: () => 3 },
    );

    render(
      <SimulationWorkspace
        project={project}
        materialization={materializeRobotWorkspace(
          project,
          createInitialRobotWorkspaceSettings(project),
        )}
        previewData={previewData()}
      />,
    );

    // Cursor 0 is the first pick at the calibrated conveyor pickup.
    const props = latestViewerProps();
    expect(props.equipment?.robot).toBeNull();
    expect(props.liftCarriageMm).toBeCloseTo(415.9, 9);
    expect(
      props.robotJoints!.map(
        (angle) => Math.round(((angle * 180) / Math.PI) * 1e6) / 1e6,
      ),
    ).toEqual([
      165.507316, -29.233318, 128.937033, -189.703715, -90, -59.492684,
    ]);
    expect(
      screen.getByRole<HTMLInputElement>("slider", {
        name: "Hubposition Ewellix",
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText(
        "Der Hub folgt während der Simulation der UR10e-Kinematik.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("erreichbar")).toBeTruthy();
    expect(screen.getByText("165,5°")).toBeTruthy();
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
      screen.queryByRole("slider", { name: "Hubposition Ewellix" }),
    ).toBeNull();
    expect(latestViewerProps().equipment?.robotCell).toBeNull();
    expect(latestViewerProps().liftCarriageMm).toBeNull();
    expect(latestViewerProps().sceneCalibration).toBeUndefined();
  });
});
