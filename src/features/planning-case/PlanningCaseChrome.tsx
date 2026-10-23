"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PalletData } from "~/domain/palletTypes";
import type { SolverCandidate } from "~/domain/solver";
import {
  Drawer,
  statusToneSymbol,
  statusToneText,
  toneForLedgerStatus,
} from "~/components/ui";
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
  const [expandedList, setExpandedList] = useState<{
    candidates: readonly SolverCandidate[];
    rowLimit: number;
  } | null>(null);
  const pageSize = Math.max(0, maximumRows);
  const rowLimit =
    expandedList?.candidates === candidates
      ? Math.max(pageSize, expandedList.rowLimit)
      : pageSize;
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
    <section className="border-line grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border">
      <div>
        <header className="border-line flex items-center justify-between border-b px-2.5 py-2">
          <h3 className="text-body text-ink font-semibold">
            Candidate layouts
          </h3>
          <span className="text-micro text-muted font-mono">
            {rows.length}/{candidates.length}
          </span>
        </header>
        {selectedCandidate && selectedRankReason ? (
          <p
            aria-live="polite"
            className="border-line text-micro text-muted border-b px-2.5 py-1.5 leading-4"
          >
            <span className="text-ink font-semibold">
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
        className="min-h-0 scrollbar-thin overflow-auto"
      >
        <table className="text-micro w-full border-collapse whitespace-nowrap">
          <thead className="bg-surface text-micro text-muted sticky top-0 z-10 text-left">
            <tr className="border-line border-b">
              <th className="px-2 py-1.5 font-medium">Rank</th>
              <th className="px-2 py-1.5 font-medium">Pkgs</th>
              <th className="px-2 py-1.5 text-right font-medium">Util</th>
              <th className="px-2 py-1.5 text-right font-medium">Cycles</th>
              <th className="px-1 py-1.5 text-center font-medium">
                <abbr title="Geometry check" className="no-underline">
                  Geo
                </abbr>
              </th>
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
                  className={`border-line focus-visible:ring-focus cursor-pointer border-b outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                    selected
                      ? "border-l-brand bg-plan-fill text-ink border-l-2"
                      : "text-ink hover:bg-surface-hover border-l-2 border-l-transparent"
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
                  <td
                    className="px-1 py-1.5 text-center"
                    title={
                      candidate.validation.valid ? "Geometry OK" : "Rejected"
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={`font-mono ${
                        candidate.validation.valid ? "text-ok" : "text-danger"
                      }`}
                    >
                      {candidate.validation.valid ? "■" : "×"}
                    </span>
                    <span className="sr-only">
                      {candidate.validation.valid ? "Geometry OK" : "Rejected"}
                    </span>
                  </td>
                  <td className="text-micro text-muted px-2 py-1.5 text-right font-mono">
                    {candidate.metrics.boundingBlockLengthMm} ×{" "}
                    {candidate.metrics.boundingBlockWidthMm}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="text-micro text-muted p-3 leading-5">
            Generate patterns to populate the candidate layouts.
          </p>
        ) : null}
        {candidates.length > rowLimit ? (
          <div className="border-line text-micro text-muted grid gap-2 border-t p-2">
            <p>
              {selectedOutsideTopRows
                ? `Showing the selected candidate with the first ${Math.max(0, rowLimit - 1)} ranked candidates.`
                : `Showing the first ${rowLimit} ranked candidates.`}
            </p>
            <button
              type="button"
              className="ui-btn text-micro cursor-pointer"
              onClick={() =>
                setExpandedList({
                  candidates,
                  rowLimit: Math.min(
                    candidates.length,
                    rowLimit + Math.max(1, pageSize),
                  ),
                })
              }
            >
              Show more layouts (
              {Math.min(Math.max(1, pageSize), candidates.length - rowLimit)})
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function statusSymbol(status: ValidationStatus): string {
  return statusToneSymbol[toneForLedgerStatus(status)];
}

function statusClass(status: ValidationStatus): string {
  return statusToneText[toneForLedgerStatus(status)];
}

export function ValidationLedger({ rows }: { rows: ValidationLedgerRow[] }) {
  return (
    <aside
      aria-label="Inspection ledger"
      className="planning-ledger app-chrome border-line bg-surface grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border"
    >
      <header className="border-line border-b px-3 py-2">
        <h2 className="text-body text-ink font-semibold">Inspection ledger</h2>
        <p className="text-micro text-muted mt-0.5">
          G generated · O observed · ? unknown
        </p>
      </header>
      <div className="min-h-0 scrollbar-thin overflow-auto">
        {rows.map((row) => (
          <details
            key={row.id}
            className="group border-line border-b last:border-b-0"
          >
            <summary className="text-micro hover:bg-surface-hover focus-visible:ring-focus grid cursor-pointer list-none grid-cols-[12px_68px_18px_minmax(0,1fr)] items-start gap-1.5 px-2.5 py-2 marker:hidden focus-visible:ring-2 focus-visible:outline-none">
              <span
                aria-hidden="true"
                className={`font-mono ${statusClass(row.status)}`}
              >
                {statusSymbol(row.status)}
              </span>
              <span
                className={`font-mono font-semibold ${statusClass(row.status)}`}
              >
                {row.status}
              </span>
              <span className="text-muted font-mono">{row.evidence}</span>
              <span>
                <strong className="text-ink block font-semibold">
                  {row.label}
                </strong>
                <span className="text-muted mt-0.5 block leading-4">
                  {row.claim}
                </span>
              </span>
            </summary>
            {row.detail ? (
              <p className="border-line bg-canvas text-micro text-muted border-t px-3 py-2 font-mono leading-4 whitespace-pre-wrap">
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
    <div className="border-line grid grid-cols-[76px_minmax(0,1fr)] border-b last:border-b-0">
      <div className="border-line text-micro text-muted flex items-center border-r px-2 font-semibold">
        {label}
      </div>
      <div className="flex min-w-0 scrollbar-thin overflow-x-auto">
        {items.length === 0 ? (
          <span className="text-micro text-muted px-3 py-2">
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
                className={`border-line text-micro focus-visible:ring-focus min-w-14 border-r px-2 py-1 text-left font-mono outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  selectedIndex === index
                    ? "bg-plan-fill text-brand"
                    : "text-ink hover:bg-surface-hover"
                }`}
              >
                <span className="block">{item.label}</span>
                <span className="text-muted block max-w-24 truncate">
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
      className="app-chrome border-line bg-surface border"
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
  return (
    <Drawer open={open} title={title} width={width} onClose={onClose}>
      {children}
    </Drawer>
  );
}
