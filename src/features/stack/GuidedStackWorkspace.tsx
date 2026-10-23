"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayerPattern } from "~/components/LayerPattern";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import type { PalletData } from "~/domain/palletTypes";
import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import type {
  MaterializedStackResult,
  StackCapacityResult,
  StackCompositionMode,
  StackLayerTransform,
} from "~/domain/stack";
import type { GuidedSectionId } from "~/features/project/guidedProjectFormModel";
import { PlanRender } from "~/features/planner/PlanRender";
import {
  candidateLabelDe,
  candidateRefOptions,
  clampLayerCount,
  compositionLabelsDe,
  compositionModes,
  compositionPreviewState,
  describeStackWarning,
  formatDe,
  isLimitWarning,
  patternNameDe,
  rebuildGuidedSequence,
  setIndividualSheet,
  transformLabelsDe,
} from "~/features/stack/guidedStackModel";
import { StackLayerSequence } from "~/features/stack/StackLayerSequence";
import { StackResultPanel } from "~/features/stack/StackResultPanel";
import {
  materializeStackWorkspace,
  type StackInterlayerMode,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import type { StackWorkspaceChange } from "~/features/stack/stackWorkspaceUi";
import { materializedStackToPalletData } from "~/lib/projectAdapters";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type GuidedStackSubstep = "stack" | "review";

export type GuidedStackWorkspaceProps = {
  project: Project;
  candidates: readonly SolverCandidate[];
  solverInput: LayerSolverInput;
  state: StackWorkspaceState;
  change: StackWorkspaceChange;
  result: MaterializedStackResult | null;
  error: string | null;
  previewData: PalletData | null;
  capacity: StackCapacityResult | null;
  candidateByRef: ReadonlyMap<string, SolverCandidate>;
  dirty: boolean;
  saving: boolean;
  saveFailure: string | null;
  saveMessage: string | null;
  onSaveClick: () => void;
  onBack?: () => void;
  onEditProject?: (section?: GuidedSectionId) => void;
  onSubstepChange?: (substep: GuidedStackSubstep) => void;
};

function mm(value: number): string {
  return `${formatDe(value)} mm`;
}

function thicknessValue(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

type CompositionThumbs = Partial<
  Record<
    StackCompositionMode,
    readonly [LayerPatternPreview, LayerPatternPreview]
  >
>;

function useCompositionThumbs(
  project: Project,
  candidates: readonly SolverCandidate[],
  solverInput: LayerSolverInput,
  state: StackWorkspaceState,
): CompositionThumbs {
  const { patternARef, patternBRef } = state;
  return useMemo(() => {
    const thumbs: CompositionThumbs = {};
    for (const mode of compositionModes) {
      const preview = compositionPreviewState(
        { ...state, patternARef, patternBRef },
        mode,
      );
      if (!preview) continue;
      try {
        const data = materializedStackToPalletData(
          materializeStackWorkspace(project, candidates, solverInput, preview),
        );
        if (data.layer_count < 2) continue;
        thumbs[mode] = [
          palletLayerToPatternPreview(data, 0),
          palletLayerToPatternPreview(data, 1),
        ];
      } catch {
        // A tile without a thumbnail stays selectable; the stack reports errors.
      }
    }
    return thumbs;
    // Thumbnails depend only on the patterns, not on count or sheets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, candidates, solverInput, patternARef, patternBRef]);
}

function StageFact({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: ReactNode;
  bad?: boolean;
}) {
  return (
    <div data-bad={bad ? "true" : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HeightGauge({
  heightMm,
  limitMm,
}: {
  heightMm: number;
  limitMm: number;
}) {
  const ratio = limitMm > 0 ? heightMm / limitMm : 0;
  const over = ratio > 1;
  // The limit line sits at 100 %; an over-height fill runs past it.
  const scaleMax = Math.max(1, ratio);
  return (
    <div
      className="fw-gauge"
      role="meter"
      aria-label="Ladehöhe gegen Lagerhöhe"
      aria-valuemin={0}
      aria-valuemax={limitMm}
      aria-valuenow={Math.round(heightMm)}
      aria-valuetext={`${mm(heightMm)} von ${mm(limitMm)}`}
    >
      <div className="fw-gauge-track">
        <div
          className="fw-gauge-fill"
          data-over={over ? "true" : undefined}
          style={{ height: `${Math.min(100, (ratio / scaleMax) * 100)}%` }}
        />
        <div
          className="fw-gauge-limit"
          style={{ bottom: `${(1 / scaleMax) * 100}%` }}
        />
      </div>
      <span className="fw-gauge-label">Lagerhöhe</span>
    </div>
  );
}

export function GuidedStackWorkspace({
  project,
  candidates,
  solverInput,
  state,
  change,
  result,
  error,
  previewData,
  capacity,
  candidateByRef,
  dirty,
  saving,
  saveFailure,
  saveMessage,
  onSaveClick,
  onBack,
  onEditProject,
  onSubstepChange,
}: GuidedStackWorkspaceProps) {
  const [substep, setSubstep] = useState<GuidedStackSubstep>("stack");
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [stageExpanded, setStageExpanded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shownSubstep = useRef(substep);
  const thumbs = useCompositionThumbs(project, candidates, solverInput, state);

  useEffect(() => {
    onSubstepChange?.(substep);
    if (shownSubstep.current === substep) return;
    shownSubstep.current = substep;
    // The root starts with the stage on narrow screens, so both stay visible.
    rootRef.current?.scrollIntoView?.({ block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, [substep, onSubstepChange]);

  const storageHeightMm = project.pallet?.storageEnvelopeMm?.height ?? null;
  const metrics = result?.metrics ?? null;
  const loadHeightMm = metrics?.height.loadStackHeightMm ?? 0;
  const limitWarnings = (result?.warnings ?? []).filter(isLimitWarning);
  const notes = (result?.warnings ?? []).filter(
    (warning) => !isLimitWarning(warning),
  );
  const heightOver = limitWarnings.some(
    ({ code }) => code === "height-exceeded",
  );
  const weightOver = limitWarnings.some(
    ({ code }) => code === "gross-weight-exceeded",
  );
  const patternA = state.patternARef
    ? candidateByRef.get(state.patternARef)
    : undefined;
  const layerCount = state.layers.length;
  const maxLayers =
    capacity?.status === "calculated" && state.interlayerMode !== "individual"
      ? capacity.capacityLayers
      : null;

  const layerPreviews = useMemo(
    () =>
      previewData
        ? previewData.layers.map((_, index) =>
            palletLayerToPatternPreview(previewData, index),
          )
        : [],
    [previewData],
  );

  const setCount = (count: number) => {
    change((current) =>
      rebuildGuidedSequence(current, {
        requestedLayerCount: clampLayerCount(count),
      }),
    );
  };

  const capacityText = (() => {
    if (storageHeightMm === null) return "Keine Lagerhöhe hinterlegt.";
    if (!capacity) return "";
    if (capacity.status === "impossible") {
      return `Schon eine Schicht passt nicht in ${mm(storageHeightMm)}.`;
    }
    if (capacity.status !== "calculated") return "";
    if (state.interlayerMode === "individual") {
      return capacity.capacityLayers < layerCount
        ? `Nur ${capacity.capacityLayers} der ${layerCount} Schichten passen in ${mm(storageHeightMm)}.`
        : `Alle Schichten passen in ${mm(storageHeightMm)}.`;
    }
    return `Bis zu ${capacity.capacityLayers} passen in ${mm(storageHeightMm)}.`;
  })();

  const sheetSummary = (() => {
    const parts: string[] = [];
    if (state.interlayerMode === "all") {
      parts.push(
        `Zwischenlage zwischen allen Schichten (${mm(state.betweenThicknessMm)})`,
      );
    } else if (state.interlayerMode === "individual") {
      const before = state.layers
        .map((layer, index) =>
          index > 0 && state.individualBeforeLayer[layer.id]?.enabled
            ? index + 1
            : null,
        )
        .filter((value): value is number => value !== null);
      parts.push(
        before.length === 0
          ? "Keine einzelnen Zwischenlagen"
          : `Zwischenlage vor Schicht ${before.join(", ")}`,
      );
    } else {
      parts.push("Keine Zwischenlagen");
    }
    if (state.baseEnabled) parts.push("Bodenblatt");
    if (state.deckEnabled) parts.push("Deckblatt");
    return parts.join(", ");
  })();

  const stage = (
    <aside
      className="fw-stage"
      data-expanded={stageExpanded ? "true" : "false"}
      aria-label="Stapelvorschau"
    >
      <div className="fw-stage-head">
        <h2>
          {layerCount === 0
            ? "Noch keine Schicht"
            : `${layerCount} ${layerCount === 1 ? "Schicht" : "Schichten"} gestapelt`}
        </h2>
        <span className="fw-stage-meta">
          {compositionLabelsDe[state.compositionMode]}
        </span>
        <button
          type="button"
          className="fw-link fw-stage-toggle"
          aria-expanded={stageExpanded}
          onClick={() => setStageExpanded((current) => !current)}
        >
          {stageExpanded ? "Kleiner" : "Größer"}
        </button>
      </div>
      <div
        className="fw-stage-scene"
        data-gauge={storageHeightMm !== null ? "true" : undefined}
      >
        <PlanRender
          data={previewData && previewData.layer_count > 0 ? previewData : null}
          palletSize={
            project.pallet
              ? {
                  length: project.pallet.dimensionsMm.length,
                  width: project.pallet.dimensionsMm.width,
                }
              : undefined
          }
          palletHeight={project.pallet?.dimensionsMm.height}
          packageHeight={project.package.dimensionsMm.height}
          title={
            layerCount === 0
              ? "Leere Palette"
              : `Stapel mit ${layerCount} Schichten`
          }
        />
        {storageHeightMm !== null ? (
          <HeightGauge heightMm={loadHeightMm} limitMm={storageHeightMm} />
        ) : null}
      </div>
      <dl className="fw-facts">
        <StageFact
          label="Pakete gesamt"
          value={metrics ? metrics.packages.totalPackageCount : "–"}
        />
        <StageFact
          label={
            storageHeightMm !== null
              ? "Ladehöhe / Lagerhöhe mm"
              : "Ladehöhe mm ohne Palette"
          }
          bad={heightOver}
          value={
            metrics
              ? storageHeightMm !== null
                ? `${formatDe(loadHeightMm)} / ${formatDe(storageHeightMm)}`
                : formatDe(loadHeightMm)
              : "–"
          }
        />
        <StageFact
          label={
            project.pallet?.maxGrossKg != null
              ? `Brutto kg, max. ${formatDe(project.pallet.maxGrossKg)}`
              : "Brutto kg"
          }
          bad={weightOver}
          value={
            metrics?.weight.grossWeightKg != null
              ? formatDe(metrics.weight.grossWeightKg)
              : "unbekannt"
          }
        />
      </dl>
      {limitWarnings.length > 0 ? (
        <ul className="fw-limits" role="status">
          {limitWarnings.map((warning) => (
            <li key={warning.id}>{describeStackWarning(warning)}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );

  const alerts = (
    <>
      {error ? (
        <div role="alert" className="fw-alert">
          Der Stapel lässt sich so nicht aufbauen: {error}
        </div>
      ) : null}
      {saveFailure ? (
        <div role="alert" className="fw-alert">
          {saveFailure}
        </div>
      ) : null}
      {saveMessage ? (
        <div role="status" className="fw-info">
          {saveMessage}
        </div>
      ) : null}
    </>
  );

  const physicalRows = result ? [...result.physicalSequence].reverse() : [];

  const stackStep = (
    <>
      <header className="fw-intro">
        <h1 ref={headingRef} tabIndex={-1}>
          Stapel aufbauen
        </h1>
        <p>
          Schichten, Folgeschicht und Zwischenlagen wählen. Jede Änderung baut
          die Schichtfolge neu auf.
        </p>
      </header>
      {alerts}

      <section className="fw-row" aria-labelledby="fw-stack-pattern">
        <div className="fw-row-label">
          <h2 id="fw-stack-pattern">Muster A</h2>
          <span>
            {patternA
              ? `${candidateLabelDe(patternA)}, ${patternA.metrics.provisionalCycleCount} Griffe je Schicht`
              : "Kein Muster gewählt"}
          </span>
        </div>
        <div className="fw-row-ctl fw-row-end">
          {onBack ? (
            <button type="button" className="ui-btn" onClick={onBack}>
              Anderes Muster wählen
            </button>
          ) : null}
        </div>
      </section>

      <section className="fw-row" aria-labelledby="fw-stack-count">
        <div className="fw-row-label">
          <h2 id="fw-stack-count">Schichten</h2>
          <span>{capacityText}</span>
        </div>
        <div className="fw-row-ctl">
          <div className="fw-inline">
            <div className="fw-stepper">
              <button
                type="button"
                aria-label="Eine Schicht weniger"
                disabled={layerCount <= 0 || !state.patternARef}
                onClick={() => setCount(layerCount - 1)}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                aria-label="Anzahl Schichten"
                value={countDraft ?? String(state.requestedLayerCount)}
                disabled={!state.patternARef}
                onChange={(event) => {
                  const raw = event.target.value;
                  setCountDraft(raw);
                  const value = Number(raw);
                  if (
                    raw.trim() !== "" &&
                    Number.isInteger(value) &&
                    value >= 0
                  ) {
                    setCount(value);
                  }
                }}
                onBlur={() => setCountDraft(null)}
              />
              <button
                type="button"
                aria-label="Eine Schicht mehr"
                disabled={!state.patternARef}
                onClick={() => setCount(layerCount + 1)}
              >
                +
              </button>
            </div>
            {maxLayers !== null && maxLayers > 0 ? (
              <button
                type="button"
                className="fw-chip"
                aria-pressed={layerCount === maxLayers}
                onClick={() => setCount(maxLayers)}
              >
                Maximum ({maxLayers})
              </button>
            ) : null}
            {storageHeightMm === null && onEditProject ? (
              <button
                type="button"
                className="fw-link"
                onClick={() => onEditProject("limits")}
              >
                Lagerhöhe eintragen
              </button>
            ) : null}
          </div>
          {metrics ? (
            <p className="fw-note">
              {metrics.packages.totalPackageCount} Pakete, {mm(loadHeightMm)}{" "}
              Ladehöhe ohne Palette
            </p>
          ) : null}
        </div>
      </section>

      <section className="fw-row" aria-labelledby="fw-stack-mode">
        <div className="fw-row-label">
          <h2 id="fw-stack-mode">Folgeschicht</h2>
          <span>
            Wie jede zweite Schicht liegt. Versatz gibt Verbund.
            {layerCount < 2 ? " Wirkt ab der zweiten Schicht." : ""}
          </span>
        </div>
        <div className="fw-row-ctl">
          <div className="fw-tiles" role="group" aria-label="Folgeschicht">
            {compositionModes.map((mode) => {
              const pair = thumbs[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  className="fw-tile"
                  aria-pressed={state.compositionMode === mode}
                  onClick={() =>
                    change((current) =>
                      rebuildGuidedSequence(current, { compositionMode: mode }),
                    )
                  }
                >
                  <span className="fw-tile-pair" aria-hidden="true">
                    {pair ? (
                      <>
                        <LayerPattern
                          preview={pair[0]}
                          showGrid={false}
                          showGroupLabels={false}
                          showLabelSides={false}
                        />
                        <LayerPattern
                          preview={pair[1]}
                          showGrid={false}
                          showGroupLabels={false}
                          showLabelSides={false}
                        />
                      </>
                    ) : null}
                  </span>
                  <span>{compositionLabelsDe[mode]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="fw-row" aria-labelledby="fw-stack-sheets">
        <div className="fw-row-label">
          <h2 id="fw-stack-sheets">Zwischenlagen</h2>
          <span>Zählen zur Ladehöhe.</span>
        </div>
        <div className="fw-row-ctl">
          <fieldset className="fw-seg-field">
            <legend className="sr-only">Zwischenlagen</legend>
            <div className="fw-seg">
              {(
                [
                  ["none", "Keine"],
                  ["all", "Zwischen allen"],
                  ["individual", "Einzeln in der Schichtfolge"],
                ] as const satisfies readonly (readonly [
                  StackInterlayerMode,
                  string,
                ])[]
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="fw-interlayer-mode"
                    value={value}
                    checked={state.interlayerMode === value}
                    onChange={() =>
                      change((current) => ({
                        ...current,
                        interlayerMode: value,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {state.interlayerMode === "all" ? (
            <label className="fw-mini-field">
              Dicke je Zwischenlage
              <span className="fw-ctl fw-ctl-sm">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={state.betweenThicknessMm}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      betweenThicknessMm: thicknessValue(event.target.value),
                    }))
                  }
                />
                <span className="fw-unit">mm</span>
              </span>
            </label>
          ) : null}
          <div className="fw-grid2">
            <div className="fw-sheet-opt">
              <label className="fw-check">
                <input
                  type="checkbox"
                  checked={state.baseEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      baseEnabled: event.target.checked,
                    }))
                  }
                />
                Bodenblatt auf der Palette
              </label>
              {state.baseEnabled ? (
                <span className="fw-ctl fw-ctl-sm">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Dicke Bodenblatt"
                    value={state.baseThicknessMm}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        baseThicknessMm: thicknessValue(event.target.value),
                      }))
                    }
                  />
                  <span className="fw-unit">mm</span>
                </span>
              ) : null}
            </div>
            <div className="fw-sheet-opt">
              <label className="fw-check">
                <input
                  type="checkbox"
                  checked={state.deckEnabled}
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      deckEnabled: event.target.checked,
                    }))
                  }
                />
                Deckblatt oben
              </label>
              {state.deckEnabled ? (
                <span className="fw-ctl fw-ctl-sm">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Dicke Deckblatt"
                    value={state.deckThicknessMm}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        deckThicknessMm: thicknessValue(event.target.value),
                      }))
                    }
                  />
                  <span className="fw-unit">mm</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <details
        className="fw-panel-details"
        open={
          state.patternBRef !== null || state.specialTopEnabled || undefined
        }
      >
        <summary>Muster B und abweichende Decklage</summary>
        <div className="fw-details-body">
          <div className="fw-grid2">
            <div className="fw-field">
              <label htmlFor="fw-pattern-b">
                Muster B (jede zweite Schicht)
              </label>
              <div className="fw-ctl">
                <select
                  id="fw-pattern-b"
                  value={state.patternBRef ?? ""}
                  onChange={(event) =>
                    change((current) =>
                      rebuildGuidedSequence(current, {
                        patternBRef: event.target.value || null,
                      }),
                    )
                  }
                >
                  <option value="">Wie Muster A</option>
                  {candidateRefOptions(candidates).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <label className="fw-check">
            <input
              type="checkbox"
              checked={state.specialTopEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  specialTopEnabled: event.target.checked,
                }))
              }
            />
            Oberste Schicht durch ein anderes Muster ersetzen
          </label>
          {state.specialTopEnabled ? (
            <div className="fw-grid2">
              <div className="fw-field">
                <label htmlFor="fw-top-pattern">Muster der Decklage</label>
                <div className="fw-ctl">
                  <select
                    id="fw-top-pattern"
                    value={state.specialTopPatternRef ?? ""}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        specialTopPatternRef: event.target.value || null,
                      }))
                    }
                  >
                    {candidateRefOptions(candidates).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="fw-field">
                <label htmlFor="fw-top-transform">Lage der Decklage</label>
                <div className="fw-ctl">
                  <select
                    id="fw-top-transform"
                    value={state.specialTopTransform}
                    onChange={(event) =>
                      change((current) => ({
                        ...current,
                        specialTopTransform: event.target
                          .value as StackLayerTransform,
                      }))
                    }
                  >
                    {Object.entries(transformLabelsDe).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </details>

      <section className="fw-panel" aria-labelledby="fw-stack-seq">
        <header className="fw-panel-head">
          <h2 id="fw-stack-seq">Schichtfolge</h2>
          <p>
            Von oben nach unten, mit Ablagehöhe des Roboters ohne Palette.
            {state.interlayerMode === "individual"
              ? " Zwischenlagen hier einfügen."
              : ""}
          </p>
        </header>
        {physicalRows.length === 0 ? (
          <p className="fw-note">Noch keine Schicht. Mit + eine hinzufügen.</p>
        ) : (
          <ol className="fw-seq">
            {physicalRows.map((item, index) => {
              if (item.kind === "sheet") {
                const removable =
                  state.interlayerMode === "individual" &&
                  item.role === "between-layers" &&
                  item.beforeLayerId !== null;
                const name =
                  item.role === "base-sheet"
                    ? "Bodenblatt"
                    : item.role === "deck-sheet"
                      ? "Deckblatt"
                      : "Zwischenlage";
                return (
                  <li key={item.id} className="fw-seq-sheet">
                    <span className="fw-seq-line" aria-hidden="true" />
                    <span>
                      {name} {mm(item.thicknessMm)}
                    </span>
                    {removable ? (
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm"
                        onClick={() =>
                          change((current) =>
                            setIndividualSheet(
                              current,
                              item.beforeLayerId!,
                              false,
                            ),
                          )
                        }
                      >
                        Entfernen
                      </button>
                    ) : null}
                  </li>
                );
              }
              const layerNumber = item.packageLayerIndex + 1;
              const preview = layerPreviews[item.packageLayerIndex];
              const below = physicalRows[index + 1];
              const canInsert =
                state.interlayerMode === "individual" &&
                item.packageLayerIndex > 0 &&
                below?.kind === "package-layer";
              const special = item.layerProvenance.kind === "special-top";
              return (
                <li key={item.id} className="fw-seq-group">
                  <div className="fw-seq-layer">
                    <span className="fw-seq-n">{layerNumber}</span>
                    <span className="fw-seq-thumb" aria-hidden="true">
                      {preview ? (
                        <LayerPattern
                          preview={preview}
                          showGrid={false}
                          showGroupLabels={false}
                          showLabelSides={false}
                        />
                      ) : null}
                    </span>
                    <span className="fw-seq-text">
                      {special ? "Decklage: " : ""}
                      {patternNameDe(state, item.patternRef, candidateByRef)}
                      {item.transform !== "identity"
                        ? `, ${transformLabelsDe[item.transform]}`
                        : ""}
                      , {item.placements.length} Pakete
                    </span>
                    <span className="fw-seq-z">
                      Ablage-Z {formatDe(item.zTopMm)}
                    </span>
                  </div>
                  {canInsert ? (
                    <div className="fw-seq-gap">
                      <span className="fw-seq-line" aria-hidden="true" />
                      <button
                        type="button"
                        className="ui-btn ui-btn-sm"
                        aria-label={`Zwischenlage unter Schicht ${layerNumber} einfügen`}
                        onClick={() =>
                          change((current) =>
                            setIndividualSheet(current, item.id, true),
                          )
                        }
                      >
                        Zwischenlage einfügen
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <details className="fw-panel-details">
        <summary>Schichtfolge einzeln bearbeiten</summary>
        <div className="fw-details-body fw-classic">
          <p className="fw-note">
            Muster und Lage je Schicht frei setzen, Schichten verschieben oder
            löschen. Eine spätere Änderung an Anzahl, Folgeschicht oder Muster
            baut die Folge wieder neu auf.
          </p>
          <StackLayerSequence
            state={state}
            candidates={candidates}
            candidateByRef={candidateByRef}
            change={change}
          />
        </div>
      </details>

      {notes.length > 0 ? (
        <details className="fw-panel-details">
          <summary>Hinweise ({notes.length})</summary>
          <ul className="fw-notes">
            {notes.map((warning) => (
              <li key={warning.id}>{describeStackWarning(warning)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );

  const pallet = project.pallet;
  const pkg = project.package;
  const reviewRows: {
    key: string;
    label: string;
    value: string;
    detail: string;
    action?: { label: string; onClick: () => void };
  }[] = [
    {
      key: "package",
      label: "Paket",
      value: `${formatDe(pkg.dimensionsMm.length)} × ${formatDe(pkg.dimensionsMm.width)} × ${mm(pkg.dimensionsMm.height)}`,
      detail: `${pkg.weightKg === null ? "Gewicht unbekannt" : `${formatDe(pkg.weightKg)} kg je Paket`}, Einlauf ${pkg.inletOrientation === "lengthwise" ? "längs" : "quer"}`,
      action: onEditProject
        ? { label: "Paket ändern", onClick: () => onEditProject("package") }
        : undefined,
    },
    {
      key: "pallet",
      label: "Palette",
      value: pallet?.name ?? "Keine Palette",
      detail: pallet
        ? `${formatDe(pallet.dimensionsMm.length)} × ${formatDe(pallet.dimensionsMm.width)} × ${mm(pallet.dimensionsMm.height)}${
            pallet.storageEnvelopeMm
              ? `, Lagerhöhe ${mm(pallet.storageEnvelopeMm.height)}`
              : ""
          }`
        : "",
      action: onEditProject
        ? { label: "Palette ändern", onClick: () => onEditProject("pallet") }
        : undefined,
    },
    {
      key: "meta",
      label: "Artikel und Linie",
      value:
        [project.productNumber, project.projectNumber]
          .filter((part) => part.trim() !== "")
          .join(", ") || "Nicht angegeben",
      detail: "Ändert weder Muster noch Stapel.",
      action: onEditProject
        ? {
            label: "Artikel und Linie ändern",
            onClick: () => onEditProject("meta"),
          }
        : undefined,
    },
    {
      key: "pattern",
      label: "Muster A",
      value: patternA ? `Platz ${patternA.rank}` : "Kein Muster",
      detail: patternA
        ? `${patternA.metrics.packageCount} Pakete, ${patternA.metrics.provisionalCycleCount} Griffe je Schicht`
        : "",
      action: onBack ? { label: "Muster ändern", onClick: onBack } : undefined,
    },
    {
      key: "stack",
      label: "Stapel",
      value: `${layerCount} ${layerCount === 1 ? "Schicht" : "Schichten"}, ${compositionLabelsDe[state.compositionMode]}`,
      detail: sheetSummary,
      action: {
        label: "Stapel ändern",
        onClick: () => setSubstep("stack"),
      },
    },
    {
      key: "result",
      label: "Ergebnis",
      value: metrics
        ? `${metrics.packages.totalPackageCount} Pakete, ${mm(loadHeightMm)}${
            metrics.weight.grossWeightKg !== null
              ? `, ${formatDe(metrics.weight.grossWeightKg)} kg brutto`
              : ", Bruttogewicht unbekannt"
          }`
        : "–",
      detail: metrics
        ? metrics.cycles.totalCycleCount !== null
          ? `${metrics.cycles.totalCycleCount} Griffe gesamt`
          : "Griffzahl unbekannt"
        : "",
    },
  ];

  const reviewStep = (
    <>
      <header className="fw-intro">
        <h1 ref={headingRef} tabIndex={-1}>
          Prüfen und speichern
        </h1>
        <p>
          Jede Zeile lässt sich gezielt ändern; der Stapel bleibt dabei
          erhalten.
        </p>
      </header>
      {alerts}
      <dl className="fw-review">
        {reviewRows.map((row) => (
          <div key={row.key} className="fw-review-row">
            <dt>{row.label}</dt>
            <dd>
              <span className="fw-review-value">{row.value}</span>
              {row.detail ? (
                <span className="fw-review-detail">{row.detail}</span>
              ) : null}
            </dd>
            {row.action ? (
              <dd className="fw-review-action">
                <button
                  type="button"
                  className="ui-btn ui-btn-sm"
                  aria-label={row.action.label}
                  onClick={row.action.onClick}
                >
                  Ändern
                </button>
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
      {limitWarnings.length > 0 ? (
        <div className="fw-warn" role="status">
          <p>
            Der Stapel überschreitet Grenzen. Speichern ist trotzdem möglich.
          </p>
          <ul>
            {limitWarnings.map((warning) => (
              <li key={warning.id}>{describeStackWarning(warning)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className="fw-panel-details">
        <summary>Alle Kennzahlen</summary>
        <div className="fw-details-body fw-classic">
          {result ? <StackResultPanel result={result} /> : null}
        </div>
      </details>
    </>
  );

  const canReview = Boolean(result) && layerCount > 0;

  return (
    <div ref={rootRef} className="fw fw-stack" aria-busy={saving}>
      <div className="fw-layout">
        <div className="fw-main">
          {substep === "stack" ? stackStep : reviewStep}
        </div>
        {stage}
      </div>
      <footer className="fw-footer">
        <p className="fw-footer-hint" aria-live="polite">
          {substep === "review"
            ? "Nach dem Speichern öffnet sich der Plan."
            : !canReview
              ? "Mindestens eine Schicht aufbauen, um fortzufahren."
              : dirty
                ? "Stapel noch nicht gespeichert."
                : limitWarnings.length > 0
                  ? "Grenzen überschritten, Speichern bleibt möglich."
                  : "Stapel bereit zum Prüfen."}
        </p>
        <div className="fw-footer-actions">
          {substep === "review" ? (
            <>
              <button
                type="button"
                className="ui-btn"
                disabled={saving}
                onClick={() => setSubstep("stack")}
              >
                Zurück
              </button>
              <button
                type="button"
                className="ui-btn-primary"
                disabled={saving || !canReview}
                onClick={onSaveClick}
              >
                {saving ? "Wird gespeichert …" : "Plan speichern"}
              </button>
            </>
          ) : (
            <>
              {onBack ? (
                <button type="button" className="ui-btn" onClick={onBack}>
                  Zurück
                </button>
              ) : null}
              <button
                type="button"
                className="ui-btn-primary"
                disabled={!canReview}
                onClick={() => setSubstep("review")}
              >
                Prüfen &amp; speichern
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
