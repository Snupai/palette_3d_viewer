"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  duplicateProjectModel,
  updateProject,
} from "~/domain/project/projectFactory";
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
  exportProjectPackageJson,
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
import { SessionMenu, usePlannerSession } from "~/features/auth/SessionMenu";
import { LocalImportController } from "~/features/import/LocalImportDialog";
import {
  plannerAccess,
  saveControl,
  type PlannerAccess,
  type SaveButtonState,
} from "~/features/auth/plannerAccessModel";
import type { PlannerStoreName } from "~/lib/plannerDatabase";
import type { RecordVersion } from "~/lib/plannerRecordStorage";
import { createBrowserLocalPlannerStorage, createPlannerRecordStorage } from "~/lib/plannerStorageFactory";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import {
  createProjectRepository,
  type ProjectConflictPolicy,
  type ProjectRepository,
  type ProjectSortField,
  type RepositoryDiagnostic,
  type SortDirection,
  type VersionedProject,
} from "~/lib/projectRepository";
import { configuredStorageMode, type StorageMode } from "~/lib/storageMode";
import {
  WorkspaceRepositoryModel,
  newWorkspacePlanOrigin,
  isBrowserQuotaError,
  type WorkspacePlanOrigin,
} from "~/features/project/workspaceRepositoryModel";
import { ProjectConflictView } from "~/features/project/ProjectConflictView";
import { DraftRestoreOffer } from "~/features/project/DraftRestoreOffer";
import {
  draftBackupScope,
  draftBaseVersion,
  readDraftBackups,
  removeAllDraftBackups,
  rebaseDraftBackup,
  removeDraftBackup,
  draftBackupStatus,
  saveFailureReason,
  writeDraftBackup,
  type DraftBackup,
  type DraftBackupStorage,
  type SaveFailure,
} from "~/features/project/draftBackupModel";
import {
  createProjectConflict,
  isProjectVersionConflict,
  projectSaveOptions,
  readConflictServerState,
  resolveProjectConflict,
  type ConflictChoice,
  type LoadedProjectVersion,
  type ProjectConflict,
} from "~/features/project/projectConflictModel";

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
  browserRepository?: ProjectRepository;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  /**
   * Defaults to the build's configured mode. In `server` mode saves carry the
   * loaded record version, and a version conflict opens the conflict view.
   */
  storageMode?: StorageMode;
  /** Session API calls in server mode; default `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
};

type DialogMode = "closed" | "create" | "edit";

/** Tools that change the plan and therefore hold a draft. */
const EDITING_TOOLS: ReadonlySet<ProductionTool> = new Set([
  "editor",
  "stack",
  "robotics",
]);

/**
 * The draft a window holds in server mode (#35) and the only writer of its
 * local backup. A restore adopts the backup's own lease.
 */
type DraftLease = {
  projectId: string;
  /** The author: the draft stays in their backups across a user switch. */
  owner: string;
  /** Identifies the draft's backup; other drafts' backups are foreign. */
  token: string;
  /**
   * The stored version the draft is based on, fixed when it starts; `null`
   * for a plan not stored yet (new plan, retry, `.rob` import): it must not
   * exist when saved. Every server-mode save of the draft uses it.
   */
  baseVersion: RecordVersion | null;
  /** Revision of the last backup write (0: none yet). */
  rev: number;
  /** The editor's lease ends when the editor is clean again. */
  source: "editor" | "save";
};

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

