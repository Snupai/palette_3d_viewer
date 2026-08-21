import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import type { Gripper, Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverResult } from "~/domain/solver";
import {
  SolverControls,
  type GeneratorPackageInputs,
} from "~/features/candidates/SolverControls";

const clientMocks = vi.hoisted(() => ({
  run: vi.fn(),
  dispose: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("~/workers/solverClient", () => ({
  createLayerSolverClient: () => ({
    run: clientMocks.run,
    dispose: clientMocks.dispose,
  }),
  SolverRunCancelledError: class SolverRunCancelledError extends Error {},
}));

const completedResult: SolverResult = {
  status: "completed",
  candidates: [],
  diagnostics: [],
  exclusions: [],
  statistics: {
    generatedDraftCount: 0,
    validDraftCount: 0,
    invalidDraftCount: 0,
    geometricDuplicateCount: 0,
    candidateCount: 0,
    generatedByFamily: {
      row: 0,
      block: 0,
      "justified-grid": 0,
      pinwheel: 0,
      "nested-side": 0,
      "edge-ring": 0,
      "mixed-orientation": 0,
      symmetry: 0,
    },
  },
};

const gripper: Gripper = {
  id: "solver-controls-gripper",
  name: "Solver controls suction",
  externalId: null,
  isDefault: true,
  maxPickupLengthMm: 150,
  tcpMm: { x: 0, y: 0, z: 0 },
  envelopeMm: {
    negativeX: 20,
    positiveX: 20,
    negativeY: 20,
    positiveY: 20,
  },
  inletOrientation: "any",
  allowedPlaceRotations: [0, 90, 180, 270],
  packageLimits: {
    lengthMm: { min: 1, max: 1_000 },
    widthMm: { min: 1, max: 1_000 },
    heightMm: { min: 1, max: 1_000 },
  },
  settings: { type: "suction", multipickSinglePlace: false },
};

function project(): Project {
  return createProject(
    {
      id: "solver-controls-project",
      projectNumber: "SOLVER-CONTROLS",
      package: {
        dimensionsMm: { length: 120, width: 80, height: 60 },
        multiPickAllowed: false,
      },
      pallet: {
        id: "pallet-1",
        name: "Test pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: null,
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      grippers: [],
      palletStations: [],
      selectedGripperId: null,
      selectedPalletStationId: null,
    },
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
}

beforeEach(() => {
  clientMocks.cancel.mockReset();
  clientMocks.dispose.mockReset();
  clientMocks.run.mockReset();
  clientMocks.run.mockReturnValue({
    runId: "solver-controls-run",
    cancel: clientMocks.cancel,
    result: Promise.resolve(completedResult),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SolverControls", () => {
  it("applies package dimensions and signed underhang with an exact layer count", async () => {
    const sourceProject = project();
    const onApplyPackageInputs = vi.fn(
      async ({
        dimensionsMm,
        inletOrientation,
        multiPickAllowed,
      }: GeneratorPackageInputs) =>
        updateProject(sourceProject, {
          package: {
            ...sourceProject.package,
            dimensionsMm,
            inletOrientation,
            multiPickAllowed,
          },
        }),
    );
    const onResult = vi.fn();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={onApplyPackageInputs}
        onResult={onResult}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Package length")).toHaveProperty(
      "value",
      "120",
    );
    expect(
      screen.getByLabelText("Length overhang / underhang per side"),
    ).toHaveProperty("value", "0");
    expect(
      screen.getByRole("checkbox", {
        name: "Allow mixed lengthwise / crosswise orientations",
      }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("checkbox", { name: "Allow multipick" }),
    ).toHaveProperty("checked", false);
    expect(screen.getByLabelText("Automatic group limit")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("radio", { name: "Lengthwise" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByRole("radio", { name: "Crosswise" })).toHaveProperty(
      "checked",
      false,
    );
    expect(
      screen
        .getByLabelText("Infeed direction: left to right")
        .getAttribute("data-infeed-direction"),
    ).toBe("left-to-right");
    expect(
      screen.getAllByRole("button", { name: /displayed .* edge/i }),
    ).toHaveLength(4);
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed top edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed right edge",
      }),
    );
    expect(screen.getByText(/No gripper is selected/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Package length"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Package width"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("Package height"), {
      target: { value: "40" },
    });
    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(
      screen.getByLabelText("Width overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() =>
      expect(onApplyPackageInputs).toHaveBeenCalledWith({
        dimensionsMm: { length: 100, width: 50, height: 40 },
        inletOrientation: "lengthwise",
        multiPickAllowed: false,
      }),
    );
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    const solverInput = clientMocks.run.mock.calls[0]?.[0] as LayerSolverInput;
    expect(solverInput).toMatchObject({
      package: { dimensionsMm: { length: 100, width: 50 } },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 400,
        maxY: 300,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      generationBoundsMm: {
        minX: 100,
        minY: 100,
        maxX: 300,
        maxY: 200,
      },
      constraints: {
        minimumPackageCount: 3,
        maximumPackageCount: 3,
        allowMixedPackageOrientations: true,
        unrotatedPackageLabelSide: "right",
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(completedResult, solverInput),
    );
    expect(sourceProject.package.labelSidesAtPickup).toEqual([]);
  });

  it("authorizes multipick explicitly and defaults automatic grouping to doubles", async () => {
    const sourceProject = project();
    const onApplyPackageInputs = vi.fn(
      async ({
        dimensionsMm,
        inletOrientation,
        multiPickAllowed,
      }: GeneratorPackageInputs) =>
        updateProject(sourceProject, {
          package: {
            ...sourceProject.package,
            dimensionsMm,
            inletOrientation,
            multiPickAllowed,
          },
        }),
    );

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={onApplyPackageInputs}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow multipick" }));

    expect(
      screen.getByRole("checkbox", { name: "Allow multipick" }),
    ).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Automatic group limit")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("Automatic group limit")).toHaveProperty(
      "value",
      "2",
    );
    expect(screen.getByText(/automatic grouping enabled up to 2/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() =>
      expect(onApplyPackageInputs).toHaveBeenCalledWith({
        dimensionsMm: { length: 120, width: 80, height: 60 },
        inletOrientation: "lengthwise",
        multiPickAllowed: true,
      }),
    );
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: { provisionalPackagesPerCycle: 2 },
    });
  });

  it("caps generated groups by the selected gripper pickup length", async () => {
    const sourceProject = project();
    const configuredProject = updateProject(sourceProject, {
      package: {
        ...sourceProject.package,
        multiPickAllowed: true,
      },
      grippers: [gripper],
      selectedGripperId: gripper.id,
    });

    render(
      <SolverControls
        project={configuredProject}
        onApplyPackageInputs={async () => configuredProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "2" },
    });

    expect(
      screen.getByRole("checkbox", { name: "Allow multipick" }),
    ).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Automatic group limit")).toHaveProperty(
      "value",
      "2",
    );
    expect(screen.getByText(/automatic grouping enabled up to 1/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: { provisionalPackagesPerCycle: 1 },
    });
  });

  it("launches a matching creation request exactly once with the requested count", async () => {
    const sourceProject = project();
    const configuredProject = updateProject(sourceProject, {
      package: {
        ...sourceProject.package,
        multiPickAllowed: true,
      },
      grippers: [gripper],
      selectedGripperId: gripper.id,
    });
    const launchRequest = {
      requestId: "creation-request-1",
      projectId: configuredProject.id,
      exactPackageCount: 3,
    };
    const onApplyPackageInputs = vi.fn(async () => configuredProject);
    const onLaunchRequestConsumed = vi.fn();
    const onResult = vi.fn();
    const onReset = vi.fn();
    const view = render(
      <SolverControls
        project={configuredProject}
        launchRequest={launchRequest}
        onLaunchRequestConsumed={onLaunchRequestConsumed}
        onApplyPackageInputs={onApplyPackageInputs}
        onResult={onResult}
        onReset={onReset}
      />,
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(onLaunchRequestConsumed).toHaveBeenCalledTimes(1);
    expect(onLaunchRequestConsumed).toHaveBeenCalledWith(
      launchRequest.requestId,
    );
    expect(onApplyPackageInputs).toHaveBeenCalledTimes(1);
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: {
        minimumPackageCount: 3,
        maximumPackageCount: 3,
        provisionalPackagesPerCycle: 1,
      },
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));

    view.rerender(
      <SolverControls
        project={configuredProject}
        launchRequest={launchRequest}
        onLaunchRequestConsumed={onLaunchRequestConsumed}
        onApplyPackageInputs={onApplyPackageInputs}
        onResult={onResult}
        onReset={onReset}
      />,
    );
    await Promise.resolve();

    expect(clientMocks.run).toHaveBeenCalledTimes(1);
    expect(onLaunchRequestConsumed).toHaveBeenCalledTimes(1);
    expect(onApplyPackageInputs).toHaveBeenCalledTimes(1);
  });

  it("ignores creation requests for another project", async () => {
    const sourceProject = project();
    const onLaunchRequestConsumed = vi.fn();
    const onReset = vi.fn();

    render(
      <SolverControls
        project={sourceProject}
        launchRequest={{
          requestId: "creation-request-other",
          projectId: "another-project",
          exactPackageCount: 4,
        }}
        onLaunchRequestConsumed={onLaunchRequestConsumed}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );
    await Promise.resolve();

    expect(clientMocks.run).not.toHaveBeenCalled();
    expect(onLaunchRequestConsumed).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Packages per layer")).toHaveProperty(
      "value",
      "",
    );
  });

  it("disables multipick controls while a solver run is pending", async () => {
    let resolveResult!: (result: SolverResult) => void;
    const pendingResult = new Promise<SolverResult>((resolve) => {
      resolveResult = resolve;
    });
    clientMocks.run.mockReturnValue({
      runId: "solver-controls-pending-run",
      cancel: clientMocks.cancel,
      result: pendingResult,
    });
    const sourceProject = project();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow multipick" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("checkbox", { name: "Allow multipick" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Automatic group limit")).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(clientMocks.cancel).toHaveBeenCalledTimes(1);
    resolveResult(completedResult);
    await Promise.resolve();
  });

  it("discards a completed run when saved multipick authorization changes", async () => {
    const sourceProject = project();
    const onReset = vi.fn();
    const { rerender } = render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );
    expect(await screen.findByText(/Completed: 0 candidates/)).toBeTruthy();
    onReset.mockClear();

    const authorizedProject = updateProject(sourceProject, {
      package: {
        ...sourceProject.package,
        multiPickAllowed: true,
      },
    });
    rerender(
      <SolverControls
        project={authorizedProject}
        onApplyPackageInputs={async () => authorizedProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Allow multipick" }),
      ).toHaveProperty("checked", true),
    );
    expect(screen.queryByText(/Completed: 0 candidates/)).toBeNull();
    expect(
      await screen.findByText(
        "The previous solver run was discarded because generator inputs changed.",
      ),
    ).toBeTruthy();
    expect(onReset).toHaveBeenCalled();
  });

  it("seeds only an unambiguous package label face and reseeds when that metadata changes", async () => {
    const sourceProject = project();
    const singletonProject = updateProject(sourceProject, {
      package: {
        ...sourceProject.package,
        inletOrientation: "crosswise",
        labelSidesAtPickup: ["left"],
      },
    });
    const onReset = vi.fn();
    const { rerender } = render(
      <SolverControls
        project={singletonProject}
        onApplyPackageInputs={async () => singletonProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    expect(screen.getByRole("radio", { name: "Crosswise" })).toHaveProperty(
      "checked",
      true,
    );
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed bottom edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    const ambiguousProject = updateProject(singletonProject, {
      package: {
        ...singletonProject.package,
        labelSidesAtPickup: ["top", "right"],
      },
    });
    rerender(
      <SolverControls
        project={ambiguousProject}
        onApplyPackageInputs={async () => ambiguousProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "No label" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(onReset).toHaveBeenCalled();
  });

  it("preserves the label face but discards a completed run when same-project dimensions change", async () => {
    const sourceProject = project();
    const onReset = vi.fn();
    const { rerender } = render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed bottom edge",
      }),
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );
    expect(await screen.findByText(/Completed: 0 candidates/)).toBeTruthy();
    onReset.mockClear();

    const resizedProject = updateProject(sourceProject, {
      package: {
        ...sourceProject.package,
        dimensionsMm: { length: 130, width: 90, height: 70 },
      },
    });
    rerender(
      <SolverControls
        project={resizedProject}
        onApplyPackageInputs={async () => resizedProject}
        onResult={vi.fn()}
        onReset={onReset}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Package length")).toHaveProperty(
        "value",
        "130",
      ),
    );
    expect(screen.getByLabelText("Package width")).toHaveProperty(
      "value",
      "90",
    );
    expect(screen.getByLabelText("Package height")).toHaveProperty(
      "value",
      "70",
    );
    expect(
      screen
        .getByRole("button", {
          name: "Select label on displayed bottom edge",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText(/Completed: 0 candidates/)).toBeNull();
    expect(
      await screen.findByText(
        "The previous solver run was discarded because generator inputs changed.",
      ),
    ).toBeTruthy();
    expect(onReset).toHaveBeenCalled();
  });

  it("centers the requested block in a non-zero effective pallet envelope", async () => {
    const sourceProject = project();
    const underhangProject = updateProject(sourceProject, {
      pallet: {
        ...sourceProject.pallet!,
        allowedOverhangMm: { length: -20, width: -10 },
      },
    });

    render(
      <SolverControls
        project={underhangProject}
        onApplyPackageInputs={async () => underhangProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(
      screen.getByLabelText("Width overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 400,
        maxY: 300,
      },
      envelopeMm: { minX: 20, minY: 10, maxX: 380, maxY: 290 },
      generationBoundsMm: {
        minX: 100,
        minY: 100,
        maxX: 300,
        maxY: 200,
      },
    });
  });

  it("uses authorized positive overhang once and preserves the saved pallet policy", async () => {
    const sourceProject = project();
    const overhangProject = updateProject(sourceProject, {
      pallet: {
        ...sourceProject.pallet!,
        allowedOverhangMm: { length: 20, width: 10 },
      },
    });
    const onApplyPackageInputs = vi.fn(async () => overhangProject);

    render(
      <SolverControls
        project={overhangProject}
        onApplyPackageInputs={onApplyPackageInputs}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Length overhang / underhang per side"),
    ).toHaveProperty("value", "20");
    expect(
      screen.getByLabelText("Width overhang / underhang per side"),
    ).toHaveProperty("value", "10");
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Allow mixed lengthwise / crosswise orientations",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 400,
        maxY: 300,
      },
      envelopeMm: { minX: -20, minY: -10, maxX: 420, maxY: 310 },
      generationBoundsMm: {
        minX: -20,
        minY: -10,
        maxX: 420,
        maxY: 310,
      },
      constraints: {
        allowMixedPackageOrientations: false,
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
    expect(overhangProject.pallet?.allowedOverhangMm).toEqual({
      length: 20,
      width: 10,
    });
  });

  it("uses compact centered footprints when both allowances are zero, including negative zero", async () => {
    const sourceProject = project();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Zero on both axes creates a tight centered footprint/),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "-0" } },
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      generationBoundsMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        rectangularBlockFootprintPolicy: "compact-centered",
        requiredShape: "any",
      },
    });
    expect(sourceProject.pallet?.allowedOverhangMm).toEqual({
      length: 0,
      width: 0,
    });
  });

  it("keeps explicit partial-axis underhang in frame-filling mode", async () => {
    const sourceProject = project();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByLabelText("Width overhang / underhang per side"),
      { target: { value: "-0.001" } },
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      generationBoundsMm: {
        minX: 0,
        minY: 0.001,
        maxX: 400,
        maxY: 299.999,
      },
      constraints: {
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
  });

  it("blocks solving until count and signed allowances are valid", () => {
    render(
      <SolverControls
        project={project()}
        onApplyPackageInputs={async () => project()}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Packages per layer must be a positive integer.",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Apply inputs & solve",
      }).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "3" },
    });
    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "" } },
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Length overhang / underhang per side is required.",
    );

    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "1" } },
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The requested generation envelope must fit inside the project-authorized pallet envelope.",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Apply inputs & solve",
      }).disabled,
    ).toBe(true);
  });
});
