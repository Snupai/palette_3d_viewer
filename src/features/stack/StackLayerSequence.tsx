"use client";

import { useRef } from "react";
import { useT } from "~/i18n";
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
  classicTransformLabel,
  stackLayerTransforms,
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
  const t = useT();
  const manualLayerNumber = useRef(0);

  return (
    <fieldset className="border-line grid gap-2 border p-3">
      <legend className={stackLegendClass}>{t("stack.seqEdit.legend")}</legend>
      <div className="border-line scrollbar-thin max-h-[360px] overflow-auto border">
        <table className="ui-table min-w-[600px]">
          <thead>
            <tr>
              <th>{t("stack.seqEdit.colLayer")}</th>
              <th>{t("stack.seqEdit.colPattern")}</th>
              <th>{t("stack.seqEdit.colTransform")}</th>
              {state.interlayerMode === "individual" ? (
                <th>{t("stack.seqEdit.colSheetBefore")}</th>
              ) : null}
              <th>{t("stack.seqEdit.colActions")}</th>
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
                        aria-label={t("stack.seqEdit.patternAria", {
                          n: index + 1,
                        })}
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
                        <span className="text-danger ml-2">
                          {t("stack.seqEdit.missing")}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={t("stack.seqEdit.transformAria", {
                        n: index + 1,
                      })}
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
                      {stackLayerTransforms.map((value) => (
                        <option key={value} value={value}>
                          {classicTransformLabel(t, value)}
                        </option>
                      ))}
                    </select>
                  </td>
                  {state.interlayerMode === "individual" ? (
                    <td>
                      {index === 0 ? (
                        <span className="text-muted">
                          {t("stack.seqEdit.baseRule")}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            aria-label={t(
                              "stack.seqEdit.interlayerBeforeAria",
                              {
                                n: index + 1,
                              },
                            )}
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
                              aria-label={t(
                                "stack.seqEdit.interlayerThicknessAria",
                                { n: index + 1 },
                              )}
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
                        aria-label={t("stack.seqEdit.moveUpAria", {
                          n: index + 1,
                        })}
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
                        {t("stack.seqEdit.up")}
                      </button>
                      <button
                        type="button"
                        aria-label={t("stack.seqEdit.moveDownAria", {
                          n: index + 1,
                        })}
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
                        {t("stack.seqEdit.down")}
                      </button>
                      <button
                        type="button"
                        aria-label={t("stack.seqEdit.deleteAria", {
                          n: index + 1,
                        })}
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
                        {t("stack.seqEdit.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {state.layers.length === 0 ? (
          <p className="text-muted text-micro p-3">
            {t("stack.seqEdit.empty")}
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
        {t("stack.seqEdit.addLayer")}
      </button>
    </fieldset>
  );
}
