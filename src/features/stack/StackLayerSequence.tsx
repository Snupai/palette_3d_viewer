"use client";

import { useRef } from "react";
import type { SolverCandidate } from "~/domain/solver";
import {
  applyStackSequenceCommand,
  type StackLayerTransform,
} from "~/domain/stack";
import {
  candidatePatternRef,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import {
  stackButtonClass,
  stackCheckboxClass,
  stackInputClass,
  stackLegendClass,
  type StackWorkspaceChange,
  transformLabels,
} from "~/features/stack/stackWorkspaceUi";

/** Editable physical layer sequence: one table row per layer. */
export function StackLayerSequence({
  state,
  candidates,
  candidateByRef,
  change,
}: {
  state: StackWorkspaceState;
  candidates: readonly SolverCandidate[];
  candidateByRef: ReadonlyMap<string, SolverCandidate>;
  change: StackWorkspaceChange;
}) {
  const manualLayerNumber = useRef(0);

  return (
    <fieldset className="border-line grid gap-2 border p-3">
      <legend className={stackLegendClass}>Editable layer sequence</legend>
      <p className="text-muted text-xs">
        Each row is one physical layer. Set requested layers to 1 to build
        exactly one layer, then choose its transform below.
      </p>
      <div className="scrollbar-thin border-line max-h-[360px] overflow-auto border">
        <table className="ui-table min-w-[600px]">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Pattern</th>
              <th>Transform</th>
              {state.interlayerMode === "individual" ? (
                <th>Sheet before</th>
              ) : null}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.layers.map((layer, index) => {
              const candidate = candidateByRef.get(layer.patternRef);
              const individual = state.individualBeforeLayer[layer.id] ?? {
                enabled: false,
                thicknessMm: 3,
              };
              return (
                <tr key={layer.id} data-layer-id={layer.id}>
                  <td className="font-mono">{index + 1}</td>
                  <td>
                    <div className="flex items-center">
                      <select
                        aria-label={`Layer ${index + 1} pattern`}
                        value={layer.patternRef}
                        onChange={(event) =>
                          change((current) => ({
                            ...current,
                            layers: applyStackSequenceCommand(current.layers, {
                              type: "update",
                              layerId: layer.id,
                              changes: { patternRef: event.target.value },
                            }).sequence,
                          }))
                        }
                        className={stackInputClass}
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
                        <span className="text-danger ml-2">Missing</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={`Layer ${index + 1} transform`}
                      value={layer.transform}
                      onChange={(event) =>
                        change((current) => ({
                          ...current,
                          layers: applyStackSequenceCommand(current.layers, {
                            type: "update",
                            layerId: layer.id,
                            changes: {
                              transform: event.target
                                .value as StackLayerTransform,
                            },
                          }).sequence,
                        }))
                      }
                      className={stackInputClass}
                    >
                      {Object.entries(transformLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {state.interlayerMode === "individual" ? (
                    <td>
                      {index === 0 ? (
                        <span className="text-muted">Base rule</span>
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
                            className={stackCheckboxClass}
                          />
                          <span className="w-20 shrink-0">
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
                                      thicknessMm: Number(event.target.value),
                                    },
                                  },
                                }))
                              }
                              className={`${stackInputClass} font-mono`}
                            />
                          </span>
                        </div>
                      )}
                    </td>
                  ) : null}
                  <td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Move layer ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() =>
                          change((current) => ({
                            ...current,
                            layers: applyStackSequenceCommand(current.layers, {
                              type: "reorder",
                              layerId: layer.id,
                              toIndex: index - 1,
                            }).sequence,
                          }))
                        }
                        className={stackButtonClass}
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
                            layers: applyStackSequenceCommand(current.layers, {
                              type: "reorder",
                              layerId: layer.id,
                              toIndex: index + 1,
                            }).sequence,
                          }))
                        }
                        className={stackButtonClass}
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
                            layers: applyStackSequenceCommand(current.layers, {
                              type: "delete",
                              layerId: layer.id,
                            }).sequence,
                          }))
                        }
                        className={`${stackButtonClass} ui-btn-danger`}
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
          <p className="text-muted p-3 text-xs">
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
        className={`${stackButtonClass} justify-self-start`}
      >
        Add layer
      </button>
    </fieldset>
  );
}
