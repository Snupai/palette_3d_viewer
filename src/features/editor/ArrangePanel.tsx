"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
} from "~/domain/project/projectSchema";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import { labelSideOptions } from "~/features/editor/editorLabels";
import type { ProjectEditorCommand } from "~/features/editor/editorModel";

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
          <h3 id="ed-selection-title">Auswahl</h3>
          <small>
            {selected.length} / {pattern.placements.length} Pakete
          </small>
        </div>
        {selected.length === 0 ? (
          <p className="ed-panel-note">
            Paket anklicken. Strg/Cmd-Klick wählt mehrere, Shift-Ziehen auf
            freier Fläche zieht einen Rahmen. Ein Klick auf ein Paket wählt
            immer den ganzen Griff.
          </p>
        ) : (
          <>
            <div className="ed-grid2">
              <label className="ed-field">
                X (mm)
                <input
                  aria-label="Position X"
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
                  aria-label="Position Y"
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
            {!selectedOne ? (
              <p className="ed-panel-note">
                Koordinaten lassen sich nur für ein einzelnes Paket eintragen.
                Verschieben, Drehen, Zentrieren und Etikett gelten für die ganze
                Auswahl.
              </p>
            ) : null}
            <label className="ed-field">
              Etikettseite
              <select
                aria-label="Etikettseite"
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
                  <option value="mixed">Gemischt</option>
                ) : null}
                {labelSideOptions.map(([value, label]) => (
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
                      <th>Paket</th>
                      <th>X</th>
                      <th>Y</th>
                      <th>Drehung</th>
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
        <summary>Muster und Schrittweite</summary>
        <div>
          <label className="ed-field">
            Name des Musters
            <input
              aria-label="Name des Musters"
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
              Feiner Schritt (mm)
              <input
                aria-label="Feiner Schritt"
                type="number"
                min="0.01"
                step="any"
                value={fineStepDraft}
                onChange={(event) => onFineStepChange(event.target.value)}
                className="ui-input"
              />
            </label>
            <label className="ed-field">
              Grober Schritt (mm)
              <input
                aria-label="Grober Schritt"
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
            <dt>Pfeile</dt>
            <dd>Auswahl um den feinen Schritt verschieben, mit Shift grob</dd>
            <dt>R</dt>
            <dd>Auswahl um 90° drehen</dd>
            <dt>C</dt>
            <dd>Auswahl auf der Palette zentrieren</dd>
            <dt>L / T</dt>
            <dd>Paket längs oder quer einfügen</dd>
            <dt>Entf</dt>
            <dd>Auswahl löschen</dd>
            <dt>Strg+Z / Y</dt>
            <dd>Rückgängig, Wiederholen</dd>
          </dl>
        </div>
      </details>
    </>
  );
}
