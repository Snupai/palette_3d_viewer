"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { PalletData } from "~/domain/palletTypes";
import type {
  LayerSolverInput,
  SolverCandidate,
  SolverResult,
} from "~/domain/solver";
import { CandidateBrowser } from "~/features/candidates/CandidateBrowser";
import type {
  GeneratorLaunchRequest,
  GeneratorPackageInputs,
} from "~/features/candidates/SolverControls";
import { ProjectEditorWorkspace } from "~/features/editor/ProjectEditorWorkspace";
import { MpbInspector } from "~/features/legacy-mpb/MpbInspector";
import { CaseDrawer } from "~/features/planning-case/PlanningCaseChrome";
import {
  PlanningCaseWorkbench,
  type ProductionTool,
} from "~/features/planning-case/PlanningCaseWorkbench";
import type { PlanFieldMode } from "~/features/planning-case/MeasuredPlanField";
import {
  comparePatternPreviews,
  type PatternComparison,
  type PlanningStage,
  type ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";
import {
  ProjectDialog,
  type ProjectDialogSubmission,
} from "~/features/project/ProjectDialog";
import { ProjectLibrary } from "~/features/project/ProjectLibrary";
import { RoboticsWorkspace } from "~/features/robotics/RoboticsWorkspace";
import {
  createInitialRobotWorkspaceSettings,
  createRobotReadiness,
  materializeRobotWorkspace,
  type RobotWorkspaceSettings,
} from "~/features/robotics/robotWorkspaceModel";
import {
  createInitialStackWorkspaceState,
  materializeStackWorkspace,
  projectWithPersistedStack,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import {
  exportRepositoryPackageJson,
  importProjectPackageJson,
} from "~/lib/projectPackage";
import {
  materializedStackToPalletData,
  projectSolutionToPalletData,
  robotCycleMaterializationToPalletData,
} from "~/lib/projectAdapters";
import {
  palletLayerToPatternPreview,
  solverCandidateToPatternPreview,
} from "~/lib/previewAdapters";
import { parseRobText } from "~/lib/robParser";
import {
  createProjectRepository,
  type ProjectConflictPolicy,
  type ProjectRepository,
  type ProjectSortField,
  type RepositoryDiagnostic,
  type SortDirection,
} from "~/lib/projectRepository";

function ProductionToolLoading() {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-zinc-500">
      Loading production tool…
    </div>
  );
}

const Candidate3DWorkspace = dynamic(
  () =>
    import("~/features/project/Candidate3DWorkspace").then(
      (module) => module.Candidate3DWorkspace,
    ),
  { ssr: false, loading: ProductionToolLoading },
);

const LegacyPlanWorkspace = dynamic(
  () =>
    import("~/features/legacy-plan/LegacyPlanWorkspace").then(
      (module) => module.LegacyPlanWorkspace,
    ),
  { ssr: false, loading: ProductionToolLoading },
);

const ReportWorkspace = dynamic(
  () =>
    import("~/features/reporting/ReportWorkspace").then(
      (module) => module.ReportWorkspace,
    ),
  { ssr: false, loading: ProductionToolLoading },
);

const SimulationWorkspace = dynamic(
  () =>
    import("~/features/simulation/SimulationWorkspace").then(
      (module) => module.SimulationWorkspace,
    ),
  { ssr: false, loading: ProductionToolLoading },
);

const StackWorkspace = dynamic(
  () =>
    import("~/features/stack/StackWorkspace").then(
      (module) => module.StackWorkspace,
    ),
  { ssr: false, loading: ProductionToolLoading },
);

export type PlannerProjectWorkspaceProps = {
  repository?: ProjectRepository;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type DialogMode = "closed" | "create" | "edit";

type RobReference = {
  fileName: string;
  rawText: string;
  data: PalletData;
};

const productionToolTitles: Record<ProductionTool, string> = {
  "candidate-browser": "Candidate browser",
  "candidate-3d": "Candidate 3D inspection",
  stack: "Stack composer",
  editor: "Pattern editor",
  robotics: "Robotics",
  simulation: "Simulation",
  report: "Validation report",
  "mpb-inspector": "Legacy .mpb inspector",
  "legacy-rob": "Legacy .rob workspace",
};

function projectLabel(project: Project): string {
  return project.projectNumber || project.productNumber || "Untitled project";
}

function diagnosticText(diagnostics: readonly RepositoryDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const path =
        diagnostic.path.length > 0 ? ` (${diagnostic.path.join(".")})` : "";
      return `${diagnostic.message}${path}`;
    })
    .join("\n");
}

function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type ReferenceInputAssessment = {
  encodedMatch: boolean;
  physicalComparable: boolean;
  detail: string;
};

