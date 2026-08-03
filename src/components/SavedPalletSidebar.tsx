"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { SavedPallet } from "~/lib/palletTypes";

type SavedPalletSidebarProps = {
  saved: SavedPallet[];
  selectedId: string | null;
  hasUnsavedEdits: boolean;
  onSelect: (pallet: SavedPallet) => void;
  onDelete: (id: string) => Promise<boolean>;
  onClear: () => Promise<boolean>;
};

export function SavedPalletSidebar({
  saved,
  selectedId,
  hasUnsavedEdits,
  onSelect,
  onDelete,
  onClear,
}: SavedPalletSidebarProps) {
  const [filterL, setFilterL] = useState("");
  const [filterW, setFilterW] = useState("");
  const [filterH, setFilterH] = useState("");

  const filteredSaved = useMemo(() => {
    const l = filterL.trim() === "" ? null : Number(filterL);
    const w = filterW.trim() === "" ? null : Number(filterW);
    const h = filterH.trim() === "" ? null : Number(filterH);
    return saved.filter((pallet) => {
      const { length, width, height } = pallet.data.package;
      const matchL = l === null || width === l;
      const matchW = w === null || length === w;
      const matchH = h === null || height === h;
      return matchL && matchW && matchH;
    });
  }, [filterH, filterL, filterW, saved]);

  const clearAll = async (event: MouseEvent<HTMLButtonElement>) => {
    const allow = event.ctrlKey || window.confirm("Clear all saved pallets?");
    if (allow) await onClear();
  };

  return (
    <aside className="order-2 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-1 xl:w-[240px] xl:shrink-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-semibold text-cyan-200">Saved Pallets</h2>
        {saved.length > 0 && (
          <button
            onClick={(event) => void clearAll(event)}
            className="cursor-pointer rounded border border-cyan-500/20 bg-transparent px-2 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
          >
            Clear All
          </button>
        )}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <input
          value={filterL}
          onChange={(event) => setFilterL(event.target.value)}
          inputMode="numeric"
          placeholder="L"
          aria-label="Filter length"
          className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
        />
        <input
          value={filterW}
          onChange={(event) => setFilterW(event.target.value)}
          inputMode="numeric"
          placeholder="W"
          aria-label="Filter width"
          className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
        />
        <input
          value={filterH}
          onChange={(event) => setFilterH(event.target.value)}
          inputMode="numeric"
          placeholder="H"
          aria-label="Filter height"
          className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:ring-0 focus:outline-none"
        />
        <button
          onClick={() => {
            setFilterL("");
            setFilterW("");
            setFilterH("");
          }}
          className="col-span-2 cursor-pointer rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-200 transition hover:border-cyan-400/40 hover:bg-slate-900/50 sm:col-span-3"
        >
          Reset Filters
        </button>
      </div>
      <div className="scrollbar-thin flex max-h-[70vh] flex-col gap-1 overflow-auto pr-1">
        {filteredSaved.length === 0 && (
          <div className="text-slate-400">No saved pallets yet.</div>
        )}
        {filteredSaved.map((pallet) => (
          <div
            key={pallet.id}
            className={`group flex items-start justify-between gap-2 rounded border px-3 py-2 transition ${
              pallet.id === selectedId
                ? "border-cyan-400/60 bg-cyan-500/10 shadow-lg shadow-cyan-500/20"
                : "border-cyan-500/10 bg-slate-900/50 hover:border-cyan-400/40 hover:bg-slate-900/70"
            }`}
          >
            <button
              className="flex min-w-0 flex-1 cursor-pointer flex-col text-left"
              onClick={() => {
                if (
                  pallet.id !== selectedId &&
                  hasUnsavedEdits &&
                  !window.confirm("Switch plans and discard unsaved changes?")
                ) {
                  return;
                }
                onSelect(pallet);
              }}
            >
              <span className="truncate text-slate-100">{pallet.name}</span>
              <span className="text-xs text-slate-400">
                {pallet.data.layer_count} layers x {pallet.data.total_boxes}{" "}
                boxes
              </span>
            </button>
            <button
              aria-label="Delete"
              className="cursor-pointer rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-200 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-rose-500/25"
              onClick={(event) => {
                const allow =
                  event.ctrlKey || window.confirm(`Delete "${pallet.name}"?`);
                if (allow) void onDelete(pallet.id);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
