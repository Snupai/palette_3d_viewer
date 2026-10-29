import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import {
  PlanningCaseWorkbench,
  type PlanningCaseWorkbenchProps,
} from "./PlanningCaseWorkbench";
function props(project: Project | null): PlanningCaseWorkbenchProps {
  return {
    project,
    loadingProject: false,
    error: null,
    statusMessage: null,
    activeStage: "inputs",
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
    onApplyGeneratorPackageInputs: vi.fn(),
    onSolverResult: vi.fn(),
    onResetSolver: vi.fn(),
    onCandidateChange: vi.fn(),
    currentPreview: null,
    comparison: {
      status: "unavailable",
      referenceCount: 0,
      currentCount: 0,
      missingCount: 0,
      extraCount: 0,
      acceptedSymmetry: null,
      maximumAxisDisplacementMm: null,
      toleranceMm: 0.500001,
    },
    ledgerRows: [],
    currentPalletData: null,
    currentLayerIndex: 0,
    onCurrentLayerChange: vi.fn(),
    hasUnsavedChanges: false,
  };
}
afterEach(cleanup);
describe("guided planning navigation", () => {
  it("shows sequential read-only steps and starts with inputs", () => {
    const p = props(null);
    render(<PlanningCaseWorkbench {...p} />);
    const steps = screen.getByRole("list", { name: "Planungsschritte" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(within(steps).queryByRole("button")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Neuen Plan erstellen" }),
    );
    expect(p.onCreateProject).toHaveBeenCalledOnce();
  });
  it("keeps production tools outside the sequential planning steps", () => {
    const p = props(
      createProject(
        { id: "inputs" },
        { now: () => 1, createId: (k) => `${k}-inputs` },
      ),
    );
    render(<PlanningCaseWorkbench {...p} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Weiter zu den Mustern" }),
    );
    expect(p.onStageChange).toHaveBeenCalledWith("generate");
    expect(screen.queryByRole("button", { name: "Simulation" })).toBeNull();
  });
  it("does not offer generation for an imported plan", () => {
    const p = props(
      createProject(
        {
          id: "imported",
          source: { kind: "rob-import", fileName: "demo.rob" },
        },
        { now: () => 1, createId: (k) => `${k}-imported` },
      ),
    );
    render(<PlanningCaseWorkbench {...p} />);
    expect(screen.queryByRole("list", { name: "Planungsschritte" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Mustersuche" })).toBeNull();
  });
});
