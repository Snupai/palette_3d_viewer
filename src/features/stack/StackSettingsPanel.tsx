"use client";

import { useT } from "~/i18n";
import type { SolverCandidate } from "~/domain/solver";
import type { StackCompositionMode, StackLayerTransform } from "~/domain/stack";
import {
  type calculateWorkspaceCapacity,
  candidatePatternRef,
  rebuildStackSequence,
  type StackInterlayerMode,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import { compositionModes } from "~/features/stack/guidedStackModel";
import {
  modeLabel,
  stackButtonClass,
  stackCheckboxClass,
  stackFieldLabelClass,
  stackFieldsetClass,
  stackInputClass,
  stackLegendClass,
  type StackWorkspaceChange,
  classicTransformLabel,
  stackLayerTransforms,
} from "~/features/stack/stackWorkspaceUi";

/** Composition, interlayer, and special-top controls of the stack workspace. */
export function StackSettingsPanel({
  state,
  candidates,
  capacity,
  change,
}: {
  state: StackWorkspaceState;
  candidates: readonly SolverCandidate[];
  capacity: ReturnType<typeof calculateWorkspaceCapacity>;
  change: StackWorkspaceChange;
}) {
  const t = useT();
  const selectedA = state.patternARef ?? "";
  const selectedB = state.patternBRef ?? "";

  return (
    <>
      <fieldset className={stackFieldsetClass}>
        <legend className={stackLegendClass}>
          {t("stack.settings.composition")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={stackFieldLabelClass}>
            {t("stack.settings.patternA")}
            <select
              aria-label={t("stack.settings.patternA")}
              value={selectedA}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  patternARef: event.target.value || null,
                }))
              }
              className={stackInputClass}
            >
              {candidates.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidatePatternRef(candidate)}
                >
                  {t("stack.settings.patternOption", {
                    rank: candidate.rank,
                    count: candidate.metrics.packageCount,
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            {t("stack.settings.patternB")}
            <select
              aria-label={t("stack.settings.patternB")}
              value={selectedB}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  patternBRef: event.target.value || null,
                }))
              }
              className={stackInputClass}
            >
              <option value="">{t("stack.settings.usePatternA")}</option>
              {candidates.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidatePatternRef(candidate)}
                >
                  {t("stack.settings.patternOption", {
                    rank: candidate.rank,
                    count: candidate.metrics.packageCount,
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            {t("stack.settings.compositionMode")}
            <select
              aria-label={t("stack.settings.compositionMode")}
              value={state.compositionMode}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  compositionMode: event.target.value as StackCompositionMode,
                }))
              }
              className={stackInputClass}
            >
              {compositionModes.map((value) => (
                <option key={value} value={value}>
                  {modeLabel(t, value)}
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            {t("stack.settings.requestedLayers")}
            <input
              aria-label={t("stack.settings.requestedLayers")}
              type="number"
              min="0"
              step="1"
              value={state.requestedLayerCount}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  requestedLayerCount: Number(event.target.value),
                }))
              }
              className={`${stackInputClass} font-mono`}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => change((current) => rebuildStackSequence(current))}
            className={stackButtonClass}
          >
            {t("stack.settings.buildAB")}
          </button>
          <span className="text-muted text-micro">
            {t("stack.settings.derivedMax", {
              value: capacity ? capacity.capacityLayers : t("stack.unknown"),
            })}
            {capacity
              ? ` · ${capacity.message}`
              : ` · ${t("stack.settings.noStorageHeight")}`}
          </span>
        </div>
      </fieldset>

      <fieldset className={stackFieldsetClass}>
        <legend className={stackLegendClass}>
          {t("stack.settings.interlayers")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={stackFieldLabelClass}>
            {t("stack.settings.rule")}
            <select
              aria-label={t("stack.settings.ruleAria")}
              value={state.interlayerMode}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  interlayerMode: event.target.value as StackInterlayerMode,
                }))
              }
              className={stackInputClass}
            >
              <option value="none">{t("stack.settings.ruleNone")}</option>
              <option value="all">{t("stack.settings.ruleAll")}</option>
              <option value="individual">
                {t("stack.settings.ruleIndividual")}
              </option>
            </select>
          </label>
          {state.interlayerMode === "all" ? (
            <label className={stackFieldLabelClass}>
              {t("stack.settings.betweenThickness")}
              <input
                aria-label={t("stack.settings.betweenThicknessAria")}
                type="number"
                min="0"
                step="any"
                value={state.betweenThicknessMm}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    betweenThicknessMm: Number(event.target.value),
                  }))
                }
                className={`${stackInputClass} font-mono`}
              />
            </label>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-ink text-micro grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            <input
              type="checkbox"
              aria-label={t("stack.settings.enableBase")}
              checked={state.baseEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  baseEnabled: event.target.checked,
                }))
              }
              className={stackCheckboxClass}
            />
            {t("stack.settings.baseSheet")}
            <span className="col-span-2 pl-6">
              <input
                aria-label={t("stack.settings.baseThickness")}
                type="number"
                min="0"
                step="any"
                value={state.baseThicknessMm}
                disabled={!state.baseEnabled}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    baseThicknessMm: Number(event.target.value),
                  }))
                }
                className={`${stackInputClass} font-mono`}
              />
            </span>
          </label>
          <label className="text-ink text-micro grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
            <input
              type="checkbox"
              aria-label={t("stack.settings.enableDeck")}
              checked={state.deckEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  deckEnabled: event.target.checked,
                }))
              }
              className={stackCheckboxClass}
            />
            {t("stack.settings.deckSheet")}
            <span className="col-span-2 pl-6">
              <input
                aria-label={t("stack.settings.deckThickness")}
                type="number"
                min="0"
                step="any"
                value={state.deckThicknessMm}
                disabled={!state.deckEnabled}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    deckThicknessMm: Number(event.target.value),
                  }))
                }
                className={`${stackInputClass} font-mono`}
              />
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className={stackFieldsetClass}>
        <legend className={stackLegendClass}>
          {t("stack.settings.specialTop")}
        </legend>
        <label className="text-ink text-micro flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.specialTopEnabled}
            onChange={(event) =>
              change((current) => ({
                ...current,
                specialTopEnabled: event.target.checked,
              }))
            }
            className={stackCheckboxClass}
          />
          {t("stack.settings.replaceTop")}
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={stackFieldLabelClass}>
            {t("stack.settings.topCandidate")}
            <select
              aria-label={t("stack.settings.topCandidate")}
              value={state.specialTopPatternRef ?? ""}
              disabled={!state.specialTopEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  specialTopPatternRef: event.target.value || null,
                }))
              }
              className={stackInputClass}
            >
              {candidates.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidatePatternRef(candidate)}
                >
                  {t("stack.settings.patternOption", {
                    rank: candidate.rank,
                    count: candidate.metrics.packageCount,
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            {t("stack.settings.topTransform")}
            <select
              aria-label={t("stack.settings.topTransform")}
              value={state.specialTopTransform}
              disabled={!state.specialTopEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  specialTopTransform: event.target
                    .value as StackLayerTransform,
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
          </label>
        </div>
      </fieldset>
    </>
  );
}
