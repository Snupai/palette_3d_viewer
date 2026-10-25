"use client";

import { useEffect, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
} from "~/domain/project/projectSchema";
import { countLabel, gripLabel } from "~/features/editor/editorLabels";
import type {
  ProjectEditorCommand,
  ProjectEditorOrderModel,
} from "~/features/editor/editorModel";

export type OrderPanelProps = {
  solution: PlanningSolution;
  pattern: LayerPattern;
  orderModel: ProjectEditorOrderModel;
  selectedPlacementIds: ReadonlySet<string>;
  onSelectionChange: (placementIds: ReadonlySet<string>) => void;
  execute: (command: ProjectEditorCommand) => void;
};

/** Side panel of the "Greifreihenfolge" view: ordered grips and dependencies. */
export function OrderPanel({
  solution,
  pattern,
  orderModel,
  selectedPlacementIds,
  onSelectionChange,
  execute,
}: OrderPanelProps) {
  const groups = orderModel.groups;
  const [beforeGripId, setBeforeGripId] = useState("");
  const [afterGripId, setAfterGripId] = useState("");
  useEffect(() => {
    const first = groups[0]?.id ?? "";
    const second = groups[1]?.id ?? first;
    setBeforeGripId((current) =>
      groups.some(({ id }) => id === current) ? current : first,
    );
    setAfterGripId((current) =>
      groups.some(({ id }) => id === current) ? current : second,
    );
  }, [groups]);
  const commandBase = {
    mode: "order" as const,
    solutionId: solution.id,
    patternId: pattern.id,
  };
  const isSelected = (placementIds: readonly string[]) =>
    placementIds.length > 0 &&
    placementIds.every((id) => selectedPlacementIds.has(id));

  return (
    <>
      <section className="ed-panel" aria-labelledby="ed-grips-title">
        <div className="ed-panel-head">
          <h3 id="ed-grips-title">Griffe in Reihenfolge</h3>
          <small>{countLabel(groups.length, "Griff", "Griffe")}</small>
        </div>
        {groups.length === 0 ? (
          <p className="ed-panel-note">
            Dieses Muster hat noch keine Griffe. Pakete auf der Palette
            auswählen und „Griff aus Auswahl bilden“ wählen, oder „Automatisch
            ordnen“ für einen Vorschlag.
          </p>
        ) : (
          <ol className="ed-grips">
            {groups.map((group, index) => {
              const label = `G${index + 1}`;
              const selected = isSelected(group.placementIds);
              return (
                <li
                  key={group.id}
                  className="ed-grip"
                  data-editor-group-id={group.id}
                  data-selected={selected ? "true" : undefined}
                >
                  <button
                    type="button"
                    className="ed-grip-pick"
                    aria-pressed={selected}
                    aria-label={`Griff ${label} auswählen`}
                    onClick={() =>
                      onSelectionChange(
                        selected ? new Set() : new Set(group.placementIds),
                      )
                    }
                  >
                    <span className="ed-grip-n" aria-hidden="true">
                      {label}
                    </span>
                    <span className="ed-grip-text">
                      <span>
                        {countLabel(
                          group.placementIds.length,
                          "Paket",
                          "Pakete",
                        )}
                      </span>
                      <small>
                        Mitte {Number(group.centerMm.x.toFixed(1))} /{" "}
                        {Number(group.centerMm.y.toFixed(1))} mm
                        {group.persisted ? "" : " · neu"}
                      </small>
                    </span>
                  </button>
                  <span className="ed-grip-tools">
                    <button
                      type="button"
                      className="ui-btn"
                      aria-label={`Griff ${label} nach vorn`}
                      title="Früher greifen"
                      disabled={index === 0}
                      onClick={() =>
                        execute({
                          type: "reorder-group",
                          ...commandBase,
                          gripId: group.id,
                          toIndex: index - 1,
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      aria-label={`Griff ${label} nach hinten`}
                      title="Später greifen"
                      disabled={index === groups.length - 1}
                      onClick={() =>
                        execute({
                          type: "reorder-group",
                          ...commandBase,
                          gripId: group.id,
                          toIndex: index + 1,
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      aria-label={`Griff ${label} teilen`}
                      disabled={group.placementIds.length <= 1}
                      onClick={() =>
                        execute({
                          type: "split-group",
                          ...commandBase,
                          gripId: group.id,
                        })
                      }
                    >
                      Teilen
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      data-danger="true"
                      aria-label={`Griff ${label} auflösen`}
                      onClick={() =>
                        execute({
                          type: "remove-group",
                          ...commandBase,
                          gripId: group.id,
                        })
                      }
                    >
                      Auflösen
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {orderModel.unassignedPlacementIds.length > 0 ? (
          <p className="ed-panel-note">
            Ohne Griff:{" "}
            {orderModel.unassignedPlacementIds
              .map((id) => {
                const placement = pattern.placements.find((p) => p.id === id);
                return placement ? `#${placement.sequence + 1}` : id;
              })
              .join(", ")}
            . Diese Pakete werden nicht exportiert.
          </p>
        ) : null}
      </section>

      <details className="ed-panel-details">
        <summary>
          Abhängigkeiten <small>{orderModel.dependencies.length}</small>
        </summary>
        <div>
          <div className="ed-dep-form">
            <label className="ed-field">
              Zuerst
              <select
                aria-label="Abhängigkeit: zuerst"
                value={beforeGripId}
                onChange={(event) => setBeforeGripId(event.target.value)}
                className="ui-input"
                disabled={groups.length === 0}
              >
                {groups.map((group, index) => (
                  <option key={group.id} value={group.id}>
                    G{index + 1}
                  </option>
                ))}
              </select>
            </label>
            <span aria-hidden="true">vor</span>
            <label className="ed-field">
              Danach
              <select
                aria-label="Abhängigkeit: danach"
                value={afterGripId}
                onChange={(event) => setAfterGripId(event.target.value)}
                className="ui-input"
                disabled={groups.length === 0}
              >
                {groups.map((group, index) => (
                  <option key={group.id} value={group.id}>
                    G{index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ui-btn ui-btn-sm"
              disabled={
                !beforeGripId || !afterGripId || beforeGripId === afterGripId
              }
              onClick={() =>
                execute({
                  type: "add-order-dependency",
                  ...commandBase,
                  beforeGripId,
                  afterGripId,
                })
              }
            >
              Hinzufügen
            </button>
          </div>
          {orderModel.dependencies.length === 0 ? (
            <p className="ed-panel-note">Keine Abhängigkeiten.</p>
          ) : (
            <ul className="ed-deps">
              {orderModel.dependencies.map((dependency) => {
                const before = gripLabel(groups, dependency.beforeGripId);
                const after = gripLabel(groups, dependency.afterGripId);
                return (
                  <li
                    key={`${dependency.beforeGripId}:${dependency.afterGripId}`}
                    className="ed-dep"
                  >
                    <span className="ed-dep-text">
                      {before} vor {after}
                    </span>
                    {dependency.source === "inferred" ? (
                      <small>aus der Geometrie abgeleitet</small>
                    ) : (
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm"
                        aria-label={`Abhängigkeit ${before} vor ${after} entfernen`}
                        onClick={() =>
                          execute({
                            type: "remove-order-dependency",
                            ...commandBase,
                            beforeGripId: dependency.beforeGripId,
                            afterGripId: dependency.afterGripId,
                          })
                        }
                      >
                        Entfernen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </>
  );
}
