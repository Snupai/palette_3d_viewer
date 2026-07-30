"use client";

import { useState } from "react";

type LayerSliderProps = {
  layerCount: number;
  value: number;
  onChange: (layer: number) => void;
};

/** Vertical push distance so neighbors make room for the hovered tick. */
function pushOffset(index: number, hoveredIndex: number | null): number {
  if (hoveredIndex === null) return 0;
  const delta = index - hoveredIndex;
  if (delta === 0) return 0;
  const sign = delta > 0 ? 1 : -1;
  const dist = Math.abs(delta);
  if (dist === 1) return sign * 4;
  if (dist === 2) return sign * 2;
  return 0;
}

/**
 * ChatGPT-style conversation timeline / prompt navigation rail.
 * Selecting N shows layers 1..N (from bottom); layers above are hidden.
 */
export function LayerSlider({ layerCount, value, onChange }: LayerSliderProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (layerCount <= 0) return null;

  const clamped = Math.min(Math.max(1, value), layerCount);

  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center gap-2 self-center"
      role="slider"
      aria-label="Visible layers"
      aria-valuemin={1}
      aria-valuemax={layerCount}
      aria-valuenow={clamped}
      aria-valuetext={`Layer ${clamped} of ${layerCount}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(Math.min(layerCount, clamped + 1));
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(Math.max(1, clamped - 1));
        } else if (e.key === "Home") {
          e.preventDefault();
          onChange(1);
        } else if (e.key === "End") {
          e.preventDefault();
          onChange(layerCount);
        }
      }}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      {/* py leaves room so pushed-away edge ticks stay inside the clip box */}
      <div className="max-h-[60lvh] w-9 overflow-clip">
        <div className="flex flex-col items-center gap-1.5 py-2">
          {Array.from({ length: layerCount }, (_, i) => {
            const layerFromBottom = layerCount - i;
            const active = layerFromBottom === clamped;
            const included = layerFromBottom <= clamped;
            const hovered = hoveredIndex === i;
            return (
              <button
                key={layerFromBottom}
                type="button"
                aria-label={`Layer ${layerFromBottom}`}
                data-toc-item-index={i}
                data-toc-active={active ? "" : undefined}
                onClick={() => onChange(layerFromBottom)}
                onMouseEnter={() => setHoveredIndex(i)}
                style={{ transform: `translateY(${pushOffset(i, hoveredIndex)}px)` }}
                // ::before widens the hit area past the layout box, keeping ticks tightly spaced
                className="relative flex w-9 shrink-0 cursor-pointer items-center justify-center py-0.5 transition-transform duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-['']"
              >
                <span
                  className={`shrink-0 rounded-full transition-all duration-150 ease-out ${
                    hovered ? "h-[3px] w-7" : "h-0.5 w-4.5"
                  } ${
                    active
                      ? "bg-cyan-300 shadow-[0_0_6px_rgba(103,232,249,0.6)]"
                      : hovered
                      ? "bg-cyan-200"
                      : included
                      ? "bg-cyan-400/45"
                      : "bg-slate-600/80"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
      <span className="font-mono text-[10px] tabular-nums text-cyan-200/70">
        {clamped}/{layerCount}
      </span>
    </div>
  );
}
