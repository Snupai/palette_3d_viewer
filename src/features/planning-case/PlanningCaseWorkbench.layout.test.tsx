import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { PlanningCaseWorkbench } from "~/features/planning-case/PlanningCaseWorkbench";
import type { PatternComparison } from "~/features/planning-case/planningCaseModel";

const unavailableComparison: PatternComparison = {
  status: "unavailable",
  referenceCount: 0,
  currentCount: 0,
  missingCount: 0,
  extraCount: 0,
  acceptedSymmetry: null,
  maximumAxisDisplacementMm: null,
  toleranceMm: 0.500001,
};

function workbenchProps(project: Project | null) {
  return {
    project,
    loadingProject: false,
    error: null,
    statusMessage: null,
    activeStage: "inputs" as const,
    onStageChange: vi.fn(),
    onOpenProjects: vi.fn(),
    onCreateProject: vi.fn(),
    onEditProject: vi.fn(),
    onOpenTool: vi.fn(),
    onImportRob: vi.fn(),
    solverResult: null,
    solverInput: null,
    candidates: [],
    selectedCandidate: null,
    selectedCandidateId: null,
    onApplyGeneratorPackageInputs: async () => {
      throw new Error("Generator inputs are not used in this test.");
    },
    onSolverResult: vi.fn(),
    onResetSolver: vi.fn(),
    onCandidateChange: vi.fn(),
    currentPreview: null,
    comparison: unavailableComparison,
    ledgerRows: [],
    currentPalletData: null,
    currentLayerIndex: 0,
    onCurrentLayerChange: vi.fn(),
    hasUnsavedChanges: false,
  };
}

afterEach(cleanup);

describe("PlanningCaseWorkbench layout", () => {
  it("contains the planning row and preserves narrow-screen header actions", () => {
    const { container } = render(
      <PlanningCaseWorkbench
        project={null}
        loadingProject={false}
        error={null}
        statusMessage={null}
        activeStage="inputs"
        onStageChange={vi.fn()}
        onOpenProjects={vi.fn()}
        onCreateProject={vi.fn()}
        onEditProject={vi.fn()}
        onOpenTool={vi.fn()}
        onImportRob={vi.fn()}
        solverResult={null}
        solverInput={null}
        candidates={[]}
        selectedCandidate={null}
        selectedCandidateId={null}
        onApplyGeneratorPackageInputs={async () => {
          throw new Error("Generator inputs are not used in this test.");
        }}
        onSolverResult={vi.fn()}
        onResetSolver={vi.fn()}
        onCandidateChange={vi.fn()}
        currentPreview={null}
        comparison={unavailableComparison}
        ledgerRows={[]}
        currentPalletData={null}
        currentLayerIndex={0}
        onCurrentLayerChange={vi.fn()}
        hasUnsavedChanges={false}
      />,
    );

    const grid = container.querySelector(".planning-case-grid");
    const header = container.querySelector("header.app-chrome");
    const projectIdentity = header?.querySelector("h1")?.parentElement;
    const headerActions = header?.querySelector("div:last-child");

    expect(grid).not.toBeNull();
    expect(grid!.classList.contains("h-full")).toBe(true);
    expect(grid!.classList.contains("min-h-0")).toBe(true);
    expect(grid!.classList.contains("grid-rows-[minmax(0,1fr)]")).toBe(true);
    expect(
      grid!.classList.contains(
        "grid-cols-[minmax(240px,280px)_minmax(480px,1fr)_minmax(260px,300px)]",
      ),
    ).toBe(true);

    expect(header?.classList.contains("grid")).toBe(true);
    expect(
      header?.classList.contains("grid-cols-[auto_minmax(0,1fr)_auto]"),
    ).toBe(true);
    expect(header?.classList.contains("md:flex")).toBe(true);
    expect(projectIdentity?.classList.contains("min-w-0")).toBe(true);
    expect(headerActions?.classList.contains("shrink-0")).toBe(true);
  });

  it("gates the engineering tools until their prerequisites exist", () => {
    const project = createProject(
      { id: "gate-project", projectNumber: "GATE" },
      { now: () => 1, createId: (kind) => `${kind}-gate` },
    );
    render(<PlanningCaseWorkbench {...workbenchProps(project)} />);

    const editor = screen.getByRole("button", { name: "Editor" });
    const robotics = screen.getByRole("button", { name: "Robotics" });
    const simulation = screen.getByRole("button", { name: "Simulation" });
    const report = screen.getByRole("button", { name: "Report" });

    expect(editor).toHaveProperty("disabled", true);
    expect(robotics).toHaveProperty("disabled", true);
    expect(simulation).toHaveProperty("disabled", true);
    expect(report).toHaveProperty("disabled", false);
    expect(robotics.title).toContain("no stack layers");
    expect(simulation.title).toContain("robot cycle");
  });

  it("uses the shared product language for the primary actions and stages", () => {
    const { unmount } = render(
      <PlanningCaseWorkbench {...workbenchProps(null)} />,
    );
    expect(
      screen.getByRole("button", { name: "Create pallet plan" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open .rob file" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Project inputs" }));
    unmount();

    const project = createProject(
      { id: "copy-project", projectNumber: "COPY" },
      { now: () => 1, createId: (kind) => `${kind}-copy` },
    );
    render(
      <PlanningCaseWorkbench
        {...workbenchProps(project)}
        activeStage="stack"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Compose the pallet sequence" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open stack composer" }),
    ).toBeTruthy();
  });
});
