"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { PalletData } from "~/domain/palletTypes";
import type { SolverCandidate } from "~/domain/solver";
import { candidateRankReason } from "~/features/candidates/candidateListModel";
import {
  type ValidationLedgerRow,
  type ValidationStatus,
} from "~/features/planning-case/planningCaseModel";

export function PlanningCandidateIndex({
  candidates,
  selectedCandidateId,
  onSelect,
  maximumRows = 32,
}: {
  candidates: readonly SolverCandidate[];
  selectedCandidateId: string | null;
  onSelect: (candidateId: string) => void;
  maximumRows?: number;
}) {
  const rowLimit = Math.max(0, maximumRows);
  const topRows = candidates.slice(0, rowLimit);
  const selectedCandidate = candidates.find(
    ({ id }) => id === selectedCandidateId,
  );
  const selectedOutsideTopRows = Boolean(
    selectedCandidate &&
      rowLimit > 0 &&
      !topRows.some(({ id }) => id === selectedCandidate.id),
  );
  const rows = selectedOutsideTopRows
    ? [...topRows.slice(0, rowLimit - 1), selectedCandidate!]
    : topRows;
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const selectedRowIndex = rows.findIndex(
    ({ id }) => id === selectedCandidateId,
  );
  const tabStopIndex = selectedRowIndex >= 0 ? selectedRowIndex : 0;
  const positionByCandidateId = new Map(
    candidates.map(({ id }, index) => [id, index + 1]),
  );
  const selectedPosition = selectedCandidateId
    ? (positionByCandidateId.get(selectedCandidateId) ?? null)
    : null;
  const followingCandidate =
    selectedPosition !== null && selectedPosition < candidates.length
      ? candidates[selectedPosition]
      : null;
  const selectedRankReason = selectedCandidate
    ? candidateRankReason(selectedCandidate, followingCandidate ?? null)
    : null;

  const selectAt = (index: number) => {
    const candidate = rows[index];
    if (!candidate) return;
    onSelect(candidate.id);
    const row = rowRefs.current.get(candidate.id);
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const onCandidateKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        nextIndex = Math.min(rows.length - 1, index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        nextIndex = Math.max(0, index - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectAt(index);
        return;
      default:
        return;
    }

    event.preventDefault();
    selectAt(nextIndex);
  };

  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--line)]">
      <div>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-2.5 py-2">
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">
            Candidate layouts
          </h3>
          <span className="font-mono text-[11px] text-[var(--muted)]">
            {rows.length}/{candidates.length}
          </span>
        </header>
        {selectedCandidate && selectedRankReason ? (
          <p
            aria-live="polite"
            className="border-b border-[var(--line)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--muted)]"
          >
            <span className="font-semibold text-[var(--ink)]">
              #{selectedCandidate.rank}
              {followingCandidate
                ? ` ahead of #${followingCandidate.rank}`
                : ""}
              :
            </span>{" "}
            {selectedRankReason}
          </p>
        ) : null}
      </div>
      <div
        role="listbox"
        aria-label="Generated pattern layouts"
        className="scrollbar-thin min-h-0 overflow-auto"
      >
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[var(--surface)] text-left text-[11px] text-[var(--muted)]">
            <tr className="border-b border-[var(--line)]">
              <th className="px-2 py-1.5 font-medium">Rank</th>
              <th className="px-2 py-1.5 font-medium">Pkgs</th>
              <th className="px-2 py-1.5 text-right font-medium">Util</th>
              <th className="px-2 py-1.5 text-right font-medium">Cycles</th>
              <th className="px-2 py-1.5 font-medium">Geometry</th>
              <th className="px-2 py-1.5 text-right font-medium">Bounds mm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((candidate, index) => {
              const selected = candidate.id === selectedCandidateId;
              return (
                <tr
                  key={candidate.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(candidate.id, node);
                    else rowRefs.current.delete(candidate.id);
                  }}
                  role="option"
                  aria-selected={selected}
                  aria-posinset={positionByCandidateId.get(candidate.id)}
                  aria-setsize={candidates.length}
                  tabIndex={index === tabStopIndex ? 0 : -1}
                  onClick={() => selectAt(index)}
                  onKeyDown={(event) => onCandidateKeyDown(event, index)}
                  className={`cursor-pointer border-b border-[var(--line)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset ${
                    selected
                      ? "border-l-2 border-l-[var(--brand)] bg-[var(--plan-fill)] text-[var(--ink)]"
                      : "border-l-2 border-l-transparent text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono">#{candidate.rank}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {candidate.metrics.packageCount}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {candidate.metrics.utilizationPercent.toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {candidate.metrics.provisionalCycleCount}
                  </td>
                  <td className="px-2 py-1.5">
                    {candidate.validation.valid ? "Geometry OK" : "Rejected"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[var(--muted)]">
                    {candidate.metrics.boundingBlockLengthMm} ×{" "}
                    {candidate.metrics.boundingBlockWidthMm}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-3 text-xs leading-5 text-[var(--muted)]">
            Generate patterns to populate the candidate layouts.
          </p>
        ) : null}
        {candidates.length > rowLimit ? (
          <p className="border-t border-[var(--line)] p-2 text-[10px] text-[var(--muted)]">
            {selectedOutsideTopRows
              ? `Showing the selected candidate with the first ${Math.max(0, rowLimit - 1)} ranked candidates.`
              : `Showing the first ${rowLimit} ranked candidates.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}

const statusSymbol: Record<ValidationStatus, string> = {
  PASS: "■",
  FAIL: "×",
  BLOCKED: "□",
  OBSERVED: "◇",
  SKIPPED: "–",
};

const statusClass: Record<ValidationStatus, string> = {
  PASS: "text-[var(--inspection-pass)]",
  FAIL: "text-[var(--inspection-fail)]",
  BLOCKED: "text-[var(--muted)]",
  OBSERVED: "text-[var(--measure)]",
  SKIPPED: "text-[var(--muted)]",
};

export function ValidationLedger({ rows }: { rows: ValidationLedgerRow[] }) {
  return (
    <aside
      aria-label="Inspection ledger"
      className="planning-ledger app-chrome grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--line)] bg-[var(--surface)]"
    >
      <header className="border-b border-[var(--line)] px-3 py-2">
        <h2 className="text-[13px] font-semibold text-[var(--ink)]">
          Inspection ledger
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          G generated · O observed · ? unknown
        </p>
      </header>
      <div className="scrollbar-thin min-h-0 overflow-auto">
        {rows.map((row) => (
          <details
            key={row.id}
            className="group border-b border-[var(--line)] last:border-b-0"
          >
            <summary className="grid cursor-pointer list-none grid-cols-[12px_68px_18px_minmax(0,1fr)] items-start gap-1.5 px-2.5 py-2 text-[11px] marker:hidden hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none">
              <span
                aria-hidden="true"
                className={`font-mono ${statusClass[row.status]}`}
              >
                {statusSymbol[row.status]}
              </span>
              <span
                className={`font-mono font-semibold ${statusClass[row.status]}`}
              >
                {row.status}
              </span>
              <span className="font-mono text-[var(--muted)]">
                {row.evidence}
              </span>
              <span>
                <strong className="block font-semibold text-[var(--ink)]">
                  {row.label}
                </strong>
                <span className="mt-0.5 block leading-4 text-[var(--muted)]">
                  {row.claim}
                </span>
              </span>
            </summary>
            {row.detail ? (
              <p className="border-t border-[var(--line)] bg-[var(--canvas)] px-3 py-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-[var(--muted)]">
                {row.detail}
              </p>
            ) : null}
          </details>
        ))}
      </div>
    </aside>
  );
}

type LayerStripItem = {
  id: string;
  label: string;
  pattern: string;
  sheetBefore: boolean;
};

function sourceStrip(data: PalletData | null): LayerStripItem[] {
  return (
    data?.layers.map((layer, index) => ({
      id: `reference-${index + 1}`,
      label: `L${String(index + 1).padStart(2, "0")}`,
      pattern: `P${layer.unique_layer_id}`,
      sheetBefore: layer.zwischenlage > 0,
    })) ?? []
  );
}

function currentStrip(data: PalletData | null): LayerStripItem[] {
  return (
    data?.layers.map((layer, index) => ({
      id: data.planner?.layers[index]?.id ?? `current-${index + 1}`,
      label: `L${String(index + 1).padStart(2, "0")}`,
      pattern:
        data.planner?.layers[index]?.patternRef ?? `P${layer.unique_layer_id}`,
      sheetBefore: layer.zwischenlage > 0,
    })) ?? []
  );
}

function StripRow({
  label,
  items,
  selectedIndex,
  onSelect,
}: {
  label: string;
  items: LayerStripItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] border-b border-[var(--line)] last:border-b-0">
      <div className="flex items-center border-r border-[var(--line)] px-2 text-[11px] font-semibold text-[var(--muted)]">
        {label}
      </div>
      <div className="scrollbar-thin flex min-w-0 overflow-x-auto">
        {items.length === 0 ? (
          <span className="px-3 py-2 text-[10px] text-[var(--muted)]">
            No layer sequence
          </span>
        ) : (
          items.map((item, index) => (
            <div key={item.id} className="flex shrink-0 items-stretch">
              {item.sheetBefore ? (
                <span
                  className="w-1 bg-[repeating-linear-gradient(45deg,var(--accent)_0,var(--accent)_1px,transparent_1px,transparent_3px)]"
                  title="Interlayer before"
                />
              ) : null}
              <button
                type="button"
                title={`${item.label} · ${item.pattern}`}
                onClick={() => onSelect(index)}
                className={`min-w-14 border-r border-[var(--line)] px-2 py-1 text-left font-mono text-[9px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-inset ${
                  selectedIndex === index
                    ? "bg-[var(--plan-fill)] text-[var(--brand)]"
                    : "text-[var(--ink)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <span className="block">{item.label}</span>
                <span className="block max-w-24 truncate text-[var(--muted)]">
                  {item.pattern}
                </span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LayerStrips({
  reference,
  current,
  referenceLayerIndex,
  currentLayerIndex,
  onReferenceLayerChange,
  onCurrentLayerChange,
}: {
  reference: PalletData | null;
  current: PalletData | null;
  referenceLayerIndex: number;
  currentLayerIndex: number;
  onReferenceLayerChange: (index: number) => void;
  onCurrentLayerChange: (index: number) => void;
}) {
  return (
    <section
      aria-label="Layer sequences"
      className="app-chrome border border-[var(--line)] bg-[var(--surface)]"
    >
      {reference ? (
        <StripRow
          label="Reference"
          items={sourceStrip(reference)}
          selectedIndex={referenceLayerIndex}
          onSelect={onReferenceLayerChange}
        />
      ) : null}
      <StripRow
        label="Layers"
        items={currentStrip(current)}
        selectedIndex={currentLayerIndex}
        onSelect={onCurrentLayerChange}
      />
    </section>
  );
}

export function CaseDrawer({
  open,
  title,
  width = "wide",
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  width?: "narrow" | "wide";
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  const narrow = width === "narrow";
  return (
    <div
      className={`fixed inset-0 z-40 flex ${narrow ? "justify-end bg-black/70" : ""}`}
      role="presentation"
    >
      {narrow ? (
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          className="min-w-8 flex-1 cursor-default"
        />
      ) : null}
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`grid h-full min-w-0 grid-rows-[44px_minmax(0,1fr)] bg-[var(--surface)] ${
          narrow
            ? "w-[min(420px,calc(100vw-32px))] border-l border-[var(--line)] shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
            : "w-full"
        }`}
      >
        <header className="app-chrome flex items-center border-b border-[var(--line)] px-3">
          <h2 className="mr-auto text-[13px] font-semibold text-[var(--ink)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ui-btn h-7 px-2 text-[11px]"
          >
            Close
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 overflow-auto">{children}</div>
      </section>
    </div>
  );
}
