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
import { useT } from "~/i18n";
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
  const t = useT();
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
    <section className="border-line bg-surface grid min-h-0 grid-rows-[auto_minmax(240px,1fr)_auto] border">
      <header className="border-line flex flex-wrap items-end gap-2 border-b p-3">
        <div className="mr-auto">
          <h2 className="text-body text-ink font-semibold">
            {t("candidates.browser.title")}
          </h2>
          <p className="text-micro text-muted" aria-live="polite">
            {t("candidates.browser.summary", {
              shown: filteredCandidates.length,
              total: candidates.length,
              generated: generatedCandidateCount,
            })}
          </p>
        </div>
        <label className="text-micro text-muted grid gap-1">
          {t("candidates.browser.exactCount")}
          <input
            type="number"
            min="0"
            step="1"
            value={exactCount}
            disabled={maximumOnly}
            onChange={(event) => setExactCount(event.target.value)}
            aria-label={t("candidates.browser.exactCountAria")}
            className="ui-input text-micro w-24 px-2 py-1.5 font-mono"
          />
        </label>
        <label className="border-line text-micro text-ink flex h-8 cursor-pointer items-center gap-2 border px-2.5">
          <input
            type="checkbox"
            checked={maximumOnly}
            onChange={(event) => setMaximumOnly(event.target.checked)}
            className="accent-brand h-4 w-4"
          />
          {t("candidates.browser.maximum", { count: maximumCount })}
        </label>
        <button
          type="button"
          onClick={() => {
            setExactCount("");
            setMaximumOnly(false);
          }}
          className="ui-btn text-micro"
        >
          {t("candidates.browser.resetFilters")}
        </button>
      </header>

      <div
        ref={listboxRef}
        role="listbox"
        aria-label={t("candidates.browser.listAria")}
        aria-activedescendant={
          selectedCandidateId ? optionId(selectedCandidateId) : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="focus-visible:ring-focus scrollbar-thin min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <table
          role="presentation"
          className="ui-table text-micro min-w-[650px]"
        >
          <thead className="text-muted text-left">
            <tr>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colNr")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colCount")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colGeometry")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colBlocks")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colCycles")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colLength")}
              </th>
              <th className="px-2 py-2 font-medium">
                {t("candidates.browser.colWidth")}
              </th>
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
                  className="cursor-pointer"
                >
                  <td className="px-2 py-2 font-mono">{candidate.rank}</td>
                  <td className="px-2 py-2 font-mono">
                    {candidate.metrics.packageCount}
                  </td>
                  <td className="px-2 py-2">
                    {candidate.validation.valid
                      ? t("candidates.browser.geometryOk")
                      : t("candidates.browser.rejected")}
                  </td>
                  <td
                    className="text-muted px-2 py-2"
                    title={t("candidates.browser.blocksTitle")}
                  >
                    {t("candidates.browser.unknown")}
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
          <p className="text-body text-muted p-4">
            {t("candidates.browser.noMatch")}
          </p>
        ) : null}
      </div>

      <div className="border-line grid gap-3 border-t p-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="border-line bg-canvas min-h-[160px] overflow-hidden border p-2">
          {selectedPreview ? (
            <LayerPattern
              preview={selectedPreview}
              showGroupLabels={false}
              className="h-full min-h-[144px] w-full"
            />
          ) : (
            <div className="text-micro text-muted flex h-full min-h-[144px] items-center justify-center">
              {t("candidates.browser.selectCandidate")}
            </div>
          )}
        </div>
        <div className="text-micro text-muted min-w-0">
          {selectedCandidate ? (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt>{t("candidates.browser.score")}</dt>
              <dd className="text-ink font-mono">
                {selectedCandidate.score.value}
              </dd>
              <dt>{t("candidates.browser.utilization")}</dt>
              <dd className="text-ink font-mono">
                {selectedCandidate.metrics.utilizationPercent.toFixed(2)}%
              </dd>
              <dt>{t("candidates.browser.colGeometry")}</dt>
              <dd
                className="text-ink truncate font-mono"
                title={selectedCandidate.geometryId}
              >
                {selectedCandidate.geometryId}
              </dd>
              <dt>{t("candidates.browser.generators")}</dt>
              <dd className="text-ink">
                {selectedCandidate.provenance
                  .map(({ family, variant }) => `${family}/${variant}`)
                  .join(", ") || t("candidates.browser.noneRecorded")}
              </dd>
            </dl>
          ) : (
            <p>{t("candidates.browser.noDiagnosticsActive")}</p>
          )}
          <details className="border-line mt-3 border-t pt-2">
            <summary className="text-ink cursor-pointer">
              {t("candidates.browser.diagnosticsSummary", {
                diagnostics: diagnostics.length,
                exclusions: exclusions.length,
              })}
            </summary>
            <div className="scrollbar-thin mt-2 max-h-32 overflow-auto pr-2">
              {diagnostics.length === 0 && exclusions.length === 0 ? (
                <p className="text-muted">
                  {t("candidates.browser.noDiagnostics")}
                </p>
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
                    <li>
                      {t("candidates.browser.moreExclusions", {
                        count: exclusions.length - 30,
                      })}
                    </li>
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