function assessReferenceInputs(
  project: Project | null,
  referenceData: PalletData | null,
): ReferenceInputAssessment {
  if (!referenceData) {
    return {
      encodedMatch: false,
      physicalComparable: false,
      detail: "? No .rob reference is attached.",
    };
  }
  if (!project) {
    return {
      encodedMatch: false,
      physicalComparable: false,
      detail:
        "O Reference dimensions are readable.\n? No current project exists for reconciliation.",
    };
  }

  const packageMatch =
    project.package.dimensionsMm.length === referenceData.package.width &&
    project.package.dimensionsMm.width === referenceData.package.length &&
    project.package.dimensionsMm.height === referenceData.package.height;
  const palletMatch =
    referenceData.pallet !== null &&
    project.pallet !== null &&
    project.pallet.dimensionsMm.length === referenceData.pallet.width &&
    project.pallet.dimensionsMm.width === referenceData.pallet.length &&
    project.pallet.dimensionsMm.height === referenceData.pallet.height;
  const expectedInlet =
    referenceData.inputDirection === 1 ? "crosswise" : "lengthwise";
  const inletMatch =
    !referenceData.inputDirectionExplicit ||
    project.package.inletOrientation === expectedInlet;
  const lines = [
    `${packageMatch ? "PASS" : "FAIL"} package dimensions: current ${project.package.dimensionsMm.length} × ${project.package.dimensionsMm.width} × ${project.package.dimensionsMm.height} mm / observed ${referenceData.package.width} × ${referenceData.package.length} × ${referenceData.package.height} mm`,
    `${palletMatch ? "PASS" : "FAIL"} pallet dimensions: current ${project.pallet ? `${project.pallet.dimensionsMm.length} × ${project.pallet.dimensionsMm.width} × ${project.pallet.dimensionsMm.height} mm` : "unknown"} / observed ${referenceData.pallet ? `${referenceData.pallet.width} × ${referenceData.pallet.length} × ${referenceData.pallet.height} mm` : "unknown"}`,
    referenceData.inputDirectionExplicit
      ? `${inletMatch ? "PASS" : "FAIL"} input direction: current ${project.package.inletOrientation} / observed ${referenceData.inputDirection}`
      : "? input direction is not encoded in the reference",
    "? clearance, overhang, multipick policy, weight, resources, and station frame are not proven by .rob",
  ];
  return {
    encodedMatch: packageMatch && palletMatch && inletMatch,
    physicalComparable: packageMatch && palletMatch,
    detail: lines.join("\n"),
  };
}

function comparisonLedgerStatus(
  comparison: PatternComparison,
): ValidationLedgerRow["status"] {
  if (
    comparison.status === "exact" ||
    comparison.status === "integer-compatible"
  ) {
    return "PASS";
  }
  if (
    comparison.status === "count-mismatch" ||
    comparison.status === "no-match"
  ) {
    return "FAIL";
  }
  return "BLOCKED";
}

