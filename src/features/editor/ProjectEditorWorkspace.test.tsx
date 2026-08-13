import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import {
  projectSchema,
  type Gripper,
  type PackagePlacement,
  type PalletStation,
  type Project,
} from "~/domain/project/projectSchema";
import { materializeRobotCycles } from "~/domain/robotics";
import { ProjectEditorWorkspace } from "~/features/editor/ProjectEditorWorkspace";

afterEach(cleanup);

function placement(
  id: string,
  sequence: number,
  x: number,
  y: number,
): PackagePlacement {
  return {
    id,
    sequence,
    positionMm: { x, y },
    rotation: 0,
    gripId: null,
    labelSide: null,
  };
}

const gripper: Gripper = {
  id: "gripper-1",
  name: "Editor suction",
  externalId: null,
  isDefault: true,
  maxPickupLengthMm: 250,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 10,
    positiveX: 10,
    negativeY: 10,
    positiveY: 10,
  },
  inletOrientation: "any",
  allowedPlaceRotations: [0, 90, 180, 270],
  packageLimits: null,
  settings: { type: "suction", multipickSinglePlace: false },
};

const station: PalletStation = {
  id: "station-1",
  name: "Editor station",
  externalId: null,
  isDefault: true,
  palletOrigin: { x: "left", y: "bottom" },
  obstacleEnvelopeMm: {
    negativeX: 10_000,
    positiveX: 10_000,
    negativeY: 10_000,
    positiveY: 10_000,
  },
  tcpEnvelopeMm: {
    negativeX: 10_000,
    positiveX: 10_000,
    negativeY: 10_000,
    positiveY: 10_000,
  },
  allowedDirections: ["x-positive-y-positive"],
  preferredDirection: "x-positive-y-positive",
  robotCenterMm: { x: 0, y: 0 },
  robotRadiusMm: { min: 0, max: 10_000 },
  inletAlignment: "center",
};

function projectFixture(): Project {
  return createProject(
    {
      id: "editor-component-project",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: true,
        palletizingDirection: "x-positive-y-positive",
      },
      pallet: {
        id: "pallet-1",
        name: "Test pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: { length: 400, width: 300, height: 500 },
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      grippers: [gripper],
      palletStations: [station],
      selectedGripperId: gripper.id,
      selectedPalletStationId: station.id,
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
                placement("p1", 0, 50, 50),
                placement("p2", 1, 150, 50),
                placement("p3", 2, 50, 150),
                placement("p4", 3, 150, 150),
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

function importedGripProject(): Project {
  const project = projectFixture();
  const solution = project.solutions[0]!;
  const sourcePattern = solution.patterns[0]!;
  return projectSchema.parse({
    ...project,
    source: {
      kind: "rob-import",
      fileName: "imported-editor.rob",
      rawRobText: "DEF imported-editor()\nEND",
    },
    solutions: [
      {
        ...solution,
        origin: "imported",
        patterns: [
          {
            ...sourcePattern,
            grips: [
              {
                id: "g1",
                groupNumber: 1,
                pickX: 50,
                pickY: 0,
                pickRotation: 0,
                x: 100,
                y: 50,
                rotation: 0,
                numPackages: 2,
                dx: 37,
                dy: 0,
              },
              {
                id: "g2",
                groupNumber: 2,
                pickX: 50,
                pickY: 100,
                pickRotation: 0,
                x: 100,
                y: 150,
                rotation: 0,
                numPackages: 2,
                dx: 0,
                dy: -14,
              },
            ],
            placements: sourcePattern.placements.map((item, index) => ({
              ...item,
              gripId: index < 2 ? "g1" : "g2",
              labelSide: "top",
            })),
            groupOrder: ["g1", "g2"],
            orderDependencies: [],
          },
        ],
      },
    ],
  });
}

function projectWithSecondPattern(): Project {
  const project = projectFixture();
  const solution = project.solutions[0]!;
  const firstPattern = solution.patterns[0]!;
  return projectSchema.parse({
    ...project,
    solutions: [
      {
        ...solution,
        patterns: [
          firstPattern,
          {
            ...firstPattern,
            id: "pattern-2",
            name: "Pattern 2",
            placements: firstPattern.placements.map((item) => ({
              ...item,
              id: `second-${item.id}`,
              gripId: null,
            })),
          },
        ],
        stack: {
          ...solution.stack,
          layers: [
            ...solution.stack.layers,
            {
              id: "layer-2",
              patternId: "pattern-2",
              interlayerBefore: 0,
            },
          ],
        },
      },
    ],
  });
}

function renderEditor(
  overrides: {
    project?: Project;
    onDraftChange?: (project: Project | null) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onSaveProject?: (project: Project) => Promise<Project>;
  } = {},
) {
  const project = overrides.project ?? projectFixture();
  const materialization = materializeRobotCycles(project, {
    pickReference: {
      originMm: { x: 0, y: 0, z: 100 },
      yawDeg: 0,
      provenance: { status: "verified", source: "component test" },
    },
  });
  const onSaveProject =
    overrides.onSaveProject ?? vi.fn(async (value: Project) => value);
  const view = render(
    <ProjectEditorWorkspace
      project={project}
      materialization={materialization}
      onDraftChange={overrides.onDraftChange}
      onDirtyChange={overrides.onDirtyChange}
      onSaveProject={onSaveProject}
    />,
  );
  return { project, materialization, onSaveProject, ...view };
}

function placementRect(id: string): SVGRectElement {
  const value = document.querySelector<SVGRectElement>(
    `[data-placement-id="${id}"] rect`,
  );
  if (!value) throw new Error(`Missing placement ${id}`);
  return value;
}

function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  input: MouseEventInit & { pointerId: number },
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, ...input });
  Object.defineProperty(event, "pointerId", { value: input.pointerId });
  return event;
}

