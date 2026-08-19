"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import { SequenceCanvas } from "~/features/editor/SequenceCanvas";
import {
  projectEditorEnvelope,
  suggestProjectEditorOrder,
  type ProjectEditorCommand,
  type ProjectEditorDiagnostic,
  type ProjectEditorOrderModel,
} from "~/features/editor/editorModel";

const inputClass = "ui-input";
const buttonClass = "ui-btn h-7 px-2.5 text-[12px]";

export type OrderModeProps = {
  project: Project;
  solution: PlanningSolution;
  pattern: LayerPattern;
  orderModel: ProjectEditorOrderModel;
  diagnostics: readonly ProjectEditorDiagnostic[];
  selectedPlacementIds: ReadonlySet<string>;
  selectedGroupIds: ReadonlySet<string>;
  onGroupSelectionChange: (gripIds: ReadonlySet<string>) => void;
  execute: (command: ProjectEditorCommand) => void;
};

export function OrderMode({
  project,
  solution,
  pattern,
  orderModel,
  diagnostics,
  selectedPlacementIds,
  selectedGroupIds,
  onGroupSelectionChange,
  execute,
}: OrderModeProps) {
  const [beforeGripId, setBeforeGripId] = useState("");
  const [afterGripId, setAfterGripId] = useState("");
  const groups = orderModel.groups;
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

  const gripNumberById = useMemo(
    () => new Map(groups.map(({ id }, index) => [id, index + 1])),
    [groups],
  );
  const groupByPlacement = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.placementIds.map(
            (placementId) => [placementId, group] as const,
          ),
        ),
      ),
    [groups],
  );
  const envelope = projectEditorEnvelope(project) ?? {
    minX: 0,
    minY: 0,
    maxX: project.pallet?.dimensionsMm.length ?? 1_200,
    maxY: project.pallet?.dimensionsMm.width ?? 800,
  };
  const sequencePlacements = pattern.placements.map((placement) => {
    const group = groupByPlacement.get(placement.id);
    return {
      id: placement.id,
      positionMm: placement.positionMm,
      rotation: placement.rotation,
      label: group ? String(group.orderIndex + 1) : "—",
      detail: group
        ? `Package ${placement.sequence + 1}; grip G${group.orderIndex + 1}`
        : `Package ${placement.sequence + 1}; ungrouped`,
    };
  });
  const commandBase = {
    mode: "order" as const,
    solutionId: solution.id,
    patternId: pattern.id,
  };
  const toggleGroup = (gripId: string) => {
    const next = new Set(selectedGroupIds);
    if (next.has(gripId)) next.delete(gripId);
    else next.add(gripId);
    onGroupSelectionChange(next);
  };

  return (
    <div className="grid gap-3 2xl:grid-cols-[minmax(680px,1.15fr)_minmax(420px,0.85fr)]">
      <section className="border border-[var(--line)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-2">
          <button
            type="button"
            disabled={selectedPlacementIds.size === 0}
            onClick={() =>
              execute({
                type: "create-group",
                ...commandBase,
                placementIds: [...selectedPlacementIds],
              })
            }
            className={buttonClass}
          >
            Add group from package selection ({selectedPlacementIds.size})
          </button>
          <button
            type="button"
            disabled={selectedGroupIds.size < 2}
            onClick={() => {
              execute({
                type: "merge-groups",
                ...commandBase,
                gripIds: [...selectedGroupIds],
              });
              onGroupSelectionChange(new Set());
            }}
            className={buttonClass}
          >
            Merge selected groups ({selectedGroupIds.size})
          </button>
          <button
            type="button"
            disabled={groups.length === 0}
            onClick={() => {
              const suggestion = suggestProjectEditorOrder(
                project,
                solution.id,
                pattern.id,
              );
              execute({
                type: "apply-suggested-order",
                ...commandBase,
                gripIds: suggestion.order,
              });
            }}
            className="ui-btn-primary h-7 px-2.5 text-[12px]"
          >
            Apply automatic order
          </button>
        </div>

        <div className="scrollbar-thin overflow-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-xs">
            <thead className="bg-[var(--canvas)] text-[var(--muted)]">
              <tr>
                <th className="border-b border-[var(--line)] px-2 py-2 font-medium">
                  Select
                </th>
                <th className="border-b border-[var(--line)] px-2 py-2 font-medium">
                  Grip / Order
                </th>
                <th className="border-b border-[var(--line)] px-2 py-2 font-medium">
                  Packages
                </th>
                <th className="border-b border-[var(--line)] px-2 py-2 font-medium">
                  Center X/Y
                </th>
                <th className="border-b border-[var(--line)] px-2 py-2 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => (
                <tr
                  key={group.id}
                  data-editor-group-id={group.id}
                  className="border-b border-[var(--line)] text-[var(--ink)]"
                >
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select grip G${index + 1}`}
                      checked={selectedGroupIds.has(group.id)}
                      onChange={() => toggleGroup(group.id)}
                      className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                    />
                  </td>
                  <td className="px-2 py-2 font-mono">G{index + 1}</td>
                  <td className="px-2 py-2">
                    <span className="font-mono">
                      {group.placementIds.length}
                    </span>
                    <span className="ml-2 text-[10px] text-[var(--muted)]">
                      {group.placementIds.join(", ")}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {Number(group.centerMm.x.toFixed(2))} /{" "}
                    {Number(group.centerMm.y.toFixed(2))}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        aria-label={`Move grip G${index + 1} up`}
                        disabled={index === 0}
                        onClick={() =>
                          execute({
                            type: "reorder-group",
                            ...commandBase,
                            gripId: group.id,
                            toIndex: index - 1,
                          })
                        }
                        className={buttonClass}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        aria-label={`Move grip G${index + 1} down`}
                        disabled={index === groups.length - 1}
                        onClick={() =>
                          execute({
                            type: "reorder-group",
                            ...commandBase,
                            gripId: group.id,
                            toIndex: index + 1,
                          })
                        }
                        className={buttonClass}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        aria-label={`Split grip G${index + 1}`}
                        disabled={group.placementIds.length <= 1}
                        onClick={() =>
                          execute({
                            type: "split-group",
                            ...commandBase,
                            gripId: group.id,
                          })
                        }
                        className={buttonClass}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove grip G${index + 1}`}
                        onClick={() =>
                          execute({
                            type: "remove-group",
                            ...commandBase,
                            gripId: group.id,
                          })
                        }
                        className={`${buttonClass} text-[var(--danger)]`}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {groups.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    This pattern has no package groups.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid content-start gap-3">
        <section className="border border-[var(--line)] bg-[var(--surface)]">
          <header className="border-b border-[var(--line)] px-3 py-2">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              2D execution order
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              G1 is the first executed grip. Reordering rows renumbers all grips
              automatically.
            </p>
          </header>
          <div className="bg-[var(--canvas)] p-3">
            <SequenceCanvas
              ariaLabel={`Execution order for ${pattern.name}`}
              envelope={envelope}
              pallet={
                project.pallet
                  ? {
                      length: project.pallet.dimensionsMm.length,
                      width: project.pallet.dimensionsMm.width,
                    }
                  : null
              }
              packageDimensions={project.package.dimensionsMm}
              placements={sequencePlacements}
            />
          </div>
        </section>

        <section className="border border-[var(--line)] bg-[var(--surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Order dependencies
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-xs text-[var(--muted)]">
              Prerequisite group
              <select
                aria-label="Dependency prerequisite group"
                value={beforeGripId}
                onChange={(event) => setBeforeGripId(event.target.value)}
                className={inputClass}
              >
                {groups.map((group, index) => (
                  <option key={group.id} value={group.id}>
                    Grip G{index + 1}
                  </option>
                ))}
              </select>
            </label>
            <span className="pb-2 text-xs text-[var(--muted)]" aria-hidden="true">
              before
            </span>
            <label className="grid gap-1 text-xs text-[var(--muted)]">
              Dependent group
              <select
                aria-label="Dependency dependent group"
                value={afterGripId}
                onChange={(event) => setAfterGripId(event.target.value)}
                className={inputClass}
              >
                {groups.map((group, index) => (
                  <option key={group.id} value={group.id}>
                    Grip G{index + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
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
              className={buttonClass}
            >
              Add
            </button>
          </div>
          {orderModel.dependencies.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              No explicit or retained legacy dependencies.
            </p>
          ) : (
            <ul className="mt-3 grid gap-1">
              {orderModel.dependencies.map((dependency) => {
                const beforeNumber = gripNumberById.get(
                  dependency.beforeGripId,
                );
                const afterNumber = gripNumberById.get(dependency.afterGripId);
                return (
                  <li
                    key={`${dependency.beforeGripId}:${dependency.afterGripId}`}
                    className="flex items-center gap-2 border-t border-[var(--line)] py-1.5 text-xs text-[var(--muted)]"
                  >
                    <span className="mr-auto font-mono">
                      G{beforeNumber ?? "?"} before G{afterNumber ?? "?"}
                    </span>
                    {dependency.source === "inferred" ? (
                      <span className="text-[11px] text-[var(--muted)]">
                        Inferred from package geometry or legacy dx/dy;
                        immutable.
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove dependency grip G${beforeNumber ?? "unknown"} before grip G${afterNumber ?? "unknown"}`}
                        onClick={() =>
                          execute({
                            type: "remove-order-dependency",
                            ...commandBase,
                            beforeGripId: dependency.beforeGripId,
                            afterGripId: dependency.afterGripId,
                          })
                        }
                        className={`${buttonClass} text-[var(--danger)]`}
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="border border-[var(--line)] bg-[var(--surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Order feedback ({diagnostics.length})
          </h3>
          {orderModel.unassignedPlacementIds.length > 0 ? (
            <p className="mt-2 text-xs leading-5 text-[var(--danger)]">
              Ungrouped packages: {orderModel.unassignedPlacementIds.join(", ")}
            </p>
          ) : null}
          {diagnostics.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              The current order satisfies all known dependencies.
            </p>
          ) : (
            <ul className="scrollbar-thin mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.message}-${index}`}
                  className={
                    diagnostic.severity === "error"
                      ? "text-xs leading-5 text-[var(--danger)]"
                      : "text-xs leading-5 text-[var(--brand)]"
                  }
                >
                  <span className="font-mono text-[10px] text-[var(--muted)]">
                    {diagnostic.code}
                  </span>
                  <br />
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
