"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayerSlider } from "~/components/LayerSlider";
import { RobViewer, type BoxSelection } from "~/components/RobViewer";
import { parseRobText } from "~/lib/robParser";
import { clearPallets, deletePalletById, getAllPallets, putPallets } from "~/lib/storage";

/** Re-parse from raw .rob when present so newer fields (place coords) are available. */
function resolvePalletData(entry: { data: ReturnType<typeof parseRobText>; rawText?: string }) {
  if (entry.rawText) {
    try {
      return parseRobText(entry.rawText);
    } catch {
      return entry.data;
    }
  }
  return entry.data;
}

type SavedPallet = {
  id: string;
  name: string;
  createdAt: number;
  data: ReturnType<typeof parseRobText>;
  rawText?: string;
};

const STORAGE_KEY = "saved_pallets_v1";

function rotateRobPlanBy180(rawText: string): string {
  const newline = rawText.includes("\r\n") ? "\r\n" : "\n";
  const lines = rawText.split(/\r?\n/);
  const coordinatePattern = /^(\s*-?\d+(?:\s+-?\d+){4}\s+)(-?\d+)(.*)$/;
  const rotated = lines.map((line) => {
    if (!coordinatePattern.test(line)) return line;
    return line.replace(coordinatePattern, (_full, prefix: string, rotationRaw: string, suffix: string) => {
      const rotation = Number.parseInt(rotationRaw, 10);
      if (!Number.isFinite(rotation)) return line;
      const rotatedValue = ((rotation + 180) % 360 + 360) % 360;
      return `${prefix}${rotatedValue}${suffix}`;
    });
  });
  return rotated.join(newline);
}

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReturnType<typeof parseRobText> | null>(null);
  const [saved, setSaved] = useState<SavedPallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterL, setFilterL] = useState("");
  const [filterW, setFilterW] = useState("");
  const [filterH, setFilterH] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedRawText, setSelectedRawText] = useState<string | null>(null);
  const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
  /** 1-based from bottom: show layers 1..N solid; above hidden. */
  const [visibleUpToLayer, setVisibleUpToLayer] = useState(1);

  // Load saved pallets on mount, migrating from localStorage if present
  useEffect(() => {
    void (async () => {
      try {
        const existing = await getAllPallets<ReturnType<typeof parseRobText>>();
        if (existing.length > 0) {
          setSaved(existing);
          setSelectedId(existing[0]!.id);
          setData(resolvePalletData(existing[0]!));
          setSelectedRawText(existing[0]!.rawText ?? null);
          setBoxSelection(null);
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
            setData(resolvePalletData(migrated[0]!));
            setSelectedRawText(migrated[0]!.rawText ?? null);
            setBoxSelection(null);
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
          rawText: text,
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
      setData(resolvePalletData(last));
      setSelectedRawText(last.rawText ?? null);
      setBoxSelection(null);
    }
    if (failed.length > 0) {
      setError(`Failed to parse: ${failed.join(", ")}`);
    }
  }, []);

  //

  const selectedEntry = useMemo(() => saved.find((p) => p.id === selectedId) ?? null, [saved, selectedId]);

  useEffect(() => {
    const nextRaw = selectedEntry?.rawText ?? null;
    setSelectedRawText((prev) => (prev === nextRaw ? prev : nextRaw));
  }, [selectedEntry]);

  // Reset layer slider to show all layers when pallet data changes
  useEffect(() => {
    if (data) setVisibleUpToLayer(data.layer_count);
  }, [data]);

  const triggerDownload = useCallback((filename: string, contents: string) => {
    const blob = new Blob([contents], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const onModifyPlan = useCallback(() => {
    setError(null);
    if (!data) {
      setError("Load a plan before modifying it.");
      return;
    }
    if (!selectedRawText) {
      setError("Cannot modify this plan because the original .rob text is unavailable.");
      return;
    }
    try {
      const rotatedRaw = rotateRobPlanBy180(selectedRawText);
      const baseName = selectedEntry?.name ?? "pallet.rob";
      const downloadName = baseName.toLowerCase().endsWith(".rob") ? baseName : `${baseName}.rob`;
      triggerDownload(downloadName, rotatedRaw);
    } catch (err) {
      console.error("Failed to modify plan", err);
      setError("Unable to modify the plan at this time.");
    }
  }, [data, selectedEntry, selectedRawText, triggerDownload]);

  const onDownloadOriginal = useCallback(() => {
    setError(null);
    if (!selectedRawText) {
      setError("Cannot download this plan because the original .rob text is unavailable.");
      return;
    }
    try {
      const baseName = selectedEntry?.name ?? "pallet.rob";
      const downloadName = baseName.toLowerCase().endsWith(".rob") ? baseName : `${baseName}.rob`;
      triggerDownload(downloadName, selectedRawText);
    } catch (err) {
      console.error("Failed to download original plan", err);
      setError("Unable to download the original plan at this time.");
    }
  }, [selectedEntry, selectedRawText, triggerDownload]);

  const header = useMemo(() => {
    const downloadDisabled = !selectedRawText;
    const modifyDisabled = !data || downloadDisabled;
    return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-center text-2xl font-bold text-cyan-100 sm:text-left">Pallet 3D Viewer (.rob)</h1>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
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
          className="w-full rounded bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-cyan-400 sm:w-auto"
        >
          Import .rob file(s)
        </button>
        <button
          type="button"
          onClick={onDownloadOriginal}
          disabled={downloadDisabled}
          className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
            downloadDisabled
              ? "cursor-not-allowed bg-slate-700 text-slate-400"
              : "bg-slate-200 text-slate-900 hover:bg-white"
          }`}
        >
          Download original plan
        </button>
        <button
          type="button"
          onClick={onModifyPlan}
          disabled={modifyDisabled}
          className={`w-full rounded px-4 py-2 text-sm font-semibold shadow-sm transition sm:w-auto ${
            modifyDisabled
              ? "cursor-not-allowed bg-slate-700 text-slate-400"
              : "bg-emerald-500 text-slate-900 hover:bg-emerald-400"
          }`}
        >
          Modify plan (rotate 180°)
        </button>
      </div>
    </div>
  );
  }, [data, onDownloadOriginal, onFileChange, onModifyPlan, selectedRawText]);

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
    <main className="flex min-h-screen flex-col items-stretch bg-gradient-to-b from-[#07152f] via-[#040d1d] to-[#010409] text-slate-100">
      <div className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-6 px-4 py-8">
        {header}
        {error && (
          <div className="rounded border border-red-400 bg-red-500/20 p-3 text-sm text-red-100">{error}</div>
        )}
        {!data && (
          <div className="flex flex-1 items-center justify-center rounded border border-cyan-500/10 bg-slate-900/50">
            <p className="text-center text-slate-200">Upload a .rob file to visualize the pallet</p>
          </div>
        )}
        {data && data.total_boxes === 0 && (
          <div className="flex flex-1 items-center justify-center rounded border border-yellow-400/40 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            Parsed 0 boxes. The .rob format may differ from the expected structure.
          </div>
        )}
        {data && data.total_boxes > 0 && (
          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,280px)] xl:items-start xl:gap-8">
            {/* Left: saved list */}
            <aside className="order-2 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-1 xl:w-[240px] xl:shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-cyan-200">Saved Pallets</h2>
                {saved.length > 0 && (
                  <button
                    onClick={async (e) => {
                      const allow = e.ctrlKey || window.confirm("Clear all saved pallets?");
                      if (!allow) return;
                      await clearPallets();
                      setData(null);
                      setSelectedId(null);
                      setSaved([]);
                      setSelectedRawText(null);
                      setBoxSelection(null);
                    }}
                    className="rounded border border-cyan-500/20 bg-transparent px-2 py-1 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/40 hover:bg-cyan-500/10"
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <input
                  value={filterL}
                  onChange={(e) => setFilterL(e.target.value)}
                  inputMode="numeric"
                  placeholder="L"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:outline-none focus:ring-0"
                />
                <input
                  value={filterW}
                  onChange={(e) => setFilterW(e.target.value)}
                  inputMode="numeric"
                  placeholder="W"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:outline-none focus:ring-0"
                />
                <input
                  value={filterH}
                  onChange={(e) => setFilterH(e.target.value)}
                  inputMode="numeric"
                  placeholder="H"
                  className="w-full rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-cyan-400/40 focus:outline-none focus:ring-0"
                />
                <button
                  onClick={() => { setFilterL(""); setFilterW(""); setFilterH(""); }}
                  className="col-span-2 rounded border border-cyan-500/20 bg-slate-950/30 px-2 py-1 text-xs text-slate-200 transition hover:border-cyan-400/40 hover:bg-slate-900/50 sm:col-span-3"
                >
                  Reset Filters
                </button>
              </div>
              <div className="flex max-h-[70vh] flex-col gap-1 overflow-auto pr-1 scrollbar-thin">
                {filteredSaved.length === 0 && (
                  <div className="text-slate-400">No saved pallets yet.</div>
                )}
                {filteredSaved.map((p) => (
                  <div
                    key={p.id}
                    className={`group flex items-start justify-between gap-2 rounded border px-3 py-2 transition ${
                      p.id === selectedId
                        ? "border-cyan-400/60 bg-cyan-500/10 shadow-lg shadow-cyan-500/20"
                        : "border-cyan-500/10 bg-slate-900/50 hover:border-cyan-400/40 hover:bg-slate-900/70"
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 flex-col text-left"
                      onClick={() => {
                        setSelectedId(p.id);
                        setData(resolvePalletData(p));
                        setSelectedRawText(p.rawText ?? null);
                        setBoxSelection(null);
                      }}
                    >
                      <span className="truncate text-slate-100">{p.name}</span>
                      <span className="text-xs text-slate-400">
                        {p.data.layer_count} layers x {p.data.total_boxes} boxes
                      </span>
                    </button>
                    <button
                      aria-label="Delete"
                      className="rounded bg-rose-500/15 px-2 py-1 text-xs text-rose-200 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/25"
                      onClick={async (e) => {
                        const allow = e.ctrlKey || window.confirm(`Delete "${p.name}"?`);
                        if (!allow) return;
                        await deletePalletById(p.id);
                        const next = await getAllPallets<ReturnType<typeof parseRobText>>();
                        setSaved(next);
                        if (selectedId === p.id) {
                          if (next[0]) {
                            setSelectedId(next[0].id);
                            setData(resolvePalletData(next[0]));
                            setSelectedRawText(next[0].rawText ?? null);
                            setBoxSelection(null);
                          } else {
                            setSelectedId(null);
                            setData(null);
                            setSelectedRawText(null);
                            setBoxSelection(null);
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

            {/* Center: viewer with layer rail alongside */}
            <div className="order-1 flex min-w-0 flex-1 items-stretch gap-1 xl:order-2">
              <div className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden rounded border border-cyan-500/15 bg-slate-950/70 shadow-inner shadow-cyan-500/10 sm:min-h-[420px] xl:h-[70vh]">
                <RobViewer
                  data={data}
                  visibleUpToLayer={visibleUpToLayer}
                  onBoxSelect={setBoxSelection}
                />
              </div>
              <LayerSlider
                layerCount={data.layer_count}
                value={visibleUpToLayer}
                onChange={setVisibleUpToLayer}
              />
            </div>
            {/* Right: info */}
            <aside className="order-3 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-3 xl:w-[260px] xl:shrink-0">
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Pallet Info</h2>
              <div className="space-y-2 text-slate-100">
                <div>
                  <span className="text-slate-400">Layers:</span> {data.layer_count}
                </div>
                <div>
                  <span className="text-slate-400">Total boxes:</span> {data.total_boxes}
                </div>
                <div className="pt-2 font-medium text-slate-200">Package (LxWxH)</div>
                <div>
                  {data.package.width} x {data.package.length} x {data.package.height}
                </div>
                <div className="pt-2 font-medium text-slate-200">Pallet (LxWxH)</div>
                <div>
                  {data.pallet ? (
                    <span>
                      {data.pallet.width} x {data.pallet.length} x {data.pallet.height}
                    </span>
                  ) : (
                    <span className="text-slate-500">unknown</span>
                  )}
                </div>
              </div>

              <h2 className="mb-3 mt-5 text-base font-semibold text-cyan-200">Selected Box</h2>
              {boxSelection ? (
                <div className="space-y-2 text-slate-100">
                  <div>
                    <span className="text-slate-400">Place X:</span> {boxSelection.placeX}
                  </div>
                  <div>
                    <span className="text-slate-400">Place Y:</span> {boxSelection.placeY}
                  </div>
                  <div>
                    <span className="text-slate-400">Place Z:</span> {boxSelection.placeZ}
                    <span className="text-slate-500"> (Oberkante, ohne Palette)</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Grip packages:</span> {boxSelection.numPackages}
                    {boxSelection.gripBoxCount !== boxSelection.numPackages
                      ? ` (${boxSelection.gripBoxCount} highlighted)`
                      : null}
                  </div>
                  <div>
                    <span className="text-slate-400">Rotation:</span> {boxSelection.rotation}°
                  </div>
                  <div>
                    <span className="text-slate-400">Layer (from bottom):</span>{" "}
                    {boxSelection.layerIndex + 1}
                  </div>
                  <div>
                    <span className="text-slate-400">Zwischenlage:</span>{" "}
                    {boxSelection.zwischenlage ? `yes (${boxSelection.zwischenlage})` : "no"}
                  </div>
                  <div>
                    <span className="text-slate-400">Grip #:</span> {boxSelection.blueNumber}
                  </div>
                  <div className="pt-1 text-xs text-slate-400">
                    Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Click a box to highlight its grip group and show place coordinates.</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

