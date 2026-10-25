import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { SolverCandidate, SolverResult } from "~/domain/solver";
import type {
  StackWorkspaceState,
  materializeStackWorkspace,
} from "~/features/stack/stackWorkspaceModel";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

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
vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));
vi.mock("~/features/stack/StackWorkspace", async () => {
  const model = await import("~/features/stack/stackWorkspaceModel");
  return {
    StackWorkspace: ({
      candidates,
      onSave,
      project,
      solverInput,
      onDirtyChange,
      onEditProject,
    }: {
      onDirtyChange: (dirty: boolean) => void;
      onEditProject: () => void;
      candidates: readonly SolverCandidate[];
      onSave: (
        state: StackWorkspaceState,
        materialized: ReturnType<typeof materializeStackWorkspace>,
      ) => Promise<void>;
      project: Parameters<typeof materializeStackWorkspace>[0];
      solverInput: Parameters<typeof materializeStackWorkspace>[2];
    }) => (
      <>
        <button onClick={() => onDirtyChange(true)}>Dirty stack draft</button>
        <button onClick={() => onEditProject()}>Edit stack inputs</button>
        <output data-testid="stack-candidate-ids">
          {candidates.map(({ id }) => id).join("|")}
        </output>
        <button
          type="button"
          onClick={() => {
            const state = model.rebuildStackSequence({
              ...model.createInitialStackWorkspaceState(candidates),
              requestedLayerCount: 10,
            });
            void onSave(
              state,
              model.materializeStackWorkspace(
                project,
                candidates,
                solverInput,
                state,
              ),
            );
          }}
        >
          Save stack draft
        </button>
      </>
    ),
  };
});

