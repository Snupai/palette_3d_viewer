"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { LayerPattern } from "~/components/LayerPattern";
import type { RectangleBoundsMm } from "~/domain/geometry";
import type {
  LayerSolverInput,
  SolverCandidate,
  SolverDiagnostic,
  SolverExclusion,
} from "~/domain/solver";
import { solverCandidateToPatternPreview } from "~/lib/previewAdapters";

export type CandidateBrowserProps = {
  candidates: readonly SolverCandidate[];
  solverInput: LayerSolverInput;
  physicalPalletBoundsMm?: RectangleBoundsMm;
  selectedCandidateId: string | null;
  onSelectionChange: (candidateId: string | null) => void;
  generatedCandidateCount?: number;
  diagnostics?: readonly SolverDiagnostic[];
  exclusions?: readonly SolverExclusion[];
};

function optionId(candidateId: string): string {
  return `candidate-option-${candidateId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function exactCountValue(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function CandidateBrowser({
  candidates,
  solverInput,
  physicalPalletBoundsMm,
  selectedCandidateId,
  onSelectionChange,
  generatedCandidateCount = candidates.length,
  diagnostics = [],
  exclusions = [],
}: CandidateBrowserProps) {
  const [exactCount, setExactCount] = useState("");
  const [maximumOnly, setMaximumOnly] = useState(false);
  const listboxRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const maximumCount = useMemo(
    () =>
      candidates.reduce(
        (maximum, candidate) =>
          Math.max(maximum, candidate.metrics.packageCount),
        0,
      ),
    [candidates],
  );
  const filteredCandidates = useMemo(() => {
    const parsedExactCount = exactCountValue(exactCount);
    return candidates.filter((candidate) => {
      if (maximumOnly) {
        return candidate.metrics.packageCount === maximumCount;
      }
      return (
        parsedExactCount === null ||
        candidate.metrics.packageCount === parsedExactCount
      );
    });
  }, [candidates, exactCount, maximumCount, maximumOnly]);

  useEffect(() => {
    if (
      selectedCandidateId &&
      filteredCandidates.some(({ id }) => id === selectedCandidateId)
    ) {
      return;
    }
    onSelectionChange(filteredCandidates[0]?.id ?? null);
  }, [filteredCandidates, onSelectionChange, selectedCandidateId]);

  const selectedCandidate =
    candidates.find(({ id }) => id === selectedCandidateId) ?? null;
  const selectedPreview = selectedCandidate
    ? solverCandidateToPatternPreview(selectedCandidate, solverInput, {
        physicalPalletBoundsMm,
      })
    : null;

  const selectAt = (index: number) => {
    const candidate = filteredCandidates[index];
    if (!candidate) return;
    onSelectionChange(candidate.id);
    const scrollSelectedIntoView = () => {
      rowRefs.current.get(candidate.id)?.scrollIntoView?.({ block: "nearest" });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(scrollSelectedIntoView);
    } else {
      scrollSelectedIntoView();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (filteredCandidates.length === 0) return;
    const currentIndex = filteredCandidates.findIndex(
      ({ id }) => id === selectedCandidateId,
    );
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = Math.min(
          filteredCandidates.length - 1,
          Math.max(0, currentIndex + 1),
        );
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextIndex = Math.max(
          0,
          currentIndex < 0 ? filteredCandidates.length - 1 : currentIndex - 1,
        );
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = filteredCandidates.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectAt(nextIndex);
  };

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(240px,1fr)_auto] border border-zinc-800 bg-zinc-900">
      <header className="flex flex-wrap items-end gap-2 border-b border-zinc-800 p-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-zinc-100">
            Selectable layouts
          </h2>
          <p className="text-xs text-zinc-500" aria-live="polite">
            {filteredCandidates.length} of {candidates.length} layouts ·{" "}
            {generatedCandidateCount} generated candidates
          </p>
        </div>
        <label className="grid gap-1 text-[11px] text-zinc-500">
          Exact count
          <input
            type="number"
            min="0"
            step="1"
            value={exactCount}
            disabled={maximumOnly}
            onChange={(event) => setExactCount(event.target.value)}
            aria-label="Exact package count"
            className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25 disabled:text-zinc-600"
          />
        </label>
        <label className="flex h-8 items-center gap-2 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={maximumOnly}
            onChange={(event) => setMaximumOnly(event.target.checked)}
            className="h-4 w-4 accent-amber-400"
          />
          Maximum ({maximumCount})
        </label>
        <button
          type="button"
          onClick={() => {
            setExactCount("");
            setMaximumOnly(false);
          }}
          className="h-8 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-400/40 focus:outline-none"
        >
          Reset filters
        </button>
      </header>

      <div
        ref={listboxRef}
        role="listbox"
        aria-label="Selectable candidate layouts"
        aria-activedescendant={
          selectedCandidateId ? optionId(selectedCandidateId) : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="scrollbar-thin min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-inset"
      >
        <table
          role="presentation"
          className="w-full min-w-[650px] border-collapse text-xs"
        >
          <thead className="sticky top-0 z-10 bg-zinc-900 text-left text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-2 font-medium">Nr.</th>
              <th className="px-2 py-2 font-medium">Count</th>
              <th className="px-2 py-2 font-medium">Geometry</th>
              <th className="px-2 py-2 font-medium">Blocks</th>
              <th className="px-2 py-2 font-medium">Cycles</th>
              <th className="px-2 py-2 font-medium">Length</th>
              <th className="px-2 py-2 font-medium">Width</th>
            </tr>
          </thead>
          <tbody role="presentation">
            {filteredCandidates.map((candidate) => {
              const selected = candidate.id === selectedCandidateId;
              return (
                <tr
                  key={candidate.id}
                  id={optionId(candidate.id)}
                  ref={(node) => {
                    if (node) rowRefs.current.set(candidate.id, node);
                    else rowRefs.current.delete(candidate.id);
                  }}
                  role="option"
                  aria-selected={selected}
                  onPointerDown={() => listboxRef.current?.focus()}
                  onClick={() => {
                    listboxRef.current?.focus();
                    onSelectionChange(candidate.id);
                  }}
                  className={`cursor-default border-b border-zinc-800/80 text-zinc-300 ${
                    selected
                      ? "bg-amber-400/15 text-zinc-100"
                      : "hover:bg-zinc-800/70"
                  }`}
                >
                  <td className="px-2 py-2 font-mono">{candidate.rank}</td>
                  <td className="px-2 py-2 font-mono">
                    {candidate.metrics.packageCount}
                  </td>
                  <td className="px-2 py-2">
                    {candidate.validation.valid ? "Geometry OK" : "Rejected"}
                  </td>
                  <td
                    className="px-2 py-2 text-zinc-500"
                    title="The legacy MultiPack Blocks value has not been verified and is not inferred."
                  >
                    Unknown
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {candidate.metrics.provisionalCycleCount}
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {candidate.metrics.boundingBlockLengthMm} mm
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {candidate.metrics.boundingBlockWidthMm} mm
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredCandidates.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">
            No candidate matches the current filters.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 border-t border-zinc-800 p-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-h-[160px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-2">
          {selectedPreview ? (
            <LayerPattern
              preview={selectedPreview}
              showGroupLabels={false}
              className="h-full min-h-[144px] w-full"
            />
          ) : (
            <div className="flex h-full min-h-[144px] items-center justify-center text-xs text-zinc-600">
              Select a candidate
            </div>
          )}
        </div>
        <div className="min-w-0 text-xs text-zinc-400">
          {selectedCandidate ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>Score</dt>
              <dd className="font-mono text-zinc-200">
                {selectedCandidate.score.value}
              </dd>
              <dt>Utilization</dt>
              <dd className="font-mono text-zinc-200">
                {selectedCandidate.metrics.utilizationPercent.toFixed(2)}%
              </dd>
              <dt>Geometry</dt>
              <dd
                className="truncate font-mono text-zinc-300"
                title={selectedCandidate.geometryId}
              >
                {selectedCandidate.geometryId}
              </dd>
              <dt>Generators</dt>
              <dd className="text-zinc-300">
                {selectedCandidate.provenance
                  .map(({ family, variant }) => `${family}/${variant}`)
                  .join(", ") || "None recorded"}
              </dd>
            </dl>
          ) : (
            <p>No active candidate diagnostics.</p>
          )}
          <details className="mt-3 border-t border-zinc-800 pt-2">
            <summary className="cursor-pointer text-zinc-300">
              Solver diagnostics ({diagnostics.length}) and exclusions (
              {exclusions.length})
            </summary>
            <div className="scrollbar-thin mt-2 max-h-32 overflow-auto pr-2">
              {diagnostics.length === 0 && exclusions.length === 0 ? (
                <p className="text-zinc-600">No diagnostics or exclusions.</p>
              ) : (
                <ul className="grid gap-1">
                  {diagnostics.map((diagnostic, index) => (
                    <li key={`diagnostic-${index}`}>
                      {diagnostic.phase}: {diagnostic.message}
                    </li>
                  ))}
                  {exclusions.slice(0, 30).map((exclusion, index) => (
                    <li key={`exclusion-${index}`}>
                      {exclusion.reason}: {exclusion.message}
                    </li>
                  ))}
                  {exclusions.length > 30 ? (
                    <li>{exclusions.length - 30} more exclusions not shown.</li>
                  ) : null}
                </ul>
              )}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
