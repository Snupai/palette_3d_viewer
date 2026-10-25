"use client";

import { useEffect, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
} from "~/domain/project/projectSchema";
import { gripLabel } from "~/features/editor/editorLabels";
import type {
  ProjectEditorCommand,
  ProjectEditorOrderModel,
} from "~/features/editor/editorModel";
import { useT } from "~/i18n";

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
  const t = useT();
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
          <h3 id="ed-grips-title">{t("editor.order.title")}</h3>
          <small>{t("editor.gripCount", { count: groups.length })}</small>
        </div>
        {groups.length === 0 ? (
          <p className="ed-panel-note">{t("editor.order.empty")}</p>
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
                    aria-label={t("editor.order.select", { label })}
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
                        {t("editor.packageCount", {
                          count: group.placementIds.length,
                        })}
                      </span>
                      <small>
                        {t("editor.order.center", {
                          x: Number(group.centerMm.x.toFixed(1)),
                          y: Number(group.centerMm.y.toFixed(1)),
                        })}
                        {group.persisted ? "" : t("editor.order.new")}
                      </small>
                    </span>
                  </button>
                  <span className="ed-grip-tools">
                    <button
                      type="button"
                      className="ui-btn"
                      aria-label={t("editor.order.earlier", { label })}
                      title={t("editor.order.earlierTitle")}
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
                      aria-label={t("editor.order.later", { label })}
                      title={t("editor.order.laterTitle")}
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
                      aria-label={t("editor.order.splitAria", { label })}
                      disabled={group.placementIds.length <= 1}
                      onClick={() =>
                        execute({
                          type: "split-group",
                          ...commandBase,
                          gripId: group.id,
                        })
                      }
                    >
                      {t("editor.order.split")}
                    </button>
                    <button
                      type="button"
                      className="ui-btn"
                      data-danger="true"
                      aria-label={t("editor.order.dissolveAria", { label })}
                      onClick={() =>
                        execute({
                          type: "remove-group",
                          ...commandBase,
                          gripId: group.id,
                        })
                      }
                    >
                      {t("editor.order.dissolve")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {orderModel.unassignedPlacementIds.length > 0 ? (
          <p className="ed-panel-note">
            {t("editor.order.unassigned", {
              packages: orderModel.unassignedPlacementIds
                .map((id) => {
                  const placement = pattern.placements.find((p) => p.id === id);
                  return placement ? `#${placement.sequence + 1}` : id;
                })
                .join(", "),
            })}
          </p>
        ) : null}
      </section>

      <details className="ed-panel-details">
        <summary>
          {t("editor.order.dependencies")}{" "}
          <small>{orderModel.dependencies.length}</small>
        </summary>
        <div>
          <div className="ed-dep-form">
            <label className="ed-field">
              {t("editor.order.first")}
              <select
                aria-label={t("editor.order.firstAria")}
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
            <span aria-hidden="true">{t("editor.order.before")}</span>
            <label className="ed-field">
              {t("editor.order.then")}
              <select
                aria-label={t("editor.order.thenAria")}
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
              {t("editor.order.add")}
            </button>
          </div>
          {orderModel.dependencies.length === 0 ? (
            <p className="ed-panel-note">{t("editor.order.noDependencies")}</p>
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
                      {t("editor.order.beforeAfter", { before, after })}
                    </span>
                    {dependency.source === "inferred" ? (
                      <small>{t("editor.order.inferred")}</small>
                    ) : (
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm"
                        aria-label={t("editor.order.removeAria", {
                          before,
                          after,
                        })}
                        onClick={() =>
                          execute({
                            type: "remove-order-dependency",
                            ...commandBase,
                            beforeGripId: dependency.beforeGripId,
                            afterGripId: dependency.afterGripId,
                          })
                        }
                      >
                        {t("editor.order.remove")}
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
