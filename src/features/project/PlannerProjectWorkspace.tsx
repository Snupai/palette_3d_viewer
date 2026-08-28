"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type {
  LayerSolverInput,
  SolverCandidate,
  SolverResult,
} from "~/domain/solver";
import { createLayerSolverInputFromProject } from "~/domain/solver/projectInput";
import { CandidateBrowser } from "~/features/candidates/CandidateBrowser";
import { selectDistinctCandidateLayouts } from "~/features/candidates/candidateListModel";
import type {
  GeneratorLaunchRequest,
  GeneratorPackageInputs,
} from "~/features/candidates/SolverControls";
import { ProjectEditorWorkspace } from "~/features/editor/ProjectEditorWorkspace";
import { CaseDrawer } from "~/features/planning-case/PlanningCaseChrome";
import {
  PlanningCaseWorkbench,
  type ProductionTool,
} from "~/features/planning-case/PlanningCaseWorkbench";
import {
  clampPlanningStage,
  planningStageForProject,
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
  savedPalletToProject,
} from "~/lib/projectAdapters";
import {
  palletLayerToPatternPreview,
  solverCandidateToPatternPreview,
} from "~/lib/previewAdapters";
import { parseRobText } from "~/lib/robParser";
import { CURRENT_PALLET_SCHEMA_VERSION } from "~/lib/palletPersistence";
import {
  createProjectRepository,
  type ProjectConflictPolicy,
  type ProjectRepository,
  type ProjectSortField,
  type RepositoryDiagnostic,
  type SortDirection,
} from "~/lib/projectRepository";

function WorkspaceLoading() {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-[var(--muted)]">
      Loading…
    </div>
  );
}

const Candidate3DWorkspace = dynamic(
  () =>
    import("~/features/project/Candidate3DWorkspace").then(
      (module) => module.Candidate3DWorkspace,
    ),
  { ssr: false, loading: WorkspaceLoading },
);

const LegacyPlanWorkspace = dynamic(
  () =>
    import("~/features/legacy-plan/LegacyPlanWorkspace").then(
      (module) => module.LegacyPlanWorkspace,
    ),
  { ssr: false, loading: WorkspaceLoading },
);

const ReportWorkspace = dynamic(
  () =>
    import("~/features/reporting/ReportWorkspace").then(
      (module) => module.ReportWorkspace,
    ),
  { ssr: false, loading: WorkspaceLoading },
);

const SimulationWorkspace = dynamic(
  () =>
    import("~/features/simulation/SimulationWorkspace").then(
      (module) => module.SimulationWorkspace,
    ),
  { ssr: false, loading: WorkspaceLoading },
);

const StackWorkspace = dynamic(
  () =>
    import("~/features/stack/StackWorkspace").then(
      (module) => module.StackWorkspace,
    ),
  { ssr: false, loading: WorkspaceLoading },
);

