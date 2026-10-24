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
import { ArrangePanel } from "~/features/editor/ArrangePanel";
import {
  createProjectEditorHistory,
  projectEditorCanReset,
  projectEditorHistoryDirty,
  projectEditorHistoryReducer,
} from "~/features/editor/editorHistory";
import { countLabel, describeDiagnostic } from "~/features/editor/editorLabels";
import {
  activeEditorPattern,
  activeEditorSolution,
  projectEditorOrderModel,
  suggestProjectEditorOrder,
  validateProjectEditor,
  type ProjectEditorCommand,
} from "~/features/editor/editorModel";
import { InterlayerPanel } from "~/features/editor/InterlayerPanel";
import { OrderPanel } from "~/features/editor/OrderPanel";
import { PatternCanvas } from "~/features/editor/PatternCanvas";

/** Editor views; the command `mode` of the model uses the same names. */
type EditorView = "pattern" | "order";

const views: ReadonlyArray<readonly [EditorView, string]> = [
  ["pattern", "Anordnung"],
  ["order", "Greifreihenfolge"],
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

function positiveStep(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const [view, setView] = useState<EditorView>("pattern");
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(
    null,
  );
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [fineStepDraft, setFineStepDraft] = useState("1");
  const [coarseStepDraft, setCoarseStepDraft] = useState("10");
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
    if (pendingSaveRef.current?.submitted.id === project.id) {
      loadedProjectRef.current = project;
      onDraftChange?.(historyRef.current.present);
      onDirtyChange?.(projectEditorHistoryDirty(historyRef.current));
      return;
    }
    loadedProjectRef.current = project;
    dispatch({ type: "replace", project });
    setSelectedPatternId(null);
    setSelectedPlacementIds(new Set());
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
  const diagnostics = useMemo(
    () =>
      validateProjectEditor(
        history.present,
        solution?.id ?? null,
        pattern?.id ?? null,
      ),
    [history.present, pattern?.id, solution?.id],
  );
  const robotDiagnostics = materialization.diagnostics.filter(({ phase }) =>
    [
      "resources",
      "compatibility",
      "reach",
      "envelope",
      "collision",
      "pose",
    ].includes(phase),
  );

  // A click on a package always selects its whole grip.
  const effectiveSelection = useMemo(() => {
    if (!pattern) return new Set<string>();
    const next = new Set(selectedPlacementIds);
    const gripIds = new Set(
      pattern.placements.flatMap((placement) =>
        next.has(placement.id) && placement.gripId ? [placement.gripId] : [],
      ),
    );
    for (const placement of pattern.placements) {
      if (placement.gripId && gripIds.has(placement.gripId)) {
        next.add(placement.id);
      }
    }
    return next;
  }, [pattern, selectedPlacementIds]);
  const selectedGripIds = useMemo(
    () =>
      new Set(
        (pattern?.placements ?? []).flatMap((placement) =>
          effectiveSelection.has(placement.id) && placement.gripId
            ? [placement.gripId]
            : [],
        ),
      ),
    [effectiveSelection, pattern],
  );

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
  const patternBase = () =>
    solution && pattern
      ? {
          mode: "pattern" as const,
          solutionId: solution.id,
          patternId: pattern.id,
        }
      : null;
  const orderBase = () =>
    solution && pattern
      ? {
          mode: "order" as const,
          solutionId: solution.id,
          patternId: pattern.id,
        }
      : null;

  const insert = (orientation: "longitudinal" | "transverse") => {
    const base = patternBase();
    if (!base) return;
    const placementId = createPlacementId();
    execute({ type: "insert-placement", ...base, placementId, orientation });
    setSelectedPlacementIds(new Set([placementId]));
  };
  const move = (deltaMm: { x: number; y: number }, ids?: readonly string[]) => {
    const base = patternBase();
    const placementIds = ids ?? [...effectiveSelection];
    if (!base || placementIds.length === 0) return;
    execute({
      type: "move-placements",
      ...base,
      placementIds: [...placementIds],
      deltaMm,
    });
  };
  const rotate = () => {
    const base = patternBase();
    if (!base || effectiveSelection.size === 0) return;
    execute({
      type: "rotate-placements",
      ...base,
      placementIds: [...effectiveSelection],
    });
  };
  const center = () => {
    const base = patternBase();
    if (!base || effectiveSelection.size === 0) return;
    execute({
      type: "center-placements",
      ...base,
      placementIds: [...effectiveSelection],
    });
  };
  const remove = () => {
    const base = patternBase();
    if (!base || effectiveSelection.size === 0) return;
    execute({
      type: "delete-placements",
      ...base,
      placementIds: [...effectiveSelection],
    });
    setSelectedPlacementIds(new Set());
  };
  const createGroup = () => {
    const base = orderBase();
    if (!base || effectiveSelection.size === 0) return;
    execute({
      type: "create-group",
      ...base,
      placementIds: [...effectiveSelection],
    });
  };
  const mergeGroups = () => {
    const base = orderBase();
    if (!base || selectedGripIds.size < 2) return;
    execute({ type: "merge-groups", ...base, gripIds: [...selectedGripIds] });
  };
  const applySuggestedOrder = () => {
    const base = orderBase();
    if (!base) return;
    const suggestion = suggestProjectEditorOrder(
      history.present,
      base.solutionId,
      base.patternId,
    );
    execute({
      type: "apply-suggested-order",
      ...base,
      gripIds: suggestion.order,
    });
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
      setStatus("Muster gespeichert.");
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      pendingSaveRef.current = null;
      setSaving(false);
    }
  };

  const discard = () => {
    if (
      dirty &&
      !window.confirm("Alle ungespeicherten Änderungen verwerfen?")
    ) {
      return;
    }
    dispatch({ type: "discard" });
    setSelectedPlacementIds(new Set());
    setSaveError(null);
    setStatus("Änderungen verworfen.");
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isTextControl(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLocaleLowerCase();
    if (modifier && key === "z") {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      dispatch({ type: "redo" });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedPlacementIds(new Set());
      dispatch({ type: "clear-error" });
      return;
    }
    if (view !== "pattern") return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (effectiveSelection.size === 0) return;
      event.preventDefault();
      remove();
      return;
    }
    if (key === "r" && effectiveSelection.size > 0) {
      event.preventDefault();
      rotate();
    } else if (key === "c" && effectiveSelection.size > 0) {
      event.preventDefault();
      center();
    } else if (key === "l" || key === "t") {
      event.preventDefault();
      insert(key === "l" ? "longitudinal" : "transverse");
    }
  };

  const ready = Boolean(solution && pattern && orderModel);
  const selectedCount = effectiveSelection.size;
  const alerts = [history.error, saveError].filter((value): value is string =>
    Boolean(value),
  );

  return (
    <section
      data-testid="project-editor-workspace"
      className="ed"
      onKeyDown={handleKeyboard}
    >
      <div className="ed-bar">
        <div className="ed-bar-title">
          <h2>{pattern ? pattern.name : "Muster bearbeiten"}</h2>
          <p>
            {pattern
              ? `${countLabel(pattern.placements.length, "Paket", "Pakete")} · ${countLabel(orderModel?.groups.length ?? 0, "Griff", "Griffe")}`
              : "Kein Muster geladen"}
          </p>
        </div>
        {history.present.solutions.length > 1 ? (
          <label className="ed-bar-select">
            Lösung
            <select
              aria-label="Aktive Lösung"
              value={solution?.id ?? ""}
              onChange={(event) => {
                execute({
                  type: "set-active-solution",
                  mode: view,
                  solutionId: event.target.value,
                });
                setSelectedPatternId(null);
                setSelectedPlacementIds(new Set());
              }}
              className="ui-input"
            >
              {history.present.solutions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {solution && solution.patterns.length > 1 ? (
          <label className="ed-bar-select">
            Muster
            <select
              aria-label="Aktives Muster"
              value={pattern?.id ?? ""}
              onChange={(event) => {
                setSelectedPatternId(event.target.value);
                setSelectedPlacementIds(new Set());
              }}
              className="ui-input"
            >
              {solution.patterns.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.placements.length} Pakete
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <fieldset className="fw-seg-field">
          <legend className="sr-only">Ansicht</legend>
          <div className="fw-seg">
            {views.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="editor-view"
                  value={value}
                  checked={view === value}
                  onChange={() => setView(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="ed-bar-actions">
          <span role="status" className="ed-status" data-dirty={dirty}>
            {dirty ? "Ungespeicherte Änderungen" : "Gespeichert"}
          </span>
          <button
            type="button"
            className="ui-btn"
            disabled={history.past.length === 0 || saving}
            onClick={() => dispatch({ type: "undo" })}
          >
            Rückgängig
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={history.future.length === 0 || saving}
            onClick={() => dispatch({ type: "redo" })}
          >
            Wiederholen
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!projectEditorCanReset(history) || saving}
            onClick={() => dispatch({ type: "reset-to-original" })}
          >
            Original wiederherstellen
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!dirty || saving}
            onClick={discard}
          >
            Verwerfen
          </button>
          <button
            type="button"
            className="ui-btn-primary"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? "Speichert …" : "Speichern"}
          </button>
        </div>
      </div>

      <div className="ed-alerts">
        {alerts.map((message) => (
          <div key={message} role="alert" className="fw-alert">
            {message}
          </div>
        ))}
        {status ? (
          <div role="status" className="fw-info">
            {status}
          </div>
        ) : null}
      </div>

      {!ready || !solution || !pattern || !orderModel ? (
        <div className="ed-empty">
          Erst einen Stapel mit mindestens einem Muster speichern oder eine
          .rob-Datei importieren, dann lässt sich das Muster bearbeiten.
        </div>
      ) : (
        <div className="ed-layout">
          <div className="ed-stage">
            {view === "pattern" ? (
              <div className="ed-toolbar" role="toolbar" aria-label="Anordnung">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => insert("longitudinal")}
                >
                  Paket längs einfügen
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => insert("transverse")}
                >
                  Paket quer einfügen
                </button>
                <span className="ed-toolbar-gap" aria-hidden="true" />
                <button
                  type="button"
                  className="ui-btn"
                  disabled={selectedCount === 0}
                  onClick={rotate}
                >
                  Drehen
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  disabled={selectedCount === 0}
                  onClick={center}
                >
                  Zentrieren
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn-danger"
                  disabled={selectedCount === 0}
                  onClick={remove}
                >
                  Löschen
                </button>
                <span className="ed-toolbar-count">
                  {selectedCount} ausgewählt
                </span>
              </div>
            ) : (
              <div
                className="ed-toolbar"
                role="toolbar"
                aria-label="Greifreihenfolge"
              >
                <button
                  type="button"
                  className="ui-btn"
                  disabled={selectedCount === 0}
                  onClick={createGroup}
                >
                  Griff aus Auswahl bilden ({selectedCount})
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  disabled={selectedGripIds.size < 2}
                  onClick={mergeGroups}
                >
                  Griffe zusammenlegen ({selectedGripIds.size})
                </button>
                <span className="ed-toolbar-gap" aria-hidden="true" />
                <button
                  type="button"
                  className="ui-btn-primary"
                  disabled={orderModel.groups.length === 0}
                  onClick={applySuggestedOrder}
                >
                  Automatisch ordnen
                </button>
                <span className="ed-toolbar-count">
                  {selectedCount} ausgewählt
                </span>
              </div>
            )}
            <PatternCanvas
              interactionMode={view === "order" ? "select" : "edit"}
              project={history.present}
              pattern={pattern}
              groups={orderModel.groups}
              selectedPlacementIds={effectiveSelection}
              fineStepMm={positiveStep(fineStepDraft, 1)}
              coarseStepMm={positiveStep(coarseStepDraft, 10)}
              onSelectionChange={(ids) => setSelectedPlacementIds(new Set(ids))}
              onMoveSelection={(deltaMm, ids) => move(deltaMm, ids)}
              onNudgeSelection={(deltaMm) => move(deltaMm)}
              onDeleteSelection={remove}
              onRotateSelection={rotate}
            />
            <p className="ed-canvas-hint">
              {view === "pattern"
                ? "Pakete ziehen oder mit den Pfeiltasten verschieben. Die Nummern zeigen die Griffe, die Pfeile die Ablagerichtung."
                : "G1 wird zuerst gesetzt. Griff anklicken, um ihn auf der Palette zu sehen; Pakete auswählen, um daraus einen neuen Griff zu bilden."}
            </p>
          </div>

          <aside className="ed-side">
            {view === "pattern" ? (
              <ArrangePanel
                solution={solution}
                pattern={pattern}
                selectedPlacementIds={effectiveSelection}
                fineStepDraft={fineStepDraft}
                coarseStepDraft={coarseStepDraft}
                onFineStepChange={setFineStepDraft}
                onCoarseStepChange={setCoarseStepDraft}
                execute={execute}
              />
            ) : (
              <OrderPanel
                solution={solution}
                pattern={pattern}
                orderModel={orderModel}
                selectedPlacementIds={effectiveSelection}
                onSelectionChange={setSelectedPlacementIds}
                execute={execute}
              />
            )}

            <section className="ed-panel" aria-labelledby="ed-check-title">
              <div className="ed-panel-head">
                <h3 id="ed-check-title">Prüfung</h3>
                <small>
                  {diagnostics.length === 0
                    ? "keine Hinweise"
                    : `${diagnostics.length} ${diagnostics.length === 1 ? "Hinweis" : "Hinweise"}`}
                </small>
              </div>
              {diagnostics.length === 0 ? (
                <p className="ed-ok">
                  Anordnung, Griffe und Reihenfolge sind gültig.
                </p>
              ) : (
                <ul className="ed-diag">
                  {diagnostics.map((diagnostic, index) => (
                    <li
                      key={`${diagnostic.code}-${index}`}
                      data-severity={diagnostic.severity}
                    >
                      {describeDiagnostic(
                        diagnostic,
                        pattern,
                        orderModel.groups,
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <InterlayerPanel solution={solution} execute={execute} />

            {robotDiagnostics.length > 0 ? (
              <details className="ed-panel-details">
                <summary>
                  Roboterprüfung <small>{robotDiagnostics.length}</small>
                </summary>
                <div>
                  <ul className="ed-diag">
                    {robotDiagnostics.map((diagnostic, index) => (
                      <li
                        key={`${diagnostic.code}-${index}`}
                        data-severity={diagnostic.severity}
                      >
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </aside>
        </div>
      )}
    </section>
  );
}
