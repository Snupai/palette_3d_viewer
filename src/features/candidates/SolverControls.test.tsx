import { getMultipackEquipmentProfile } from "~/domain/project/equipmentProfiles";
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
import {
  solveLayer,
  type LayerSolverInput,
  type SolverResult,
} from "~/domain/solver";
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

/** Runs the user started; combined mode adds one legacy background run. */
function primaryRuns() {
  return clientMocks.run.mock.calls.filter(
    ([, options]) =>
      (options as { generatorScope?: string } | undefined)?.generatorScope !==
      "legacy",
  );
}

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
      "crossed-strip": 0,
      "stepped-strip": 0,
      "stepped-block": 0,
      "slice-grid": 0,
      "paired-grid": 0,
      mosaic: 0,
      "rounded-slice": 0,
      "anchored-ring": 0,
      "capped-ring": 0,
      "asymmetric-ring": 0,
      "nested-edge": 0,
      "nested-strip": 0,
      staircase: 0,
      "staircase-variable": 0,
      "staircase-exchange": 0,
      multipack: 0,
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
  it("splits the total underhang to reproduce a 1162 by 738 mm frame", async () => {
    const source = project();
    const plan = updateProject(source, {
      package: {
        ...source.package,
        dimensionsMm: { length: 204, width: 110, height: 193 },
      },
      pallet: {
        ...source.pallet!,
        dimensionsMm: {
          ...source.pallet!.dimensionsMm,
          length: 1200,
          width: 800,
        },
      },
    });
    render(
      <SolverControls
        project={plan}
        onApplyPackageInputs={async () => plan}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "-38" },
    });
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Breite gesamt"), {
      target: { value: "-62" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "38" },
    });
    expect(screen.getByText("Wirksamer Rahmen: 1162 × 738 mm")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );
    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      generationBoundsMm: { minX: 19, minY: 31, maxX: 1181, maxY: 769 },
      constraints: { minimumPackageCount: 38, maximumPackageCount: 38 },
    });
  });

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

    expect(screen.getByLabelText("Paketlänge")).toHaveProperty("value", "120");
    expect(
      screen.getByLabelText("Über-/Unterstand Länge gesamt"),
    ).toHaveProperty("value", "0");
    expect(
      screen.getByRole("checkbox", {
        name: "Gemischte Ausrichtungen längs / quer erlauben",
      }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    ).toHaveProperty("checked", false);
    expect(screen.getByLabelText("Automatisches Gruppenlimit")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("radio", { name: "Längs" })).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByRole("radio", { name: "Quer" })).toHaveProperty(
      "checked",
      false,
    );
    expect(
      screen
        .getByLabelText("Einlaufrichtung: von links nach rechts")
        .getAttribute("data-infeed-direction"),
    ).toBe("left-to-right");
    expect(
      screen.getAllByRole("button", { name: /angezeigten Rand/i }),
    ).toHaveLength(4);
    expect(
      screen
        .getByRole("button", {
          name: "Etikett am angezeigten Rand oben wählen",
        })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Etikett am angezeigten Rand rechts wählen",
      }),
    );
    expect(screen.getByText(/kein Greifer ausgewählt/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Paketlänge"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Paketbreite"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("Pakethöhe"), {
      target: { value: "40" },
    });
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "-100" },
    });
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Breite gesamt"), {
      target: { value: "-100" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() =>
      expect(onApplyPackageInputs).toHaveBeenCalledWith({
        dimensionsMm: { length: 100, width: 50, height: 40 },
        inletOrientation: "lengthwise",
        multiPickAllowed: false,
      }),
    );
    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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
        minX: 50,
        minY: 50,
        maxX: 350,
        maxY: 250,
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

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    );

    expect(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    ).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Automatisches Gruppenlimit")).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByLabelText("Automatisches Gruppenlimit")).toHaveProperty(
      "value",
      "2",
    );
    expect(
      screen.getByText(/automatische Gruppierung aktiviert bis 2/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() =>
      expect(onApplyPackageInputs).toHaveBeenCalledWith({
        dimensionsMm: { length: 120, width: 80, height: 60 },
        inletOrientation: "lengthwise",
        multiPickAllowed: true,
      }),
    );
    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "2" },
    });

    expect(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    ).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Automatisches Gruppenlimit")).toHaveProperty(
      "value",
      "2",
    );
    expect(
      screen.getByText(/automatische Gruppierung aktiviert bis 1/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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
    // MultiPack result, then the result with the background legacy run appended.
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));

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

    expect(primaryRuns()).toHaveLength(1);
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
    expect(screen.getByLabelText("Pakete je Lage")).toHaveProperty("value", "");
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

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
    expect(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Automatisches Gruppenlimit")).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(clientMocks.cancel).toHaveBeenCalledTimes(1);
    resolveResult(completedResult);
    await Promise.resolve();
  });

  it("shows MultiPack first and appends the legacy run from the background", async () => {
    const [first, second] = solveLayer(
      {
        package: {
          shape: "cuboid",
          dimensionsMm: { length: 100, width: 50 },
          clearanceMm: 0,
        },
        envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
        constraints: { minimumPackageCount: 24, maximumPackageCount: 24 },
      },
      { generatorScope: "multipack" },
    ).candidates;
    let resolveLegacy!: (result: SolverResult) => void;
    clientMocks.run
      .mockReturnValueOnce({
        runId: "multipack-run",
        cancel: clientMocks.cancel,
        result: Promise.resolve({ ...completedResult, candidates: [first!] }),
      })
      .mockReturnValueOnce({
        runId: "legacy-run",
        cancel: clientMocks.cancel,
        result: new Promise<SolverResult>((resolve) => {
          resolveLegacy = resolve;
        }),
      });
    const sourceProject = project();
    const onResult = vi.fn();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={onResult}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "24" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(
      clientMocks.run.mock.calls.map(
        ([, options]) =>
          (options as { generatorScope?: string }).generatorScope,
      ),
    ).toEqual(["multipack", "legacy"]);
    expect(
      screen.getByText(/Alter Generator läuft im Hintergrund/),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Eingaben übernehmen und lösen",
      }).disabled,
    ).toBe(false);

    resolveLegacy({ ...completedResult, candidates: [first!, second!] });
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    const merged = onResult.mock.calls[1]?.[0] as SolverResult;
    expect(merged.candidates.map(({ id, rank }) => [id, rank])).toEqual([
      [first!.id, 1],
      [second!.id, 2],
    ]);
    expect(
      screen.queryByText(/Alter Generator läuft im Hintergrund/),
    ).toBeNull();
  });

  it("runs only the legacy generators when selected", async () => {
    const sourceProject = project();
    const onResult = vi.fn();
    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={onResult}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Generator"), {
      target: { value: "legacy" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(
      clientMocks.run.mock.calls.map(
        ([, options]) =>
          (options as { generatorScope?: string }).generatorScope,
      ),
    ).toEqual(["legacy"]);
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

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );
    expect(await screen.findByText(/Abgeschlossen: 0 Kandidaten/)).toBeTruthy();
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
        screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
      ).toHaveProperty("checked", true),
    );
    expect(screen.queryByText(/Abgeschlossen: 0 Kandidaten/)).toBeNull();
    expect(
      await screen.findByText(
        "Der vorherige Solver-Lauf wurde verworfen, weil sich die Generator-Eingaben geändert haben.",
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

    expect(screen.getByRole("radio", { name: "Quer" })).toHaveProperty(
      "checked",
      true,
    );
    expect(
      screen
        .getByRole("button", {
          name: "Etikett am angezeigten Rand unten wählen",
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
          .getByRole("button", { name: "Kein Etikett" })
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
        name: "Etikett am angezeigten Rand unten wählen",
      }),
    );
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );
    expect(await screen.findByText(/Abgeschlossen: 0 Kandidaten/)).toBeTruthy();
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
      expect(screen.getByLabelText("Paketlänge")).toHaveProperty(
        "value",
        "130",
      ),
    );
    expect(screen.getByLabelText("Paketbreite")).toHaveProperty("value", "90");
    expect(screen.getByLabelText("Pakethöhe")).toHaveProperty("value", "70");
    expect(
      screen
        .getByRole("button", {
          name: "Etikett am angezeigten Rand unten wählen",
        })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText(/Abgeschlossen: 0 Kandidaten/)).toBeNull();
    expect(
      await screen.findByText(
        "Der vorherige Solver-Lauf wurde verworfen, weil sich die Generator-Eingaben geändert haben.",
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

    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "-100" },
    });
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Breite gesamt"), {
      target: { value: "-100" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 400,
        maxY: 300,
      },
      envelopeMm: { minX: 20, minY: 10, maxX: 380, maxY: 290 },
      generationBoundsMm: {
        minX: 50,
        minY: 50,
        maxX: 350,
        maxY: 250,
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
      screen.getByLabelText("Über-/Unterstand Länge gesamt"),
    ).toHaveProperty("value", "40");
    expect(
      screen.getByLabelText("Über-/Unterstand Breite gesamt"),
    ).toHaveProperty("value", "20");
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Gemischte Ausrichtungen längs / quer erlauben",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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

  it("authorizes a positive overhang typed beyond the pallet policy for this run only", async () => {
    const sourceProject = project();

    render(
      <SolverControls
        project={sourceProject}
        onApplyPackageInputs={async () => sourceProject}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      envelopeMm: { minX: -6, minY: 0, maxX: 406, maxY: 300 },
      generationBoundsMm: { minX: -6, minY: 0, maxX: 406, maxY: 300 },
    });
    expect(sourceProject.pallet?.allowedOverhangMm).toEqual({
      length: 0,
      width: 0,
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

    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "-0" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
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

    fireEvent.change(screen.getByLabelText("Über-/Unterstand Breite gesamt"), {
      target: { value: "-0.001" },
    });
    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Eingaben übernehmen und lösen" }),
    );

    await waitFor(() => expect(primaryRuns()).toHaveLength(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      generationBoundsMm: {
        minX: 0,
        minY: 0.0005,
        maxX: 400,
        maxY: 299.9995,
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
      "Pakete je Lage muss eine positive ganze Zahl sein.",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Eingaben übernehmen und lösen",
      }).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Über-/Unterstand Länge gesamt ist erforderlich.",
    );

    fireEvent.change(screen.getByLabelText("Über-/Unterstand Länge gesamt"), {
      target: { value: "1" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Eingaben übernehmen und lösen",
      }).disabled,
    ).toBe(false);
  });
  it("updates the profile-derived group capacity while preserving an explicit limit", () => {
    const base = project();
    const builtin = getMultipackEquipmentProfile().gripper;
    const configured = {
      ...base,
      grippers: [builtin],
      selectedGripperId: builtin.id,
      package: {
        ...base.package,
        multiPickAllowed: true,
        dimensionsMm: { length: 147, width: 104, height: 139 },
      },
    };
    render(
      <SolverControls
        project={configured}
        onApplyPackageInputs={async () => configured}
        onResult={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    const limit = screen.getByLabelText("Automatisches Gruppenlimit");
    expect(limit).toHaveProperty("value", "3");
    fireEvent.change(screen.getByLabelText("Paketlänge"), {
      target: { value: "151" },
    });
    expect(limit).toHaveProperty("value", "2");
    fireEvent.change(limit, { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Paketlänge"), {
      target: { value: "135" },
    });
    expect(limit).toHaveProperty("value", "1");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    );
    expect(limit).toHaveProperty("value", "3");
  });
});
