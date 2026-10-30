import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

/** Plain selection goes through pointer events; clicks only handle modifiers. */
function selectPlacement(id: string, pointerId = 1): void {
  const rect = placementRect(id);
  fireEvent.pointerDown(rect, { pointerId, clientX: 50, clientY: 250 });
  fireEvent.pointerUp(rect, { pointerId, clientX: 50, clientY: 250 });
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
    expect(screen.getByText("1 ausgewählt")).toBeTruthy();

    fireEvent.click(second, { ctrlKey: true });
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();

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
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();
  });

  it("keeps undo, Delete, arrows, and shortcuts out of form controls", () => {
    renderEditor();
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });

    const labelSelect =
      screen.getByLabelText<HTMLSelectElement>("Etikettseite");
    fireEvent.change(labelSelect, { target: { value: "top" } });
    expect(labelSelect.value).toBe("top");
    fireEvent.keyDown(labelSelect, { key: "z", ctrlKey: true });
    expect(labelSelect.value).toBe("top");

    const xInput = screen.getByLabelText<HTMLInputElement>("Position X");
    fireEvent.keyDown(xInput, { key: "Delete" });
    fireEvent.keyDown(xInput, { key: "ArrowRight" });
    expect(document.querySelectorAll("[data-placement-id]")).toHaveLength(4);
    expect(xInput.value).toBe("50");

    fireEvent.keyDown(screen.getByTestId("project-editor-workspace"), {
      key: "z",
      ctrlKey: true,
    });
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "",
    );
  });

  it("hides the solution and pattern selectors when there is only one", () => {
    renderEditor();
    expect(screen.queryByLabelText("Aktive Lösung")).toBeNull();
    expect(screen.queryByLabelText("Aktives Muster")).toBeNull();
    expect(screen.getByRole("heading", { name: "Pattern 1" })).toBeTruthy();
    // Without saved grips the model proposes two provisional grips.
    expect(screen.getByText("4 Pakete · 2 Griffe")).toBeTruthy();
  });

  it("shows a rejected command as an alert and keeps the typed position", () => {
    renderEditor();
    expect(screen.getByText("keine Hinweise")).toBeTruthy();
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });
    const xInput = screen.getByLabelText<HTMLInputElement>("Position X");
    fireEvent.change(xInput, { target: { value: "150" } });
    fireEvent.blur(xInput);
    expect(screen.getByRole("alert").textContent).toMatch(/overlap/);
    expect(xInput.value).toBe("150");
  });
});

describe("ProjectEditorWorkspace order and persistence", () => {
  it("builds a grip from the canvas selection and offers merging two grips", () => {
    renderEditor();
    fireEvent.click(screen.getByLabelText("Greifreihenfolge"));
    // Without saved grips the model proposes provisional ones, marked as new.
    expect(screen.getAllByText(/· neu$/)).toHaveLength(2);
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Griffe zusammenlegen (0)",
      }).disabled,
    ).toBe(true);

    // Face-adjacent neighbours along the package length can form a grip.
    // Creating one grip persists the remaining provisional grips as well.
    selectPlacement("p1");
    fireEvent.click(placementRect("p2"), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Griff aus Auswahl bilden (2)" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/· neu$/)).toBeNull();
    expect(screen.getByText("4 Pakete · 2 Griffe")).toBeTruthy();

    // A package click selects its whole grip; two grips enable merging.
    selectPlacement("p1");
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();
    fireEvent.click(placementRect("p3"), { ctrlKey: true });
    expect(screen.getByText("4 ausgewählt")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Griffe zusammenlegen (2)",
      }).disabled,
    ).toBe(false);
  });

  it("shows invalid dependency feedback and applies the automatic suggestion", async () => {
    renderEditor({ project: importedGripProject() });
    fireEvent.click(screen.getByLabelText("Greifreihenfolge"));

    fireEvent.change(
      screen.getByLabelText<HTMLSelectElement>("Abhängigkeit: zuerst"),
      { target: { value: "g2" } },
    );
    fireEvent.change(
      screen.getByLabelText<HTMLSelectElement>("Abhängigkeit: danach"),
      { target: { value: "g1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(await screen.findByText(/would create a cycle/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Automatisch ordnen" }));
    await waitFor(() =>
      expect(screen.queryByText(/would create a cycle/)).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Griff G1 auswählen" }),
    ).toBeTruthy();
  });

  it("recalculates imported grips automatically for inspection and editing", () => {
    const onDraftChange = vi.fn();
    renderEditor({ project: importedGripProject(), onDraftChange });
    fireEvent.click(screen.getByLabelText("Greifreihenfolge"));

    fireEvent.click(
      screen.getByRole("button", { name: "Griffe neu berechnen" }),
    );

    const draft = onDraftChange.mock.calls.at(-1)?.[0] as Project | null;
    const grips = draft?.solutions[0]?.patterns[0]?.grips ?? [];
    expect(grips.map(({ id }) => id)).not.toContain("g1");
    expect(grips.map(({ numPackages }) => numPackages)).toEqual([2, 2]);
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Griff G1 auswählen" }));
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();
  });

  it("renders inferred legacy dependencies as immutable and selects grips from the list", () => {
    renderEditor({ project: importedGripProject() });
    fireEvent.click(screen.getByLabelText("Greifreihenfolge"));

    expect(screen.getByText("aus der Geometrie abgeleitet")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Abhängigkeit G1 vor G2 entfernen",
      }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Griff G2 auswählen" }));
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Griff G2 auswählen" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("supports save, discard, and reset", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onSaveProject = vi.fn(async (value: Project) => value);
    renderEditor({ onSaveProject });
    const first = placementRect("p1");
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 50, clientY: 250 });
    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "top" },
    });
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "top",
    );

    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "right" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
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
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "top",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Original wiederherstellen" }),
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "",
    );
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
    const labelSide = screen.getByLabelText<HTMLSelectElement>("Etikettseite");
    fireEvent.change(labelSide, { target: { value: "top" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
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
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "right",
    );

    resolveSave?.(saved);
    await waitFor(() =>
      expect(screen.getByText("Ungespeicherte Änderungen")).toBeTruthy(),
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "right",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Speichern" })
        .disabled,
    ).toBe(false);
    expect(
      onDraftChange.mock.calls.at(-1)?.[0]?.solutions[0]?.patterns[0]
        ?.placements[0]?.labelSide,
    ).toBe("right");
    expect(onDirtyChange.mock.calls.at(-1)?.[0]).toBe(true);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
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
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "top",
    );
    confirm.mockRestore();
  });

  it("switches patterns through the selector and edits interlayers", () => {
    renderEditor({ project: projectWithSecondPattern() });
    fireEvent.change(screen.getByLabelText("Aktives Muster"), {
      target: { value: "pattern-2" },
    });
    expect(screen.getByRole("heading", { name: "Pattern 2" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Zwischenlagen unter Lage 2"), {
      target: { value: "1" },
    });
    expect(screen.getByText("1 Blatt")).toBeTruthy();
    expect(screen.getByText("Ungespeicherte Änderungen")).toBeTruthy();
  });
});