const solverResult: SolverResult = {
  status: "completed",
  candidates: [
    {
      rank: 1,
      id: "candidate-exact-4",
      geometryId: "geometry-exact-4",
      identityFingerprint: "identity-exact-4",
      geometryFingerprint: "geometry-fingerprint-exact-4",
      orderDependencies: [],
      placements: [
        {
          sequence: 0,
          positionMm: { x: 150, y: 125 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:1",
        },
        {
          sequence: 1,
          positionMm: { x: 250, y: 125 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:2",
        },
        {
          sequence: 2,
          positionMm: { x: 150, y: 175 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:3",
        },
        {
          sequence: 3,
          positionMm: { x: 250, y: 175 },
          rotation: 0,
          labelSide: null,
          gripId: "generated-grip:4",
        },
      ],
      grips: [
        { x: 150, y: 125 },
        { x: 250, y: 125 },
        { x: 150, y: 175 },
        { x: 250, y: 175 },
      ].map(({ x, y }, sequence) => ({
        id: `generated-grip:${sequence + 1}`,
        groupNumber: sequence + 1,
        sequence,
        pickX: 0,
        pickY: 0,
        pickRotation: 0 as const,
        x,
        y,
        rotation: 0 as const,
        numPackages: 1,
        dx: 0,
        dy: 0,
      })),
      provenance: [{ family: "row", variant: "test" }],
      validation: { valid: true, issues: [] },
      metrics: {
        packageCount: 4,
        occupiedAreaMm2: 20_000,
        utilization: 1,
        utilizationPercent: 100,
        boundingBlockLengthMm: 200,
        boundingBlockWidthMm: 100,
        boundingBlockAreaMm2: 20_000,
        provisionalCycleCount: 4,
        provisionalCycleBasis: "generated-grip-groups",
        multiPackBlocks: null,
        multiPackBlocksVerification: "unverified",
      },
      score: {
        value: 4,
        packageCount: 4,
        utilizationMillionths: 1_000_000,
        provisionalCycleCount: 4,
        boundingBlockAreaMm2: 20_000,
        boundingBlockPerimeterMm: 600,
        multiPackBlocks: null,
      },
    },
  ],
  diagnostics: [],
  exclusions: [],
  statistics: {
    generatedDraftCount: 1,
    validDraftCount: 1,
    invalidDraftCount: 0,
    geometricDuplicateCount: 0,
    candidateCount: 1,
    generatedByFamily: {
      row: 1,
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
      "edge-ring": 0,
      "mixed-orientation": 0,
      symmetry: 0,
    },
  },
};

function candidateVariant(
  rank: number,
  id: string,
  rotationOffset: 0 | 180,
  shiftX = 0,
): SolverCandidate {
  const source = solverResult.candidates[0]!;
  return {
    ...source,
    rank,
    id,
    geometryId: `geometry-${id}`,
    identityFingerprint: `identity-${id}`,
    geometryFingerprint: `geometry-fingerprint-${id}`,
    placements: source.placements.map((placement) => ({
      ...placement,
      positionMm: {
        x: placement.positionMm.x + shiftX,
        y: placement.positionMm.y,
      },
      rotation: ((placement.rotation + rotationOffset) % 360) as
        | 0
        | 90
        | 180
        | 270,
    })),
    grips: source.grips.map((grip) => ({
      ...grip,
      x: grip.x + shiftX,
      rotation: ((grip.rotation + rotationOffset) % 360) as 0 | 90 | 180 | 270,
    })),
  };
}

function emptyRepository() {
  return new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
}

function candidateListResult(count: number): SolverResult {
  return {
    ...solverResult,
    candidates: Array.from({ length: count }, (_, index) =>
      candidateVariant(index + 1, `candidate-${index + 1}`, 0, index),
    ),
    statistics: {
      ...solverResult.statistics,
      generatedDraftCount: count,
      validDraftCount: count,
      candidateCount: count,
    },
  };
}

function stackMetricValue(label: string): string | null {
  const term = screen.getByText(label);
  return term.parentElement?.querySelector("dd")?.textContent ?? null;
}

async function repositoryWithProject() {
  const repository = emptyRepository();
  const project = createProject(
    {
      id: "generator-project",
      projectNumber: "M5-GENERATOR",
      package: {
        dimensionsMm: { length: 120, width: 80, height: 60 },
        multiPickAllowed: false,
      },
      pallet: {
        id: "pallet-1",
        name: "Generator pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: null,
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
    },
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
  await repository.saveProject(project);
  return { project, repository };
}

beforeEach(() => {
  clientMocks.cancel.mockReset();
  clientMocks.dispose.mockReset();
  clientMocks.run.mockReset();
  clientMocks.run.mockReturnValue({
    runId: "workspace-generator-run",
    cancel: clientMocks.cancel,
    result: Promise.resolve(solverResult),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fillNewProjectPackageDimensions() {
  for (const [label, value] of [
    ["Artikelnummer", "A-1"],
    ["Länge", "400"],
    ["Breite", "300"],
    ["Höhe", "200"],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
}
async function createAndGenerate(repository: ProjectRepository, count = "4") {
  render(<PlannerProjectWorkspace repository={repository} />);
  fireEvent.click(
    screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
  );
  fillNewProjectPackageDimensions();
  fireEvent.change(screen.getByLabelText("Genaue Anzahl"), {
    target: { value: count },
  });
  fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
  await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
  await screen.findByRole("region", { name: "Muster auswählen" });
}
async function openFirst(repository: ProjectRepository) {
  render(<PlannerProjectWorkspace repository={repository} />);
  fireEvent.click(
    screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
  );
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Öffnen" }))[0]!,
  );
  await screen.findByRole("button", { name: "Weiter zu den Mustern" });
}
async function solveExisting(repository: ProjectRepository) {
  await openFirst(repository);
  fireEvent.click(
    screen.getByRole("button", { name: "Weiter zu den Mustern" }),
  );
  fireEvent.change(screen.getByLabelText("Pakete je Lage"), {
    target: { value: "4" },
  });
}

describe("PlannerProjectWorkspace guided generation integration", () => {
  it("does not let FIRST's pending save close or clean a new SECOND form", async () => {
    const repository = emptyRepository();
    const persist = repository.saveProject.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveSpy = vi
      .spyOn(repository, "saveProject")
      .mockImplementationOnce(async (project) => {
        await pending;
        return persist(project);
      });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PlannerProjectWorkspace repository={repository} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    );
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Artikelnummer"), {
      target: { value: "FIRST" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Nur speichern" }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    fireEvent.click(screen.getByRole("button", { name: /^Neuen Plan/ }));
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Artikelnummer"), {
      target: { value: "SECOND" },
    });
    await act(async () => {
      release();
      await pending;
    });
    await waitFor(async () =>
      expect(
        (await repository.listProjects()).projects.map((p) => p.productNumber),
      ).toEqual(["FIRST"]),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Artikelnummer").value).toBe(
      "SECOND",
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(screen.getByLabelText<HTMLInputElement>("Artikelnummer").value).toBe(
      "SECOND",
    );
  });

  it("preserves an in-flight search through the library and returns to its result", async () => {
    const { repository } = await repositoryWithProject();
    let complete!: (result: SolverResult) => void;
    const pending = new Promise<SolverResult>((resolve) => {
      complete = resolve;
    });
    clientMocks.run.mockReturnValueOnce({
      runId: "pending-navigation",
      cancel: clientMocks.cancel,
      result: pending,
    });
    await solveExisting(repository);
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    const cancels = clientMocks.cancel.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(clientMocks.cancel).toHaveBeenCalledTimes(cancels);
    await act(async () => {
      complete(solverResult);
      await pending;
    });
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Öffnen" }))[0]!,
    );
    await screen.findByRole("region", { name: "Muster auswählen" });
    expect(clientMocks.run).toHaveBeenCalledTimes(1);
  });

  it("checks geometry loss before saving and closes metadata inputs without discarding the stack", async () => {
    const repository = emptyRepository();
    await createAndGenerate(repository);
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    fireEvent.click(screen.getByRole("button", { name: "Dirty stack draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit stack inputs" }));
    const save = vi.spyOn(repository, "saveProject");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("Länge"), {
      target: { value: "410" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>("Länge").value).toBe("410");
    fireEvent.change(screen.getByLabelText("Länge"), {
      target: { value: "400" },
    });
    fireEvent.change(screen.getByLabelText("Artikelnummer"), {
      target: { value: "RENAMED" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Paket und Palette" }),
      ).toBeNull(),
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("stack-candidate-ids").textContent).toBe(
      "candidate-exact-4",
    );
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("stack-candidate-ids")).toBeTruthy();
  });

  it("does not overwrite inputs opened while a stack save is pending", async () => {
    const repository = emptyRepository();
    await createAndGenerate(repository);
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    const persist = repository.saveProject.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(repository, "saveProject")
      .mockImplementationOnce(async (project) => {
        await pending;
        return persist(project);
      });
    fireEvent.click(screen.getByRole("button", { name: "Save stack draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Edit stack inputs" }));
    fireEvent.change(screen.getByLabelText("Länge"), {
      target: { value: "410" },
    });
    await act(async () => {
      release();
      await pending;
    });
    await waitFor(async () =>
      expect(
        (await repository.listProjects()).projects[0]!.solutions[0]!.stack
          .layers,
      ).toHaveLength(10),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Länge").value).toBe("410");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(screen.getByLabelText<HTMLInputElement>("Länge").value).toBe("410");
  });

  it("keeps unsaved inputs when leaving is dismissed and discards them only after confirmation", async () => {
    render(<PlannerProjectWorkspace repository={emptyRepository()} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    );
    fireEvent.change(screen.getByLabelText("Länge"), {
      target: { value: "400" },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(confirm).toHaveBeenCalledWith(
      "Planliste öffnen: Ungespeicherte Änderungen verwerfen?",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Länge").value).toBe("400");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(screen.getByRole("region", { name: "Planbibliothek" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "＋ Neuer Plan" }));
    expect(screen.getByLabelText<HTMLInputElement>("Länge").value).toBe("");
  });

  it("returns to the start page when a new plan is cancelled and mirrors the screen in the URL", async () => {
    const repository = emptyRepository();
    render(<PlannerProjectWorkspace repository={repository} />);
    expect(window.location.pathname).toBe("/");
    fireEvent.click(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    );
    expect(window.location.pathname).toBe("/neu");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe("/");
    fireEvent.click(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    );
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Genaue Anzahl"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await screen.findByRole("region", { name: "Muster auswählen" });
    const savedId = (await repository.listProjects()).projects[0]!.id;
    expect(window.location.pathname).toBe(`/plan/${savedId}/muster`);
  });

  it("starts with the two explicit paths, saves inputs and solves exactly once", async () => {
    const repository = emptyRepository();
    await createAndGenerate(repository);
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: { minimumPackageCount: 4, maximumPackageCount: 4 },
    });
    expect(
      screen
        .getByRole("button", { name: "Muster 1 mit 4 Paketen wählen" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Stapel aufbauen" }),
    ).toHaveProperty("disabled", false);
    const saved = (await repository.listProjects()).projects;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.solutions[0]?.stack.layers).toEqual([]);
  });
  it("deduplicates choices while passing all raw variants to the stack", async () => {
    const duplicate = candidateVariant(2, "candidate-duplicate", 180);
    const distinct = candidateVariant(3, "candidate-distinct", 0);
    distinct.placements = distinct.placements.map((x) => ({
      ...x,
      positionMm: {
        ...x.positionMm,
        x: x.positionMm.x + (x.sequence >= 2 ? 300 : 0),
      },
    }));
    clientMocks.run.mockReturnValueOnce({
      runId: "dedup",
      cancel: clientMocks.cancel,
      result: Promise.resolve({
        ...solverResult,
        candidates: [solverResult.candidates[0]!, duplicate, distinct],
      }),
    });
    await createAndGenerate(emptyRepository());
    expect(
      screen.getAllByRole("button", {
        name: /Muster \d+ mit 4 Paketen wählen/,
      }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    expect(screen.getByTestId("stack-candidate-ids").textContent).toBe(
      "candidate-exact-4|candidate-duplicate|candidate-distinct",
    );
  });
  it("can save only the inputs without launching the worker", async () => {
    const repository = emptyRepository();
    render(<PlannerProjectWorkspace repository={repository} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Neuen Plan erstellen/ }),
    );
    fillNewProjectPackageDimensions();
    fireEvent.click(screen.getByRole("button", { name: "Nur speichern" }));
    await screen.findByRole("button", { name: "Weiter zu den Mustern" });
    expect(clientMocks.run).not.toHaveBeenCalled();
    expect((await repository.listProjects()).projects).toHaveLength(1);
  });
  it("reopens imported projects as plans and never starts generation", async () => {
    const repository = emptyRepository();
    await repository.saveProject(
      createProject(
        {
          id: "imported",
          projectNumber: "ROB-IMPORTED",
          source: { kind: "rob-import", fileName: "fixture.rob" },
        },
        { now: () => 1, createId: (k) => `imported-${k}` },
      ),
    );
    render(<PlannerProjectWorkspace repository={repository} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
    );
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Öffnen" }))[0]!,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Planbibliothek" }),
      ).toBeNull(),
    );
    expect(clientMocks.run).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Mustersuche" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Planungsschritte" })).toBeNull();
  });
  it("keeps zero-allowance search compact without changing the saved pallet policy", async () => {
    const { project, repository } = await repositoryWithProject();
    await solveExisting(repository);
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      generationBoundsMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        rectangularBlockFootprintPolicy: "compact-centered",
        requiredShape: "any",
      },
    });
    expect(
      (await repository.getProject(project.id)).project?.pallet
        ?.allowedOverhangMm,
    ).toEqual({ length: 0, width: 0 });
  });
  it("persists package and multipick changes before generation and keeps signed search allowance separate", async () => {
    const { project, repository } = await repositoryWithProject();
    await solveExisting(repository);
    fireEvent.click(screen.getByText("Suchparameter anpassen"));
    for (const [label, value] of [
      ["Paketlänge (mm)", "100"],
      ["Paketbreite (mm)", "50"],
      ["Pakethöhe (mm)", "40"],
      ["Über-/Unterstand Länge gesamt (mm)", "-100"],
      ["Über-/Unterstand Breite gesamt (mm)", "-100"],
    ])
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mehrfachgriff erlauben" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      package: { dimensionsMm: { length: 100, width: 50 } },
      generationBoundsMm: { minX: 50, minY: 50, maxX: 350, maxY: 250 },
      constraints: {
        minimumPackageCount: 4,
        maximumPackageCount: 4,
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
    const saved = (await repository.getProject(project.id)).project!;
    expect(saved.package.dimensionsMm).toEqual({
      length: 100,
      width: 50,
      height: 40,
    });
    expect(saved.package.multiPickAllowed).toBe(true);
    expect(saved.pallet?.allowedOverhangMm).toEqual({ length: 0, width: 0 });
  });
  it("keeps the selected candidate when composing the stack and changing filters", async () => {
    clientMocks.run.mockReturnValueOnce({
      runId: "many",
      cancel: clientMocks.cancel,
      result: Promise.resolve(candidateListResult(20)),
    });
    await createAndGenerate(emptyRepository(), "6");
    expect(
      screen.getAllByRole("button", {
        name: /Muster \d+ mit 4 Paketen wählen/,
      }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Genau Pakete je Lage"), {
      target: { value: "99" },
    });
    expect(
      screen.getByRole("heading", { name: "Kein Muster mit 99 Paketen" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Stapel aufbauen" }),
    ).toHaveProperty("disabled", false);
    fireEvent.click(
      screen.getByRole("button", { name: "Alle Muster anzeigen" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    expect(
      screen.getByTestId("stack-candidate-ids").textContent?.split("|"),
    ).toHaveLength(20);
    expect(clientMocks.run).toHaveBeenCalledTimes(1);
  });
  it("keeps candidates when a pre-solve project save lands before the in-flight worker result", async () => {
    const { repository } = await repositoryWithProject();
    let resolveRun!: (r: SolverResult) => void;
    clientMocks.run.mockReturnValue({
      runId: "pending",
      cancel: clientMocks.cancel,
      result: new Promise<SolverResult>((r) => {
        resolveRun = r;
      }),
    });
    await solveExisting(repository);
    fireEvent.click(screen.getByText("Suchparameter anpassen"));
    fireEvent.change(screen.getByLabelText("Paketlänge (mm)"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(
      (await repository.getProject("generator-project")).project?.package
        .dimensionsMm.length,
    ).toBe(100);
    await act(async () => {
      resolveRun(solverResult);
    });
    expect(
      await screen.findByRole("button", {
        name: "Muster 1 mit 4 Paketen wählen",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    expect(screen.getByTestId("stack-candidate-ids").textContent).toBe(
      "candidate-exact-4",
    );
  });
  it("saves a stack with exact totals and opens its real viewer and download", async () => {
    const repository = emptyRepository();
    await createAndGenerate(repository);
    fireEvent.click(screen.getByRole("button", { name: "Stapel aufbauen" }));
    fireEvent.click(screen.getByRole("button", { name: "Save stack draft" }));
    expect(
      await screen.findByRole("heading", { name: "Plan im Überblick" }),
    ).toBeTruthy();
    expect(stackMetricValue("Lagen")).toBe("10");
    expect(stackMetricValue("Pakete gesamt")).toBe("40");
    expect(
      screen.getByRole("button", { name: ".rob herunterladen" }),
    ).toHaveProperty("disabled", false);
    const saved = (await repository.listProjects()).projects[0]!;
    expect(saved.solutions[0]?.stack.layers).toHaveLength(10);
    expect(saved.solutions[0]?.origin).toBe("calculated");
    expect(screen.queryByTestId("robotics-workspace")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Muster erzeugen" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Muster 1 mit 4 Paketen wählen" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Stapel aufbauen" }),
    ).toHaveProperty("disabled", true);
  });
});
