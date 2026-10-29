"use client";

import type { PlanningSolution } from "~/domain/project/projectSchema";
import type { ProjectEditorCommand } from "~/features/editor/editorModel";
import { useT } from "~/i18n";

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
  const t = useT();
  const stack = solution.stack;
  const base = { mode: "pattern" as const, solutionId: solution.id };
  const sheetCount =
    stack.layers.reduce((sum, layer) => sum + layer.interlayerBefore, 0) +
    stack.trailingInterlayer;
  return (
    <details className="ed-panel-details">
      <summary>
        {t("editor.interlayer.title")}{" "}
        <small>
          {t("editor.interlayer.sheetCount", { count: sheetCount })}
        </small>
      </summary>
      <div>
        <label className="ed-field">
          {t("editor.interlayer.defaultThickness")}
          <input
            aria-label={t("editor.interlayer.defaultThicknessAria")}
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
              <th>{t("editor.interlayer.position")}</th>
              <th>{t("editor.interlayer.quantity")}</th>
              <th>{t("editor.interlayer.thickness")}</th>
            </tr>
          </thead>
          <tbody>
            {stack.layers.map((layer, index) => (
              <tr key={layer.id}>
                <td>
                  {index === 0
                    ? t("editor.interlayer.belowFirst")
                    : t("editor.interlayer.belowLayer", { n: index + 1 })}
                </td>
                <td>
                  <input
                    aria-label={t("editor.interlayer.quantityAria", {
                      n: index + 1,
                    })}
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
                    aria-label={t("editor.interlayer.thicknessAria", {
                      n: index + 1,
                    })}
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
              <td>{t("editor.interlayer.deck")}</td>
              <td>
                <input
                  aria-label={t("editor.interlayer.deckQuantityAria")}
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
                  aria-label={t("editor.interlayer.deckThicknessAria")}
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
      </div>
    </details>
  );
}
