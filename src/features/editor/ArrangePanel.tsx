"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
} from "~/domain/project/projectSchema";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import { labelSideOptions } from "~/features/editor/editorLabels";
import type { ProjectEditorCommand } from "~/features/editor/editorModel";
import { useT } from "~/i18n";

export type ArrangePanelProps = {
  solution: PlanningSolution;
  pattern: LayerPattern;
  /** Selection including every package of a selected grip. */
  selectedPlacementIds: ReadonlySet<string>;
  fineStepDraft: string;
  coarseStepDraft: string;
  onFineStepChange: (value: string) => void;
  onCoarseStepChange: (value: string) => void;
  execute: (command: ProjectEditorCommand) => void;
};

/** Side panel of the "Anordnung" view: selection details and pattern settings. */
export function ArrangePanel({
  solution,
  pattern,
  selectedPlacementIds,
  fineStepDraft,
  coarseStepDraft,
  onFineStepChange,
  onCoarseStepChange,
  execute,
}: ArrangePanelProps) {
  const t = useT();
  const selected = pattern.placements.filter(({ id }) =>
    selectedPlacementIds.has(id),
  );
  const selectedOne = selected.length === 1 ? selected[0]! : null;
  const [xDraft, setXDraft] = useState("");
  const [yDraft, setYDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(pattern.name);
  useEffect(() => {
    setXDraft(selectedOne ? String(selectedOne.positionMm.x) : "");
    setYDraft(selectedOne ? String(selectedOne.positionMm.y) : "");
  }, [selectedOne]);
  useEffect(() => setNameDraft(pattern.name), [pattern.id, pattern.name]);

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
  const commitPosition = (axis: "x" | "y", raw: string) => {
    if (!selectedOne) return;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) {
      (axis === "x" ? setXDraft : setYDraft)(
        String(selectedOne.positionMm[axis]),
      );
      return;
    }
    if (value === selectedOne.positionMm[axis]) return;
    execute({
      type: "set-placement-position",
      ...commandBase,
      placementId: selectedOne.id,
      positionMm: { ...selectedOne.positionMm, [axis]: value },
    });
  };

  return (
    <>
      <section className="ed-panel" aria-labelledby="ed-selection-title">
        <div className="ed-panel-head">
          <h3 id="ed-selection-title">{t("editor.arrange.selection")}</h3>
          <small>
            {t("editor.arrange.selectionCount", {
              selected: selected.length,
              total: pattern.placements.length,
            })}
          </small>
        </div>
        {selected.length === 0 ? (
          <p className="ed-panel-note">{t("editor.arrange.emptyNote")}</p>
        ) : (
          <>
            <div className="ed-grid2">
              <label className="ed-field">
                X (mm)
                <input
                  aria-label={t("editor.arrange.positionX")}
                  type="number"
                  step="any"
                  disabled={!selectedOne}
                  value={xDraft}
                  onChange={(event) => setXDraft(event.target.value)}
                  onBlur={() => commitPosition("x", xDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape" && selectedOne)
                      setXDraft(String(selectedOne.positionMm.x));
                  }}
                  className="ui-input"
                />
              </label>
              <label className="ed-field">
                Y (mm)
                <input
                  aria-label={t("editor.arrange.positionY")}
                  type="number"
                  step="any"
                  disabled={!selectedOne}
                  value={yDraft}
                  onChange={(event) => setYDraft(event.target.value)}
                  onBlur={() => commitPosition("y", yDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape" && selectedOne)
                      setYDraft(String(selectedOne.positionMm.y));
                  }}
                  className="ui-input"
                />
              </label>
            </div>
            <label className="ed-field">
              {t("editor.arrange.labelSide")}
              <select
                aria-label={t("editor.arrange.labelSide")}
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
                className="ui-input"
              >
                {sharedLabel === "mixed" ? (
                  <option value="mixed">{t("editor.arrange.mixed")}</option>
                ) : null}
                {labelSideOptions(t).map(([value, label]) => (
                  <option key={value || "none"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {selected.length > 1 ? (
              <div className="ed-table-scroll">
                <table className="ed-table">
                  <thead>
                    <tr>
                      <th>{t("editor.arrange.colPackage")}</th>
                      <th>X</th>
                      <th>Y</th>
                      <th>{t("editor.arrange.colRotation")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.map((placement) => (
                      <tr key={placement.id}>
                        <td className="num">#{placement.sequence + 1}</td>
                        <td className="num">{placement.positionMm.x}</td>
                        <td className="num">{placement.positionMm.y}</td>
                        <td className="num">{placement.rotation}°</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>

      <details className="ed-panel-details">
        <summary>{t("editor.arrange.patternSettings")}</summary>
        <div>
          <label className="ed-field">
            {t("editor.arrange.patternName")}
            <input
              aria-label={t("editor.arrange.patternName")}
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
              className="ui-input"
            />
          </label>
          <div className="ed-grid2">
            <label className="ed-field">
              {t("editor.arrange.fineStep")}
              <input
                aria-label={t("editor.arrange.fineStepAria")}
                type="number"
                min="0.01"
                step="any"
                value={fineStepDraft}
                onChange={(event) => onFineStepChange(event.target.value)}
                className="ui-input"
              />
            </label>
            <label className="ed-field">
              {t("editor.arrange.coarseStep")}
              <input
                aria-label={t("editor.arrange.coarseStepAria")}
                type="number"
                min="0.01"
                step="any"
                value={coarseStepDraft}
                onChange={(event) => onCoarseStepChange(event.target.value)}
                className="ui-input"
              />
            </label>
          </div>
          <dl className="ed-shortcuts">
            <dt>{t("editor.arrange.keyArrows")}</dt>
            <dd>{t("editor.arrange.keyArrowsDesc")}</dd>
            <dt>R</dt>
            <dd>{t("editor.arrange.keyRotateDesc")}</dd>
            <dt>C</dt>
            <dd>{t("editor.arrange.keyCenterDesc")}</dd>
            <dt>L / T</dt>
            <dd>{t("editor.arrange.keyInsertDesc")}</dd>
            <dt>{t("editor.arrange.keyDelete")}</dt>
            <dd>{t("editor.arrange.keyDeleteDesc")}</dd>
            <dt>{t("editor.arrange.keyUndo")}</dt>
            <dd>{t("editor.arrange.keyUndoDesc")}</dd>
          </dl>
        </div>
      </details>
    </>
  );
}
