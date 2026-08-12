import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MULTIPACK_GRIPPER_ID,
  MULTIPACK_PALLET_STATION_ID,
} from "~/domain/project/equipmentProfiles";
import { createProject } from "~/domain/project/projectFactory";
import type {
  Gripper,
  PalletStation,
  Project,
} from "~/domain/project/projectSchema";
import { RoboticsWorkspace } from "~/features/robotics/RoboticsWorkspace";
import {
  createInitialRobotWorkspaceSettings,
  materializeRobotWorkspace,
} from "~/features/robotics/robotWorkspaceModel";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

const gripper: Gripper = {
  id: "gripper-1",
  name: "Fixture suction",
  externalId: null,
  isDefault: false,
  maxPickupLengthMm: 500,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 20,
    positiveX: 20,
    negativeY: 20,
    positiveY: 20,
  },
  inletOrientation: "any",
  allowedPlaceRotations: [0, 90, 180, 270],
  packageLimits: null,
  settings: { type: "suction", multipickSinglePlace: false },
};

const station: PalletStation = {
  id: "station-1",
  name: "Fixture station",
  externalId: null,
  isDefault: false,
  palletOrigin: { x: "left", y: "bottom" },
  obstacleEnvelopeMm: {
    negativeX: 5_000,
    positiveX: 5_000,
    negativeY: 5_000,
    positiveY: 5_000,
  },
  tcpEnvelopeMm: {
    negativeX: 5_000,
    positiveX: 5_000,
    negativeY: 5_000,
    positiveY: 5_000,
  },
  allowedDirections: ["x-positive-y-positive"],
  preferredDirection: "x-positive-y-positive",
  robotCenterMm: { x: 0, y: 0 },
  robotRadiusMm: { min: 0, max: 5_000 },
  inletAlignment: "center",
};