/** `localStorage`, or `null` where the browser blocks it. */
function browserDraftStorage(): DraftBackupStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
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
  browserRepository: providedBrowserRepository,
  onUnsavedChange,
  storageMode = configuredStorageMode,
  fetchImpl,
}: PlannerProjectWorkspaceProps) {
  const t = useT();
  // Effects and callbacks that must not re-run on a language switch read `t`
  // through this ref; the message is translated when the error is produced.
  const tRef = useRef(t);
  tRef.current = t;
  const toolTitles = productionToolTitles(t);
  const repositoryRef = useRef<ProjectRepository | null>(null);
  repositoryRef.current ??=
    providedRepository ??
    createProjectRepository(createPlannerRecordStorage({ mode: storageMode, fetch: fetchImpl }));
  const repository = repositoryRef.current;
  const browserStorageRef = useRef<ReturnType<typeof createBrowserLocalPlannerStorage> | null>(null);
  const routingRef = useRef<WorkspaceRepositoryModel | null>(null);
  if (!routingRef.current) {
    if (storageMode === "server") browserStorageRef.current = createBrowserLocalPlannerStorage();
    routingRef.current = new WorkspaceRepositoryModel(storageMode, repository,
      storageMode === "server" ? providedBrowserRepository ?? createProjectRepository(browserStorageRef.current!) : null);
  }
  const routing = routingRef.current;
  const sessionControls = usePlannerSession(storageMode, fetchImpl);
  const { session } = sessionControls;
  /** What the session may do with a stored project (or a new one). */
  const newPlanOrigin = newWorkspacePlanOrigin(storageMode, session);
  const accessFor = (key: string | null | undefined): PlannerAccess => {
    const reference = key ? routing.reference(key) : { origin: newPlanOrigin, id: "" };
    return plannerAccess(session, reference.origin === "browser-local"
      ? { origin: "browser-local" }
      : { origin: "server", createdBy: key ? repository.projectCreatedBy(reference.id) : undefined });
  };
  /**
   * A copy save is in flight. Its success reopens the plan under the copy's
   * id, which resets every editing surface, so all of them are locked until
   * it settles; edits made meanwhile could not be carried over.
   */
  const [copySaving, setCopySaving] = useState(false);
  const saveButtonFor = (access: PlannerAccess): SaveButtonState => {
    const control = saveControl(access);
    return {
      label: control.label ? t(control.label) : null,
      disabledReason: control.disabledReason ? t(control.disabledReason) : null,
      hint: control.hint ? t(control.hint) : undefined,
    };
  };
  /** Creator the server reported for a record (local import, #37). */
  const serverCreatorOf = useCallback(
    (store: PlannerStoreName, id: string) =>
      repository.recordCreatedBy(store, id),
    [repository],
  );
  const generalAccess = accessFor(null);
  const generalReadOnlyHint = generalAccess.readOnlyHint ? t(generalAccess.readOnlyHint) : null;
  /**
   * Local draft backups (ADR 0002, #35), keyed by server, user and project.
   * The user is the last signed-in one, so a draft lost to an expired session
   * is still backed up for its author.
   */
  const backupStorageRef = useRef<DraftBackupStorage | null | undefined>(
    undefined,
  );
  const backupStorage = (): DraftBackupStorage | null => {
    if (backupStorageRef.current === undefined) {
      backupStorageRef.current = browserDraftStorage();
    }
    return backupStorageRef.current;
  };
  const backupUserRef = useRef<string | null>(null);
  if (session.status === "signed-in") backupUserRef.current = session.user.id;
  const backupScopeFor = (userId: string | null) =>
    draftBackupScope(storageMode, globalThis.location?.origin ?? "", userId);
  /**
   * The one draft this window holds (#35): the only writer of its backup.
   * Everything about the draft is fixed when it starts — author, the stored
   * version it is based on — instead of being re-read from live state when a
   * backup is written or a save is sent.
   */
  const draftLeaseRef = useRef<DraftLease | null>(null);
  /** Bumped by every explicit sign-out: late results of before are stale. */
  const signOutEpochRef = useRef(0);
  const [saveFailure, setSaveFailure] = useState<{
    reason: SaveFailure;
    backedUp: boolean;
  } | null>(null);
  /**
   * Bumped by every backup write and removal: the restore offer, the pending
   * badge and the sign-out warning are derived from the live store.
   */
  const [backupRevision, setBackupRevision] = useState(0);
  /** A new plan keeps its id across failed saves, so retries never fork it. */
  const failedCreateIdRef = useRef<string | null>(null);
  const [restoringDraft, setRestoringDraft] = useState(false);

  /** A 401 from the server: the session is gone; the draft stays here. */
  const sessionLossMessage = (cause: unknown): string | null => {
    if (
      cause instanceof ServerStorageError &&
      cause.kind === "unauthenticated"
    ) {
      sessionControls.markSessionLost();
      return t("auth.error.sessionExpired");
    }
    return null;
  };

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
  /** Stored version the open plan was read at (ADR 0006). */
  const loadedVersionRef = useRef<LoadedProjectVersion | null>(null);
  const [conflict, setConflict] = useState<ProjectConflict | null>(null);

  /**
   * The lease of the draft of `project`: the window's lease when it is for
   * that plan, otherwise a new one (the previous lease is released, its
   * backup kept). `null` outside server mode or without a known user.
   */
  const ensureLease = (
    project: Project,
    source: DraftLease["source"],
  ): DraftLease | null => {
    if (selectedProjectIdRef.current && routing.reference(selectedProjectIdRef.current).origin === "browser-local") return null;
    const current = draftLeaseRef.current;
    if (current?.projectId === project.id) return current;
    const owner = backupUserRef.current;
    if (!backupScopeFor(owner) || !owner) return null;
    const lease: DraftLease = {
      projectId: project.id,
      owner,
      token: crypto.randomUUID(),
      baseVersion: draftBaseVersion(loadedVersionRef.current, project.id),
      rev: 0,
      source,
    };
    draftLeaseRef.current = lease;
    return lease;
  };
  /**
   * Backs up `project` under `lease`, if that is still the window's draft.
   * Never touches another draft's backup ("foreign").
   */
  const backUpDraft = (lease: DraftLease, project: Project): boolean => {
    if (draftLeaseRef.current?.token !== lease.token) return false;
    const scope = backupScopeFor(lease.owner);
    if (!scope) return false;
    const rev = lease.rev + 1;
    const result = writeDraftBackup(
      backupStorage(),
      scope,
      project,
      lease.baseVersion,
      Date.now(),
      { token: lease.token, rev },
    );
    if (result !== "written") return false;
    draftLeaseRef.current = { ...lease, rev };
    setBackupRevision((revision) => revision + 1);
    return true;
  };
  /**
   * The lease's draft is saved, settled or confirmed discarded: its backup
   * goes (only if it still holds revision `rev`, when given) and the window
   * holds no draft any more.
   */
  const endLease = (lease: DraftLease, rev?: number) => {
    const scope = backupScopeFor(lease.owner);
    if (scope) {
      removeDraftBackup(
        backupStorage(),
        scope,
        lease.projectId,
        lease.token,
        rev,
      );
    }
    if (draftLeaseRef.current?.token === lease.token) {
      draftLeaseRef.current = null;
    }
    setBackupRevision((revision) => revision + 1);
  };
  /** The window lets go of its draft; its backup stays on offer. */
  const releaseLease = () => {
    draftLeaseRef.current = null;
    setBackupRevision((revision) => revision + 1);
  };
  /** The draft the open conflict view decides on. */
  const conflictLeaseRef = useRef<DraftLease | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

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

  // The open editor draft is backed up as it changes (server mode only).
  // Once the editor is clean again (saved, undone) the lease it started ends;
  // a lease another save started (and its backup) is not the editor's to end.
  const backupHandlersRef = useRef({ ensureLease, backUpDraft, endLease });
  backupHandlersRef.current = { ensureLease, backUpDraft, endLease };
  useEffect(() => {
    const handlers = backupHandlersRef.current;
    if (editorDirty && editorDraftProject) {
      const lease = handlers.ensureLease(editorDraftProject, "editor");
      if (lease) handlers.backUpDraft(lease, editorDraftProject);
      return;
    }
    const lease = draftLeaseRef.current;
    if (!editorDirty && lease?.source === "editor") {
      handlers.endLease(lease);
      setSaveFailure(null);
    }
  }, [editorDirty, editorDraftProject, session]);

  // Backups written by another tab change the offer and the badge too.
  useEffect(() => {
    if (storageMode !== "server") return;
    const reread = () => setBackupRevision((revision) => revision + 1);
    window.addEventListener("storage", reread);
    return () => window.removeEventListener("storage", reread);
  }, [storageMode]);

  // The backups of the signed-in user (after an expired session: of the last
  // one), re-read on every write, removal and sign-in.
  const signedInUserId =
    session.status === "signed-in" ? session.user.id : null;
  const backupOwnerId = signedInUserId ?? backupUserRef.current;
  const liveBackups = useMemo(() => {
    void backupRevision;
    const scope = draftBackupScope(
      storageMode,
      globalThis.location?.origin ?? "",
      backupOwnerId,
    );
    return scope ? readDraftBackups(browserDraftStorage(), scope) : [];
  }, [backupOwnerId, backupRevision, storageMode]);

  useEffect(() => {
    onUnsavedChange?.(stackDirty || editorDirty || inputsDirty);
    return () => onUnsavedChange?.(false);
  }, [editorDirty, onUnsavedChange, stackDirty, inputsDirty]);

  const refreshProjects = useCallback(async () => {
    const request = ++listRequest.current;
    setLoadingLibrary(true);
    try {
      const result = await routing.list({
        search,
        projectNumber: projectNumberFilter,
        productNumber: productNumberFilter,
        sortBy,
        sortDirection,
      });
      if (request !== listRequest.current) return;
      setProjects(result.projects);
      if (result.errors.length > 0) setError(tRef.current("project.error.libraryFailed", { message: result.errors.map((cause) => cause instanceof Error ? cause.message : String(cause)).join("; ") }));
      const diagnostic = diagnosticText(result.diagnostics);
      if (diagnostic) setError(diagnostic);
      setSelectedId((current) => current ?? (result.projects[0] ? routing.keyFor(result.projects[0]) : null));
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
    routing,
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
      loadedVersionRef.current = null;
      setSelectedProject(null);
      setLoadingProject(false);
      return;
    }
    setLoadingProject(true);
    void routing
      .load(selectedId)
      .then((result) => {
        if (request !== projectRequest.current) return;
        loadedVersionRef.current =
          routing.reference(selectedId).origin === "server" && result.project && typeof result.version === "number"
            ? { projectId: result.project.id, version: result.version }
            : null;
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
  }, [routing, selectedId, projectReloadToken]);

  /**
   * The one write path for the open plan. In server mode it saves against the
   * version the plan was loaded at; a concurrent save elsewhere rejects with a
   * version conflict, which opens the conflict view and rejects the caller so
   * its draft stays unsaved and intact (ADR 0006). In server mode the
   * draft's lease fixes that version (`null`: the plan must not exist yet);
   * the conflict view's draft is backed up so "later" or a reload keeps it.
   */
  const persistProject = async (
    project: Project,
    lease: DraftLease | null,
    origin: WorkspacePlanOrigin,
  ): Promise<VersionedProject> => {
    const options =
      origin === "browser-local" ? undefined : lease && storageMode === "server"
        ? { expectedVersion: lease.baseVersion }
        : projectSaveOptions(storageMode, loadedVersionRef.current, project.id);
    const generation = navigationGeneration.current;
    // Like the success paths: a reply for a plan the user has left (switched,
    // closed, discarded) must not open a conflict view over the new context.
    // A new plan (create retry, `.rob` import) is not selected yet: its own
    // still-held lease counts as open too.
    const stillOpen = () =>
      generation === navigationGeneration.current &&
      (selectedProjectIdRef.current === routing.key({ id: project.id, origin }) ||
        (lease !== null && draftLeaseRef.current?.token === lease.token));
    try {
      const saved = await routing.save(project, origin, options);
      if (origin === "server" && selectedProjectIdRef.current === routing.keyFor(saved.project)) {
        loadedVersionRef.current = {
          projectId: saved.project.id,
          version: saved.version,
        };
      }
      return saved;
    } catch (cause) {
      if (isBrowserQuotaError(cause)) throw new Error(t("project.error.browserQuota"), { cause });
      if (origin === "browser-local" && isProjectVersionConflict(cause, project.id)) throw new Error(t("project.error.browserConflict"), { cause });
      if (!options || !isProjectVersionConflict(cause, project.id)) throw cause;
      if (!stillOpen()) throw cause;
      const server = await readConflictServerState(repository, project.id);
      if (!stillOpen()) throw cause;
      // The rejected draft is backed up — unless the draft moved on while
      // the request ran: its newer backup must not be replaced by this one.
      const current = draftLeaseRef.current;
      if (lease && current?.token === lease.token && current.rev === lease.rev)
        backUpDraft(current, project);
      conflictLeaseRef.current = draftLeaseRef.current;
      setConflictError(null);
      setConflict(createProjectConflict(project, server));
      throw new Error(t("conflict.saveRejected"), { cause });
    }
  };

  /**
   * Stores `project` as the session may (#34): the open plan itself through
   * {@link persistProject}, a new copy the user owns (another user's plan;
   * created fresh, so it never conflicts with the original), or not at all
   * (read-only). A 401 marks the session signed out; the draft stays.
   */
  const saveForSession = async (
    project: Project,
    origin: WorkspacePlanOrigin,
  ): Promise<{ saved: Project; version: RecordVersion; copied: boolean }> => {
    const access = accessFor(routing.key({ id: project.id, origin }));
    if (access.save === "none") {
      throw new Error(t(access.readOnlyHint ?? "auth.readOnly.signIn"));
    }
    // The draft this save belongs to, as it was when the save started.
    const lease = origin === "server" ? ensureLease(project, "save") : null;
    const leaseRev = lease?.rev;
    const epoch = signOutEpochRef.current;
    /** Still the window's draft: not discarded, signed out or replaced. */
    const currentLease = (): DraftLease | null => {
      const current = draftLeaseRef.current;
      return lease &&
        current?.token === lease.token &&
        epoch === signOutEpochRef.current
        ? current
        : null;
    };
    /**
     * Saved: the draft's backup goes — unless the draft changed meanwhile
     * (a newer backup revision), which then continues from the saved version.
     */
    const settle = (version: RecordVersion, inPlace: boolean) => {
      const current = currentLease();
      if (!lease) {
        setSaveFailure(null);
        return;
      }
      if (!current) return;
      if (current.rev === leaseRev) endLease(current, leaseRev);
      else if (inPlace) {
        // Newer edits continue from the saved version, in the lease and in
        // their backup (its content stays the newer one).
        draftLeaseRef.current = { ...current, baseVersion: version };
        const scope = backupScopeFor(current.owner);
        if (scope) {
          rebaseDraftBackup(
            backupStorage(),
            scope,
            current.projectId,
            current.token,
            version,
          );
          setBackupRevision((revision) => revision + 1);
        }
      }
      setSaveFailure(null);
    };
    try {
      if (access.save === "copy") {
        const copy = duplicateProjectModel(project, {
          projectNumber: project.projectNumber
            ? t("project.copySuffix", { number: project.projectNumber })
            : t("project.copy"),
        });
        setCopySaving(true);
        try {
          const { project: saved, version } =
            await repository.saveProjectVersioned(copy, {
              expectedVersion: null,
            });
          settle(version, false);
          return { saved, version, copied: true };
        } finally {
          setCopySaving(false);
        }
      }
      const { project: saved, version } = await persistProject(project, lease, origin);
      settle(version, true);
      return { saved, version, copied: false };
    } catch (cause) {
      // Unreachable server or expired session: the draft stays pending in
      // the browser and is backed up locally (ADR 0002) — unless it was
      // discarded or signed out of while the request ran.
      const reason = saveFailureReason(cause);
      const current = currentLease();
      if (reason && current) {
        // Edits made while the request ran are newer and already backed up:
        // the request's older content must not replace them.
        const backedUp =
          current.rev === leaseRev ? backUpDraft(current, project) : true;
        setSaveFailure({ reason, backedUp });
      }
      // A lease without a backup holds nothing a discard could lose.
      const after = currentLease();
      if (after && after.rev === 0) releaseLease();
      // A 401 from before an explicit sign-out says nothing about the
      // session signed in now.
      const message =
        epoch === signOutEpochRef.current ? sessionLossMessage(cause) : null;
      if (message) throw new Error(message, { cause });
      if (reason === "network") {
        throw new Error(t("project.error.serverUnreachable"), { cause });
      }
      throw cause;
    }
  };

  const draftOrigin = (project: Project): WorkspacePlanOrigin => selectedId && selectedProject?.id === project.id
    ? routing.reference(selectedId).origin : newPlanOrigin;
  const saveProject = async (project: Project, origin = draftOrigin(project)): Promise<Project> => {
    setShowWelcome(false);
    setProjectDrawerOpen(false);
    setError(null);
    setStatusMessage(null);
    const switchedProject = selectedId !== routing.key({ id: project.id, origin });
    const generation = navigationGeneration.current;
    const { saved, version, copied } = await saveForSession(project, origin);
    if (generation !== navigationGeneration.current) return saved;
    selectedProjectIdRef.current = routing.keyFor(saved);
    loadedVersionRef.current = origin === "server" ? { projectId: saved.id, version } : null;
    setSelectedId(routing.keyFor(saved));
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    // The saved project is now the plan: drop a candidate preview so the
    // viewer, report and downloads all show the saved geometry.
    setSelectedCandidateId(null);
    if (switchedProject) {
      setActiveStage(planningStageForProject(saved));
      setActiveTool(null);
    }
    setStatusMessage(
      t(copied ? "auth.status.savedAsCopy" : "project.status.planSaved", {
        name: projectLabel(saved, t),
      }),
    );
    await refreshProjects();
    return saved;
  };
  const hasUnsavedChanges = stackDirty || editorDirty || inputsDirty;
  const backupStatus = draftBackupStatus({
    backups: liveBackups,
    openDraftToken: draftLeaseRef.current?.token ?? null,
    draftOpen: hasUnsavedChanges,
    signedIn: signedInUserId !== null,
  });
  /** The drafts the last sign-out warning covered (their backup tokens). */
  const signOutTokensRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * Whether "Abmelden" must warn, from the live store when clicked — another
   * tab may have written a backup meanwhile. A confirmed sign-out removes
   * exactly the backups counted here.
   */
  const pendingDraftsAtSignOut = (): boolean => {
    const scope = backupScopeFor(signedInUserId);
    const backups = scope ? readDraftBackups(backupStorage(), scope) : [];
    signOutTokensRef.current = new Set(backups.map(({ token }) => token));
    return hasUnsavedChanges || backups.length > 0;
  };
  /**
   * The user confirmed discarding the window's draft: its lease ends, with
   * its local backup and the pending-save state (#35). Only a confirmed
   * discard ends a lease this way.
   */
  const discardDraftLease = (): void => {
    const lease = draftLeaseRef.current;
    if (lease) endLease(lease);
    setSaveFailure(null);
  };
  /**
   * Asks before discarding unsaved work: dirty inputs, stack or editor, or a
   * draft only its backup still holds (a failed save, a failed `.rob`
   * import). Confirming discards that draft's backup too.
   */
  const confirmDiscardUnsaved = (action: string): boolean => {
    const dirty = stackDirty || editorDirty || inputsDirtyRef.current;
    if (!dirty && !draftLeaseRef.current) return true;
    if (!window.confirm(t("project.confirm.discardUnsaved", { action }))) {
      return false;
    }
    discardDraftLease();
    return true;
  };

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

  /** Resets the in-memory drafts; backups only go through a confirm. */
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
    const dirty = productionToolIsDirty(activeTool);
    if (
      dirty &&
      !window.confirm(
        t("project.confirm.discardInTool", {
          action,
          tool: toolTitles[activeTool],
        }),
      )
    ) {
      return false;
    }
    if (dirty) discardDraftLease();
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
        projects.find((entry) => routing.keyFor(entry) === id) ?? null,
      ),
    );
    setProjectDrawerOpen(false);
    setShowWelcome(false);
    setSelectedId(id);
  };

  /** The persisted project behind a library row; the open one wins. */
  const libraryProject = (id: string): Project | null =>
    selectedId === id
      ? selectedProject
      : (projects.find((entry) => routing.keyFor(entry) === id) ?? null);

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
    if (pendingEditIdRef.current !== (selectedProject ? routing.keyFor(selectedProject) : null)) {
      return;
    }
    pendingEditIdRef.current = null;
    setDialogMode("edit");
  }, [selectedProject]);

  const openProductionTool = (tool: ProductionTool) => {
    if (tool === activeTool) return;
    const action = t("project.action.openTool", { tool: toolTitles[tool] });
    if (!confirmLeaveActiveTool(action)) return;
    // A window holds one draft: an editing tool starts only once another
    // surface's unsaved draft (or a draft only its backup holds) is
    // discarded, so the tool's draft never replaces that draft's backup.
    if (
      !activeTool &&
      EDITING_TOOLS.has(tool) &&
      (stackDirty || inputsDirtyRef.current || draftLeaseRef.current)
    ) {
      if (!confirmDiscardUnsaved(action)) return;
      discardUnsavedPlannerChanges();
    }
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
      const origin = session.status === "anonymous" ? "browser-local" : routing.reference(id).origin;
      if (!generalAccess.canCreate) return;
      const { project: copied } = await routing.copy(source, origin, {
        projectNumber: source.projectNumber ? t("project.copySuffix", { number: source.projectNumber }) : t("project.copy"),
      });
      const result = { project: copied };
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = routing.keyFor(result.project);
      setSelectedId(routing.keyFor(result.project));
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
      if (isBrowserQuotaError(cause)) { setError(t("project.error.browserQuota")); return; }
      const lost = sessionLossMessage(cause);
      if (lost) {
        setError(lost);
        return;
      }
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
      const origin = session.status === "anonymous" ? "browser-local" : routing.reference(id).origin;
      if (!generalAccess.canCreate) return;
      const { project: saved } = await routing.copy(source, origin, { projectNumber, productNumber });
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      selectedProjectIdRef.current = routing.keyFor(saved);
      setSelectedId(routing.keyFor(saved));
      setSelectedProject(saved);
      setActiveStage(planningStageForProject(saved));
      setStatusMessage(
        t("project.status.savedAs", { name: projectLabel(saved, t) }),
      );
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to save project as", cause);
      if (isBrowserQuotaError(cause)) { setError(t("project.error.browserQuota")); return; }
      const lost = sessionLossMessage(cause);
      if (lost) {
        setError(lost);
        return;
      }
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
    if (!accessFor(id).canDelete) return;
    const isOpen = id === selectedId;
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
      const deleted = await routing.remove(id);
      if (!deleted) throw new Error(t("project.error.projectGone"));
      const lease = draftLeaseRef.current;
      if (lease?.projectId === target.id) {
        // Its open draft was confirmed discarded with the plan; a draft only
        // a backup holds stays on offer.
        if (isOpen && hasUnsavedChanges) endLease(lease);
        else releaseLease();
      }
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
      if (isBrowserQuotaError(cause)) { setError(t("project.error.browserQuota")); return; }
      const lost = sessionLossMessage(cause);
      if (lost) {
        setError(lost);
        return;
      }
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
      const reference = projectId ? routing.reference(projectId) : null;
      const result = selection === "selected" && reference
        ? await exportRepositoryPackageJson(routing.repository(reference.origin), { projectIds: [reference.id], ...(reference.origin === "browser-local" ? { resourceIds: [] } : {}) })
        : await (async () => {
            const listed = await routing.list();
            if (listed.errors.length) throw listed.errors[0];
            const resources = await repository.listResources();
            return { json: exportProjectPackageJson({ projects: listed.projects, resources: resources.resources }), diagnostics: [...listed.diagnostics, ...resources.diagnostics] };
          })();
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
      if (!generalAccess.canCreate) return;
      const origin = newPlanOrigin;
      const result = await routing.importPackage(
        await file.text(),
        origin,
        {
          projectConflictPolicy,
          resourceConflictPolicy,
        },
        session.status === "signed-in" && session.user.role === "admin",
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
        selectedProjectIdRef.current = routing.keyFor(result.projects[0]);
        setActiveStage(planningStageForProject(result.projects[0]));
        setSelectedId(routing.keyFor(result.projects[0]));
      }
      // An overwrite of the open plan keeps the same id, so the load effect
      // would not re-run; force it so stale inputs cannot be saved back.
      if (
        selectedProjectIdRef.current &&
        result.projects.some((project) => routing.keyFor(project) === selectedProjectIdRef.current)
      ) {
        setProjectReloadToken((token) => token + 1);
      }
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to import project package", cause);
      if (isBrowserQuotaError(cause)) { setError(t("project.error.browserQuota")); return; }
      const lost = sessionLossMessage(cause);
      if (lost) {
        setError(lost);
        return;
      }
      setError(
        cause instanceof Error
          ? t("project.error.importFailed", { message: cause.message })
          : t("project.error.importFailedGeneric"),
      );
    }
  };

  const importRobAsProject = async (file: File) => {
    if (!generalAccess.canCreate || !confirmDiscardUnsaved(t("project.action.openRob"))) return;
    const origin = newPlanOrigin;
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
      const saved = await saveProject(project, origin);
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
    (
      projectId: string,
      result: SolverResult,
      input: LayerSolverInput,
      appended = false,
    ) => {
      if (!selectedProjectIdRef.current || routing.reference(selectedProjectIdRef.current).id !== projectId) return;
      setSolverResult(result);
      setSolverInput(input);
      // Background patterns only extend the list; keep the user's selection.
      if (appended) return;
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
  const workspaceSaveButton: SaveButtonState = copySaving
    ? { label: null, disabledReason: t("auth.savingCopy") }
    : saveButtonFor(accessFor(selectedId));
  const readOnlyHint = accessFor(selectedId).readOnlyHint ? t(accessFor(selectedId).readOnlyHint!) : null;
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
    // A copy leaves the original's stack untouched: nothing to confirm.
    if (
      existingLayerCount > 0 &&
      accessFor(selectedId).save !== "copy" &&
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
    const { saved, version, copied } = await saveForSession(updated, draftOrigin(updated));
    if (generation !== navigationGeneration.current)
      return "cancelled" as const;
    if (copied) {
      selectedProjectIdRef.current = routing.keyFor(saved);
      loadedVersionRef.current = routing.reference(routing.keyFor(saved)).origin === "server" ? { projectId: saved.id, version } : null;
      setSelectedId(routing.keyFor(saved));
    }
    setSelectedProject(saved);
    setEditorDraftProject(null);
    setEditorDirty(false);
    // The materialized stack replaces the candidate draft as the current
    // geometry; the generated candidates stay available for a new draft.
    setSelectedCandidateId(null);
    setCurrentLayerIndex(0);
    setStatusMessage(
      copied
        ? t("auth.status.savedAsCopy", { name: projectLabel(saved, t) })
        : t("project.status.stackSaved", {
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

  const resolveConflict = async (choice: ConflictChoice) => {
    if (!conflict || conflictBusy) return;
    setConflictBusy(true);
    setConflictError(null);
    try {
      const outcome = await resolveProjectConflict(
        repository,
        conflict,
        choice,
        {
          projectNumber: conflict.mine.projectNumber
            ? t("project.copySuffix", { number: conflict.mine.projectNumber })
            : t("project.copy"),
        },
      );
      if (outcome.kind === "refreshed") {
        setConflict(outcome.conflict);
        return;
      }
      // Every other outcome settles the draft: it is saved, replaced by the
      // server state, or kept as a copy. Only that draft's backup goes.
      setConflict(null);
      const settled = conflictLeaseRef.current;
      conflictLeaseRef.current = null;
      if (settled) endLease(settled);
      discardUnsavedPlannerChanges();
      setGeneratorLaunchRequest(null);
      setDialogMode("closed");
      setError(null);
      if (outcome.kind === "saved-mine" || outcome.kind === "adopted-server") {
        loadedVersionRef.current = {
          projectId: outcome.project.id,
          version: outcome.version,
        };
        // A new plan's conflict (create retry) was not the selected plan.
        routing.register(outcome.project, "server");
        selectedProjectIdRef.current = routing.keyFor(outcome.project);
        setSelectedId(routing.keyFor(outcome.project));
        setSelectedProject(outcome.project);
        // Re-read so solver results, tools and robot settings start from the
        // chosen plan state instead of the discarded draft.
        setProjectReloadToken((token) => token + 1);
        setStatusMessage(
          t(
            outcome.kind === "saved-mine"
              ? "conflict.status.savedMine"
              : "conflict.status.adoptedServer",
            { name: projectLabel(outcome.project, t) },
          ),
        );
      } else if (outcome.kind === "server-deleted") {
        selectedProjectIdRef.current = null;
        loadedVersionRef.current = null;
        setSelectedProject(null);
        setSelectedId(null);
        setStatusMessage(t("conflict.status.serverDeleted"));
      } else {
        routing.register(outcome.project, "server");
        selectedProjectIdRef.current = routing.keyFor(outcome.project);
        setSelectedId(routing.keyFor(outcome.project));
        setSelectedProject(outcome.project);
        setActiveStage(planningStageForProject(outcome.project));
        setStatusMessage(
          t("conflict.status.savedCopy", {
            name: projectLabel(outcome.project, t),
          }),
        );
      }
      await refreshProjects();
    } catch (cause) {
      console.error("Failed to resolve version conflict", cause);
      // Like a failed save: an unreachable server or expired session keeps
      // the draft backed up and pending (ADR 0002).
      const reason = saveFailureReason(cause);
      const lease = draftLeaseRef.current;
      if (reason && lease && lease.token === conflictLeaseRef.current?.token) {
        setSaveFailure({ reason, backedUp: backUpDraft(lease, conflict.mine) });
      }
      sessionLossMessage(cause);
      setConflictError(
        t("conflict.error", {
          message:
            cause instanceof Error ? cause.message : t("conflict.errorUnknown"),
        }),
      );
    } finally {
      setConflictBusy(false);
    }
  };

  /**
   * Restores a backed-up draft by saving it through the normal path, against
   * the version it was based on: a plan changed meanwhile opens the conflict
   * view instead of being overwritten (ADR 0006).
   */
  const restoreDraft = async (backup: DraftBackup) => {
    if (restoringDraft || !signedInUserId) return;
    if (
      draftLeaseRef.current?.token !== backup.token &&
      !confirmDiscardUnsaved(t("project.action.restoreDraft"))
    ) {
      return;
    }
    discardUnsavedPlannerChanges();
    setGeneratorLaunchRequest(null);
    setDialogMode("closed");
    // The restore continues the backed-up draft: its token, author and base
    // version. The backup stays until that draft is saved or settled.
    const lease: DraftLease = {
      projectId: backup.projectId,
      owner: signedInUserId,
      token: backup.token,
      baseVersion: backup.baseVersion,
      rev: backup.rev,
      source: "save",
    };
    draftLeaseRef.current = lease;
    selectedProjectIdRef.current = routing.key({ id: backup.projectId, origin: "server" });
    setSelectedId(routing.key({ id: backup.projectId, origin: "server" }));
    setRestoringDraft(true);
    try {
      const saved = await saveProject(backup.project);
      // Re-read so a load started before the save cannot win with the
      // version the draft replaced.
      setProjectReloadToken((token) => token + 1);
      setStatusMessage(
        t("project.draft.restored", { name: projectLabel(saved, t) }),
      );
    } catch (cause) {
      console.error("Failed to restore draft", cause);
      // Nothing of it is open in this window: the backup stays on offer (a
      // conflict view decides on it through its own lease).
      if (draftLeaseRef.current?.token === lease.token) releaseLease();
      setSaveFailure(null);
      setError(
        cause instanceof Error
          ? cause.message
          : t("project.error.saveAsFailedGeneric"),
      );
    } finally {
      setRestoringDraft(false);
    }
  };

  const discardDraftBackup = (backup: DraftBackup) => {
    if (
      !window.confirm(
        t("project.draft.confirmDiscard", {
          name: projectLabel(backup.project, t),
        }),
      )
    ) {
      return;
    }
    const scope = backupScopeFor(signedInUserId);
    if (scope) {
      removeDraftBackup(backupStorage(), scope, backup.projectId, backup.token);
    }
    if (draftLeaseRef.current?.token === backup.token) {
      draftLeaseRef.current = null;
    }
    setBackupRevision((revision) => revision + 1);
  };

  const createNew = () => {
    if (!generalAccess.canCreate) return;
    if (!confirmDiscardUnsaved(t("project.action.createPlan"))) return;
    discardUnsavedPlannerChanges();
    failedCreateIdRef.current = null;
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
                    // The pattern editor only changes the plan: locked
                    // while the session may not save (server mode, #34).
                    const lockedHint = !gate.ready
                      ? gate.missing
                      : tool === "editor"
                        ? readOnlyHint
                        : null;
                    return (
                      <button
                        key={tool}
                        title={lockedHint ?? undefined}
                        onClick={(event) => {
                          const menu = event.currentTarget.closest("details");
                          if (menu) menu.open = false;
                          openProductionTool(tool);
                        }}
                      >
                        {label}
                        {lockedHint === null ? null : (
                          <span>
                            <span aria-hidden="true">{t("shell.locked")}</span>
                            <span className="sr-only">{lockedHint}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </details>
            )}
          {storageMode === "server" ? (
            <LocalImportController
              session={session}
              repository={repository}
              creatorOf={serverCreatorOf}
              onImported={() => void refreshProjects()}
              onSessionLost={sessionControls.markSessionLost}
            />
          ) : null}
          {/* #71 BrowserSyncController belongs here; reuse browserStorageRef, routing.browser, repository, serverCreatorOf and refreshProjects. */}
          {saveFailure && backupStatus.hasPendingDrafts
            ? (() => {
                const hint = t(
                  saveFailure.backedUp
                    ? "project.draft.pendingBackedUp"
                    : "project.draft.pendingMemoryOnly",
                );
                return (
                  <span
                    className="save-pending-badge"
                    role="status"
                    title={hint}
                  >
                    {t(
                      saveFailure.reason === "network"
                        ? "project.draft.pendingNetwork"
                        : "project.draft.pendingSession",
                    )}
                    <span className="sr-only"> {hint}</span>
                  </span>
                );
              })()
            : null}
          <SessionMenu
            controls={{ ...sessionControls, signIn: async (username, password) => {
              if (hasUnsavedChanges && ((dialogMode === "create" && newPlanOrigin === "browser-local") || (selectedId && routing.reference(selectedId).origin === "browser-local"))) return "project.error.saveBrowserBeforeSignIn";
              return sessionControls.signIn(username, password);
            } }}
            hasUnsavedDrafts={pendingDraftsAtSignOut}
            beforeLeave={() =>
              confirmDiscardUnsaved(t("auth.action.openUserManagement"))
            }
            onSignedOut={(user) => {
              if (hasUnsavedChanges) discardUnsavedPlannerChanges();
              // An explicit sign-out discards the drafts its warning covered
              // (this user, this server); an expired session keeps them, and
              // so do backups written after the warning (ADR 0002).
              const scope = backupScopeFor(user.id);
              if (scope) {
                removeAllDraftBackups(
                  backupStorage(),
                  scope,
                  signOutTokensRef.current,
                );
              }
              signOutTokensRef.current = new Set();
              // Late results of requests from before are stale now.
              signOutEpochRef.current += 1;
              backupUserRef.current = null;
              conflictLeaseRef.current = null;
              releaseLease();
              setSaveFailure(null);
            }}
          />
          <LanguageSwitcher />
        </div>
      </header>
      <DraftRestoreOffer
        backups={backupStatus.restorable}
        busy={restoringDraft}
        label={(backup) => projectLabel(backup.project, t)}
        onRestore={(backup) => void restoreDraft(backup)}
        onDiscard={discardDraftBackup}
      />
      {routeReady && showWelcome && dialogMode === "closed" ? (
        <PlannerWelcome
          createDisabledReason={generalReadOnlyHint}
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
                    if (stackDirty) {
                      if (!window.confirm(t("project.confirm.changePattern"))) {
                        return;
                      }
                      discardDraftLease();
                    }
                    setActiveStage("generate");
                  }}
                  onEditProject={openInputs}
                  project={workspaceProject}
                  candidates={stackComposerCandidates}
                  solverInput={solverInput}
                  onSave={saveStack}
                  onDirtyChange={setStackDirty}
                  saveButton={workspaceSaveButton}
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
            editDisabledReason={generalReadOnlyHint}
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
            projectKey={routing.keyFor}
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
            editDisabledReason={generalReadOnlyHint}
            deleteDisabledReason={(id) =>
              accessFor(id).canDelete ? null : t("auth.deleteNotAllowed")
            }
          />
        </>
      ) : null}

      <CaseDrawer
        open={activeTool !== null}
        title={activeTool ? toolTitles[activeTool] : t("project.tool.fallback")}
        onClose={closeProductionTool}
      >
        {/* A dirty editor stays mounted when the session ends, so the
            draft survives until the user signs in again (ADR 0002). */}
        {activeTool === "editor" && readOnlyHint && !editorDirty ? (
          <p className="text-ink p-4 text-[13px] leading-5">{readOnlyHint}</p>
        ) : activeToolGate && !activeToolGate.ready ? (
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
                saveButton={workspaceSaveButton}
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
                saveButton={workspaceSaveButton}
              />
            ) : null}

            {activeTool === "robotics" &&
            workspaceProject &&
            robotMaterialization &&
            resolvedRobotSettings ? (
              <fieldset className="fw-locked-fields" disabled={copySaving}>
                <RoboticsWorkspace
                  project={workspaceProject}
                  repository={repository}
                  materialization={robotMaterialization}
                  settings={resolvedRobotSettings}
                  onSettingsChange={setRobotSettings}
                  onSaveProject={saveProject}
                  onPreviewMotion={() => setActiveTool("simulation")}
                />
              </fieldset>
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
          saveButton={
            dialogMode === "edit"
              ? workspaceSaveButton
              : saveButtonFor(generalAccess)
          }
          onClose={() => {
            const formDirty = inputsDirtyRef.current;
            if (
              !formDirty ||
              window.confirm(t("project.confirm.closeInputs"))
            ) {
              if (formDirty) discardDraftLease();
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
            project: submitted,
            generationIntent,
          }: ProjectDialogSubmission) => {
            // A new plan whose save failed keeps that attempt's id: the retry
            // replaces its backup (and a first save that did reach the
            // server) instead of creating a second plan (#35).
            const creating = dialogMode === "create";
            const project =
              creating && failedCreateIdRef.current
                ? { ...submitted, id: failedCreateIdRef.current }
                : submitted;
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
            let saved: Project;
            try {
              saved = await saveProject(project);
            } catch (cause) {
              if (creating) failedCreateIdRef.current = project.id;
              throw cause;
            }
            if (creating) failedCreateIdRef.current = null;
            if (generation !== navigationGeneration.current) return "cancelled";
            markInputsDirty(false);
            if (dialogMode === "edit" && saved.id !== project.id) {
              // Saved as a copy: the form no longer shows the saved project
              // and will not close itself, so close it here.
              navigationGeneration.current += 1;
              setDialogMode("closed");
              return;
            }
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
      {conflict ? (
        <ProjectConflictView
          conflict={conflict}
          busy={conflictBusy}
          error={conflictError}
          onChoose={(choice) => void resolveConflict(choice)}
          onLater={() => {
            // The draft stays — open, and backed up under its lease.
            conflictLeaseRef.current = null;
            setConflict(null);
            setConflictError(null);
          }}
        />
      ) : null}
    </div>
  );
}