export type PlannerProjectWorkspaceProps = {
  repository?: ProjectRepository;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type DialogMode = "closed" | "create" | "edit";

const productionToolTitles: Record<ProductionTool, string> = {
  "candidate-browser": "Candidate browser",
  "candidate-3d": "Candidate 3D inspection",
  stack: "Stack composer",
  editor: "Pattern editor",
  robotics: "Robotics",
  simulation: "Simulation",
  report: "Validation report",
  "legacy-rob": "Legacy .rob workspace",
};

function projectLabel(project: Project): string {
  return project.productNumber || project.projectNumber || "Untitled project";
}

/**
 * Reuses the real solver adapter so the invalidation signature can never drift
 * from the fields the solver actually consumes. A project that cannot produce
 * solver input yields `null`, which compares unequal to every real signature.
 */
function solverInputSignature(project: Project): string | null {
  try {
    return JSON.stringify(createLayerSolverInputFromProject(project));
  } catch {
    return null;
  }
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

  const generatorLaunchRequestRef = useRef(generatorLaunchRequest);
  generatorLaunchRequestRef.current = generatorLaunchRequest;

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
        if (!generatorLaunchRequestRef.current) {
          setActiveStage(planningStageForProject(result.project));
        }
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
      setActiveStage(planningStageForProject(saved));
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
    setActiveStage(
      planningStageForProject(
        projects.find((entry) => entry.id === id) ?? null,
      ),
    );
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
    if (!confirmLeaveActiveTool("Close")) return;
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
      setActiveStage(planningStageForProject(result.project));
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
      "Line number for the new copy",
      selectedProject.projectNumber
        ? `${selectedProject.projectNumber} copy`
        : "New line",
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
      setActiveStage(planningStageForProject(saved));
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
        setActiveStage(planningStageForProject(result.projects[0]));
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

  const importRobAsProject = async (file: File) => {
    if (!confirmDiscardUnsaved("Open the .rob file as a project")) return;
    discardUnsavedPlannerChanges();
    setError(null);
    setStatusMessage(null);
    try {
      const rawText = await file.text();
      const data = parseRobText(rawText);
      const project = savedPalletToProject({
        schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
        id: `rob-${crypto.randomUUID()}`,
        name: file.name,
        createdAt: Date.now(),
        data,
        rawText,
        originalRawText: rawText,
      });
      const saved = await saveProject(project);
      setActiveStage(planningStageForProject(saved));
      setStatusMessage(
        `Opened "${saved.source.kind === "rob-import" ? saved.source.fileName : file.name}" as the current plan.`,
      );
    } catch (cause) {
      console.error("Failed to open .rob file", cause);
      setError(
        cause instanceof Error
          ? `.rob import failed: ${cause.message}`
          : ".rob import failed.",
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
  const candidateLayouts = useMemo(
    () =>
      solverResult && solverInput
        ? selectDistinctCandidateLayouts(
            solverResult.candidates,
            solverInput.package.dimensionsMm,
          )
        : [],
    [solverInput, solverResult],
  );

  const selectedCandidate: SolverCandidate | null =
    candidateLayouts.find(({ id }) => id === selectedCandidateId) ?? null;
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
  const resolvedCurrentLayerIndex = currentPalletData?.layer_count
    ? Math.min(currentLayerIndex, currentPalletData.layer_count - 1)
    : 0;
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
  const importedRob = workspaceProject?.source.kind === "rob-import";
  const resolvedStage = clampPlanningStage(activeStage, Boolean(importedRob));
  const emptyComparison = {
    status: "unavailable" as const,
    referenceCount: 0,
    currentCount: currentPreview?.items.length ?? 0,
    missingCount: 0,
    extraCount: currentPreview?.items.length ?? 0,
    acceptedSymmetry: null,
    maximumAxisDisplacementMm: null,
    toleranceMm: 0.500001,
  };
  const ledgerRows = useMemo<ValidationLedgerRow[]>(() => {
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
    const importedSource =
      workspaceProject?.source.kind === "rob-import"
        ? workspaceProject.source
        : null;
    return [
      ...(importedSource
        ? [
            {
              id: "imported-plan",
              label: "Imported plan",
              status: "OBSERVED" as const,
              evidence: "O" as const,
              claim:
                "The current geometry comes from the imported .rob file; a second reference plan is not required.",
              detail: `${importedSource.fileName}${
                currentPalletData
                  ? `\n${currentPalletData.layer_count} layers · ${currentPalletData.total_boxes} packages`
                  : ""
              }`,
            },
          ]
        : []),
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
            ? importedSource
              ? "The imported layer geometry is shown as the current plan."
              : "A saved current layer is observable; solver validation was not rerun."
            : "No current layer geometry is available.",
        detail: selectedCandidate
          ? selectedCandidate.validation.issues
              .map(({ message }) => message)
              .join("\n") ||
            `Candidate ${selectedCandidate.rank} · ${selectedCandidate.metrics.packageCount} packages`
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
    currentPalletData,
    currentPreview,
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
    // The materialized stack replaces the candidate draft as the current
    // geometry; the generated candidates stay available for a new draft.
    setSelectedCandidateId(null);
    setCurrentLayerIndex(0);
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
        activeStage={resolvedStage}
        onStageChange={(stage) =>
          setActiveStage(clampPlanningStage(stage, Boolean(importedRob)))
        }
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
        onImportRob={(file) => void importRobAsProject(file)}
        solverResult={solverResult}
        solverInput={solverInput}
        candidates={candidateLayouts}
        selectedCandidate={selectedCandidate}
        selectedCandidateId={selectedCandidateId}
        generatorLaunchRequest={generatorLaunchRequest}
        onGeneratorLaunchRequestConsumed={consumeGeneratorLaunchRequest}
        onApplyGeneratorPackageInputs={applyGeneratorPackageInputs}
        onSolverResult={onSolverResult}
        onResetSolver={resetSolver}
        onCandidateChange={(candidateId) => changeCandidate(candidateId)}
        currentPreview={currentPreview}
        comparison={emptyComparison}
        ledgerRows={ledgerRows}
        currentPalletData={currentPalletData}
        currentLayerIndex={resolvedCurrentLayerIndex}
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
        title={activeTool ? productionToolTitles[activeTool] : "Workspace"}
        onClose={closeProductionTool}
      >
        {activeTool === "candidate-browser" && solverResult && solverInput ? (
          <CandidateBrowser
            candidates={candidateLayouts}
            solverInput={solverInput}
            physicalPalletBoundsMm={physicalPalletBoundsMm}
            selectedCandidateId={selectedCandidateId}
            onSelectionChange={changeCandidate}
            generatedCandidateCount={solverResult.statistics.candidateCount}
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
          const previous = selectedProject;
          const saved = await saveProject(project);
          if (
            previous &&
            previous.id === saved.id &&
            solverInputSignature(previous) !== solverInputSignature(saved)
          ) {
            // Editing in place keeps `selectedId` stable, so the project-switch
            // reset never runs and stale candidates would outlive their input.
            resetSolver();
          }
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