function projectFixture(): Project {
  return createProject(
    {
      id: "robotics-project",
      projectNumber: "M5-ROBOTICS",
      productNumber: "BOX-100-50",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: true,
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: "euro",
      grippers: [gripper],
      palletStations: [station],
      selectedGripperId: gripper.id,
      selectedPalletStationId: station.id,
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
                  positionMm: { x: 100, y: 100 },
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
    { createId: (kind) => `${kind}-unused`, now: () => 1 },
  );
}

function repositoryFixture(): ProjectRepository {
  return new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RoboticsWorkspace operator view", () => {
  it("keeps ordinary setup short and engineering data closed", async () => {
    const project = createProject(
      {
        id: "unconfigured-robotics-project",
        grippers: [],
        palletStations: [],
        selectedGripperId: null,
        selectedPalletStationId: null,
      },
      { createId: (kind) => `${kind}-unused`, now: () => 1 },
    );
    const settings = createInitialRobotWorkspaceSettings(project);
    const repository = repositoryFixture();
    const listResources = vi.spyOn(repository, "listResources");
    const onSaveProject = vi.fn(async (next: Project) => next);

    render(
      <RoboticsWorkspace
        project={project}
        repository={repository}
        materialization={materializeRobotWorkspace(project, settings)}
        settings={settings}
        onSettingsChange={vi.fn()}
        onSaveProject={onSaveProject}
        onPreviewMotion={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listResources).toHaveBeenCalledWith({
        sortBy: "name",
        sortDirection: "asc",
      });
    });

    expect(
      screen.getByTestId<HTMLDetailsElement>("robotics-advanced").open,
    ).toBe(false);
    expect(
      screen.getByTestId<HTMLDetailsElement>("generated-pickup-list").open,
    ).toBe(false);
    expect(
      screen
        .getAllByRole("combobox")
        .filter((element) => element.closest("details") === null),
    ).toHaveLength(2);
    expect(
      screen
        .getAllByRole("spinbutton")
        .filter((element) => element.closest("details") === null),
    ).toHaveLength(5);
    expect(
      screen
        .getAllByRole("checkbox")
        .filter((element) => element.closest("details") === null),
    ).toHaveLength(0);
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected project gripper")
        .value,
    ).toBe("");
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected project station")
        .value,
    ).toBe("");
    expect(project.grippers).toHaveLength(0);
    expect(project.palletStations).toHaveLength(0);
    expect(onSaveProject).not.toHaveBeenCalled();
    expect(
      screen.getByText("Production feasibility is not assessed."),
    ).toBeTruthy();
    expect(
      screen
        .getAllByText(
          "No fixed obstacles are modeled. Collision against individual station objects has not been checked.",
        )
        .filter((element) => element.closest("details") === null),
    ).toHaveLength(1);
    expect(
      screen
        .getByLabelText("ROB integer quantization")
        .closest('[data-testid="robotics-advanced"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Create unverified suction draft" })
        .closest('[data-testid="robotics-advanced"]'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("table")
        .closest('[data-testid="generated-pickup-list"]'),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Advanced engineering"));
    const gripperEditor = screen
      .getByText("Gripper library and editor")
      .closest("details")!;
    const stationEditor = screen
      .getByText("Pallet station library and editor")
      .closest("details")!;
    expect(gripperEditor.open).toBe(false);
    expect(stationEditor.open).toBe(false);

    fireEvent.click(screen.getByText(/Detailed diagnostics/));
    expect(screen.getByText("missing-sign-convention")).toBeTruthy();
    expect(
      screen.getByText(
        "No fixed obstacles are modeled; no collision claim is made.",
      ),
    ).toBeTruthy();
  });

  it("shows the observed Multipack profile as the read-only default for a new project", async () => {
    const project = createProject(
      { id: "multipack-default-project" },
      { createId: (kind) => `${kind}-unused`, now: () => 1 },
    );
    const settings = createInitialRobotWorkspaceSettings(project);

    render(
      <RoboticsWorkspace
        project={project}
        repository={repositoryFixture()}
        materialization={materializeRobotWorkspace(project, settings)}
        settings={settings}
        onSettingsChange={vi.fn()}
        onSaveProject={vi.fn(async (next: Project) => next)}
        onPreviewMotion={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected project gripper")
        .value,
    ).toBe(MULTIPACK_GRIPPER_ID);
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected project station")
        .value,
    ).toBe(MULTIPACK_PALLET_STATION_ID);
    expect(
      screen.getByText(
        "Multipack Roboter observed defaults v1 are preselected for this project.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /documented configuration evidence, not a station survey/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The observed Multipack default profile is selected. Its values are documented evidence, not calibrated production equipment.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Advanced engineering"));
    const gripperEditor = screen
      .getByText("Gripper library and editor")
      .closest("details")!;
    fireEvent.click(screen.getByText("Gripper library and editor"));
    expect(
      within(gripperEditor).getByText(
        /Package limits: lengthwise 50–500 × 50–420 mm/,
      ),
    ).toBeTruthy();
    expect(
      within(gripperEditor).getByRole("button", {
        name: "Create editable copy",
      }),
    ).toBeTruthy();
  });

  it("opens the shared calculated motion preview", async () => {
    const project = projectFixture();
    const settings = {
      ...createInitialRobotWorkspaceSettings(project),
      pickX: "-500",
      pickY: "100",
      pickZ: "300",
      pickReferenceStatus: "verified" as const,
      pickReferenceSource: "RoboticsWorkspace component fixture",
    };
    const onPreviewMotion = vi.fn();

    render(
      <RoboticsWorkspace
        project={project}
        repository={repositoryFixture()}
        materialization={materializeRobotWorkspace(project, settings)}
        settings={settings}
        onSettingsChange={vi.fn()}
        onSaveProject={vi.fn(async (next: Project) => next)}
        onPreviewMotion={onPreviewMotion}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Preview calculated motion" }),
      ).toBeTruthy();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview calculated motion" }),
    );

    expect(onPreviewMotion).toHaveBeenCalledTimes(1);
  });
});