describe("ProjectEditorWorkspace pattern interaction", () => {
  it("supports click, Ctrl/Command toggles, and Shift marquee selection", () => {
    renderEditor();
    const first = placementRect("p1");
    const second = placementRect("p2");
    fireEvent.pointerDown(first, {
      pointerId: 1,
      clientX: 50,
      clientY: 250,
    });
    fireEvent.pointerUp(first, {
      pointerId: 1,
      clientX: 50,
      clientY: 250,
    });
    expect(screen.getByText("1 selected")).toBeTruthy();

    fireEvent.click(second, { ctrlKey: true });
    expect(screen.getByText("2 selected")).toBeTruthy();

    const canvas = screen.getByTestId("project-pattern-canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 400,
        bottom: 300,
        width: 400,
        height: 300,
        toJSON: () => undefined,
      }),
    });
    fireEvent.keyDown(canvas, { key: "Escape" });
    fireEvent(
      canvas,
      pointerEvent("pointerdown", {
        pointerId: 3,
        shiftKey: true,
        clientX: 0,
        clientY: 280,
      }),
    );
    fireEvent(
      canvas,
      pointerEvent("pointermove", {
        pointerId: 3,
        shiftKey: true,
        clientX: 200,
        clientY: 220,
      }),
    );
    expect(screen.getByTestId("selection-marquee")).toBeTruthy();
    fireEvent(
      canvas,
      pointerEvent("pointerup", {
        pointerId: 3,
        shiftKey: true,
        clientX: 200,
        clientY: 220,
      }),
    );
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("keeps undo, Delete, arrows, and shortcuts out of form controls", () => {
    renderEditor();
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });

    const labelSelect = screen.getByLabelText<HTMLSelectElement>(
      "Selected package label side",
    );
    fireEvent.change(labelSelect, { target: { value: "top" } });
    expect(labelSelect.value).toBe("top");
    fireEvent.keyDown(labelSelect, { key: "z", ctrlKey: true });
    expect(labelSelect.value).toBe("top");

    const xInput =
      screen.getByLabelText<HTMLInputElement>("Selected package X");
    fireEvent.keyDown(xInput, { key: "Delete" });
    fireEvent.keyDown(xInput, { key: "ArrowRight" });
    expect(document.querySelectorAll("[data-placement-id]")).toHaveLength(4);
    expect(xInput.value).toBe("50");

    fireEvent.keyDown(screen.getByTestId("project-editor-workspace"), {
      key: "z",
      ctrlKey: true,
    });
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("");
  });
});

