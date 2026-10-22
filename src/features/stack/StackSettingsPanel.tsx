"use client";

import type { SolverCandidate } from "~/domain/solver";
import type { StackCompositionMode, StackLayerTransform } from "~/domain/stack";
import {
  type calculateWorkspaceCapacity,
  candidatePatternRef,
  rebuildStackSequence,
  type StackInterlayerMode,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import {
  modeLabels,
  stackButtonClass,
  stackCheckboxClass,
  stackFieldLabelClass,
  stackFieldsetClass,
  stackInputClass,
  stackLegendClass,
  type StackWorkspaceChange,
  transformLabels,
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
  const selectedA = state.patternARef ?? "";
  const selectedB = state.patternBRef ?? "";

  return (
    <>
      <fieldset className={stackFieldsetClass}>
        <legend className={stackLegendClass}>Composition</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={stackFieldLabelClass}>
            Pattern A
            <select
              aria-label="Pattern A"
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
                  #{candidate.rank} · {candidate.metrics.packageCount} packages
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            Pattern B
            <select
              aria-label="Pattern B"
              value={selectedB}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  patternBRef: event.target.value || null,
                }))
              }
              className={stackInputClass}
            >
              <option value="">Use pattern A</option>
              {candidates.map((candidate) => (
                <option
                  key={candidate.id}
                  value={candidatePatternRef(candidate)}
                >
                  #{candidate.rank} · {candidate.metrics.packageCount} packages
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            Composition mode
            <select
              aria-label="Composition mode"
              value={state.compositionMode}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  compositionMode: event.target.value as StackCompositionMode,
                }))
              }
              className={stackInputClass}
            >
              {Object.entries(modeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            Requested layers
            <input
              aria-label="Requested layers"
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
            Build A/B sequence
          </button>
          <span className="text-muted text-xs">
            Derived maximum layers:{" "}
            {capacity ? capacity.capacityLayers : "Unknown"}
            {capacity
              ? ` · ${capacity.message}`
              : " · no storage height configured"}
          </span>
        </div>
      </fieldset>

      <fieldset className={stackFieldsetClass}>
        <legend className={stackLegendClass}>Interlayers</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={stackFieldLabelClass}>
            Rule
            <select
              aria-label="Interlayer rule"
              value={state.interlayerMode}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  interlayerMode: event.target.value as StackInterlayerMode,
                }))
              }
              className={stackInputClass}
            >
              <option value="none">No interlayers</option>
              <option value="all">All layer boundaries</option>
              <option value="individual">Individual boundaries</option>
            </select>
          </label>
          {state.interlayerMode === "all" ? (
            <label className={stackFieldLabelClass}>
              Between-layer thickness (mm)
              <input
                aria-label="Between-layer thickness"
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
          ) : (
            <p className="text-muted self-end text-xs sm:col-span-2">
              {state.interlayerMode === "none"
                ? "No sheets between layers."
                : "Enable and size sheets directly in the layer sequence below."}
            </p>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-ink grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
            <input
              type="checkbox"
              aria-label="Enable base sheet"
              checked={state.baseEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  baseEnabled: event.target.checked,
                }))
              }
              className={stackCheckboxClass}
            />
            Base sheet
            <span className="col-span-2 pl-6">
              <input
                aria-label="Base sheet thickness"
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
          <label className="text-ink grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
            <input
              type="checkbox"
              aria-label="Enable deck sheet"
              checked={state.deckEnabled}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  deckEnabled: event.target.checked,
                }))
              }
              className={stackCheckboxClass}
            />
            Deck sheet
            <span className="col-span-2 pl-6">
              <input
                aria-label="Deck sheet thickness"
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
        <legend className={stackLegendClass}>Special top candidate</legend>
        <label className="text-ink flex items-center gap-2 text-xs">
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
          Replace the physical top layer
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={stackFieldLabelClass}>
            Top candidate
            <select
              aria-label="Top candidate"
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
                  #{candidate.rank} · {candidate.metrics.packageCount} packages
                </option>
              ))}
            </select>
          </label>
          <label className={stackFieldLabelClass}>
            Top transform
            <select
              aria-label="Top transform"
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
              {Object.entries(transformLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
    </>
  );
}
