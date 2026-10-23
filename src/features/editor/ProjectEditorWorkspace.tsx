"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { updateProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import {
  createProjectEditorHistory,
  projectEditorCanReset,
  projectEditorHistoryDirty,
  projectEditorHistoryPosition,
  projectEditorHistoryReducer,
} from "~/features/editor/editorHistory";
import {
  activeEditorPattern,
  activeEditorSolution,
  projectEditorOrderModel,
  validateProjectEditor,
  type ProjectEditorCommand,
  type ProjectEditorMode,
} from "~/features/editor/editorModel";
import { FlowMode } from "~/features/editor/FlowMode";
import { OrderMode } from "~/features/editor/OrderMode";
import { PatternMode } from "~/features/editor/PatternMode";

const buttonClass = "ui-btn ui-btn-sm";
const inputClass = "ui-input";

const modes: ReadonlyArray<readonly [ProjectEditorMode, string]> = [
  ["pattern", "Pattern"],
  ["order", "Order"],
  ["flow", "Flow"],
];

export type ProjectEditorWorkspaceProps = {
  project: Project;
  materialization: RobotCycleMaterialization;
  onDraftChange?: (project: Project | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveProject: (project: Project) => Promise<Project>;
};

function isTextControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  const role = target.getAttribute("role");
  return role === "textbox" || role === "spinbutton" || role === "combobox";
}

