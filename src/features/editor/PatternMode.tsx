"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import { PatternCanvas } from "~/features/editor/PatternCanvas";
import type {
  ProjectEditorCommand,
  ProjectEditorDiagnostic,
  ProjectEditorOrderModel,
} from "~/features/editor/editorModel";

const inputClass =
  "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20";
const buttonClass =
  "rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400/35 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

const labelSides: ReadonlyArray<readonly [CandidateLabelSide | "", string]> = [
  ["", "No label side"],
  ["top", "Top"],
  ["right", "Right"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["top_right", "Top right"],
  ["bottom_right", "Bottom right"],
  ["bottom_left", "Bottom left"],
  ["top_left", "Top left"],
];

export type PatternModeProps = {
  project: Project;
  solution: PlanningSolution;
  pattern: LayerPattern;
  orderModel: ProjectEditorOrderModel;
  diagnostics: readonly ProjectEditorDiagnostic[];
  selectedPlacementIds: ReadonlySet<string>;
  onSelectionChange: (placementIds: ReadonlySet<string>) => void;
  execute: (command: ProjectEditorCommand) => void;
  createPlacementId: () => string;
};

function positiveStep(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function PatternMode({
  project,
  solution,
  pattern,
  orderModel,
  diagnostics,
  selectedPlacementIds,
  onSelectionChange,
  execute,
  createPlacementId,
}: PatternModeProps) {
  const selected = pattern.placements.filter(({ id }) =>
    selectedPlacementIds.has(id),
  );
  const selectedOne = selected.length === 1 ? selected[0]! : null;
  const [xDraft, setXDraft] = useState("");
  const [yDraft, setYDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(pattern.name);
  const [fineStepDraft, setFineStepDraft] = useState("1");
  const [coarseStepDraft, setCoarseStepDraft] = useState("10");

  useEffect(() => {
    setXDraft(selectedOne ? String(selectedOne.positionMm.x) : "");
    setYDraft(selectedOne ? String(selectedOne.positionMm.y) : "");
  }, [selectedOne]);
  useEffect(() => setNameDraft(pattern.name), [pattern.id, pattern.name]);

  const fineStepMm = positiveStep(fineStepDraft, 1);
  const coarseStepMm = positiveStep(coarseStepDraft, 10);
  const sharedLabel = useMemo(() => {
    if (selected.length === 0) return "";
    const first = selected[0]!.labelSide;
    return selected.every(({ labelSide }) => labelSide === first)
      ? (first ?? "")
      : "mixed";
  }, [selected]);
  const commandBase = {
    mode: "pattern" as const,
    solutionId: solution.id,
    patternId: pattern.id,
  };
  const move = (deltaMm: { x: number; y: number }) => {
    if (selectedPlacementIds.size === 0) return;
    execute({
      type: "move-placements",
      ...commandBase,
      placementIds: [...selectedPlacementIds],
      deltaMm,
    });
  };
  const remove = () => {
    if (selectedPlacementIds.size === 0) return;
    execute({
      type: "delete-placements",
      ...commandBase,
      placementIds: [...selectedPlacementIds],
    });
    onSelectionChange(new Set());
  };
  const rotate = () => {
    if (selectedPlacementIds.size === 0) return;
    execute({
      type: "rotate-placements",
      ...commandBase,
      placementIds: [...selectedPlacementIds],
    });
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(560px,1fr)_300px]">
      <section className="border border-zinc-800 bg-zinc-900">
        <div
          className="flex flex-wrap items-center gap-2 border-b border-zinc-800 p-2"
          role="toolbar"
          aria-label="Pattern editing actions"
        >
          <button
            type="button"
            onClick={() => {
              const placementId = createPlacementId();
              execute({
                type: "insert-placement",
                ...commandBase,
                placementId,
                orientation: "longitudinal",
              });
              onSelectionChange(new Set([placementId]));
            }}
            className={buttonClass}
          >
            Insert longitudinal
          </button>
          <button
            type="button"
            onClick={() => {
              const placementId = createPlacementId();
              execute({
                type: "insert-placement",
                ...commandBase,
                placementId,
                orientation: "transverse",
              });
              onSelectionChange(new Set([placementId]));
            }}
            className={buttonClass}
          >
            Insert transverse
          </button>
          <span className="mx-1 h-5 w-px bg-zinc-800" aria-hidden="true" />
          <button
            type="button"
            disabled={selectedPlacementIds.size === 0}
            onClick={rotate}
            className={buttonClass}
          >
            Rotate 90°
          </button>
          <button
            type="button"
            disabled={selectedPlacementIds.size === 0}
            onClick={() =>
              execute({
                type: "center-placements",
                ...commandBase,
                placementIds: [...selectedPlacementIds],
              })
            }
            className={buttonClass}
          >
            Center selection
          </button>
          <button
            type="button"
            disabled={selectedPlacementIds.size === 0}
            onClick={remove}
            className={`${buttonClass} text-red-300`}
          >
            Delete
          </button>
          <span className="ml-auto text-[11px] text-zinc-500">
            {selectedPlacementIds.size} selected
          </span>
        </div>
        <PatternCanvas
          project={project}
          pattern={pattern}
          groups={orderModel.groups}
          selectedPlacementIds={selectedPlacementIds}
          fineStepMm={fineStepMm}
          coarseStepMm={coarseStepMm}
          onSelectionChange={onSelectionChange}
          onMoveSelection={move}
          onNudgeSelection={move}
          onDeleteSelection={remove}
          onRotateSelection={rotate}
        />
      </section>

      <aside className="grid content-start gap-3">
        <section className="border border-zinc-800 bg-zinc-900 p-3">
          <h3 className="text-sm font-semibold text-zinc-100">Pattern</h3>
          <label className="mt-3 grid gap-1 text-xs text-zinc-500">
            Pattern name
            <input
              aria-label="Pattern name"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => {
                if (nameDraft.trim() === pattern.name) return;
                execute({
                  type: "set-pattern-name",
                  ...commandBase,
                  name: nameDraft,
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setNameDraft(pattern.name);
              }}
              className={inputClass}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-zinc-500">
              Fine nudge (mm)
              <input
                aria-label="Fine nudge step"
                type="number"
                min="0.01"
                step="any"
                value={fineStepDraft}
                onChange={(event) => setFineStepDraft(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-xs text-zinc-500">
              Coarse nudge (mm)
              <input
                aria-label="Coarse nudge step"
                type="number"
                min="0.01"
                step="any"
                value={coarseStepDraft}
                onChange={(event) => setCoarseStepDraft(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-zinc-600">
            Arrow keys use the fine step. Hold Shift for the coarse step.
          </p>
        </section>

        <section className="border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-zinc-100">Selection</h3>
            <span className="font-mono text-[11px] text-zinc-500">
              {selected.length}/{pattern.placements.length}
            </span>
          </div>
          {selected.length === 0 ? (
            <p className="mt-3 text-xs leading-5 text-zinc-600">
              Click a package, use Ctrl/Command click for multiple packages, or
              Shift-drag empty space for a marquee.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-zinc-500">
                  X (mm)
                  <input
                    aria-label="Selected package X"
                    type="number"
                    step="any"
                    disabled={!selectedOne}
                    value={xDraft}
                    onChange={(event) => setXDraft(event.target.value)}
                    onBlur={() => {
                      if (!selectedOne) return;
                      const x = Number(xDraft);
                      if (!Number.isFinite(x)) {
                        setXDraft(String(selectedOne.positionMm.x));
                        return;
                      }
                      execute({
                        type: "set-placement-position",
                        ...commandBase,
                        placementId: selectedOne.id,
                        positionMm: { x, y: selectedOne.positionMm.y },
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape" && selectedOne) {
                        setXDraft(String(selectedOne.positionMm.x));
                      }
                    }}
                    className={`${inputClass} disabled:text-zinc-600`}
                  />
                </label>
                <label className="grid gap-1 text-xs text-zinc-500">
                  Y (mm)
                  <input
                    aria-label="Selected package Y"
                    type="number"
                    step="any"
                    disabled={!selectedOne}
                    value={yDraft}
                    onChange={(event) => setYDraft(event.target.value)}
                    onBlur={() => {
                      if (!selectedOne) return;
                      const y = Number(yDraft);
                      if (!Number.isFinite(y)) {
                        setYDraft(String(selectedOne.positionMm.y));
                        return;
                      }
                      execute({
                        type: "set-placement-position",
                        ...commandBase,
                        placementId: selectedOne.id,
                        positionMm: { x: selectedOne.positionMm.x, y },
                      });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape" && selectedOne) {
                        setYDraft(String(selectedOne.positionMm.y));
                      }
                    }}
                    className={`${inputClass} disabled:text-zinc-600`}
                  />
                </label>
              </div>
              {!selectedOne ? (
                <p className="text-[11px] text-zinc-600">
                  Numeric coordinates are available when exactly one package is
                  selected. Movement, centering, rotation, and labels apply to
                  the full selection.
                </p>
              ) : null}
              <label className="grid gap-1 text-xs text-zinc-500">
                Label side
                <select
                  aria-label="Selected package label side"
                  value={sharedLabel}
                  onChange={(event) => {
                    if (event.target.value === "mixed") return;
                    execute({
                      type: "set-label-side",
                      ...commandBase,
                      placementIds: [...selectedPlacementIds],
                      labelSide:
                        event.target.value === ""
                          ? null
                          : (event.target.value as CandidateLabelSide),
                    });
                  }}
                  className={inputClass}
                >
                  {sharedLabel === "mixed" ? (
                    <option value="mixed">Mixed label sides</option>
                  ) : null}
                  {labelSides.map(([value, label]) => (
                    <option key={value || "none"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="scrollbar-thin max-h-36 overflow-auto border border-zinc-800">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-zinc-950 text-zinc-500">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Package</th>
                      <th className="px-2 py-1.5 font-medium">X</th>
                      <th className="px-2 py-1.5 font-medium">Y</th>
                      <th className="px-2 py-1.5 font-medium">Yaw</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((placement) => (
                      <tr
                        key={placement.id}
                        className="border-t border-zinc-800"
                      >
                        <td className="px-2 py-1.5 font-mono">
                          #{placement.sequence + 1}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {placement.positionMm.x}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {placement.positionMm.y}
                        </td>
                        <td className="px-2 py-1.5 font-mono">
                          {placement.rotation}°
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="border border-zinc-800 bg-zinc-900 p-3">
          <h3 className="text-sm font-semibold text-zinc-100">Interlayers</h3>
          <label className="mt-3 grid gap-1 text-xs text-zinc-500">
            Shared thickness (mm)
            <input
              aria-label="Editor interlayer thickness"
              type="number"
              min="0.01"
              step="any"
              value={solution.stack.interlayerThicknessMm}
              onChange={(event) => {
                const thicknessMm = Number(event.target.value);
                if (!Number.isFinite(thicknessMm)) return;
                execute({
                  type: "set-interlayer-thickness",
                  mode: "pattern",
                  solutionId: solution.id,
                  thicknessMm,
                });
              }}
              className={inputClass}
            />
          </label>
          <div className="mt-3 grid gap-2">
            <div className="grid grid-cols-[1fr_64px_84px] gap-2 text-[10px] text-zinc-600">
              <span>Boundary</span>
              <span>Count</span>
              <span>Thickness</span>
            </div>
            {solution.stack.layers.map((layer, index) => (
              <div
                key={layer.id}
                className="grid grid-cols-[1fr_64px_84px] items-center gap-2 text-xs text-zinc-500"
              >
                <span>Before layer {index + 1}</span>
                <input
                  aria-label={`Interlayer before stack layer ${index + 1}`}
                  type="number"
                  min="0"
                  step="1"
                  value={layer.interlayerBefore}
                  onChange={(event) => {
                    const quantity = Number(event.target.value);
                    if (!Number.isFinite(quantity)) return;
                    execute({
                      type: "set-interlayer-before",
                      mode: "pattern",
                      solutionId: solution.id,
                      layerId: layer.id,
                      quantity,
                    });
                  }}
                  className={inputClass}
                />
                <input
                  aria-label={`Interlayer thickness before stack layer ${index + 1}`}
                  type="number"
                  min="0.01"
                  step="any"
                  value={
                    layer.interlayerThicknessMm ??
                    solution.stack.interlayerThicknessMm
                  }
                  onChange={(event) => {
                    const thicknessMm = Number(event.target.value);
                    if (!Number.isFinite(thicknessMm)) return;
                    execute({
                      type: "set-interlayer-before-thickness",
                      mode: "pattern",
                      solutionId: solution.id,
                      layerId: layer.id,
                      thicknessMm,
                    });
                  }}
                  className={inputClass}
                />
              </div>
            ))}
            <div className="grid grid-cols-[1fr_64px_84px] items-center gap-2 text-xs text-zinc-500">
              <span>Deck sheets</span>
              <input
                aria-label="Trailing interlayer quantity"
                type="number"
                min="0"
                step="1"
                value={solution.stack.trailingInterlayer}
                onChange={(event) => {
                  const quantity = Number(event.target.value);
                  if (!Number.isFinite(quantity)) return;
                  execute({
                    type: "set-trailing-interlayer",
                    mode: "pattern",
                    solutionId: solution.id,
                    quantity,
                  });
                }}
                className={inputClass}
              />
              <input
                aria-label="Trailing interlayer thickness"
                type="number"
                min="0.01"
                step="any"
                value={
                  solution.stack.trailingInterlayerThicknessMm ??
                  solution.stack.interlayerThicknessMm
                }
                onChange={(event) => {
                  const thicknessMm = Number(event.target.value);
                  if (!Number.isFinite(thicknessMm)) return;
                  execute({
                    type: "set-trailing-interlayer-thickness",
                    mode: "pattern",
                    solutionId: solution.id,
                    thicknessMm,
                  });
                }}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        <section className="border border-zinc-800 bg-zinc-900 p-3">
          <h3 className="text-sm font-semibold text-zinc-100">
            Validation ({diagnostics.length})
          </h3>
          {diagnostics.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-600">
              No pattern, grouping, or order diagnostics.
            </p>
          ) : (
            <ul className="scrollbar-thin mt-2 max-h-48 space-y-2 overflow-auto pr-1">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.message}-${index}`}
                  className={
                    diagnostic.severity === "error"
                      ? "text-xs leading-5 text-red-200"
                      : "text-xs leading-5 text-amber-200"
                  }
                >
                  <span className="font-mono text-[10px] text-zinc-500">
                    {diagnostic.code}
                  </span>
                  <br />
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
