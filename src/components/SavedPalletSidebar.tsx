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
    <aside className="border-line bg-surface text-body order-2 w-full border p-4 md:min-w-0 md:flex-1 xl:order-1 xl:w-[240px] xl:shrink-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-body text-ink font-semibold">Saved Pallets</h2>
        {saved.length > 0 && (
          <button
            onClick={(event) => void clearAll(event)}
            className="ui-btn ui-btn-sm"
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
          className="ui-input text-micro placeholder:text-muted px-2 py-1 font-mono"
        />
        <input
          value={filterW}
          onChange={(event) => setFilterW(event.target.value)}
          inputMode="numeric"
          placeholder="W"
          aria-label="Filter width"
          className="ui-input text-micro placeholder:text-muted px-2 py-1 font-mono"
        />
        <input
          value={filterH}
          onChange={(event) => setFilterH(event.target.value)}
          inputMode="numeric"
          placeholder="H"
          aria-label="Filter height"
          className="ui-input text-micro placeholder:text-muted px-2 py-1 font-mono"
        />
        <button
          onClick={() => {
            setFilterL("");
            setFilterW("");
            setFilterH("");
          }}
          className="ui-btn ui-btn-sm col-span-2 sm:col-span-3"
        >
          Reset Filters
        </button>
      </div>
      <div className="flex max-h-[70vh] scrollbar-thin flex-col gap-1 overflow-auto pr-1">
        {filteredSaved.length === 0 && (
          <div className="text-muted">No saved pallets yet.</div>
        )}
        {filteredSaved.map((pallet) => (
          <div
            key={pallet.id}
            className={`group flex items-start justify-between gap-2 border px-3 py-2 transition-colors ${
              pallet.id === selectedId
                ? "border-brand bg-plan-fill"
                : "hover:bg-surface-hover border-transparent"
            }`}
          >
            <button
              className="flex min-w-0 flex-1 flex-col text-left"
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
              <span className="text-ink truncate">{pallet.name}</span>
              <span className="text-micro text-muted font-mono">
                {pallet.data.layer_count} layers x {pallet.data.total_boxes}{" "}
                boxes
              </span>
            </button>
            <button
              aria-label="Delete"
              className="text-micro text-danger hover:bg-danger/10 px-2 py-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
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
