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
import { geometryReviewSignature } from "~/domain/project/geometryReview";
import {
  clampPlanningStage,
  projectNeedsGeometryReview,
  productionToolGate,
  planningStageForProject,
  type PlanningStage,
  type ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";
import {
  ProjectDialog,
  type ProjectDialogSubmission,
} from "~/features/project/ProjectDialog";
import type { GuidedSectionId } from "~/features/project/guidedProjectFormModel";
import { PlanLibrary } from "~/features/planner/PlanLibrary";
import {
  parsePlannerRoute,
  plannerRoutePath,
  type PlannerRoute,
} from "~/features/project/plannerRoute";
import { PlannerWelcome } from "~/features/planner/PlannerWelcome";
import { libraryRobDownload } from "~/features/project/projectRobDownload";
import { downloadText } from "~/lib/download";
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
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";
import { useT, type Translate } from "~/i18n";
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
    <div className="text-body text-muted flex min-h-[320px] items-center justify-center">
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

function productionToolTitles(t: Translate): Record<ProductionTool, string> {
  return {
    "candidate-browser": t("project.tool.candidateBrowser"),
    "candidate-3d": t("project.tool.candidate3d"),
    stack: t("project.tool.stack"),
    editor: t("project.tool.editor"),
    robotics: t("project.tool.robotics"),
    simulation: t("project.tool.simulation"),
    report: t("project.tool.report"),
  };
}

function projectLabel(project: Project, t: Translate): string {
  return (
    project.productNumber || project.projectNumber || t("project.untitledPlan")
  );
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
  const t = useT();
  // Effects and callbacks that must not re-run on a language switch read `t`
  // through this ref; the message is translated when the error is produced.
  const tRef = useRef(t);
  tRef.current = t;
  const toolTitles = productionToolTitles(t);
  const repositoryRef = useRef<ProjectRepository | null>(null);
  repositoryRef.current ??= providedRepository ?? createProjectRepository();
  const repository = repositoryRef.current;

  const navigationGeneration = useRef(0);
  const [formGeneration, setFormGeneration] = useState(0);
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
  const [showWelcome, setShowWelcome] = useState(true);
  const [workbenchEpoch, setWorkbenchEpoch] = useState(0);
  const [inputSection, setInputSection] = useState<GuidedSectionId>("package");
  const [activeTool, setActiveTool] = useState<ProductionTool | null>(null);
  const [currentLayerIndex, setCurrentLayerIndex] = useState(0);
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
  const [inputsDirty, setInputsDirty] = useState(false);
  const inputsDirtyRef = useRef(false);
  const markInputsDirty = useCallback((dirty: boolean) => {
    inputsDirtyRef.current = dirty;
    setInputsDirty(dirty);
  }, []);

  const [editorDirty, setEditorDirty] = useState(false);
  const [editorDraftProject, setEditorDraftProject] = useState<Project | null>(
    null,
  );
  const listRequest = useRef(0);
  const projectRequest = useRef(0);
  const generatorLaunchSequence = useRef(0);
  const selectedProjectIdRef = useRef<string | null>(selectedId);
  selectedProjectIdRef.current = selectedId;
  /** Where "Neuen Plan erstellen" was started, so cancelling returns there. */
  const createOriginRef = useRef<{
    screen: "welcome" | "library" | "workbench";
    selectedId: string | null;
  }>({ screen: "welcome", selectedId: null });
  /** Stage requested by the URL; wins once over the project's default stage. */
  const routeStageRef = useRef<PlanningStage | null>(null);
  /** Tool requested by the URL; restored once the project has loaded. */
  const routeToolRef = useRef<ProductionTool | null>(null);
  /** Bumped when the open project was replaced on disk and must be re-read. */
  const [projectReloadToken, setProjectReloadToken] = useState(0);
  const [routeReady, setRouteReady] = useState(false);
  const pendingEditIdRef = useRef<string | null>(null);

  const generatorLaunchRequestRef = useRef(generatorLaunchRequest);
  generatorLaunchRequestRef.current = generatorLaunchRequest;

  const consumeGeneratorLaunchRequest = useCallback((requestId: string) => {
    setGeneratorLaunchRequest((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);

  useEffect(() => {
    const route = parsePlannerRoute(window.location.pathname);
    if (route.kind === "library") {
      setShowWelcome(false);
      setProjectDrawerOpen(true);
    } else if (route.kind === "create") {
      setShowWelcome(false);
      setInputSection("meta");
      setDialogMode("create");
    } else if (route.kind === "plan") {
      setShowWelcome(false);
      selectedProjectIdRef.current = route.id;
      setSelectedId(route.id);
      if (route.stage) {
        routeStageRef.current = route.stage;
        setActiveStage(route.stage);
      }
      if (route.view === "edit") {
        setInputSection("meta");
        pendingEditIdRef.current = route.id;
      } else if (route.view) {
        routeToolRef.current = route.view;
      }
    }
    setRouteReady(true);
  }, []);

  useEffect(() => {
    onUnsavedChange?.(stackDirty || editorDirty || inputsDirty);
    return () => onUnsavedChange?.(false);
  }, [editorDirty, onUnsavedChange, stackDirty, inputsDirty]);

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
          ? tRef.current("project.error.libraryFailed", {
              message: cause.message,
            })
          : tRef.current("project.error.libraryFailedGeneric"),
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
      .migrateSavedPalletStore({
        conflictPolicy: "skip",
        legacyLocalStorageJson:
          globalThis.localStorage?.getItem("saved_pallets_v1") ?? null,
      })
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
            tRef.current(
              result.migratedCount === 1
                ? "project.status.legacyImported_one"
                : "project.status.legacyImported_other",
              {
                count: result.migratedCount,
              },
            ),
          );
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        console.error("Failed to migrate legacy pallet library", cause);
        setError(
          cause instanceof Error
            ? tRef.current("project.error.migrationFailed", {
                message: cause.message,
              })
            : tRef.current("project.error.migrationFailedGeneric"),
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
            diagnostic ||
              tRef.current("project.error.reopenMissing", { id: selectedId }),
          );
          return;
        }
        setSelectedProject(result.project);
        setRobotSettings(createInitialRobotWorkspaceSettings(result.project));
        if (routeStageRef.current) {
          routeStageRef.current = null;
        } else if (!generatorLaunchRequestRef.current) {
          setActiveStage(planningStageForProject(result.project));
        }
        if (routeToolRef.current) {
          setActiveTool(routeToolRef.current);
          routeToolRef.current = null;
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
            ? tRef.current("project.error.reopenFailed", {
                message: cause.message,
              })
            : tRef.current("project.error.reopenFailedGeneric"),
        );
      })
      .finally(() => {
        if (request === projectRequest.current) setLoadingProject(false);
      });
  }, [repository, selectedId, projectReloadToken]);

  const saveProject = async (project: Project): Promise<Project> => {
    setShowWelcome(false);
    setProjectDrawerOpen(false);
    setError(null);
    setStatusMessage(null);
    const switchedProject = selectedId !== project.id;
    const generation = navigationGeneration.current;
    const saved = await repository.saveProject(project);
    if (generation !== navigationGeneration.current) return saved;
    selectedProjectIdRef.current = saved.id;
    setSelectedId(saved.id);
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    if (switchedProject) {
      setActiveStage(planningStageForProject(saved));
      setActiveTool(null);
    }
    setStatusMessage(
      t("project.status.planSaved", { name: projectLabel(saved, t) }),
    );
    await refreshProjects();
    return saved;
  };

  const hasUnsavedChanges = stackDirty || editorDirty || inputsDirty;
  const confirmDiscardUnsaved = (action: string): boolean =>
    !(stackDirty || editorDirty || inputsDirtyRef.current) ||
    window.confirm(t("project.confirm.discardUnsaved", { action }));

  const productionToolIsDirty = (tool: ProductionTool): boolean => {
    if (tool === "stack") return stackDirty;
    if (tool === "editor") return editorDirty;
    return false;
  };

  const discardProductionToolState = (tool: ProductionTool): void => {
    if (tool === "stack") setStackDirty(false);
    if (tool === "editor") {
      setEditorDraftProject(null);
      setEditorDirty(false);
    }
  };

  const discardUnsavedPlannerChanges = (): void => {
    navigationGeneration.current += 1;
    setFormGeneration((generation) => generation + 1);
    markInputsDirty(false);
    setWorkbenchEpoch((epoch) => epoch + 1);
    setStackDirty(false);
    setEditorDraftProject(null);
    setEditorDirty(false);
    setActiveTool(null);
  };

  const confirmLeaveActiveTool = (action: string): boolean => {
    if (!activeTool) return true;
    if (
      productionToolIsDirty(activeTool) &&
      !window.confirm(
        t("project.confirm.discardInTool", {
          action,
          tool: toolTitles[activeTool],
        }),
      )
    ) {
      return false;
    }
    discardProductionToolState(activeTool);
    return true;
  };

  const selectProject = (id: string) => {
    if (id === selectedId) {
      setShowWelcome(false);
      setProjectDrawerOpen(false);
      return;
    }
    if (!confirmDiscardUnsaved(t("project.action.switchProjects"))) return;
    discardUnsavedPlannerChanges();
    setGeneratorLaunchRequest(null);
    selectedProjectIdRef.current = id;
    setActiveStage(
      planningStageForProject(
        projects.find((entry) => entry.id === id) ?? null,
      ),
    );
    setProjectDrawerOpen(false);
    setShowWelcome(false);
    setSelectedId(id);
  };

  /** The persisted project behind a library row; the open one wins. */
  const libraryProject = (id: string): Project | null =>
    selectedProject?.id === id
      ? selectedProject
      : (projects.find((entry) => entry.id === id) ?? null);

  const editProject = (id: string) => {
    navigationGeneration.current += 1;
    setInputSection("meta");
    if (id === selectedId) {
      setProjectDrawerOpen(false);
      setShowWelcome(false);
      setDialogMode("edit");
      return;
    }
    pendingEditIdRef.current = id;
    selectProject(id);
    if (selectedProjectIdRef.current !== id) pendingEditIdRef.current = null;
  };

  useEffect(() => {
    if (pendingEditIdRef.current !== selectedProject?.id) {
      return;
    }
    pendingEditIdRef.current = null;
    setDialogMode("edit");
  }, [selectedProject]);

  const openProductionTool = (tool: ProductionTool) => {
    if (tool === activeTool) return;
    if (
      !confirmLeaveActiveTool(
        t("project.action.openTool", { tool: toolTitles[tool] }),
      )
    )
      return;
    navigationGeneration.current += 1;
    setProjectDrawerOpen(false);
    setActiveTool(tool);
  };

  const closeProductionTool = () => {
    if (!confirmLeaveActiveTool(t("project.action.close"))) return;
    navigationGeneration.current += 1;
    setActiveTool(null);
  };

  const duplicate = async (id: string) => {
    const source = libraryProject(id);
    if (!source || !confirmDiscardUnsaved(t("project.action.duplicate"))) {
      return;
    }
    setError(null);
    setStatusMessage(null);
    try {
      const result = await repository.duplicateProject(source.id, {
        projectNumber: source.projectNumber
          ? t("project.copySuffix", { number: source.projectNumber })
          : t("project.copy"),
      });
      if (!result.project) {
        throw new Error(
          diagnosticText(result.diagnostics) ||
            t("project.error.sourceMissing"),
        );
      }
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = result.project.id;
      setSelectedId(result.project.id);
      setSelectedProject(result.project);
      setActiveStage(planningStageForProject(result.project));
      setStatusMessage(
        t("project.status.duplicated", {
          name: projectLabel(result.project, t),
        }),
      );
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to duplicate project", cause);
      setError(
        cause instanceof Error
          ? t("project.error.duplicateFailed", { message: cause.message })
          : t("project.error.duplicateFailedGeneric"),
      );
    }
  };

  const saveAs = async (id: string) => {
    const source = libraryProject(id);
    if (!source || !confirmDiscardUnsaved(t("project.action.saveAs"))) {
      return;
    }
    const projectNumber = window.prompt(
      t("project.prompt.lineNumber"),
      source.projectNumber
        ? t("project.copySuffix", { number: source.projectNumber })
        : t("project.newLine"),
    );
    if (projectNumber === null) return;
    const productNumber = window.prompt(
      t("project.prompt.productNumber"),
      source.productNumber,
    );
    if (productNumber === null) return;
    setError(null);
    setStatusMessage(null);
    try {
      const saved = await repository.saveProjectAs(source, {
        projectNumber,
        productNumber,
      });
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = saved.id;
      setSelectedId(saved.id);
      setSelectedProject(saved);
      setActiveStage(planningStageForProject(saved));
      setStatusMessage(
        t("project.status.savedAs", { name: projectLabel(saved, t) }),
      );
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to save project as", cause);
      setError(
        cause instanceof Error
          ? t("project.error.saveAsFailed", { message: cause.message })
          : t("project.error.saveAsFailedGeneric"),
      );
    }
  };

  /** The library already confirmed the delete (inline step or Shift+click). */
  const remove = async (id: string) => {
    const target = libraryProject(id);
    if (!target) return;
    const isOpen = target.id === selectedProject?.id;
    // Losing unsaved work in the open project still asks separately.
    if (
      isOpen &&
      hasUnsavedChanges &&
      !window.confirm(
        t("project.confirm.deleteOpen", { name: projectLabel(target, t) }),
      )
    ) {
      return;
    }
    setError(null);
    setStatusMessage(null);
    try {
      const deleted = await repository.deleteProject(target.id);
      if (!deleted) throw new Error(t("project.error.projectGone"));
      if (isOpen) {
        discardUnsavedPlannerChanges();
        setGeneratorLaunchRequest(null);
        selectedProjectIdRef.current = null;
        setSelectedProject(null);
        setSelectedId(null);
      }
      setStatusMessage(
        t("project.status.deleted", { name: projectLabel(target, t) }),
      );
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to delete project", cause);
      setError(
        cause instanceof Error
          ? t("project.error.deleteFailed", { message: cause.message })
          : t("project.error.deleteFailedGeneric"),
      );
    }
  };

  const downloadRob = (id: string) => {
    const target = libraryProject(id);
    if (!target) return;
    setError(null);
    setStatusMessage(null);
    const result = libraryRobDownload(target, t);
    if (!result.ok) {
      setError(
        t("project.error.robDownloadFailed", { message: result.message }),
      );
      return;
    }
    downloadText(result.text, result.fileName);
    setStatusMessage(
      t("project.status.downloaded", { fileName: result.fileName }),
    );
  };

  const exportProjects = async (
    selection: "selected" | "all",
    projectId: string | null = selectedId,
  ) => {
    setError(null);
    setStatusMessage(null);
    try {
      const result = await exportRepositoryPackageJson(
        repository,
        selection === "selected" && projectId
          ? { projectIds: [projectId] }
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
          ? `${selectedProject ? projectLabel(selectedProject, t) : t("project.fallbackName")}.planner.json`
          : "planner-projects.json",
        result.json,
      );
      setStatusMessage(
        selection === "selected"
          ? t("project.status.exportedSelected")
          : t("project.status.exportedAll"),
      );
    } catch (cause) {
      console.error("Failed to export projects", cause);
      setError(
        cause instanceof Error
          ? t("project.error.exportFailed", { message: cause.message })
          : t("project.error.exportFailedGeneric"),
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
      // A partial import keeps the valid part but must still surface the
      // entries it dropped.
      if (errors.length > 0) {
        setError(errors.map(({ message }) => message).join("\n"));
      }
      if (result.projects.length > 0 || errors.length === 0) {
        setStatusMessage(
          t("project.status.imported", {
            projects: result.projects.length,
            resources: result.resources.length,
            skippedProjects: result.skippedProjects,
            skippedResources: result.skippedResources,
          }),
        );
      }
      if (result.projects[0] && !hasUnsavedChanges) {
        setGeneratorLaunchRequest(null);
        selectedProjectIdRef.current = result.projects[0].id;
        setActiveStage(planningStageForProject(result.projects[0]));
        setSelectedId(result.projects[0].id);
      }
      // An overwrite of the open plan keeps the same id, so the load effect
      // would not re-run; force it so stale inputs cannot be saved back.
      if (
        selectedProjectIdRef.current &&
        result.projects.some(({ id }) => id === selectedProjectIdRef.current)
      ) {
        setProjectReloadToken((token) => token + 1);
      }
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to import project package", cause);
      setError(
        cause instanceof Error
          ? t("project.error.importFailed", { message: cause.message })
          : t("project.error.importFailedGeneric"),
      );
    }
  };

  const importRobAsProject = async (file: File) => {
    if (!confirmDiscardUnsaved(t("project.action.openRob"))) return;
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
        t("project.status.robOpened", {
          name:
            saved.source.kind === "rob-import"
              ? saved.source.fileName
              : file.name,
        }),
      );
    } catch (cause) {
      console.error("Failed to open .rob file", cause);
      setError(
        cause instanceof Error
          ? t("project.error.robImportFailed", { message: cause.message })
          : t("project.error.robImportFailedGeneric"),
      );
    }
  };

  const applyGeneratorPackageInputs = async ({
    dimensionsMm,
    inletOrientation,
    multiPickAllowed,
  }: GeneratorPackageInputs): Promise<Project> => {
    if (!selectedProject) {
      throw new Error(t("project.error.projectRequired"));
    }
    if (editorDirty) {
      throw new Error(t("project.error.editorDirtyBeforeInputs"));
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
      t("project.status.generatorInputsApplied", {
        length: dimensionsMm.length,
        width: dimensionsMm.width,
        height: dimensionsMm.height,
        orientation: inletOrientation,
        multipick: multiPickAllowed
          ? t("project.enabled")
          : t("project.disabled"),
      }),
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
  // The composer seeds pattern A with the selected candidate.
  const stackComposerCandidates = useMemo(() => {
    const all = solverResult?.candidates ?? [];
    if (!selectedCandidateId) return all;
    const selected = all.find(({ id }) => id === selectedCandidateId);
    return selected
      ? [selected, ...all.filter(({ id }) => id !== selectedCandidateId)]
      : all;
  }, [selectedCandidateId, solverResult]);
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
  const robotCycleCount = robotMaterialization?.cycles.length ?? 0;
  const activeToolGate = activeTool
    ? productionToolGate(activeTool, workspaceProject, robotCycleCount, t)
    : null;
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
  const importedRob =
    workspaceProject?.source.kind === "rob-import" &&
    !projectNeedsGeometryReview(workspaceProject);
  const resolvedStage = clampPlanningStage(activeStage, Boolean(importedRob));
  useEffect(() => {
    document.scrollingElement?.scrollTo?.({ top: 0, behavior: "auto" });
  }, [resolvedStage, showWelcome, projectDrawerOpen, dialogMode]);

  const currentRoute: PlannerRoute | null = !routeReady
    ? null
    : showWelcome
      ? { kind: "welcome" }
      : dialogMode === "create"
        ? { kind: "create" }
        : projectDrawerOpen
          ? { kind: "library" }
          : selectedId
            ? {
                kind: "plan",
                id: selectedId,
                stage: dialogMode === "edit" ? null : resolvedStage,
                view: dialogMode === "edit" ? "edit" : activeTool,
              }
            : { kind: "welcome" };
  const currentPath = currentRoute ? plannerRoutePath(currentRoute) : null;
  useEffect(() => {
    if (!currentPath || window.location.pathname === currentPath) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${currentPath}${window.location.search}${window.location.hash}`,
    );
  }, [currentPath]);
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
            t,
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
              label: t("project.ledger.importedPlan"),
              status: "OBSERVED" as const,
              evidence: "O" as const,
              claim: t("project.ledger.importedClaim"),
              detail: `${importedSource.fileName}${
                currentPalletData
                  ? `\n${t("project.ledger.importedDetail", {
                      layers: currentPalletData.layer_count,
                      packages: currentPalletData.total_boxes,
                    })}`
                  : ""
              }`,
            },
          ]
        : []),
      {
        id: "current-geometry",
        label: t("project.ledger.currentGeometry"),
        status: currentGeometryStatus,
        evidence: selectedCandidate ? "G" : currentPreview ? "O" : "?",
        claim: selectedCandidate
          ? selectedCandidate.validation.valid
            ? t("project.ledger.candidatePassed")
            : t("project.ledger.candidateFailed")
          : currentPreview
            ? importedSource
              ? t("project.ledger.importedLayerShown")
              : t("project.ledger.savedLayerObservable")
            : t("project.ledger.noGeometry"),
        detail: selectedCandidate
          ? selectedCandidate.validation.issues
              .map(({ message }) => message)
              .join("\n") ||
            t("project.ledger.candidateDetail", {
              rank: selectedCandidate.rank,
              packages: selectedCandidate.metrics.packageCount,
            })
          : undefined,
      },
      {
        id: "robot-readiness",
        label: t("project.ledger.robotReadiness"),
        status: robotReadinessStatus,
        evidence:
          robotReadinessStatus === "PASS"
            ? "G"
            : robotReadinessStatus === "OBSERVED" && observedEquipmentSelected
              ? "O"
              : "?",
        claim:
          robotReadinessStatus === "PASS"
            ? t("project.ledger.robotPass")
            : robotReadinessStatus === "OBSERVED"
              ? observedEquipmentSelected
                ? t("project.ledger.robotObservedEquipment")
                : t("project.ledger.robotObserved")
              : robotReadinessStatus === "SKIPPED"
                ? t("project.ledger.robotSkipped")
                : t("project.ledger.robotBlocked"),
        detail: robotReadinessDetail || undefined,
      },
      {
        id: "export-readiness",
        label: t("project.ledger.exportReadiness"),
        status: "BLOCKED",
        evidence: "?",
        claim: t("project.ledger.exportClaim"),
      },
    ];
  }, [
    currentPalletData,
    currentPreview,
    resolvedRobotSettings,
    robotMaterialization,
    selectedCandidate,
    t,
    workspaceProject,
  ]);

  const saveStack = async (
    state: StackWorkspaceState,
    materialized: Parameters<typeof materializedStackToPalletData>[0],
  ) => {
    setStatusMessage(null);
    if (!workspaceProject || !solverInput) return "cancelled" as const;
    if (editorDirty) {
      throw new Error(t("project.error.editorDirtyBeforeStack"));
    }
    const activeSolution = workspaceProject.solutions.find(
      ({ id }) => id === workspaceProject.activeSolutionId,
    );
    const existingLayerCount = activeSolution?.stack.layers.length ?? 0;
    if (
      existingLayerCount > 0 &&
      !window.confirm(
        t("project.confirm.replaceStack", {
          existing: existingLayerCount,
          draft: materialized.packageLayers.length,
        }),
      )
    ) {
      return "cancelled" as const;
    }
    const generation = navigationGeneration.current;
    const updated = projectWithPersistedStack(
      workspaceProject,
      solverResult?.candidates ?? [],
      solverInput,
      state,
    );
    const saved = await repository.saveProject(updated);
    if (generation !== navigationGeneration.current)
      return "cancelled" as const;
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    // The materialized stack replaces the candidate draft as the current
    // geometry; the generated candidates stay available for a new draft.
    setSelectedCandidateId(null);
    setCurrentLayerIndex(0);
    setStatusMessage(
      t("project.status.stackSaved", {
        packages: materialized.metrics.packages.totalPackageCount,
        layers: materialized.packageLayers.length,
      }),
    );
    await refreshProjects();
    if (generation !== navigationGeneration.current)
      return "cancelled" as const;
    setStackDirty(false);
    // A saved stack opens in the plan viewer; robot setup is a secondary surface.
    setActiveTool(null);
    setActiveStage("stack");
    return "saved" as const;
  };

  const createNew = () => {
    if (!confirmDiscardUnsaved(t("project.action.createPlan"))) return;
    discardUnsavedPlannerChanges();
    createOriginRef.current = {
      screen: showWelcome
        ? "welcome"
        : projectDrawerOpen
          ? "library"
          : "workbench",
      selectedId,
    };
    setShowWelcome(false);
    setProjectDrawerOpen(false);
    setInputSection("meta");
    setDialogMode("create");
  };
  const openInputs = (section: GuidedSectionId = "package") => {
    navigationGeneration.current += 1;
    setInputSection(section);
    setDialogMode("edit");
  };
  const browsePlans = () => {
    if (!confirmDiscardUnsaved(t("project.action.openPlanList"))) return;
    if (hasUnsavedChanges) discardUnsavedPlannerChanges();
    else navigationGeneration.current += 1;
    setShowWelcome(false);
    setProjectDrawerOpen(true);
    setDialogMode("closed");
  };
  return (
    <div className="planner-workspace-shell">
      <header className="fable-header">
        <button
          className="fable-logo"
          onClick={() => {
            if (!confirmDiscardUnsaved(t("project.action.openHome"))) return;
            if (hasUnsavedChanges) discardUnsavedPlannerChanges();
            else navigationGeneration.current += 1;
            setShowWelcome(true);
            setProjectDrawerOpen(false);
            setDialogMode("closed");
          }}
          aria-label={t("shell.home")}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 2 29 9 16 17 3 9Z" fill="var(--carton-top)" />
            <path d="M3 9 16 17 16 31 3 23Z" fill="var(--carton-left)" />
            <path d="M29 9 16 17 16 31 29 23Z" fill="var(--carton-right)" />
            <path d="M9 6 22 14" stroke="var(--carton-tape)" strokeWidth="3" />
          </svg>
          {t("shell.appName")}
        </button>
        <span className="header-context">
          {showWelcome
            ? ""
            : projectDrawerOpen
              ? t("shell.planLibrary")
              : dialogMode === "create"
                ? t("shell.newPlan")
                : workspaceProject
                  ? projectLabel(workspaceProject, t)
                  : t("shell.newPlan")}
        </span>
        <div className="header-actions">
          {!showWelcome && (
            <button className="text-action" onClick={browsePlans}>
              {t("shell.plans")}
            </button>
          )}
          {!showWelcome &&
            !projectDrawerOpen &&
            dialogMode === "closed" &&
            workspaceProject && (
              <details className="fable-tool-menu">
                <summary>{t("shell.editAndCheck")}</summary>
                <div>
                  {(
                    [
                      ["editor", t("shell.tool.editor")],
                      ["robotics", t("shell.tool.robotics")],
                      ["simulation", t("shell.tool.simulation")],
                      ["report", t("shell.tool.report")],
                    ] as const
                  ).map(([tool, label]) => {
                    const gate = productionToolGate(
                      tool,
                      workspaceProject,
                      robotCycleCount,
                      t,
                    );
                    return (
                      <button
                        key={tool}
                        title={gate.ready ? undefined : gate.missing}
                        onClick={(event) => {
                          const menu = event.currentTarget.closest("details");
                          if (menu) menu.open = false;
                          openProductionTool(tool);
                        }}
                      >
                        {label}
                        {gate.ready ? null : (
                          <span>
                            <span aria-hidden="true">{t("shell.locked")}</span>
                            <span className="sr-only">{gate.missing}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </details>
            )}
          <LanguageSwitcher />
        </div>
      </header>
      {routeReady && showWelcome && dialogMode === "closed" ? (
        <PlannerWelcome
          planCount={projects.length}
          onCreate={createNew}
          onBrowse={browsePlans}
          onResume={
            workspaceProject
              ? () => {
                  setShowWelcome(false);
                  setProjectDrawerOpen(false);
                }
              : undefined
          }
        />
      ) : null}
      {
        <div
          hidden={showWelcome || projectDrawerOpen || dialogMode !== "closed"}
        >
          <PlanningCaseWorkbench
            key={`${selectedId}:${workbenchEpoch}`}
            project={workspaceProject}
            stackContent={
              workspaceProject &&
              solverResult &&
              solverInput &&
              stackComposerCandidates.length ? (
                <StackWorkspace
                  guided
                  onBack={() => {
                    if (
                      stackDirty &&
                      !window.confirm(t("project.confirm.changePattern"))
                    ) {
                      return;
                    }
                    setActiveStage("generate");
                  }}
                  onEditProject={openInputs}
                  project={workspaceProject}
                  candidates={stackComposerCandidates}
                  solverInput={solverInput}
                  onSave={saveStack}
                  onDirtyChange={setStackDirty}
                />
              ) : undefined
            }
            onDownloadRob={
              selectedProject
                ? () => downloadRob(selectedProject.id)
                : undefined
            }
            loadingProject={loadingProject}
            error={error}
            statusMessage={
              projectNeedsGeometryReview(workspaceProject)
                ? t("project.geometryReview")
                : statusMessage
            }
            activeStage={resolvedStage}
            onStageChange={(stage) =>
              setActiveStage(clampPlanningStage(stage, Boolean(importedRob)))
            }
            onOpenProjects={browsePlans}
            onCreateProject={createNew}
            onEditProject={() => openInputs()}
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
            savedPalletData={savedCurrentPalletData}
            currentLayerIndex={resolvedCurrentLayerIndex}
            onCurrentLayerChange={setCurrentLayerIndex}
            hasUnsavedChanges={hasUnsavedChanges}
            robotCycleCount={robotCycleCount}
          />
        </div>
      }
      {!showWelcome && projectDrawerOpen && dialogMode === "closed" ? (
        <>
          {error && (
            <div className="fable-page">
              <p role="alert" className="fable-notice">
                {error}
              </p>
            </div>
          )}
          <PlanLibrary
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
            onCreate={createNew}
            onImportRob={(file) => void importRobAsProject(file)}
            onEdit={editProject}
            onDuplicate={(id) => void duplicate(id)}
            onSaveAs={(id) => void saveAs(id)}
            onDelete={(id) => void remove(id)}
            onExportSelected={(id) => void exportProjects("selected", id)}
            onDownloadRob={downloadRob}
            onExportAll={() => void exportProjects("all")}
            onImport={(file) => void importProjects(file)}
          />
        </>
      ) : null}

      <CaseDrawer
        open={activeTool !== null}
        title={activeTool ? toolTitles[activeTool] : t("project.tool.fallback")}
        onClose={closeProductionTool}
      >
        {activeToolGate && !activeToolGate.ready ? (
          <div className="grid justify-items-start gap-3 p-4">
            <p className="text-ink text-[13px] leading-5">
              {activeToolGate.missing}
            </p>
            <button
              type="button"
              className="ui-btn-primary"
              onClick={() => {
                if (activeToolGate.ready) return;
                if (activeToolGate.action.kind === "tool") {
                  setActiveTool(activeToolGate.action.tool as ProductionTool);
                  return;
                }
                setActiveTool(null);
                setActiveStage(
                  clampPlanningStage(
                    activeToolGate.action.stage,
                    Boolean(importedRob),
                  ),
                );
              }}
            >
              {activeToolGate.actionLabel}
            </button>
          </div>
        ) : (
          <>
            {activeTool === "candidate-browser" &&
            solverResult &&
            solverInput ? (
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
                candidates={stackComposerCandidates}
                solverInput={solverInput}
                onSave={saveStack}
                onDirtyChange={setStackDirty}
              />
            ) : null}

            {activeTool === "editor" &&
            selectedProject &&
            robotMaterialization ? (
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

            {activeTool === "report" &&
            workspaceProject &&
            robotMaterialization ? (
              <ReportWorkspace
                project={workspaceProject}
                materialization={robotMaterialization}
                previewData={robotPreviewData}
              />
            ) : null}
          </>
        )}
      </CaseDrawer>

      <div className={dialogMode !== "closed" ? "fable-page" : undefined}>
        {dialogMode === "create" && (
          <ol className="fable-steps" aria-label={t("project.steps.label")}>
            <li aria-current="step">
              <span className="step-number">1</span>
              <span className="step-name">
                {t("project.steps.packagePallet")}
              </span>
            </li>
            <li>
              <span className="step-number">2</span>
              <span className="step-name">
                {t("project.steps.pickPattern")}
              </span>
            </li>
            <li>
              <span className="step-number">3</span>
              <span className="step-name">{t("project.steps.buildStack")}</span>
            </li>
          </ol>
        )}
        <ProjectDialog
          key={formGeneration}
          inline
          initialSection={inputSection}
          {...{ onDirtyChange: markInputsDirty }}
          open={dialogMode !== "closed"}
          project={dialogMode === "edit" ? workspaceProject : null}
          onClose={() => {
            if (
              !inputsDirtyRef.current ||
              window.confirm(t("project.confirm.closeInputs"))
            ) {
              navigationGeneration.current += 1;
              setDialogMode("closed");
              // Cancelled (nothing saved): go back to where the form was
              // opened instead of stranding the user on an empty workbench.
              const origin = createOriginRef.current;
              if (
                dialogMode === "create" &&
                selectedProjectIdRef.current === origin.selectedId
              ) {
                const screen = origin.selectedId ? origin.screen : "welcome";
                if (screen === "welcome") setShowWelcome(true);
                else if (screen === "library") setProjectDrawerOpen(true);
              }
            }
          }}
          onSave={async ({
            project,
            generationIntent,
          }: ProjectDialogSubmission) => {
            const previous = selectedProject;
            const changesGeometry =
              previous?.id === project.id &&
              geometryReviewSignature(previous) !==
                geometryReviewSignature(project);
            if (
              changesGeometry &&
              (stackDirty || editorDirty) &&
              !window.confirm(t("project.confirm.changedDimensions"))
            ) {
              return "cancelled";
            }
            const generation = navigationGeneration.current;
            const saved = await saveProject(project);
            if (generation !== navigationGeneration.current) return "cancelled";
            markInputsDirty(false);
            if (
              previous?.id === saved.id &&
              solverInputSignature(previous) !== solverInputSignature(saved)
            ) {
              // Editing in place keeps `selectedId` stable, so the project-switch
              // reset never runs and stale candidates would outlive their input.
              resetSolver();
            }
            if (
              previous?.id === saved.id &&
              geometryReviewSignature(previous) !==
                geometryReviewSignature(saved)
            ) {
              setActiveStage(planningStageForProject(saved));
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
    </div>
  );
}
