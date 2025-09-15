"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { RobViewer } from "~/components/RobViewer";
import { parseRobText } from "~/lib/robParser";

export default function HomePage() {
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReturnType<typeof parseRobText> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
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
      setData(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse .rob file");
      setData(null);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const header = useMemo(() => (
    <div className="flex w-full items-center justify-between gap-4">
      <h1 className="text-2xl font-bold">Pallet 3D Viewer (.rob)</h1>
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".rob,text/plain"
          onChange={onFileChange}
          className="cursor-pointer rounded border border-white/20 bg-white/5 px-3 py-2 text-sm"
        />
        {data && (
          <button onClick={reset} className="rounded bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
            Clear
          </button>
        )}
      </div>
    </div>
  ), [onFileChange, reset, data]);

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
            <div className="h-[70vh] flex-1 overflow-hidden rounded border border-white/10">
              <RobViewer data={data} />
            </div>
            <aside className="w-80 shrink-0 rounded border border-white/10 bg-black/20 p-3 text-sm">
              <h2 className="mb-2 text-base font-semibold">Pallet Info</h2>
              <div className="space-y-1 text-white/90">
                <div>
                  <span className="text-white/60">Layers:</span> {data.layer_count}
                </div>
                <div>
                  <span className="text-white/60">Total boxes:</span> {data.total_boxes}
                </div>
                <div className="pt-2 font-medium text-white/80">Package (W×L×H)</div>
                <div>
                  {data.package.width} × {data.package.length} × {data.package.height}
                </div>
                <div className="pt-2 font-medium text-white/80">Pallet (W×L×H)</div>
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
