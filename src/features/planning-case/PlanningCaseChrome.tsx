"use client";

import type { ReactNode } from "react";
import type { PalletData } from "~/domain/palletTypes";
import type { SolverCandidate } from "~/domain/solver";
import {
  PLANNING_STAGES,
  type PlanningStage,
  type ValidationLedgerRow,
  type ValidationStatus,
} from "~/features/planning-case/planningCaseModel";

export function PlanningWorkflowNav({
  activeStage,
  onChange,
}: {
  activeStage: PlanningStage;
  onChange: (stage: PlanningStage) => void;
}) {
  return (
    <nav
      aria-label="Planning workflow"
      className="app-chrome grid grid-cols-3 border-b border-[var(--steel-rule)] bg-[var(--graphite-surface)] md:grid-cols-6"
    >
      {PLANNING_STAGES.map(([stage, label], index) => {
        const active = stage === activeStage;
        return (
          <button
            key={stage}
            type="button"
            aria-current={active ? "step" : undefined}
            onClick={() => onChange(stage)}
            className={`group relative flex min-h-10 items-center gap-2 border-r border-[var(--steel-rule)] px-3 text-left text-[11px] font-semibold tracking-[0.08em] uppercase outline-none last:border-r-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:ring-inset ${
              active
                ? "bg-[var(--deck-black)] text-[var(--chalk-text)]"
                : "text-[var(--muted-text)] hover:bg-[#1A2024] hover:text-[var(--chalk-text)]"
            }`}
          >
            <span
              className={`font-mono ${active ? "text-[var(--selection-amber)]" : "text-[#68747C]"}`}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{label}</span>
            {active ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--selection-amber)]" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

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
  const rows = candidates.slice(0, maximumRows);
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--steel-rule)]">
      <header className="flex items-center justify-between border-b border-[var(--steel-rule)] px-2.5 py-2">
        <h3 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
          Candidate index
        </h3>
        <span className="font-mono text-[10px] text-[var(--muted-text)]">
          {rows.length}/{candidates.length}
        </span>
      </header>
      <div
        role="listbox"
        aria-label="Generated pattern candidates"
        className="scrollbar-thin min-h-0 overflow-auto"
      >
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[var(--graphite-surface)] text-left text-[10px] tracking-wide text-[var(--muted-text)] uppercase">
            <tr className="border-b border-[var(--steel-rule)]">
              <th className="px-2 py-1.5 font-medium">Rank</th>
              <th className="px-2 py-1.5 font-medium">Pkgs</th>
              <th className="px-2 py-1.5 font-medium">Geometry</th>
              <th className="px-2 py-1.5 text-right font-medium">Bounds mm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((candidate) => {
              const selected = candidate.id === selectedCandidateId;
              return (
                <tr
                  key={candidate.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => onSelect(candidate.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(candidate.id);
                    }
                  }}
                  className={`cursor-default border-b border-[var(--steel-rule)]/70 outline-none focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:ring-inset ${
                    selected
                      ? "border-l-2 border-l-[var(--selection-amber)] bg-[rgba(214,166,74,0.1)] text-[var(--chalk-text)]"
                      : "border-l-2 border-l-transparent text-[#AEB7BD] hover:bg-[#1A2024]"
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono">#{candidate.rank}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {candidate.metrics.packageCount}
                  </td>
                  <td className="px-2 py-1.5">
                    {candidate.validation.valid ? "Geometry OK" : "Rejected"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-[var(--muted-text)]">
                    {candidate.metrics.boundingBlockLengthMm} ×{" "}
                    {candidate.metrics.boundingBlockWidthMm}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-3 text-xs leading-5 text-[var(--muted-text)]">
            Generate patterns to populate the candidate index.
          </p>
        ) : null}
        {candidates.length > maximumRows ? (
          <p className="border-t border-[var(--steel-rule)] p-2 text-[10px] text-[var(--muted-text)]">
            Showing the first {maximumRows} ranked candidates. Full diagnostics
            remain available in production tools.
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
  BLOCKED: "text-[#89949B]",
  OBSERVED: "text-[var(--measured-blue)]",
  SKIPPED: "text-[#68747C]",
};

export function ValidationLedger({ rows }: { rows: ValidationLedgerRow[] }) {
  return (
    <aside
      aria-label="Inspection ledger"
      className="planning-ledger app-chrome grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--steel-rule)] bg-[var(--graphite-surface)]"
    >
      <header className="border-b border-[var(--steel-rule)] px-3 py-2">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-[var(--chalk-text)] uppercase">
          Inspection ledger
        </h2>
        <p className="mt-0.5 text-[10px] text-[var(--muted-text)]">
          G generated · O observed · ? unknown
        </p>
      </header>
      <div className="scrollbar-thin min-h-0 overflow-auto">
        {rows.map((row) => (
          <details
            key={row.id}
            className="group border-b border-[var(--steel-rule)] last:border-b-0"
          >
            <summary className="grid cursor-pointer list-none grid-cols-[12px_68px_18px_minmax(0,1fr)] items-start gap-1.5 px-2.5 py-2 text-[10px] marker:hidden hover:bg-[#1A2024] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:outline-none">
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
              <span className="font-mono text-[var(--muted-text)]">
                {row.evidence}
              </span>
              <span>
                <strong className="block font-semibold text-[#C5CDD2]">
                  {row.label}
                </strong>
                <span className="mt-0.5 block leading-4 text-[var(--muted-text)]">
                  {row.claim}
                </span>
              </span>
            </summary>
            {row.detail ? (
              <p className="border-t border-[var(--steel-rule)] bg-[var(--deck-black)] px-3 py-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-[#AEB7BD]">
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
    <div className="grid grid-cols-[76px_minmax(0,1fr)] border-b border-[var(--steel-rule)] last:border-b-0">
      <div className="flex items-center border-r border-[var(--steel-rule)] px-2 text-[10px] font-semibold tracking-[0.1em] text-[var(--muted-text)] uppercase">
        {label}
      </div>
      <div className="scrollbar-thin flex min-w-0 overflow-x-auto">
        {items.length === 0 ? (
          <span className="px-3 py-2 text-[10px] text-[#68747C]">
            No layer sequence
          </span>
        ) : (
          items.map((item, index) => (
            <div key={item.id} className="flex shrink-0 items-stretch">
              {item.sheetBefore ? (
                <span
                  className="w-1 bg-[repeating-linear-gradient(45deg,#65A9C3_0,#65A9C3_1px,transparent_1px,transparent_3px)]"
                  title="Interlayer before"
                />
              ) : null}
              <button
                type="button"
                title={`${item.label} · ${item.pattern}`}
                onClick={() => onSelect(index)}
                className={`min-w-14 border-r border-[var(--steel-rule)] px-2 py-1 text-left font-mono text-[9px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:ring-inset ${
                  selectedIndex === index
                    ? "bg-[rgba(214,166,74,0.13)] text-[var(--selection-amber)]"
                    : "text-[#9DA8AF] hover:bg-[#1A2024]"
                }`}
              >
                <span className="block">{item.label}</span>
                <span className="block max-w-24 truncate text-[#68747C]">
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
      className="app-chrome border border-[var(--steel-rule)] bg-[var(--graphite-surface)]"
    >
      <StripRow
        label="Reference"
        items={sourceStrip(reference)}
        selectedIndex={referenceLayerIndex}
        onSelect={onReferenceLayerChange}
      />
      <StripRow
        label="Current"
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
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70"
      role="presentation"
    >
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="min-w-8 flex-1 cursor-default"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`grid h-full min-w-0 grid-rows-[44px_minmax(0,1fr)] border-l border-[var(--steel-rule)] bg-[var(--graphite-surface)] shadow-2xl ${
          width === "narrow"
            ? "w-[min(420px,calc(100vw-32px))]"
            : "w-[min(1180px,calc(100vw-32px))]"
        }`}
      >
        <header className="app-chrome flex items-center border-b border-[var(--steel-rule)] px-3">
          <h2 className="mr-auto text-xs font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 border border-[var(--steel-rule)] px-2 text-[11px] text-[var(--muted-text)] hover:bg-[#1A2024] hover:text-[var(--chalk-text)] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:outline-none"
          >
            Close
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 overflow-auto">{children}</div>
      </section>
    </div>
  );
}
