import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { SolverResult } from "~/domain/solver";
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

const solverResult: SolverResult = {
  status: "completed",
  candidates: [
    {
      rank: 1,
      id: "candidate-exact-4",
      geometryId: "geometry-exact-4",
      identityFingerprint: "identity-exact-4",
      geometryFingerprint: "geometry-fingerprint-exact-4",
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

async function repositoryWithProject() {
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
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

describe("PlannerProjectWorkspace generator integration", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /03 Generate/i }));
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
        requiredShape: "rectangular-block",
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
    fireEvent.click(screen.getByRole("button", { name: /03 Generate/i }));

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
        requiredShape: "rectangular-block",
        rectangularBlockFootprintPolicy: "fill-generation-bounds",
      },
    });
    expect(await screen.findByText("Geometry OK")).toBeTruthy();
    expect(screen.getByText("200 × 100")).toBeTruthy();
  });
});
