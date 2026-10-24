"use client";

import type { PlanningSolution } from "~/domain/project/projectSchema";
import type { ProjectEditorCommand } from "~/features/editor/editorModel";

export type InterlayerPanelProps = {
  solution: PlanningSolution;
  execute: (command: ProjectEditorCommand) => void;
};

function finite(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) ? value : null;
}

/** Interlayer sheets per layer boundary plus the deck sheet, for the stack. */
export function InterlayerPanel({ solution, execute }: InterlayerPanelProps) {
  const stack = solution.stack;
  const base = { mode: "pattern" as const, solutionId: solution.id };
  const sheetCount =
    stack.layers.reduce((sum, layer) => sum + layer.interlayerBefore, 0) +
    stack.trailingInterlayer;
  return (
    <details className="ed-panel-details">
      <summary>
        Zwischenlagen{" "}
        <small>
          {sheetCount} {sheetCount === 1 ? "Blatt" : "Blätter"}
        </small>
      </summary>
      <div>
        <label className="ed-field">
          Standarddicke (mm)
          <input
            aria-label="Standarddicke der Zwischenlagen"
            type="number"
            min="0.01"
            step="any"
            value={stack.interlayerThicknessMm}
            onChange={(event) => {
              const thicknessMm = finite(event.target.value);
              if (thicknessMm === null) return;
              execute({
                type: "set-interlayer-thickness",
                ...base,
                thicknessMm,
              });
            }}
            className="ui-input"
          />
        </label>
        <table className="ed-table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Anzahl</th>
              <th>Dicke (mm)</th>
            </tr>
          </thead>
          <tbody>
            {stack.layers.map((layer, index) => (
              <tr key={layer.id}>
                <td>
                  {index === 0
                    ? "Unter Lage 1 (Boden)"
                    : `Unter Lage ${index + 1}`}
                </td>
                <td>
                  <input
                    aria-label={`Zwischenlagen unter Lage ${index + 1}`}
                    type="number"
                    min="0"
                    step="1"
                    value={layer.interlayerBefore}
                    onChange={(event) => {
                      const quantity = finite(event.target.value);
                      if (quantity === null) return;
                      execute({
                        type: "set-interlayer-before",
                        ...base,
                        layerId: layer.id,
                        quantity,
                      });
                    }}
                    className="ui-input"
                  />
                </td>
                <td>
                  <input
                    aria-label={`Dicke unter Lage ${index + 1}`}
                    type="number"
                    min="0.01"
                    step="any"
                    value={
                      layer.interlayerThicknessMm ?? stack.interlayerThicknessMm
                    }
                    onChange={(event) => {
                      const thicknessMm = finite(event.target.value);
                      if (thicknessMm === null) return;
                      execute({
                        type: "set-interlayer-before-thickness",
                        ...base,
                        layerId: layer.id,
                        thicknessMm,
                      });
                    }}
                    className="ui-input"
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td>Decklage (oben)</td>
              <td>
                <input
                  aria-label="Decklagen"
                  type="number"
                  min="0"
                  step="1"
                  value={stack.trailingInterlayer}
                  onChange={(event) => {
                    const quantity = finite(event.target.value);
                    if (quantity === null) return;
                    execute({
                      type: "set-trailing-interlayer",
                      ...base,
                      quantity,
                    });
                  }}
                  className="ui-input"
                />
              </td>
              <td>
                <input
                  aria-label="Dicke der Decklage"
                  type="number"
                  min="0.01"
                  step="any"
                  value={
                    stack.trailingInterlayerThicknessMm ??
                    stack.interlayerThicknessMm
                  }
                  onChange={(event) => {
                    const thicknessMm = finite(event.target.value);
                    if (thicknessMm === null) return;
                    execute({
                      type: "set-trailing-interlayer-thickness",
                      ...base,
                      thicknessMm,
                    });
                  }}
                  className="ui-input"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="ed-panel-note">
          Gilt für den gespeicherten Stapel dieses Plans. Beim Stapel-Schritt
          lassen sich dieselben Blätter auch bei der Zusammenstellung setzen.
        </p>
      </div>
    </details>
  );
}