function sameProject(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ProjectEditorWorkspace({
  project,
  materialization,
  onDraftChange,
  onDirtyChange,
  onSaveProject,
}: ProjectEditorWorkspaceProps) {
  const [history, dispatch] = useReducer(
    projectEditorHistoryReducer,
    project,
    createProjectEditorHistory,
  );
  const [mode, setMode] = useState<ProjectEditorMode>("pattern");
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(
    null,
  );
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const loadedProjectRef = useRef(project);
  const pendingSaveRef = useRef<{ submitted: Project } | null>(null);
  const historyRef = useRef(history);
  const placementNumber = useRef(0);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    if (
      loadedProjectRef.current === project ||
      sameProject(loadedProjectRef.current, project)
    ) {
      loadedProjectRef.current = project;
      return;
    }
    if (
      pendingSaveRef.current &&
      pendingSaveRef.current.submitted.id === project.id
    ) {
      loadedProjectRef.current = project;
      onDraftChange?.(historyRef.current.present);
      onDirtyChange?.(projectEditorHistoryDirty(historyRef.current));
      return;
    }
    loadedProjectRef.current = project;
    dispatch({ type: "replace", project });
    setSelectedPatternId(null);
    setSelectedPlacementIds(new Set());
    setSelectedGroupIds(new Set());
    setSaveError(null);
    setStatus(null);
  }, [onDirtyChange, onDraftChange, project]);

  const dirty = projectEditorHistoryDirty(history);
  useEffect(
    () => onDraftChange?.(history.present),
    [history.persisted, history.present, onDraftChange],
  );
  useEffect(
    () => () => {
      onDraftChange?.(null);
      onDirtyChange?.(false);
    },
    [onDirtyChange, onDraftChange],
  );
  useEffect(
    () => onDirtyChange?.(dirty),
    [dirty, history.persisted, onDirtyChange],
  );

  const solution = activeEditorSolution(history.present);
  const pattern = activeEditorPattern(history.present, selectedPatternId);
  useEffect(() => {
    if (!solution) {
      setSelectedPatternId(null);
      return;
    }
    setSelectedPatternId((current) =>
      current && solution.patterns.some(({ id }) => id === current)
        ? current
        : (solution.patterns[0]?.id ?? null),
    );
  }, [solution]);
  useEffect(() => {
    if (!pattern) {
      setSelectedPlacementIds(new Set());
      setSelectedGroupIds(new Set());
      return;
    }
    const placementIds = new Set(pattern.placements.map(({ id }) => id));
    setSelectedPlacementIds(
      (current) => new Set([...current].filter((id) => placementIds.has(id))),
    );
  }, [pattern]);

  const orderModel = useMemo(
    () =>
      solution && pattern
        ? projectEditorOrderModel(history.present, solution.id, pattern.id)
        : null,
    [history.present, pattern, solution],
  );
  useEffect(() => {
    if (!orderModel) {
      setSelectedGroupIds(new Set());
      return;
    }
    const ids = new Set(orderModel.groups.map(({ id }) => id));
    setSelectedGroupIds(
      (current) => new Set([...current].filter((id) => ids.has(id))),
    );
  }, [orderModel]);
  const editorDiagnostics = useMemo(
    () =>
      validateProjectEditor(
        history.present,
        solution?.id ?? null,
        pattern?.id ?? null,
      ),
    [history.present, pattern?.id, solution?.id],
  );
  const resourceDiagnostics = materialization.diagnostics.filter(
    ({ phase }) =>
      phase === "resources" ||
      phase === "compatibility" ||
      phase === "reach" ||
      phase === "envelope" ||
      phase === "collision" ||
      phase === "pose",
  );
  const position = projectEditorHistoryPosition(history);
  const execute = (command: ProjectEditorCommand) => {
    dispatch({ type: "execute", command });
    setSaveError(null);
    setStatus(null);
  };
  const createPlacementId = () => {
    placementNumber.current += 1;
    return `editor-placement-${
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${placementNumber.current}`
    }`;
  };

  const save = async () => {
    if (!dirty || saving) return;
    const snapshot = history.present;
    const submitted = updateProject(snapshot, (current) => current);
    pendingSaveRef.current = { submitted };
    setSaving(true);
    setSaveError(null);
    setStatus(null);
    try {
      const saved = await onSaveProject(submitted);
      dispatch({ type: "mark-saved", project: saved, snapshot });
      loadedProjectRef.current = saved;
      setStatus("Editor snapshot saved to the project repository.");
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Project editor save failed.",
      );
    } finally {
      pendingSaveRef.current = null;
      setSaving(false);
    }
  };

  const discard = () => {
    if (
      dirty &&
      !window.confirm("Discard all unsaved project editor changes?")
    ) {
      return;
    }
    dispatch({ type: "discard" });
    setSelectedPlacementIds(new Set());
    setSelectedGroupIds(new Set());
    setSaveError(null);
    setStatus("Unsaved editor changes discarded.");
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isTextControl(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLocaleLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedPlacementIds(new Set());
      setSelectedGroupIds(new Set());
      dispatch({ type: "clear-error" });
      return;
    }
    if (!solution || !pattern || mode !== "pattern") return;
    const base = {
      mode: "pattern" as const,
      solutionId: solution.id,
      patternId: pattern.id,
    };
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedPlacementIds.size > 0
    ) {
      event.preventDefault();
      execute({
        type: "delete-placements",
        ...base,
        placementIds: [...selectedPlacementIds],
      });
      setSelectedPlacementIds(new Set());
      return;
    }
    const shortcut = event.key.toLocaleLowerCase();
    if (shortcut === "r" && selectedPlacementIds.size > 0) {
      event.preventDefault();
      execute({
        type: "rotate-placements",
        ...base,
        placementIds: [...selectedPlacementIds],
      });
    } else if (shortcut === "c" && selectedPlacementIds.size > 0) {
      event.preventDefault();
      execute({
        type: "center-placements",
        ...base,
        placementIds: [...selectedPlacementIds],
      });
    } else if (shortcut === "l" || shortcut === "t") {
      event.preventDefault();
      const placementId = createPlacementId();
      execute({
        type: "insert-placement",
        ...base,
        placementId,
        orientation: shortcut === "l" ? "longitudinal" : "transverse",
      });
      setSelectedPlacementIds(new Set([placementId]));
    }
  };

  return (
    <section
      data-testid="project-editor-workspace"
      className="bg-canvas text-ink grid gap-3 p-3"
      onKeyDown={handleKeyboard}
    >
      <header className="border-line bg-surface border">
        <div className="border-line flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="mr-auto">
            <h2 className="text-body text-ink font-semibold">
              Project layer editor
            </h2>
            <p className="text-micro text-muted mt-0.5">
              One command history covers package geometry, labels, groups,
              execution order, and stack interlayers.
            </p>
          </div>
          <span
            role="status"
            className={
              dirty ? "text-micro text-brand" : "text-micro text-muted"
            }
          >
            {dirty ? "Unsaved editor changes" : "Saved editor state"}
          </span>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="ui-btn-primary ui-btn-sm"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={discard}
            className={buttonClass}
          >
            Discard
          </button>
          <button
            type="button"
            disabled={history.past.length === 0 || saving}
            onClick={() => dispatch({ type: "undo" })}
            className={buttonClass}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={history.future.length === 0 || saving}
            onClick={() => dispatch({ type: "redo" })}
            className={buttonClass}
          >
            Redo
          </button>
          <button
            type="button"
            disabled={!projectEditorCanReset(history) || saving}
            onClick={() => dispatch({ type: "reset-to-original" })}
            className={`${buttonClass} text-danger`}
          >
            Reset original
          </button>
          <span className="border-line bg-canvas text-micro text-muted border px-2 py-1 font-mono">
            History {position.position}/{position.length}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-3">
          <label className="text-micro text-muted grid min-w-56 gap-1">
            Active solution
            <select
              aria-label="Editor active solution"
              value={solution?.id ?? ""}
              onChange={(event) => {
                execute({
                  type: "set-active-solution",
                  mode,
                  solutionId: event.target.value,
                });
                setSelectedPatternId(null);
                setSelectedPlacementIds(new Set());
                setSelectedGroupIds(new Set());
              }}
              className={inputClass}
            >
              {history.present.solutions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-micro text-muted grid min-w-56 gap-1">
            Active pattern
            <select
              aria-label="Editor active pattern"
              value={pattern?.id ?? ""}
              disabled={!solution || solution.patterns.length === 0}
              onChange={(event) => {
                setSelectedPatternId(event.target.value);
                setSelectedPlacementIds(new Set());
                setSelectedGroupIds(new Set());
              }}
              className={`${inputClass} disabled:text-muted`}
            >
              {solution?.patterns.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.placements.length} packages
                </option>
              ))}
            </select>
          </label>
          <nav
            aria-label="Project editor mode"
            className="border-line flex items-stretch border"
          >
            {modes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-current={mode === value ? "page" : undefined}
                onClick={() => setMode(value)}
                className={`border-line text-micro focus-visible:ring-focus relative border-r px-3 py-1.5 outline-none last:border-r-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset ${
                  mode === value
                    ? "bg-canvas text-ink"
                    : "text-muted hover:bg-surface-hover hover:text-ink"
                }`}
              >
                {label}
                {mode === value ? (
                  <span className="bg-brand absolute inset-x-0 bottom-0 h-0.5" />
                ) : null}
              </button>
            ))}
          </nav>
          <p className="text-micro text-muted ml-auto max-w-md leading-5">
            Shortcuts outside form controls: Ctrl/Command+Z,
            Shift+Ctrl/Command+Z or Ctrl/Command+Y, Delete, Escape, arrows, R
            rotate, C center, L/T insert.
          </p>
        </div>
      </header>

      {history.error || saveError ? (
        <div
          role="alert"
          className="border-danger text-body text-danger border px-3 py-2"
        >
          {history.error ?? saveError}
        </div>
      ) : null}
      {status ? (
        <div
          role="status"
          className="border-line bg-surface text-body text-ink border px-3 py-2"
        >
          {status}
        </div>
      ) : null}

      {!solution || !pattern || !orderModel ? (
        <div className="border-line bg-surface text-body text-muted flex min-h-24 items-center justify-center border border-dashed px-4 text-center">
          Save or import a stack with at least one layer pattern before opening
          the project editor.
        </div>
      ) : mode === "pattern" ? (
        <PatternMode
          project={history.present}
          solution={solution}
          pattern={pattern}
          orderModel={orderModel}
          diagnostics={editorDiagnostics}
          selectedPlacementIds={selectedPlacementIds}
          onSelectionChange={(ids) => setSelectedPlacementIds(new Set(ids))}
          execute={execute}
          createPlacementId={createPlacementId}
        />
      ) : mode === "order" ? (
        <OrderMode
          project={history.present}
          solution={solution}
          pattern={pattern}
          orderModel={orderModel}
          diagnostics={editorDiagnostics}
          selectedPlacementIds={selectedPlacementIds}
          selectedGroupIds={selectedGroupIds}
          onGroupSelectionChange={(ids) => setSelectedGroupIds(new Set(ids))}
          execute={execute}
        />
      ) : (
        <FlowMode
          project={history.present}
          solution={solution}
          pattern={pattern}
          materialization={materialization}
        />
      )}

      {resourceDiagnostics.length > 0 ? (
        <details className="border-line bg-surface border">
          <summary className="text-micro text-ink focus-visible:ring-focus px-3 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset">
            Canonical robotics resource diagnostics (
            {resourceDiagnostics.length})
          </summary>
          <ul className="border-line grid gap-2 border-t p-3">
            {resourceDiagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${diagnostic.message}-${index}`}
                className={
                  diagnostic.severity === "error"
                    ? "text-micro text-danger leading-5"
                    : "text-micro text-brand leading-5"
                }
              >
                <span className="text-micro text-muted font-mono">
                  {diagnostic.phase}/{diagnostic.code}
                </span>
                <br />
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