describe("ProjectEditorWorkspace order, flow, and persistence", () => {
  it("shows invalid dependency feedback and applies the automatic suggestion", async () => {
    renderEditor();
    const first = placementRect("p1");
    const second = placementRect("p2");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.click(second, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Order" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add group from package selection (2)",
      }),
    );

    const before = screen.getByLabelText<HTMLSelectElement>(
      "Dependency prerequisite group",
    );
    const after = screen.getByLabelText<HTMLSelectElement>(
      "Dependency dependent group",
    );
    const values = [...before.options].map(({ value }) => value);
    expect(values).toHaveLength(2);
    fireEvent.change(before, { target: { value: values[1] } });
    fireEvent.change(after, { target: { value: values[0] } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/before prerequisite/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Apply automatic order" }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/before prerequisite/)).toBeNull(),
    );
    expect(screen.getAllByText(/G\d/).length).toBeGreaterThan(0);
  });

  it("renders inferred legacy dependencies as immutable", () => {
    renderEditor({ project: importedGripProject() });
    fireEvent.click(screen.getByRole("button", { name: "Order" }));

    expect(
      screen.getByText("Inferred from legacy dx/dy; immutable in this editor."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Remove dependency group 1 before group 2",
      }),
    ).toBeNull();
  });

  it("steps the shared flow and supports save, discard, and reset", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSaveProject = vi.fn(async (value: Project) => value);
    renderEditor({ onSaveProject });
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.change(screen.getByLabelText("Selected package label side"), {
      target: { value: "top" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledTimes(1));
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("top");

    fireEvent.change(screen.getByLabelText("Selected package label side"), {
      target: { value: "right" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const discardedFirst = placementRect("p1");
    fireEvent.pointerDown(discardedFirst, {
      pointerId: 3,
      clientX: 50,
      clientY: 250,
    });
    fireEvent.pointerUp(discardedFirst, {
      pointerId: 3,
      clientX: 50,
      clientY: 250,
    });
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("top");
    fireEvent.click(screen.getByRole("button", { name: "Reset original" }));
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    expect(screen.getByText("pick")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("transfer")).toBeTruthy();
    confirm.mockRestore();
  });

  it("preserves edits made while an older save is pending", async () => {
    let resolveSave: ((project: Project) => void) | undefined;
    const onSaveProject = vi.fn(
      (_project: Project) =>
        new Promise<Project>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onDraftChange = vi.fn<(project: Project | null) => void>();
    const onDirtyChange = vi.fn<(dirty: boolean) => void>();
    const view = renderEditor({
      onDraftChange,
      onDirtyChange,
      onSaveProject,
    });
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });
    const labelSide = screen.getByLabelText<HTMLSelectElement>(
      "Selected package label side",
    );
    fireEvent.change(labelSide, { target: { value: "top" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveProject).toHaveBeenCalledTimes(1);

    const submitted = onSaveProject.mock.calls[0]![0];
    fireEvent.change(labelSide, { target: { value: "right" } });
    const saved = projectSchema.parse({
      ...structuredClone(submitted),
      updatedAt: submitted.updatedAt + 1,
    });
    view.rerender(
      <ProjectEditorWorkspace
        project={saved}
        materialization={view.materialization}
        onDraftChange={onDraftChange}
        onDirtyChange={onDirtyChange}
        onSaveProject={onSaveProject}
      />,
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("right");

    resolveSave?.(saved);
    await waitFor(() =>
      expect(screen.getByText("Unsaved editor changes")).toBeTruthy(),
    );
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("right");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
    ).toBe(false);
    expect(
      onDraftChange.mock.calls.at(-1)?.[0]?.solutions[0]?.patterns[0]
        ?.placements[0]?.labelSide,
    ).toBe("right");
    expect(onDirtyChange.mock.calls.at(-1)?.[0]).toBe(true);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    const discardedFirst = placementRect("p1");
    fireEvent.pointerDown(discardedFirst, {
      pointerId: 3,
      clientX: 50,
      clientY: 250,
    });
    fireEvent.pointerUp(discardedFirst, {
      pointerId: 3,
      clientX: 50,
      clientY: 250,
    });
    expect(
      screen.getByLabelText<HTMLSelectElement>("Selected package label side")
        .value,
    ).toBe("top");
    confirm.mockRestore();
  });

  it("resets flow stepping when the active pattern changes", async () => {
    renderEditor({ project: projectWithSecondPattern() });
    fireEvent.click(screen.getByRole("button", { name: "Flow" }));
    const toolbar = screen.getByRole("toolbar", {
      name: "Flow stepping controls",
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Next" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Next" }));
    expect(within(toolbar).getByText(/^3 \/ \d+$/)).toBeTruthy();
    expect(screen.getByText("place")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Editor active pattern"), {
      target: { value: "pattern-2" },
    });

    await waitFor(() =>
      expect(within(toolbar).getByText(/^1 \/ \d+$/)).toBeTruthy(),
    );
    expect(screen.getByText("pick")).toBeTruthy();
  });
});