export function PlannerProjectWorkspace({
  repository: providedRepository,
  onUnsavedChange,
}: PlannerProjectWorkspaceProps) {
  const repositoryRef = useRef<ProjectRepository | null>(null);
  repositoryRef.current ??= providedRepository ?? createProjectRepository();
  const repository = repositoryRef.current;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [search, setSearch] = useState("");
  const [projectNumberFilter, setProjectNumberFilter] = useState("");
  const [productNumberFilter, setProductNumberFilter] = useState("");
  const [sortBy, setSortBy] = useState<ProjectSortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [projectConflictPolicy, setProjectConflictPolicy] =
    useState<ProjectConflictPolicy>("rename");
  const [resourceConflictPolicy, setResourceConflictPolicy] =
    useState<ProjectConflictPolicy>("rename");
  const [activeStage, setActiveStage] = useState<PlanningStage>("inputs");
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ProductionTool | null>(null);
  const [planFieldMode, setPlanFieldMode] = useState<PlanFieldMode>("overlay");
  const [reference, setReference] = useState<RobReference | null>(null);
  const [referenceLayerIndex, setReferenceLayerIndex] = useState(0);
  const [currentLayerIndex, setCurrentLayerIndex] = useState(0);
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [robotSettings, setRobotSettings] =
    useState<RobotWorkspaceSettings | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingProject, setLoadingProject] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("closed");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [solverInput, setSolverInput] = useState<LayerSolverInput | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [generatorLaunchRequest, setGeneratorLaunchRequest] =
    useState<GeneratorLaunchRequest | null>(null);
  const [repositoryReady, setRepositoryReady] = useState(false);
  const [stackDirty, setStackDirty] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorDraftProject, setEditorDraftProject] = useState<Project | null>(
    null,
  );
  const listRequest = useRef(0);
  const projectRequest = useRef(0);
  const generatorLaunchSequence = useRef(0);
  const selectedProjectIdRef = useRef<string | null>(selectedId);
  selectedProjectIdRef.current = selectedId;

  const consumeGeneratorLaunchRequest = useCallback((requestId: string) => {
    setGeneratorLaunchRequest((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);

  useEffect(() => {
    onUnsavedChange?.(stackDirty || editorDirty || legacyDirty);
    return () => onUnsavedChange?.(false);
  }, [editorDirty, legacyDirty, onUnsavedChange, stackDirty]);

  const refreshProjects = useCallback(async () => {
    const request = ++listRequest.current;
    setLoadingLibrary(true);
    try {
      const result = await repository.listProjects({
        search,
        projectNumber: projectNumberFilter,
        productNumber: productNumberFilter,
        sortBy,
        sortDirection,
      });
      if (request !== listRequest.current) return;
      setProjects(result.projects);
      const diagnostic = diagnosticText(result.diagnostics);
      if (diagnostic) setError(diagnostic);
      setSelectedId((current) => current ?? result.projects[0]?.id ?? null);
    } catch (cause) {
      if (request !== listRequest.current) return;
      console.error("Failed to load project library", cause);
      setError(
        cause instanceof Error
          ? `Project library failed: ${cause.message}`
          : "Project library failed.",
      );
    } finally {
      if (request === listRequest.current) setLoadingLibrary(false);
    }
  }, [
    productNumberFilter,
    projectNumberFilter,
    repository,
    search,
    sortBy,
    sortDirection,
  ]);

  useEffect(() => {
    let active = true;
    setRepositoryReady(false);
    setLoadingLibrary(true);
    void repository
      .migrateSavedPalletStore({ conflictPolicy: "skip" })
      .then((result) => {
        if (!active) return;
        const blockingDiagnostics = result.diagnostics.filter(
          ({ severity }) => severity === "error",
        );
        if (blockingDiagnostics.length > 0) {
          setError(diagnosticText(blockingDiagnostics));
        }
        if (result.migratedCount > 0) {
          setStatusMessage(
            `Imported ${result.migratedCount} legacy .rob librar${
              result.migratedCount === 1 ? "y entry" : "y entries"
            } as non-destructive planner project${
              result.migratedCount === 1 ? "" : "s"
            }.`,
          );
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("Failed to migrate legacy pallet library", cause);
        setError(
          cause instanceof Error
            ? `Legacy library migration failed: ${cause.message}`
            : "Legacy library migration failed.",
        );
      })
      .finally(() => {
        if (active) setRepositoryReady(true);
      });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!repositoryReady) return;
    void refreshProjects();
  }, [refreshProjects, repositoryReady]);

  useEffect(() => {
    const request = ++projectRequest.current;
    setSolverResult(null);
    setSolverInput(null);
    setSelectedCandidateId(null);
    setStackDirty(false);
    setEditorDirty(false);
    setEditorDraftProject(null);
    setRobotSettings(null);
    setCurrentLayerIndex(0);
    setActiveTool(null);
    if (!selectedId) {
      setSelectedProject(null);
      setLoadingProject(false);
      return;
    }
    setLoadingProject(true);
    void repository
      .getProject(selectedId)
      .then((result) => {
        if (request !== projectRequest.current) return;
        if (!result.project) {
          setSelectedProject(null);
          const diagnostic = diagnosticText(result.diagnostics);
          setError(
            diagnostic || `Project "${selectedId}" could not be reopened.`,
          );
          return;
        }
        setSelectedProject(result.project);
        setRobotSettings(createInitialRobotWorkspaceSettings(result.project));
        const diagnostic = diagnosticText(result.diagnostics);
        if (diagnostic) setError(diagnostic);
      })
      .catch((cause: unknown) => {
        if (request !== projectRequest.current) return;
        console.error("Failed to reopen project", cause);
        setSelectedProject(null);
        setError(
          cause instanceof Error
            ? `Project reopen failed: ${cause.message}`
            : "Project reopen failed.",
        );
      })
      .finally(() => {
        if (request === projectRequest.current) setLoadingProject(false);
      });
  }, [repository, selectedId]);

  const saveProject = async (project: Project): Promise<Project> => {
    setError(null);
    setStatusMessage(null);
    const switchedProject = selectedId !== project.id;
    const saved = await repository.saveProject(project);
    selectedProjectIdRef.current = saved.id;
    setSelectedId(saved.id);
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    if (switchedProject) {
      setActiveStage("inputs");
      setActiveTool(null);
    }
    setStatusMessage(`Project "${projectLabel(saved)}" saved.`);
    await refreshProjects();
    return saved;
  };

  const hasUnsavedChanges = stackDirty || editorDirty || legacyDirty;
  const confirmDiscardUnsaved = (action: string): boolean =>
    !hasUnsavedChanges ||
    window.confirm(`${action} and discard unsaved planner changes?`);

  const productionToolIsDirty = (tool: ProductionTool): boolean => {
    if (tool === "stack") return stackDirty;
    if (tool === "editor") return editorDirty;
    if (tool === "legacy-rob") return legacyDirty;
    return false;
  };

  const discardProductionToolState = (tool: ProductionTool): void => {
    if (tool === "stack") setStackDirty(false);
    if (tool === "editor") {
      setEditorDraftProject(null);
      setEditorDirty(false);
    }
    if (tool === "legacy-rob") setLegacyDirty(false);
  };

  const discardUnsavedPlannerChanges = (): void => {
    setStackDirty(false);
    setEditorDraftProject(null);
    setEditorDirty(false);
    setLegacyDirty(false);
    setActiveTool(null);
  };

  const confirmLeaveActiveTool = (action: string): boolean => {
    if (!activeTool) return true;
    if (
      productionToolIsDirty(activeTool) &&
      !window.confirm(
        `${action} and discard unsaved changes in ${productionToolTitles[activeTool]}?`,
      )
    ) {
      return false;
    }
    discardProductionToolState(activeTool);
    return true;
  };

  const selectProject = (id: string) => {
    if (id === selectedId) return;
    if (!confirmDiscardUnsaved("Switch projects")) return;
    discardUnsavedPlannerChanges();
    setGeneratorLaunchRequest(null);
    selectedProjectIdRef.current = id;
    setActiveStage("inputs");
    setProjectDrawerOpen(false);
    setSelectedId(id);
  };

  const openProductionTool = (tool: ProductionTool) => {
    if (tool === activeTool) return;
    if (!confirmLeaveActiveTool(`Open ${productionToolTitles[tool]}`)) return;
    setProjectDrawerOpen(false);
    setActiveTool(tool);
  };

  const closeProductionTool = () => {
    if (!confirmLeaveActiveTool("Close this production tool")) return;
    setActiveTool(null);
  };

  const duplicate = async () => {
    if (!selectedProject || !confirmDiscardUnsaved("Duplicate this project")) {
      return;
    }
    setError(null);
    setStatusMessage(null);
    try {
      const result = await repository.duplicateProject(selectedProject.id, {
        projectNumber: selectedProject.projectNumber
          ? `${selectedProject.projectNumber} copy`
          : "Copy",
      });
      if (!result.project) {
        throw new Error(
          diagnosticText(result.diagnostics) ||
            "The source project is missing.",
        );
      }
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = result.project.id;
      setSelectedId(result.project.id);
      setSelectedProject(result.project);
      setActiveStage("inputs");
      setStatusMessage(
        `Project duplicated as "${projectLabel(result.project)}".`,
      );
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to duplicate project", cause);
      setError(
        cause instanceof Error
          ? `Duplicate failed: ${cause.message}`
          : "Duplicate failed.",
      );
    }
  };

  const saveAs = async () => {
    if (
      !selectedProject ||
      !confirmDiscardUnsaved("Save this project as a copy")
    ) {
      return;
    }
    const projectNumber = window.prompt(
      "Project number for the new copy",
      selectedProject.projectNumber
        ? `${selectedProject.projectNumber} copy`
        : "New project",
    );
    if (projectNumber === null) return;
    const productNumber = window.prompt(
      "Product number for the new copy",
      selectedProject.productNumber,
    );
    if (productNumber === null) return;
    setError(null);
    setStatusMessage(null);
    try {
      const saved = await repository.saveProjectAs(selectedProject, {
        projectNumber,
        productNumber,
      });
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = saved.id;
      setSelectedId(saved.id);
      setSelectedProject(saved);
      setActiveStage("inputs");
      setStatusMessage(`Project saved as "${projectLabel(saved)}".`);
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to save project as", cause);
      setError(
        cause instanceof Error
          ? `Save as failed: ${cause.message}`
          : "Save as failed.",
      );
    }
  };

  const remove = async () => {
    if (!selectedProject) return;
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          `Delete "${projectLabel(selectedProject)}" and discard unsaved planner changes?`,
        )
      ) {
        return;
      }
    } else if (!window.confirm(`Delete "${projectLabel(selectedProject)}"?`)) {
      return;
    }
    setError(null);
    setStatusMessage(null);
    try {
      const deleted = await repository.deleteProject(selectedProject.id);
      if (!deleted) throw new Error("The project no longer exists.");
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = null;
      setSelectedProject(null);
      setSelectedId(null);
      setStatusMessage("Project deleted.");
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to delete project", cause);
      setError(
        cause instanceof Error
          ? `Delete failed: ${cause.message}`
          : "Delete failed.",
      );
    }
  };

  const exportProjects = async (selection: "selected" | "all") => {
    setError(null);
    setStatusMessage(null);
    try {
      const result = await exportRepositoryPackageJson(
        repository,
        selection === "selected" && selectedId
          ? { projectIds: [selectedId] }
          : {},
      );
      const errors = result.diagnostics.filter(
        ({ severity }) => severity === "error",
      );
      if (errors.length > 0) {
        setError(errors.map(({ message }) => message).join("\n"));
        return;
      }
      downloadJson(
        selection === "selected"
          ? `${selectedProject ? projectLabel(selectedProject) : "project"}.planner.json`
          : "planner-projects.json",
        result.json,
      );
      setStatusMessage(
        selection === "selected"
          ? "Selected project and reusable resource library exported."
          : "Project and reusable resource libraries exported.",
      );
    } catch (cause) {
      console.error("Failed to export projects", cause);
      setError(
        cause instanceof Error
          ? `Export failed: ${cause.message}`
          : "Export failed.",
      );
    }
  };

  const importProjects = async (file: File) => {
    setError(null);
    setStatusMessage(null);
    try {
      const result = await importProjectPackageJson(
        repository,
        await file.text(),
        {
          projectConflictPolicy,
          resourceConflictPolicy,
        },
      );
      const errors = result.diagnostics.filter(
        ({ severity }) => severity === "error",
      );
      if (errors.length > 0 && result.projects.length === 0) {
        setError(errors.map(({ message }) => message).join("\n"));
      } else {
        setStatusMessage(
          `Imported ${result.projects.length} project(s) and ${result.resources.length} resource(s); skipped ${result.skippedProjects} project(s) and ${result.skippedResources} resource(s).`,
        );
      }
      if (result.projects[0] && !hasUnsavedChanges) {
        setGeneratorLaunchRequest(null);
        selectedProjectIdRef.current = result.projects[0].id;
        setActiveStage("inputs");
        setSelectedId(result.projects[0].id);
      }
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to import project package", cause);
      setError(
        cause instanceof Error
          ? `Import failed: ${cause.message}`
          : "Import failed.",
      );
    }
  };

  const attachReference = async (file: File) => {
    setError(null);
    setStatusMessage(null);
    try {
      const rawText = await file.text();
      const data = parseRobText(rawText);
      setReference({ fileName: file.name, rawText, data });
      setReferenceLayerIndex(0);
      setActiveStage("reference");
      setStatusMessage(
        `Observed reference "${file.name}" attached for this planning session.`,
      );
    } catch (cause) {
      console.error("Failed to attach .rob reference", cause);
      setError(
        cause instanceof Error
          ? `Reference import failed: ${cause.message}`
          : "Reference import failed.",
      );
    }
  };

  const detachReference = () => {
    setReference(null);
    setReferenceLayerIndex(0);
    setStatusMessage(
      "Session reference detached; the project was not changed.",
    );
  };

  const applyReferenceInputs = async () => {
    if (!selectedProject || !reference) return;
    if (!confirmDiscardUnsaved("Apply the encoded reference inputs")) return;
    const baseProject = selectedProject;
    discardUnsavedPlannerChanges();
    const { data } = reference;
    const nextPalletDimensions = data.pallet
      ? {
          length: data.pallet.width,
          width: data.pallet.length,
          height: data.pallet.height,
        }
      : null;
    const existingPallet = baseProject.pallet;
    const allowedOverhangMm = existingPallet?.allowedOverhangMm ?? {
      length: 0,
      width: 0,
    };
    const existingStorageEnvelope = existingPallet?.storageEnvelopeMm ?? null;
    const storageEnvelopeRemainsValid =
      nextPalletDimensions !== null &&
      existingStorageEnvelope !== null &&
      existingStorageEnvelope.length >=
        nextPalletDimensions.length + allowedOverhangMm.length * 2 &&
      existingStorageEnvelope.width >=
        nextPalletDimensions.width + allowedOverhangMm.width * 2 &&
      existingStorageEnvelope.height >= nextPalletDimensions.height;
    const clearedStorageEnvelope =
      existingStorageEnvelope !== null && !storageEnvelopeRemainsValid;
    const nextPallet = nextPalletDimensions
      ? {
          ...(existingPallet ?? {
            id: `reference-pallet-${baseProject.id}`,
            name: "Reference pallet",
            kind: "custom" as const,
            allowedOverhangMm,
            tareKg: null,
            maxGrossKg: null,
            subPalletPattern: "none" as const,
          }),
          dimensionsMm: nextPalletDimensions,
          storageEnvelopeMm: storageEnvelopeRemainsValid
            ? existingStorageEnvelope
            : null,
        }
      : existingPallet;
    try {
      const updated = updateProject(baseProject, {
        package: {
          ...baseProject.package,
          dimensionsMm: {
            length: data.package.width,
            width: data.package.length,
            height: data.package.height,
          },
          inletOrientation: data.inputDirectionExplicit
            ? data.inputDirection === 1
              ? "crosswise"
              : "lengthwise"
            : baseProject.package.inletOrientation,
        },
        pallet: nextPallet,
      });
      await saveProject(updated);
      resetSolver();
      setActiveStage("generate");
      setStatusMessage(
        clearedStorageEnvelope
          ? "Encoded package, pallet, and explicit inlet inputs applied. The incompatible storage envelope was cleared to unknown; other unencoded policies remain unchanged and unverified."
          : "Encoded package, pallet, and explicit inlet inputs applied. Unencoded planning policies remain unchanged and unverified.",
      );
    } catch (cause) {
      console.error("Failed to apply reference inputs", cause);
      setError(
        cause instanceof Error
          ? `Reference input update failed: ${cause.message}`
          : "Reference input update failed.",
      );
    }
  };

  const applyGeneratorPackageInputs = async ({
    dimensionsMm,
    inletOrientation,
    multiPickAllowed,
  }: GeneratorPackageInputs): Promise<Project> => {
    if (!selectedProject) {
      throw new Error("A current project is required before generation.");
    }
    if (editorDirty) {
      throw new Error(
        "Save or discard project editor changes before applying generator inputs.",
      );
    }
    const current = selectedProject.package;
    if (
      current.dimensionsMm.length === dimensionsMm.length &&
      current.dimensionsMm.width === dimensionsMm.width &&
      current.dimensionsMm.height === dimensionsMm.height &&
      current.inletOrientation === inletOrientation &&
      current.multiPickAllowed === multiPickAllowed
    ) {
      return selectedProject;
    }
    const updated = updateProject(selectedProject, {
      package: {
        ...current,
        dimensionsMm: { ...dimensionsMm },
        inletOrientation,
        multiPickAllowed,
      },
    });
    const saved = await saveProject(updated);
    setStatusMessage(
      `Generator package inputs applied: ${dimensionsMm.length} × ${dimensionsMm.width} × ${dimensionsMm.height} mm · ${inletOrientation} infeed left to right · automatic multipick grouping ${multiPickAllowed ? "enabled" : "disabled"}.`,
    );
    return saved;
  };

  const onSolverResult = useCallback(
    (projectId: string, result: SolverResult, input: LayerSolverInput) => {
      if (selectedProjectIdRef.current !== projectId) return;
      setSolverResult(result);
      setSolverInput(input);
      setSelectedCandidateId(result.candidates[0]?.id ?? null);
      setCurrentLayerIndex(0);
    },
    [],
  );
  const resetSolver = useCallback(() => {
    setSolverResult(null);
    setSolverInput(null);
    setSelectedCandidateId(null);
    setStackDirty(false);
  }, []);
  const changeCandidate = useCallback((candidateId: string | null) => {
    setSelectedCandidateId(candidateId);
  }, []);

  const selectedCandidate: SolverCandidate | null =
    solverResult?.candidates.find(({ id }) => id === selectedCandidateId) ??
    null;
  const workspaceProject = editorDraftProject ?? selectedProject;
  const physicalPalletBoundsMm = useMemo(
    () =>
      workspaceProject?.pallet
        ? {
            minX: 0,
            minY: 0,
            maxX: workspaceProject.pallet.dimensionsMm.length,
            maxY: workspaceProject.pallet.dimensionsMm.width,
          }
        : undefined,
    [workspaceProject],
  );
  const candidatePreviewData = useMemo(() => {
    if (!workspaceProject || !solverInput || !selectedCandidate) return null;
    try {
      const state = createInitialStackWorkspaceState([selectedCandidate]);
      const materialized = materializeStackWorkspace(
        workspaceProject,
        [selectedCandidate],
        solverInput,
        state,
      );
      return materializedStackToPalletData(materialized);
    } catch {
      return null;
    }
  }, [selectedCandidate, solverInput, workspaceProject]);

  const resolvedRobotSettings = useMemo(
    () =>
      workspaceProject
        ? (robotSettings ??
          createInitialRobotWorkspaceSettings(workspaceProject))
        : null,
    [robotSettings, workspaceProject],
  );
  const robotMaterialization = useMemo(
    () =>
      workspaceProject && resolvedRobotSettings
        ? materializeRobotWorkspace(workspaceProject, resolvedRobotSettings)
        : null,
    [resolvedRobotSettings, workspaceProject],
  );
  const robotPreviewData = useMemo(() => {
    const preview = robotMaterialization
      ? robotCycleMaterializationToPalletData(robotMaterialization)
      : null;
    return preview && preview.layer_count > 0 ? preview : null;
  }, [robotMaterialization]);
  const savedCurrentPalletData = useMemo(() => {
    if (!workspaceProject) return null;
    try {
      const data = projectSolutionToPalletData(workspaceProject);
      return data.layer_count > 0 ? data : null;
    } catch {
      return null;
    }
  }, [workspaceProject]);
  const currentPalletData = candidatePreviewData ?? savedCurrentPalletData;
  const inputAssessment = useMemo(
    () => assessReferenceInputs(workspaceProject, reference?.data ?? null),
    [reference, workspaceProject],
  );
  const resolvedReferenceLayerIndex = reference?.data.layer_count
    ? Math.min(referenceLayerIndex, reference.data.layer_count - 1)
    : 0;
  const resolvedCurrentLayerIndex = currentPalletData?.layer_count
    ? Math.min(currentLayerIndex, currentPalletData.layer_count - 1)
    : 0;
  const referencePreview = useMemo(() => {
    if (!reference || reference.data.layer_count === 0) return null;
    return palletLayerToPatternPreview(
      reference.data,
      resolvedReferenceLayerIndex,
    );
  }, [reference, resolvedReferenceLayerIndex]);
  const currentPreview = useMemo(() => {
    if (selectedCandidate && solverInput) {
      return solverCandidateToPatternPreview(selectedCandidate, solverInput, {
        physicalPalletBoundsMm,
      });
    }
    if (!currentPalletData || currentPalletData.layer_count === 0) return null;
    return palletLayerToPatternPreview(
      currentPalletData,
      resolvedCurrentLayerIndex,
    );
  }, [
    currentPalletData,
    physicalPalletBoundsMm,
    resolvedCurrentLayerIndex,
    selectedCandidate,
    solverInput,
  ]);
  const comparison = useMemo(
    () =>
      comparePatternPreviews(
        inputAssessment.physicalComparable ? referencePreview : null,
        inputAssessment.physicalComparable ? currentPreview : null,
        workspaceProject
          ? {
              length: workspaceProject.package.dimensionsMm.length,
              width: workspaceProject.package.dimensionsMm.width,
            }
          : { length: 1, width: 1 },
      ),
    [
      currentPreview,
      inputAssessment.physicalComparable,
      referencePreview,
      workspaceProject,
    ],
  );
  const ledgerRows = useMemo<ValidationLedgerRow[]>(() => {
    const comparisonPassed =
      comparison.status === "exact" ||
      comparison.status === "integer-compatible";
    const currentGeometryStatus: ValidationLedgerRow["status"] =
      selectedCandidate
        ? selectedCandidate.validation.valid
          ? "PASS"
          : "FAIL"
        : currentPreview
          ? "OBSERVED"
          : "BLOCKED";
    const robotReadinessItems =
      workspaceProject && robotMaterialization && resolvedRobotSettings
        ? createRobotReadiness(
            workspaceProject,
            robotMaterialization,
            resolvedRobotSettings,
            false,
            0,
          ).filter(({ id }) => id !== "export")
        : [];
    const robotReadinessBlocked =
      robotReadinessItems.length !== 5 ||
      robotReadinessItems.some(({ status }) =>
        ["blocked", "needs-input", "engineering"].includes(status),
      );
    const robotReadinessWarning = robotReadinessItems.some(
      ({ status }) => status === "warning",
    );
    const robotReadinessNotChecked = robotReadinessItems.some(
      ({ status }) => status === "not-checked",
    );
    const robotReadinessStatus: ValidationLedgerRow["status"] =
      robotReadinessBlocked
        ? "BLOCKED"
        : robotReadinessWarning
          ? "OBSERVED"
          : robotReadinessNotChecked
            ? "SKIPPED"
            : "PASS";
    const observedEquipmentSelected = robotReadinessItems.some(
      ({ id, status }) => id === "equipment" && status === "warning",
    );
    const robotReadinessDetail = [
      ...robotReadinessItems.map(
        ({ label, status, evidence }) =>
          `${status.toUpperCase()} ${label}: ${evidence}`,
      ),
      ...(robotMaterialization?.diagnostics.map(({ message }) => message) ??
        []),
    ].join("\n");
    return [
      {
        id: "reference-parse",
        label: "Reference parse",
        status: reference ? "OBSERVED" : "BLOCKED",
        evidence: reference ? "O" : "?",
        claim: reference
          ? "The attached .rob structure was parsed successfully."
          : "No observed .rob artifact is attached.",
        detail: reference
          ? `${reference.fileName}\n${reference.data.layer_count} layers · ${reference.data.total_boxes} packages`
          : undefined,
      },
      {
        id: "encoded-inputs",
        label: "Encoded inputs",
        status:
          reference && workspaceProject
            ? inputAssessment.encodedMatch
              ? "PASS"
              : "FAIL"
            : "BLOCKED",
        evidence: reference ? "O" : "?",
        claim: inputAssessment.encodedMatch
          ? "Current package, pallet, and explicit inlet inputs match the reference."
          : "Reference/current encoded inputs are not fully reconciled.",
        detail: inputAssessment.detail,
      },
      {
        id: "current-geometry",
        label: "Current geometry",
        status: currentGeometryStatus,
        evidence: selectedCandidate ? "G" : currentPreview ? "O" : "?",
        claim: selectedCandidate
          ? selectedCandidate.validation.valid
            ? "The selected solver candidate passed internal geometry checks."
            : "The selected solver candidate failed internal geometry checks."
          : currentPreview
            ? "A saved current layer is observable; solver validation was not rerun."
            : "No current layer geometry is available.",
        detail: selectedCandidate
          ? selectedCandidate.validation.issues
              .map(({ message }) => message)
              .join("\n") ||
            `Candidate ${selectedCandidate.rank} · ${selectedCandidate.metrics.packageCount} packages`
          : undefined,
      },
      {
        id: "reference-footprint",
        label: "Footprint recreation",
        status: comparisonLedgerStatus(comparison),
        evidence: reference && currentPreview ? "G" : "?",
        claim:
          comparison.status === "exact"
            ? "Current and reference physical footprints match exactly in an accepted pallet symmetry."
            : comparison.status === "integer-compatible"
              ? "Current and reference footprints match only within the legacy integer tolerance."
              : comparison.status === "count-mismatch"
                ? "Package counts differ between the selected layers."
                : comparison.status === "no-match"
                  ? "No physical footprint match exists in the accepted pallet symmetry orbit."
                  : "Footprint comparison is blocked until physical inputs and both layers are available.",
        detail: inputAssessment.physicalComparable
          ? `symmetry=${comparison.acceptedSymmetry ?? "none"}\nmaxAxisDelta=${comparison.maximumAxisDisplacementMm ?? "unknown"} mm\ntolerance=${comparison.toleranceMm} mm`
          : inputAssessment.detail,
      },
      {
        id: "operational-equivalence",
        label: "Yaw + grouping",
        status: comparisonPassed ? "OBSERVED" : "BLOCKED",
        evidence: comparisonPassed ? "O" : "?",
        claim: comparisonPassed
          ? "Physical equality is observed, but directed yaw and grip grouping equivalence are not proven."
          : "Operational equivalence cannot be assessed before footprint recreation.",
      },
      {
        id: "stack-parity",
        label: "Stack parity",
        status: reference && currentPalletData ? "OBSERVED" : "BLOCKED",
        evidence: reference && currentPalletData ? "O" : "?",
        claim:
          reference && currentPalletData
            ? "Reference and current sequences are visible; automatic stack equivalence has not been asserted."
            : "Both reference and current stack sequences are required.",
        detail:
          reference && currentPalletData
            ? `referenceLayers=${reference.data.layer_count}\ncurrentLayers=${currentPalletData.layer_count}`
            : undefined,
      },
      {
        id: "robot-readiness",
        label: "Robot readiness",
        status: robotReadinessStatus,
        evidence:
          robotReadinessStatus === "PASS"
            ? "G"
            : robotReadinessStatus === "OBSERVED" && observedEquipmentSelected
              ? "O"
              : "?",
        claim:
          robotReadinessStatus === "PASS"
            ? "Plan, equipment, pickup point, station workspace, and modeled obstacles passed the available internal checks."
            : robotReadinessStatus === "OBSERVED"
              ? observedEquipmentSelected
                ? "The observed Multipack equipment profile is selected; current checks do not establish calibrated production readiness."
                : "Robot checks completed with unverified or uncalibrated limitations."
              : robotReadinessStatus === "SKIPPED"
                ? "No robot-readiness pass is claimed because at least one workspace check was not run."
                : "Complete the plan, equipment, pickup point, and station workspace checks before robot readiness can pass.",
        detail: robotReadinessDetail || undefined,
      },
      {
        id: "export-readiness",
        label: "Export readiness",
        status: "BLOCKED",
        evidence: "?",
        claim:
          "Production coordinate mapping, quantization, and unknown .rob fields require explicit review in Robotics.",
      },
    ];
  }, [
    comparison,
    currentPalletData,
    currentPreview,
    inputAssessment,
    reference,
    resolvedRobotSettings,
    robotMaterialization,
    selectedCandidate,
    workspaceProject,
  ]);

  const saveStack = async (
    state: StackWorkspaceState,
    materialized: Parameters<typeof materializedStackToPalletData>[0],
  ) => {
    if (!workspaceProject || !solverInput) return;
    if (editorDirty) {
      throw new Error(
        "Save or discard project editor changes before replacing the active solution stack.",
      );
    }
    const updated = projectWithPersistedStack(
      workspaceProject,
      solverResult?.candidates ?? [],
      solverInput,
      state,
    );
    const saved = await repository.saveProject(updated);
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    setStatusMessage(
      `Stack saved: ${materialized.metrics.packages.totalPackageCount} packages across ${materialized.packageLayers.length} layers.`,
    );
    await refreshProjects();
  };

  return (
    <div className="planner-workspace-shell flex min-h-0 flex-1 overflow-hidden">
      <PlanningCaseWorkbench
        project={workspaceProject}
        loadingProject={loadingProject}
        error={error}
        statusMessage={statusMessage}
        activeStage={activeStage}
        onStageChange={setActiveStage}
        onOpenProjects={() => {
          if (!confirmLeaveActiveTool("Open planner projects")) return;
          setActiveTool(null);
          setProjectDrawerOpen(true);
        }}
        onCreateProject={() => {
          if (!confirmDiscardUnsaved("Create a new project")) return;
          discardUnsavedPlannerChanges();
          setProjectDrawerOpen(false);
          setDialogMode("create");
        }}
        onEditProject={() => setDialogMode("edit")}
        onOpenTool={openProductionTool}
        referenceFileName={reference?.fileName ?? null}
        referenceData={reference?.data ?? null}
        onAttachReference={(file) => void attachReference(file)}
        onDetachReference={detachReference}
        onApplyReferenceInputs={() => void applyReferenceInputs()}
        referenceInputsMatch={inputAssessment.encodedMatch}
        referenceInputDetail={inputAssessment.detail}
        solverResult={solverResult}
        solverInput={solverInput}
        selectedCandidate={selectedCandidate}
        selectedCandidateId={selectedCandidateId}
        generatorLaunchRequest={generatorLaunchRequest}
        onGeneratorLaunchRequestConsumed={consumeGeneratorLaunchRequest}
        onApplyGeneratorPackageInputs={applyGeneratorPackageInputs}
        onSolverResult={onSolverResult}
        onResetSolver={resetSolver}
        onCandidateChange={(candidateId) => changeCandidate(candidateId)}
        referencePreview={referencePreview}
        currentPreview={currentPreview}
        comparison={comparison}
        ledgerRows={ledgerRows}
        planFieldMode={planFieldMode}
        onPlanFieldModeChange={setPlanFieldMode}
        currentPalletData={currentPalletData}
        referenceLayerIndex={resolvedReferenceLayerIndex}
        currentLayerIndex={resolvedCurrentLayerIndex}
        onReferenceLayerChange={setReferenceLayerIndex}
        onCurrentLayerChange={setCurrentLayerIndex}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      <CaseDrawer
        open={projectDrawerOpen}
        title="Planner projects"
        width="narrow"
        onClose={() => setProjectDrawerOpen(false)}
      >
        <ProjectLibrary
          projects={projects}
          selectedId={selectedId}
          loading={loadingLibrary}
          search={search}
          projectNumberFilter={projectNumberFilter}
          productNumberFilter={productNumberFilter}
          sortBy={sortBy}
          sortDirection={sortDirection}
          projectConflictPolicy={projectConflictPolicy}
          resourceConflictPolicy={resourceConflictPolicy}
          onSearchChange={setSearch}
          onProjectNumberFilterChange={setProjectNumberFilter}
          onProductNumberFilterChange={setProductNumberFilter}
          onSortChange={(nextSortBy, nextDirection) => {
            setSortBy(nextSortBy);
            setSortDirection(nextDirection);
          }}
          onProjectConflictPolicyChange={setProjectConflictPolicy}
          onResourceConflictPolicyChange={setResourceConflictPolicy}
          onSelect={selectProject}
          onCreate={() => {
            if (!confirmDiscardUnsaved("Create a new project")) return;
            discardUnsavedPlannerChanges();
            setProjectDrawerOpen(false);
            setDialogMode("create");
          }}
          onEdit={() => {
            setProjectDrawerOpen(false);
            setDialogMode("edit");
          }}
          onDuplicate={() => void duplicate()}
          onSaveAs={() => void saveAs()}
          onDelete={() => void remove()}
          onExportSelected={() => void exportProjects("selected")}
          onExportAll={() => void exportProjects("all")}
          onImport={(file) => void importProjects(file)}
        />
      </CaseDrawer>

      <CaseDrawer
        open={activeTool !== null}
        title={
          activeTool ? productionToolTitles[activeTool] : "Production tools"
        }
        onClose={closeProductionTool}
      >
        {activeTool === "candidate-browser" && solverResult && solverInput ? (
          <CandidateBrowser
            candidates={solverResult.candidates}
            solverInput={solverInput}
            physicalPalletBoundsMm={physicalPalletBoundsMm}
            selectedCandidateId={selectedCandidateId}
            onSelectionChange={changeCandidate}
            diagnostics={solverResult.diagnostics}
            exclusions={solverResult.exclusions}
          />
        ) : null}

        {activeTool === "candidate-3d" ? (
          <Candidate3DWorkspace
            data={candidatePreviewData}
            cameraResetKey={selectedCandidateId}
          />
        ) : null}

        {activeTool === "stack" &&
        workspaceProject &&
        solverResult &&
        solverInput &&
        solverResult.candidates.length > 0 ? (
          <StackWorkspace
            project={workspaceProject}
            candidates={solverResult.candidates}
            solverInput={solverInput}
            onSave={saveStack}
            onDirtyChange={setStackDirty}
          />
        ) : null}

        {activeTool === "editor" && selectedProject && robotMaterialization ? (
          <ProjectEditorWorkspace
            project={selectedProject}
            materialization={robotMaterialization}
            onDraftChange={setEditorDraftProject}
            onDirtyChange={setEditorDirty}
            onSaveProject={saveProject}
          />
        ) : null}

        {activeTool === "robotics" &&
        workspaceProject &&
        robotMaterialization &&
        resolvedRobotSettings ? (
          <RoboticsWorkspace
            project={workspaceProject}
            repository={repository}
            materialization={robotMaterialization}
            settings={resolvedRobotSettings}
            onSettingsChange={setRobotSettings}
            onSaveProject={saveProject}
            onPreviewMotion={() => setActiveTool("simulation")}
          />
        ) : null}

        {activeTool === "simulation" &&
        workspaceProject &&
        robotMaterialization ? (
          <SimulationWorkspace
            project={workspaceProject}
            materialization={robotMaterialization}
            previewData={robotPreviewData}
          />
        ) : null}

        {activeTool === "report" && workspaceProject && robotMaterialization ? (
          <ReportWorkspace
            project={workspaceProject}
            materialization={robotMaterialization}
            previewData={robotPreviewData}
          />
        ) : null}

        {activeTool === "mpb-inspector" ? <MpbInspector /> : null}
        {activeTool === "legacy-rob" ? (
          <LegacyPlanWorkspace onUnsavedChange={setLegacyDirty} />
        ) : null}
      </CaseDrawer>

      <ProjectDialog
        open={dialogMode !== "closed"}
        project={dialogMode === "edit" ? workspaceProject : null}
        onClose={() => setDialogMode("closed")}
        onSave={async ({
          project,
          generationIntent,
        }: ProjectDialogSubmission) => {
          const saved = await saveProject(project);
          if (!generationIntent) {
            setGeneratorLaunchRequest(null);
            return;
          }

          setGeneratorLaunchRequest({
            requestId: `${saved.id}:${++generatorLaunchSequence.current}`,
            projectId: saved.id,
            exactPackageCount: generationIntent.exactPackageCount,
          });
          setActiveStage("generate");
          setActiveTool(null);
        }}
      />
    </div>
  );
}
