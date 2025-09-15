"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RobViewer } from "~/components/RobViewer";
import { parseRobText } from "~/lib/robParser";
import { clearPallets, deletePalletById, getAllPallets, putPallets } from "~/lib/storage";

type SavedPallet = {
  id: string;
  name: string;
  createdAt: number;
  data: ReturnType<typeof parseRobText>;
};

const STORAGE_KEY = "saved_pallets_v1";

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReturnType<typeof parseRobText> | null>(null);
  const [saved, setSaved] = useState<SavedPallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterL, setFilterL] = useState("");
  const [filterW, setFilterW] = useState("");
  const [filterH, setFilterH] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved pallets on mount, migrating from localStorage if present
  useEffect(() => {
    void (async () => {
      try {
        const existing = await getAllPallets<ReturnType<typeof parseRobText>>();
        if (existing.length > 0) {
          setSaved(existing);
          setSelectedId(existing[0]!.id);
          setData(existing[0]!.data);
          return;
        }
        // Migrate from localStorage once
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as SavedPallet[];
          if (parsed.length > 0) {
            await putPallets(parsed);
            localStorage.removeItem(STORAGE_KEY);
            const migrated = await getAllPallets<ReturnType<typeof parseRobText>>();
            setSaved(migrated);
            setSelectedId(migrated[0]!.id);
            setData(migrated[0]!.data);
          }
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  //

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;
    const newEntries: SavedPallet[] = [];
    const failed: string[] = [];
    for (const file of fileList) {
      try {
        const text = await file.text();
        const parsed = parseRobText(text);
        if (process.env.NODE_ENV !== "production") {
          console.log(".rob file selected:", file.name, `(${text.length} chars)`);
          console.log("Parsed pallet:", {
            layers: parsed.layer_count,
            total_boxes: parsed.total_boxes,
            first_layer_boxes: parsed.layers[0]?.boxes.length ?? 0,
            sample_box: parsed.layers[0]?.boxes[0] ?? null,
          });
        }
        const entry: SavedPallet = {
          id: (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name ?? `Pallet ${new Date().toLocaleString()}`,
          createdAt: Date.now(),
          data: parsed,
        };
        newEntries.push(entry);
      } catch {
        failed.push(file.name);
      }
    }
    if (newEntries.length > 0) {
      await putPallets<ReturnType<typeof parseRobText>>(newEntries);
      const next = await getAllPallets<ReturnType<typeof parseRobText>>();
      setSaved(next);
      const last = newEntries[newEntries.length - 1]!;
      setSelectedId(last.id);
      setData(last.data);
    }
    if (failed.length > 0) {
      setError(`Failed to parse: ${failed.join(", ")}`);
    }
  }, []);

  //

  const header = useMemo(() => (
    <div className="flex w-full items-center justify-between gap-4">
      <h1 className="text-2xl font-bold">Pallet 3D Viewer (.rob)</h1>
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".rob,text/plain"
          multiple
          onChange={onFileChange}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          Import .rob file(s)
        </button>
      </div>
    </div>
  ), [onFileChange]);

  const filteredSaved = useMemo(() => {
    const l = filterL.trim() === "" ? null : Number(filterL);
    const w = filterW.trim() === "" ? null : Number(filterW);
    const h = filterH.trim() === "" ? null : Number(filterH);
    return saved.filter((p) => {
      const { length, width, height } = p.data.package;
      // Note: UI's L corresponds to stored width, and W corresponds to stored length
      const matchL = l === null || width === l;
      const matchW = w === null || length === w;
      const matchH = h === null || height === h;
      return matchL && matchW && matchH;
    });
  }, [saved, filterL, filterW, filterH]);

  return (
    <main className="flex min-h-screen flex-col items-stretch bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container mx-auto flex max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
        {header}
        {error && (
          <div className="rounded border border-red-400 bg-red-500/20 p-3 text-sm text-red-100">{error}</div>
        )}
        {!data && (
          <div className="flex flex-1 items-center justify-center rounded border border-white/10 bg-black/10">
            <p className="text-center text-white/80">Upload a .rob file to visualize the pallet</p>
          </div>
        )}
        {data && data.total_boxes === 0 && (
          <div className="flex flex-1 items-center justify-center rounded border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            Parsed 0 boxes. The .rob format may differ from the expected structure.
          </div>
        )}
        {data && data.total_boxes > 0 && (
          <div className="flex gap-4">
            {/* Left: saved list */}
            <aside className="w-64 shrink-0 rounded border border-white/10 bg-black/20 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold">Saved Pallets</h2>
                {saved.length > 0 && (
                  <button
                    onClick={async (e) => {
                      const allow = e.ctrlKey || window.confirm("Clear all saved pallets?");
                      if (!allow) return;
                      await clearPallets();
                      setData(null);
                      setSelectedId(null);
                      setSaved([]);
                    }}
                    className="rounded bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <input
                  value={filterL}
                  onChange={(e) => setFilterL(e.target.value)}
                  inputMode="numeric"
                  placeholder="L"
                  className="w-full rounded bg-white/5 px-2 py-1 text-xs text-white/80 placeholder-white/40 outline-none"
                />
                <input
                  value={filterW}
                  onChange={(e) => setFilterW(e.target.value)}
                  inputMode="numeric"
                  placeholder="W"
                  className="w-full rounded bg-white/5 px-2 py-1 text-xs text-white/80 placeholder-white/40 outline-none"
                />
                <input
                  value={filterH}
                  onChange={(e) => setFilterH(e.target.value)}
                  inputMode="numeric"
                  placeholder="H"
                  className="w-full rounded bg-white/5 px-2 py-1 text-xs text-white/80 placeholder-white/40 outline-none"
                />
                <button
                  onClick={() => { setFilterL(""); setFilterW(""); setFilterH(""); }}
                  className="col-span-3 rounded bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                >
                  Reset Filters
                </button>
              </div>
              <div className="flex max-h-[70vh] flex-col gap-1 overflow-auto pr-1 scrollbar-thin">
                {filteredSaved.length === 0 && (
                  <div className="text-white/60">No saved pallets yet.</div>
                )}
                {filteredSaved.map((p) => (
                  <div
                    key={p.id}
                    className={`group flex items-start justify-between gap-2 rounded border px-2 py-2 ${
                      p.id === selectedId ? "border-white/40 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() => {
                        setSelectedId(p.id);
                        setData(p.data);
                      }}
                    >
                      <span className="truncate text-white/90">{p.name}</span>
                      <span className="text-xs text-white/50">
                        {p.data.layer_count} layers · {p.data.total_boxes} boxes
                      </span>
                    </button>
                    <button
                      aria-label="Delete"
                      className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-200 opacity-0 group-hover:opacity-100 hover:bg-red-500/30"
                      onClick={async (e) => {
                        const allow = e.ctrlKey || window.confirm(`Delete "${p.name}"?`);
                        if (!allow) return;
                        await deletePalletById(p.id);
                        const next = await getAllPallets<ReturnType<typeof parseRobText>>();
                        setSaved(next);
                        if (selectedId === p.id) {
                          if (next[0]) {
                            setSelectedId(next[0].id);
                            setData(next[0].data);
                          } else {
                            setSelectedId(null);
                            setData(null);
                          }
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            {/* Center: viewer */}
            <div className="h-[70vh] flex-1 overflow-hidden rounded border border-white/10">
              <RobViewer data={data} />
            </div>
            {/* Right: info */}
            <aside className="w-80 shrink-0 rounded border border-white/10 bg-black/20 p-3 text-sm">
              <h2 className="mb-2 text-base font-semibold">Pallet Info</h2>
              <div className="space-y-1 text-white/90">
                <div>
                  <span className="text-white/60">Layers:</span> {data.layer_count}
                </div>
                <div>
                  <span className="text-white/60">Total boxes:</span> {data.total_boxes}
                </div>
                <div className="pt-2 font-medium text-white/80">Package (L×W×H)</div>
                <div>
                  {data.package.width} × {data.package.length} × {data.package.height}
                </div>
                <div className="pt-2 font-medium text-white/80">Pallet (L×W×H)</div>
                <div>
                  {data.pallet ? (
                    <span>
                      {data.pallet.width} × {data.pallet.length} × {data.pallet.height}
                    </span>
                  ) : (
                    <span className="text-white/50">unknown</span>
                  )}
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
