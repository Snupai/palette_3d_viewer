import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
    }: {
      candidates: readonly SolverCandidate[];
      onSave: (
        state: StackWorkspaceState,
        materialized: ReturnType<typeof materializeStackWorkspace>,
      ) => Promise<void>;
      project: Parameters<typeof materializeStackWorkspace>[0];
      solverInput: Parameters<typeof materializeStackWorkspace>[2];
    }) => (
      <>
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
  fireEvent.change(screen.getByLabelText("Length (mm)"), {
    target: { value: "400" },
  });
  fireEvent.change(screen.getByLabelText("Width (mm)"), {
    target: { value: "300" },
  });
  fireEvent.change(screen.getByLabelText("Height (mm)"), {
    target: { value: "200" },
  });
}

describe("PlannerProjectWorkspace generator integration", () => {
  it("creates a project, opens Generate, solves once, and selects the first suggestion", async () => {
    const repository = emptyRepository();

    render(<PlannerProjectWorkspace repository={repository} />);
    const createButtons = await screen.findAllByRole(
      "button",
      { name: "Create project" },
      { timeout: 5_000 },
    );
    fireEvent.click(createButtons[0]!);

    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "AUTO-GENERATE" },
    });
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: {
        minimumPackageCount: 4,
        maximumPackageCount: 4,
      },
    });
    expect(
      await screen.findByRole(
        "heading",
        { name: "AUTO-GENERATE" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Generate patterns" }),
    ).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    const selectedSuggestion = await screen.findByRole("option", {
      selected: true,
    });
    expect(selectedSuggestion.textContent).toContain("#1");
    expect(selectedSuggestion.textContent).toContain("Geometry OK");
    expect(clientMocks.run).toHaveBeenCalledTimes(1);

    const savedProjects = (await repository.listProjects()).projects;
    expect(savedProjects).toHaveLength(1);
    expect(savedProjects[0]?.solutions).toHaveLength(1);
    expect(savedProjects[0]?.solutions[0]).toMatchObject({
      origin: "manual",
      patterns: [],
      stack: { layers: [] },
      robotCycles: [],
    });
  });

  it("deduplicates visible candidate lists while preserving raw stack variants", async () => {
    const repository = emptyRepository();
    const duplicate = candidateVariant(2, "candidate-duplicate", 180);
    const distinct = candidateVariant(3, "candidate-distinct", 0, 300);
    const resultWithVisualDuplicate: SolverResult = {
      ...solverResult,
      candidates: [solverResult.candidates[0]!, duplicate, distinct],
      diagnostics: [
        {
          severity: "info",
          phase: "deduplication",
          code: "test-diagnostic",
          message: "Candidate grouping integration fixture.",
        },
      ],
      statistics: {
        ...solverResult.statistics,
        generatedDraftCount: 3,
        validDraftCount: 3,
        candidateCount: 3,
      },
    };
    clientMocks.run.mockReturnValueOnce({
      runId: "workspace-visual-dedup-run",
      cancel: clientMocks.cancel,
      result: Promise.resolve(resultWithVisualDuplicate),
    });

    render(<PlannerProjectWorkspace repository={repository} />);
    const createButtons = await screen.findAllByRole(
      "button",
      { name: "Create project" },
      { timeout: 5_000 },
    );
    fireEvent.click(createButtons[0]!);
    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "VISUAL-DEDUPE" },
    });
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    const compactOptions = await screen.findAllByRole("option", undefined, {
      timeout: 5_000,
    });
    expect(
      compactOptions.map((option) => option.querySelector("td")?.textContent),
    ).toEqual(["#1", "#3"]);
    expect(
      await screen.findByText(/3 candidates \(2 distinct layouts\)/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Open full diagnostics (1)" }),
    );
    const candidateDialog = await screen.findByRole("dialog", {
      name: "Candidate browser",
    });
    expect(within(candidateDialog).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(
      within(candidateDialog).getByRole("button", { name: "Close" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open stack composer" }),
    );
    expect((await screen.findByTestId("stack-candidate-ids")).textContent).toBe(
      "candidate-exact-4|candidate-duplicate|candidate-distinct",
    );
  });

  it("creates without solving when Save project is chosen", async () => {
    const repository = emptyRepository();

    render(<PlannerProjectWorkspace repository={repository} />);
    const createButtons = await screen.findAllByRole(
      "button",
      { name: "Create project" },
      { timeout: 5_000 },
    );
    fireEvent.click(createButtons[0]!);
    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "MANUAL-ONLY" },
    });
    fillNewProjectPackageDimensions();
    fireEvent.click(screen.getByRole("button", { name: "Save project" }));

    expect(
      await screen.findByRole(
        "heading",
        { name: "MANUAL-ONLY" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(clientMocks.run).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Project inputs" }),
    ).toBeTruthy();
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Generate/i })).toBeNull();
    expect((await repository.listProjects()).projects).toHaveLength(1);
  });

  it("does not auto-run when reopening an imported ROB project", async () => {
    const repository = emptyRepository();
    const importedProject = createProject(
      {
        id: "imported-generator-project",
        projectNumber: "ROB-IMPORTED",
        source: { kind: "rob-import", fileName: "fixture.rob" },
      },
      { now: () => 1, createId: (kind) => `${kind}-imported` },
    );
    await repository.saveProject(importedProject);

    render(<PlannerProjectWorkspace repository={repository} />);
    expect(
      await screen.findByRole(
        "heading",
        { name: "ROB-IMPORTED" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(clientMocks.run).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Imported .rob plan" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Planning workflow" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Layer solver" })).toBeNull();
  });

  it("runs zero-allowance generation as compact without changing the saved pallet policy", async () => {
    const { project, repository } = await repositoryWithProject();

    render(<PlannerProjectWorkspace repository={repository} />);
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-GENERATOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(clientMocks.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
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
    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(saved.project?.pallet?.allowedOverhangMm).toEqual({
        length: 0,
        width: 0,
      });
    });
  });

  it("persists package dimensions and multipick authorization before generating the requested layer", async () => {
    const { project, repository } = await repositoryWithProject();

    render(<PlannerProjectWorkspace repository={repository} />);
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-GENERATOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByLabelText("Package length"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Package width"), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByLabelText("Package height"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Crosswise" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Select label on displayed left edge",
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow multipick" }));
    fireEvent.change(
      screen.getByLabelText("Length overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(
      screen.getByLabelText("Width overhang / underhang per side"),
      { target: { value: "-100" } },
    );
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(saved.project?.package.dimensionsMm).toEqual({
        length: 100,
        width: 50,
        height: 40,
      });
      expect(saved.project?.pallet?.allowedOverhangMm).toEqual({
        length: 0,
        width: 0,
      });
      expect(saved.project?.package.inletOrientation).toBe("crosswise");
      expect(saved.project?.package.multiPickAllowed).toBe(true);
      expect(saved.project?.package.labelSidesAtPickup).toEqual([]);
    });
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      package: { dimensionsMm: { length: 100, width: 50 } },
      physicalPalletBoundsMm: {
        minX: 0,
        minY: 0,
        maxX: 400,
        maxY: 300,
      },
      generationBoundsMm: {
        minX: 100,
        minY: 100,
        maxX: 300,
        maxY: 200,
      },
      constraints: {
        minimumPackageCount: 4,
        maximumPackageCount: 4,
        allowMixedPackageOrientations: true,
        provisionalPackagesPerCycle: 2,
        unrotatedPackageLabelSide: "top",
        requiredShape: "any",
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
    expect(await screen.findByText("Geometry OK")).toBeTruthy();
    expect(screen.getByText("200 × 100")).toBeTruthy();
  });

  it("preserves generated candidates when continuing to the stack stage", async () => {
    const repository = emptyRepository();
    clientMocks.run.mockReturnValueOnce({
      runId: "workspace-continue-run",
      cancel: clientMocks.cancel,
      result: Promise.resolve(candidateListResult(20)),
    });

    render(<PlannerProjectWorkspace repository={repository} />);
    const createButtons = await screen.findAllByRole(
      "button",
      { name: "Create project" },
      { timeout: 5_000 },
    );
    fireEvent.click(createButtons[0]!);
    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "CONTINUE-KEEPS-CANDIDATES" },
    });
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "6" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    expect(clientMocks.run.mock.calls[0]?.[0]).toMatchObject({
      constraints: { minimumPackageCount: 6, maximumPackageCount: 6 },
    });
    const generatedOptions = await screen.findAllByRole("option", undefined, {
      timeout: 5_000,
    });
    expect(generatedOptions).toHaveLength(20);
    const selectedSuggestion = screen.getByRole("option", { selected: true });
    expect(selectedSuggestion.textContent).toContain("#1");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      screen.getByRole("heading", { name: "Compose the pallet sequence" }),
    ).toBeTruthy();
    expect(stackMetricValue("Generated candidates")).toBe("20");
    expect(stackMetricValue("Selectable layouts")).toBe("20");
    const openStackComposer = screen.getByRole("button", {
      name: "Open stack composer",
    });
    expect((openStackComposer as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getAllByRole("option")).toHaveLength(20);
    expect(screen.getByRole("option", { selected: true })).toBeTruthy();
  });

  it("keeps solver candidates when the pre-solve project save lands while the run is in flight", async () => {
    const { repository } = await repositoryWithProject();
    let resolveRun!: (result: SolverResult) => void;
    clientMocks.run.mockReturnValue({
      runId: "workspace-in-flight-save-run",
      cancel: clientMocks.cancel,
      result: new Promise<SolverResult>((resolve) => {
        resolveRun = resolve;
      }),
    });

    render(<PlannerProjectWorkspace repository={repository} />);
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-GENERATOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByLabelText("Package length"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Apply inputs & solve" }),
    );

    // The changed package dimensions force a project save before the worker
    // starts; wait until that save and the React effect flush after it have
    // both landed, then let the worker finish (production ordering).
    await waitFor(async () => {
      const saved = await repository.getProject("generator-project");
      expect(saved.project?.package.dimensionsMm.length).toBe(100);
    });
    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    resolveRun(solverResult);

    expect(
      await screen.findAllByRole("option", undefined, { timeout: 5_000 }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(stackMetricValue("Generated candidates")).toBe("1");
    expect(stackMetricValue("Selectable layouts")).toBe("1");
    const openStackComposer = screen.getByRole("button", {
      name: "Open stack composer",
    });
    expect((openStackComposer as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the saved stack totals on the stack stage after the stack is persisted", async () => {
    const repository = emptyRepository();
    clientMocks.run.mockReturnValueOnce({
      runId: "workspace-stack-save-run",
      cancel: clientMocks.cancel,
      result: Promise.resolve(candidateListResult(20)),
    });

    render(<PlannerProjectWorkspace repository={repository} />);
    const createButtons = await screen.findAllByRole(
      "button",
      { name: "Create project" },
      { timeout: 5_000 },
    );
    fireEvent.click(createButtons[0]!);
    fireEvent.change(screen.getByLabelText("Line number"), {
      target: { value: "STACK-TOTALS" },
    });
    fillNewProjectPackageDimensions();
    fireEvent.change(screen.getByLabelText("Packages per layer"), {
      target: { value: "6" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save and generate patterns" }),
    );

    await waitFor(() => expect(clientMocks.run).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    expect(
      await screen.findAllByRole("option", undefined, { timeout: 5_000 }),
    ).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open stack composer" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Save stack draft" }),
    );

    await waitFor(() => {
      expect(stackMetricValue("Visible layers")).toBe("10");
      // The fixture candidates carry 4 packages per layer.
      expect(stackMetricValue("Visible packages")).toBe("40");
    });
    expect(stackMetricValue("Generated candidates")).toBe("20");
    expect(stackMetricValue("Selectable layouts")).toBe("20");
    const openStackComposer = screen.getByRole("button", {
      name: "Open stack composer",
    });
    expect((openStackComposer as HTMLButtonElement).disabled).toBe(false);

    const saved = await repository.getProject(
      (await repository.listProjects()).projects[0]!.id,
    );
    expect(saved.project?.solutions[0]?.stack.layers).toHaveLength(10);
    expect(saved.project?.solutions[0]?.origin).toBe("calculated");
  });
});
