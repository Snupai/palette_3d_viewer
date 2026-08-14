"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayerPattern } from "~/components/LayerPattern";
import { RobViewer } from "~/components/RobViewer";
import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import {
  applyStackSequenceCommand,
  type MaterializedStackResult,
  type StackCompositionMode,
  type StackLayerTransform,
} from "~/domain/stack";
import {
  calculateWorkspaceCapacity,
  candidatePatternRef,
  createInitialStackWorkspaceState,
  materializeStackWorkspace,
  rebuildStackSequence,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import { materializedStackToPalletData } from "~/lib/projectAdapters";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type StackWorkspaceProps = {
  project: Project;
  candidates: readonly SolverCandidate[];
  solverInput: LayerSolverInput;
  onSave: (
    state: StackWorkspaceState,
    materialized: MaterializedStackResult,
  ) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

const inputClass =
  "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25";
const buttonClass =
  "rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400/40 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent";

const modeLabels: Record<StackCompositionMode, string> = {
  tower: "Tower",
  "longitudinal-mirror": "Longitudinal mirror",
  "transverse-mirror": "Transverse mirror",
  rotation: "180° rotation",
};

const transformLabels: Record<StackLayerTransform, string> = {
  identity: "No transform",
  "rotate-90": "Rotate 90°",
  "rotate-180": "Rotate 180°",
  "rotate-270": "Rotate 270°",
  "mirror-x": "Mirror along pallet width (flip X)",
  "mirror-y": "Mirror along pallet length (flip Y)",
  "transpose-main": "Transpose main diagonal",
  "transpose-anti": "Transpose anti-diagonal",
};

function metric(value: number | null, suffix = ""): string {
  return value === null ? "Unknown" : `${Number(value.toFixed(2))}${suffix}`;
}

export function StackWorkspace({
  project,
  candidates,
  solverInput,
  onSave,
  onDirtyChange,
}: StackWorkspaceProps) {
  const candidateSignature = candidates.map(({ id }) => id).join("|");
  const [state, setState] = useState<StackWorkspaceState>(() =>
    createInitialStackWorkspaceState(candidates),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const manualLayerNumber = useRef(0);
  const editRevision = useRef(0);

  useEffect(() => {
    editRevision.current += 1;
    setState(createInitialStackWorkspaceState(candidates));
    setDirty(false);
    setSaveFailure(null);
    setSaveMessage(null);
  }, [candidateSignature, candidates, project.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const change = (
    updater:
      | StackWorkspaceState
      | ((current: StackWorkspaceState) => StackWorkspaceState),
  ) => {
    editRevision.current += 1;
    setState(updater);
    setDirty(true);
    setSaveFailure(null);
    setSaveMessage(null);
  };

  const materialized = useMemo(() => {
    try {
      return {
        result: materializeStackWorkspace(
          project,
          candidates,
          solverInput,
          state,
        ),
        error: null,
      };
    } catch (cause) {
      return {
        result: null,
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to materialize the current stack.",
      };
    }
  }, [candidates, project, solverInput, state]);
  const previewData = useMemo(
    () =>
      materialized.result
        ? materializedStackToPalletData(materialized.result)
        : null,
    [materialized.result],
  );
  const topPreview = useMemo(() => {
    if (!previewData || previewData.layer_count === 0) return null;
    return palletLayerToPatternPreview(
      previewData,
      previewData.layer_count - 1,
    );
  }, [previewData]);
  const capacity = useMemo(
    () => calculateWorkspaceCapacity(project, state),
    [project, state],
  );
  const candidateByRef = useMemo(
    () =>
      new Map(
        candidates.map((candidate) => [
          candidatePatternRef(candidate),
          candidate,
        ]),
      ),
    [candidates],
  );

  const save = async () => {
    if (!materialized.result) return;
    const revisionAtSaveStart = editRevision.current;
    setSaving(true);
    setSaveFailure(null);
    setSaveMessage(null);
    try {
      await onSave(state, materialized.result);
      if (editRevision.current === revisionAtSaveStart) {
        setDirty(false);
        setSaveMessage("Stack saved to the project repository.");
      } else {
        setSaveMessage(
          "An earlier stack revision was saved. Newer edits remain unsaved.",
        );
      }
    } catch (cause) {
      console.error("Failed to save stack", cause);
      setSaveFailure(
        cause instanceof Error
          ? `Stack save failed: ${cause.message}`
          : "Stack save failed.",
      );
    } finally {
      setSaving(false);
    }
  };

  const selectedA = state.patternARef ?? "";
  const selectedB = state.patternBRef ?? "";

  return (
    <section className="border border-zinc-800 bg-zinc-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-zinc-100">
            Stack workspace
          </h2>
          <p className="text-xs text-zinc-500">
            Compose patterns A/B, edit the physical sequence, and materialize
            production metrics.
          </p>
        </div>
        <span
          className={`text-xs ${dirty ? "text-amber-300" : "text-zinc-500"}`}
        >
          {dirty ? "Unsaved stack edits" : "Saved state"}
        </span>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !materialized.result || state.layers.length === 0}
          className="rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 focus:ring-2 focus:ring-amber-200 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
        >
          {saving ? "Saving…" : "Save stack to project"}
        </button>
      </header>

      {materialized.error ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {materialized.error}
        </div>
      ) : null}
      {saveFailure ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {saveFailure}
        </div>
      ) : null}
      {saveMessage ? (
        <div
          role="status"
          className="m-3 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300"
        >
          {saveMessage}
        </div>
      ) : null}

      <div className="grid min-h-0 xl:grid-cols-[minmax(440px,0.9fr)_minmax(520px,1.1fr)]">
        <div className="grid content-start gap-4 border-b border-zinc-800 p-3 xl:border-r xl:border-b-0">
          <fieldset className="grid gap-3 rounded-md border border-zinc-800 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-300">
              Composition
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Pattern A
                <select
                  aria-label="Pattern A"
                  value={selectedA}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      patternARef: event.target.value || null,
                    }))
                  }
                  className={inputClass}
                >
                  {candidates.map((candidate) => (
                    <option
                      key={candidate.id}
                      value={candidatePatternRef(candidate)}
                    >
                      #{candidate.rank} · {candidate.metrics.packageCount}{" "}
                      packages
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Pattern B
                <select
                  aria-label="Pattern B"
                  value={selectedB}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      patternBRef: event.target.value || null,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Use pattern A</option>
                  {candidates.map((candidate) => (
                    <option
                      key={candidate.id}
                      value={candidatePatternRef(candidate)}
                    >
                      #{candidate.rank} · {candidate.metrics.packageCount}{" "}
                      packages
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Composition mode
                <select
                  aria-label="Composition mode"
                  value={state.compositionMode}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      compositionMode: event.target
                        .value as StackCompositionMode,
                    }))
                  }
                  className={inputClass}
                >
                  {Object.entries(modeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Requested layers
                <input
                  aria-label="Requested layers"
                  type="number"
                  min="0"
                  step="1"
                  value={state.requestedLayerCount}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      requestedLayerCount: Number(event.target.value),
                    }))
                  }
                  className={inputClass}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  change((current) => rebuildStackSequence(current))
                }
                className={buttonClass}
              >
                Build A/B sequence
              </button>
              <span className="text-xs text-zinc-500">
                Derived maximum layers:{" "}
                {capacity ? capacity.capacityLayers : "Unknown"}
                {capacity
                  ? ` · ${capacity.message}`
                  : " · no storage height configured"}
              </span>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 rounded-md border border-zinc-800 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-300">
              Interlayers
            </legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Rule
                <select
                  aria-label="Interlayer rule"
                  value={state.interlayerMode}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      interlayerMode: event.target.value as
                        | "all"
                        | "individual",
                    }))
                  }
                  className={inputClass}
                >
                  <option value="all">All layer boundaries</option>
                  <option value="individual">Individual boundaries</option>
                </select>
              </label>
              {state.interlayerMode === "all" ? (
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  Between-layer thickness (mm)
                  <input
                    aria-label="Between-layer thickness"
                    type="number"
                    min="0"
                    step="any"
                    value={state.betweenThicknessMm}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        betweenThicknessMm: Number(event.target.value),
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              ) : (
                <p className="self-end text-xs text-zinc-500 sm:col-span-2">
                  Enable and size sheets directly in the layer sequence below.
                </p>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  aria-label="Enable base sheet"
                  checked={state.baseEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      baseEnabled: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-amber-400"
                />
                Base sheet
                <input
                  aria-label="Base sheet thickness"
                  type="number"
                  min="0"
                  step="any"
                  value={state.baseThicknessMm}
                  disabled={!state.baseEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      baseThicknessMm: Number(event.target.value),
                    }))
                  }
                  className={`${inputClass} col-span-2 ml-6 disabled:text-zinc-600`}
                />
              </label>
              <label className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  aria-label="Enable deck sheet"
                  checked={state.deckEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      deckEnabled: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 accent-amber-400"
                />
                Deck sheet
                <input
                  aria-label="Deck sheet thickness"
                  type="number"
                  min="0"
                  step="any"
                  value={state.deckThicknessMm}
                  disabled={!state.deckEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      deckThicknessMm: Number(event.target.value),
                    }))
                  }
                  className={`${inputClass} col-span-2 ml-6 disabled:text-zinc-600`}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 rounded-md border border-zinc-800 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-300">
              Special top candidate
            </legend>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={state.specialTopEnabled}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    specialTopEnabled: event.target.checked,
                  }))
                }
                className="h-4 w-4 accent-amber-400"
              />
              Replace the physical top layer
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Top candidate
                <select
                  aria-label="Top candidate"
                  value={state.specialTopPatternRef ?? ""}
                  disabled={!state.specialTopEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      specialTopPatternRef: event.target.value || null,
                    }))
                  }
                  className={`${inputClass} disabled:text-zinc-600`}
                >
                  {candidates.map((candidate) => (
                    <option
                      key={candidate.id}
                      value={candidatePatternRef(candidate)}
                    >
                      #{candidate.rank} · {candidate.metrics.packageCount}{" "}
                      packages
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] text-zinc-500">
                Top transform
                <select
                  aria-label="Top transform"
                  value={state.specialTopTransform}
                  disabled={!state.specialTopEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      specialTopTransform: event.target
                        .value as StackLayerTransform,
                    }))
                  }
                  className={`${inputClass} disabled:text-zinc-600`}
                >
                  {Object.entries(transformLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="grid gap-2 rounded-md border border-zinc-800 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-300">
              Editable layer sequence
            </legend>
            <p className="text-xs text-zinc-500">
              Each row is one physical layer. Set requested layers to 1 to build
              exactly one layer, then choose its transform below.
            </p>
            <div className="scrollbar-thin max-h-[360px] overflow-auto border border-zinc-800">
              <table className="w-full min-w-[600px] border-collapse text-xs">
                <thead className="sticky top-0 bg-zinc-900 text-left text-zinc-500">
                  <tr className="border-b border-zinc-800">
                    <th className="px-2 py-2 font-medium">Layer</th>
                    <th className="px-2 py-2 font-medium">Pattern</th>
                    <th className="px-2 py-2 font-medium">Transform</th>
                    {state.interlayerMode === "individual" ? (
                      <th className="px-2 py-2 font-medium">Sheet before</th>
                    ) : null}
                    <th className="px-2 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.layers.map((layer, index) => {
                    const candidate = candidateByRef.get(layer.patternRef);
                    const individual = state.individualBeforeLayer[
                      layer.id
                    ] ?? {
                      enabled: false,
                      thicknessMm: 3,
                    };
                    return (
                      <tr
                        key={layer.id}
                        data-layer-id={layer.id}
                        className="border-b border-zinc-800 text-zinc-300"
                      >
                        <td className="px-2 py-2 font-mono">{index + 1}</td>
                        <td className="px-2 py-2">
                          <select
                            aria-label={`Layer ${index + 1} pattern`}
                            value={layer.patternRef}
                            onChange={(event) =>
                              change((current) => ({
                                ...current,
                                layers: applyStackSequenceCommand(
                                  current.layers,
                                  {
                                    type: "update",
                                    layerId: layer.id,
                                    changes: { patternRef: event.target.value },
                                  },
                                ).sequence,
                              }))
                            }
                            className={inputClass}
                          >
                            {candidates.map((item) => (
                              <option
                                key={item.id}
                                value={candidatePatternRef(item)}
                              >
                                #{item.rank} · {item.metrics.packageCount}
                              </option>
                            ))}
                          </select>
                          {!candidate ? (
                            <span className="ml-2 text-red-300">Missing</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            aria-label={`Layer ${index + 1} transform`}
                            value={layer.transform}
                            onChange={(event) =>
                              change((current) => ({
                                ...current,
                                layers: applyStackSequenceCommand(
                                  current.layers,
                                  {
                                    type: "update",
                                    layerId: layer.id,
                                    changes: {
                                      transform: event.target
                                        .value as StackLayerTransform,
                                    },
                                  },
                                ).sequence,
                              }))
                            }
                            className={inputClass}
                          >
                            {Object.entries(transformLabels).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        {state.interlayerMode === "individual" ? (
                          <td className="px-2 py-2">
                            {index === 0 ? (
                              <span className="text-zinc-600">Base rule</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  aria-label={`Interlayer before layer ${index + 1}`}
                                  type="checkbox"
                                  checked={individual.enabled}
                                  onChange={(event) =>
                                    change((current) => ({
                                      ...current,
                                      individualBeforeLayer: {
                                        ...current.individualBeforeLayer,
                                        [layer.id]: {
                                          ...individual,
                                          enabled: event.target.checked,
                                        },
                                      },
                                    }))
                                  }
                                  className="h-4 w-4 accent-amber-400"
                                />
                                <input
                                  aria-label={`Interlayer thickness before layer ${index + 1}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={individual.thicknessMm}
                                  disabled={!individual.enabled}
                                  onChange={(event) =>
                                    change((current) => ({
                                      ...current,
                                      individualBeforeLayer: {
                                        ...current.individualBeforeLayer,
                                        [layer.id]: {
                                          ...individual,
                                          thicknessMm: Number(
                                            event.target.value,
                                          ),
                                        },
                                      },
                                    }))
                                  }
                                  className={`${inputClass} w-20 disabled:text-zinc-600`}
                                />
                              </div>
                            )}
                          </td>
                        ) : null}
                        <td className="px-2 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label={`Move layer ${index + 1} up`}
                              disabled={index === 0}
                              onClick={() =>
                                change((current) => ({
                                  ...current,
                                  layers: applyStackSequenceCommand(
                                    current.layers,
                                    {
                                      type: "reorder",
                                      layerId: layer.id,
                                      toIndex: index - 1,
                                    },
                                  ).sequence,
                                }))
                              }
                              className={buttonClass}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              aria-label={`Move layer ${index + 1} down`}
                              disabled={index === state.layers.length - 1}
                              onClick={() =>
                                change((current) => ({
                                  ...current,
                                  layers: applyStackSequenceCommand(
                                    current.layers,
                                    {
                                      type: "reorder",
                                      layerId: layer.id,
                                      toIndex: index + 1,
                                    },
                                  ).sequence,
                                }))
                              }
                              className={buttonClass}
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete layer ${index + 1}`}
                              onClick={() =>
                                change((current) => ({
                                  ...current,
                                  requestedLayerCount: Math.max(
                                    0,
                                    current.layers.length - 1,
                                  ),
                                  layers: applyStackSequenceCommand(
                                    current.layers,
                                    {
                                      type: "delete",
                                      layerId: layer.id,
                                    },
                                  ).sequence,
                                }))
                              }
                              className={`${buttonClass} text-red-300`}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {state.layers.length === 0 ? (
                <p className="p-3 text-xs text-zinc-500">
                  Build or add a layer sequence.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!state.patternARef) return;
                manualLayerNumber.current += 1;
                const layer = {
                  id: `manual-layer-${manualLayerNumber.current}`,
                  patternRef: state.patternARef,
                  transform: "identity" as const,
                  provenance: {
                    kind: "manual" as const,
                    reason: "Added in the planner stack workspace.",
                  },
                };
                change((current) => ({
                  ...current,
                  requestedLayerCount: current.layers.length + 1,
                  layers: applyStackSequenceCommand(current.layers, {
                    type: "insert",
                    index: current.layers.length,
                    layer,
                  }).sequence,
                }));
              }}
              disabled={!state.patternARef}
              className={`${buttonClass} justify-self-start`}
            >
              Add layer
            </button>
          </fieldset>
        </div>

        <div className="grid min-h-0 content-start gap-3 p-3">
          <div className="grid min-h-[420px] gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="min-h-[420px] overflow-hidden rounded-md border border-zinc-800 bg-[#101013]">
              {previewData && previewData.layer_count > 0 ? (
                <RobViewer
                  data={previewData}
                  cameraResetKey={`${project.id}:${candidateSignature}`}
                  visibleUpToLayer={previewData.layer_count}
                  showSceneControls
                />
              ) : (
                <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-zinc-600">
                  Build a stack to preview it in 3D.
                </div>
              )}
            </div>
            <div className="grid content-start gap-3">
              <div className="min-h-[180px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2">
                {topPreview ? (
                  <LayerPattern
                    preview={topPreview}
                    showGroupLabels={false}
                    className="h-full min-h-[164px] w-full"
                  />
                ) : (
                  <div className="flex min-h-[164px] items-center justify-center text-xs text-zinc-600">
                    No top layer
                  </div>
                )}
              </div>
              <p className="text-xs leading-5 text-zinc-500">
                The 3D toolbar provides top, front, right-top, lifted-top, and
                layer-label views.
              </p>
            </div>
          </div>

          {materialized.result ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="overflow-hidden rounded-md border border-zinc-800">
                <table className="w-full text-xs">
                  <caption className="border-b border-zinc-800 px-3 py-2 text-left font-semibold text-zinc-300">
                    Stack metrics
                  </caption>
                  <tbody>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Packages
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {materialized.result.metrics.packages.totalPackageCount}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Cycles
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {metric(
                          materialized.result.metrics.cycles.totalCycleCount,
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Load height
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {metric(
                          materialized.result.metrics.height.loadStackHeightMm,
                          " mm",
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Area use
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {metric(
                          materialized.result.metrics.area.utilization.percent,
                          "%",
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Volume use
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {metric(
                          materialized.result.metrics.volume.utilization
                            .percent,
                          "%",
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Gross weight
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {metric(
                          materialized.result.metrics.weight.grossWeightKg,
                          " kg",
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th className="px-3 py-2 text-left font-normal text-zinc-500">
                        Block L × W
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-zinc-200">
                        {materialized.result.metrics.block.lengthMm} ×{" "}
                        {materialized.result.metrics.block.widthMm} mm
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rounded-md border border-zinc-800 p-3 text-xs">
                <h3 className="font-semibold text-zinc-300">
                  Warnings ({materialized.result.warnings.length})
                </h3>
                {materialized.result.warnings.length === 0 ? (
                  <p className="mt-2 text-zinc-500">No stack warnings.</p>
                ) : (
                  <ul className="scrollbar-thin mt-2 max-h-52 space-y-1 overflow-auto pr-2 text-zinc-400">
                    {materialized.result.warnings.map((warning) => (
                      <li
                        key={warning.id}
                        className="border-b border-zinc-800 pb-1"
                      >
                        <span
                          className={
                            warning.severity === "error"
                              ? "text-red-300"
                              : "text-amber-300"
                          }
                        >
                          {warning.code}
                        </span>{" "}
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          <p className="text-[11px] leading-5 text-zinc-600">
            The shared thickness remains the ProjectV2 compatibility fallback;
            exact base, boundary, and deck thickness overrides persist with the
            current project stack.
          </p>
        </div>
      </div>
    </section>
  );
}
