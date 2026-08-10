"use client";

import { useId } from "react";
import type {
  LayerPatternPreview,
  LayerPatternPreviewItem,
} from "~/domain/layerPatternPreview";
import type { PatternComparison } from "~/features/planning-case/planningCaseModel";

export type PlanFieldMode = "overlay" | "split";

export type MeasuredPlanFieldProps = {
  reference: LayerPatternPreview | null;
  current: LayerPatternPreview | null;
  comparison: PatternComparison;
  mode: PlanFieldMode;
  referenceLabel?: string;
  currentLabel?: string;
};

type DrawingBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function unionDrawingBounds(
  current: DrawingBounds,
  next: DrawingBounds,
): DrawingBounds {
  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

function drawingBounds(
  reference: LayerPatternPreview | null,
  current: LayerPatternPreview | null,
): DrawingBounds {
  let bounds: DrawingBounds | null = null;
  for (const preview of [reference, current]) {
    if (!preview) continue;
    const frames = [
      preview.palletBoundsMm,
      preview.effectiveEnvelopeMm,
      preview.generationBoundsMm,
    ].filter((entry): entry is DrawingBounds => entry !== undefined);
    for (const frame of frames) {
      bounds = bounds ? unionDrawingBounds(bounds, frame) : { ...frame };
    }
    for (const item of preview.items) {
      const itemBounds = {
        minX: item.centerMm.x - item.sizeMm.x / 2,
        minY: item.centerMm.y - item.sizeMm.y / 2,
        maxX: item.centerMm.x + item.sizeMm.x / 2,
        maxY: item.centerMm.y + item.sizeMm.y / 2,
      };
      bounds = bounds ? unionDrawingBounds(bounds, itemBounds) : itemBounds;
    }
  }
  return bounds ?? { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
}

function tickStep(span: number): {
  minor: number;
  major: number;
  label: number;
} {
  if (span <= 500) return { minor: 10, major: 50, label: 100 };
  if (span <= 1000) return { minor: 20, major: 100, label: 200 };
  return { minor: 50, major: 100, label: 200 };
}

function ticks(minimum: number, maximum: number, step: number): number[] {
  const first = Math.ceil(minimum / step) * step;
  const result: number[] = [];
  for (let value = first; value <= maximum; value += step) result.push(value);
  return result;
}

function itemOutsideBounds(
  item: LayerPatternPreviewItem,
  bounds: DrawingBounds,
): boolean {
  const left = item.centerMm.x - item.sizeMm.x / 2;
  const right = item.centerMm.x + item.sizeMm.x / 2;
  const bottom = item.centerMm.y - item.sizeMm.y / 2;
  const top = item.centerMm.y + item.sizeMm.y / 2;
  return (
    left < bounds.minX ||
    right > bounds.maxX ||
    bottom < bounds.minY ||
    top > bounds.maxY
  );
}

function PatternItems({
  preview,
  kind,
  toSvgY,
  bounds,
  overflowPatternId,
}: {
  preview: LayerPatternPreview;
  kind: "reference" | "current";
  toSvgY: (value: number) => number;
  bounds: DrawingBounds;
  overflowPatternId: string;
}) {
  const reference = kind === "reference";
  return (
    <g
      data-plan-layer={kind}
      aria-label={`${kind} packages: ${preview.items.length}`}
    >
      {preview.items.map((item, index) => {
        const overflow = itemOutsideBounds(item, bounds);
        return (
          <rect
            key={item.id}
            data-plan-item={item.id}
            x={item.centerMm.x - item.sizeMm.x / 2}
            y={toSvgY(item.centerMm.y) - item.sizeMm.y / 2}
            width={item.sizeMm.x}
            height={item.sizeMm.y}
            fill={
              overflow
                ? `url(#${overflowPatternId})`
                : reference
                  ? "rgba(101, 169, 195, 0.08)"
                  : "rgba(214, 166, 74, 0.22)"
            }
            stroke={reference ? "#65A9C3" : overflow ? "#D66A5E" : "#D6A64A"}
            strokeWidth={reference ? 1.5 : 1.75}
            strokeDasharray={reference ? "7 4" : undefined}
            vectorEffect="non-scaling-stroke"
          >
            <title>
              {kind} package {index + 1}: X {item.centerMm.x} mm, Y{" "}
              {item.centerMm.y} mm, {item.sizeMm.x} × {item.sizeMm.y} mm,{" "}
              {item.rotation}°
            </title>
          </rect>
        );
      })}
    </g>
  );
}

function PreviewFrames({
  preview,
  kind,
  toSvgY,
}: {
  preview: LayerPatternPreview;
  kind: "reference" | "current";
  toSvgY: (value: number) => number;
}) {
  const physical = preview.palletBoundsMm;
  const physicalStroke = kind === "reference" ? "#65A9C3" : "#7E8991";
  const frameRect = (frame: DrawingBounds, frameKind: string) => ({
    x: frame.minX,
    y: toSvgY(frame.maxY),
    width: Math.max(1, frame.maxX - frame.minX),
    height: Math.max(1, frame.maxY - frame.minY),
    "data-plan-frame": `${kind}-${frameKind}`,
  });
  return (
    <g aria-hidden="true">
      {preview.effectiveEnvelopeMm ? (
        <rect
          {...frameRect(preview.effectiveEnvelopeMm, "effective-envelope")}
          fill="none"
          stroke="#65717A"
          strokeWidth="1.25"
          strokeDasharray="8 5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {preview.generationBoundsMm ? (
        <rect
          {...frameRect(preview.generationBoundsMm, "generation-envelope")}
          fill="none"
          stroke="#D6A64A"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <rect
        {...frameRect(physical, "physical-pallet")}
        fill="rgba(20, 25, 29, 0.52)"
        stroke={physicalStroke}
        strokeWidth="1.5"
        strokeDasharray={kind === "reference" ? "7 4" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function MeasuredSvg({
  reference,
  current,
  label,
  drawingBoundsOverride,
}: {
  reference: LayerPatternPreview | null;
  current: LayerPatternPreview | null;
  label: string;
  drawingBoundsOverride?: DrawingBounds;
}) {
  const uid = useId().replace(/:/g, "");
  const bounds = drawingBoundsOverride ?? drawingBounds(reference, current);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const gutter = Math.max(56, Math.min(width, height) * 0.09);
  const rightGutter = gutter * 0.4;
  const bottomGutter = gutter * 0.72;
  const stepX = tickStep(width);
  const stepY = tickStep(height);
  const toSvgY = (value: number) => bounds.minY + bounds.maxY - value;
  const overflowPatternId = `overflow-${uid}`;
  const arrowId = `arrow-${uid}`;

  return (
    <svg
      viewBox={`${bounds.minX - gutter} ${bounds.minY - gutter} ${width + gutter + rightGutter} ${height + gutter + bottomGutter}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
      className="h-full min-h-0 w-full"
    >
      <title>{label}</title>
      <defs>
        <pattern
          id={overflowPatternId}
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="12" height="12" fill="rgba(214, 106, 94, 0.12)" />
          <line x1="0" y1="0" x2="0" y2="12" stroke="#D66A5E" strokeWidth="3" />
        </pattern>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#7E8991" />
        </marker>
      </defs>

      <rect
        x={bounds.minX - gutter}
        y={bounds.minY - gutter}
        width={width + gutter + rightGutter}
        height={height + gutter + bottomGutter}
        fill="#0B0E10"
      />
      <g aria-hidden="true">
        {ticks(bounds.minX, bounds.maxX, stepX.minor).map((x) => {
          const major = x % stepX.major === 0;
          return (
            <line
              key={`x-grid-${x}`}
              x1={x}
              y1={bounds.minY}
              x2={x}
              y2={bounds.maxY}
              stroke={major ? "#313940" : "#22292E"}
              strokeWidth={major ? 1 : 0.65}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {ticks(bounds.minY, bounds.maxY, stepY.minor).map((y) => {
          const major = y % stepY.major === 0;
          return (
            <line
              key={`y-grid-${y}`}
              x1={bounds.minX}
              y1={toSvgY(y)}
              x2={bounds.maxX}
              y2={toSvgY(y)}
              stroke={major ? "#313940" : "#22292E"}
              strokeWidth={major ? 1 : 0.65}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {reference ? (
        <PreviewFrames preview={reference} kind="reference" toSvgY={toSvgY} />
      ) : null}
      {current ? (
        <PreviewFrames preview={current} kind="current" toSvgY={toSvgY} />
      ) : null}

      {reference ? (
        <PatternItems
          preview={reference}
          kind="reference"
          toSvgY={toSvgY}
          bounds={reference.palletBoundsMm}
          overflowPatternId={overflowPatternId}
        />
      ) : null}
      {current ? (
        <PatternItems
          preview={current}
          kind="current"
          toSvgY={toSvgY}
          bounds={current.palletBoundsMm}
          overflowPatternId={overflowPatternId}
        />
      ) : null}

      <g
        aria-hidden="true"
        fill="#7E8991"
        fontFamily="var(--font-geist-mono), monospace"
      >
        {ticks(bounds.minX, bounds.maxX, stepX.label).map((x) => (
          <g key={`x-tick-${x}`}>
            <line
              x1={x}
              y1={bounds.minY - gutter * 0.3}
              x2={x}
              y2={bounds.minY}
              stroke="#7E8991"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x}
              y={bounds.minY - gutter * 0.42}
              textAnchor="middle"
              fontSize={Math.max(20, gutter * 0.28)}
            >
              {x}
            </text>
          </g>
        ))}
        {ticks(bounds.minY, bounds.maxY, stepY.label).map((y) => (
          <g key={`y-tick-${y}`}>
            <line
              x1={bounds.minX - gutter * 0.3}
              y1={toSvgY(y)}
              x2={bounds.minX}
              y2={toSvgY(y)}
              stroke="#7E8991"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={bounds.minX - gutter * 0.35}
              y={toSvgY(y)}
              dy="0.34em"
              textAnchor="end"
              fontSize={Math.max(20, gutter * 0.28)}
            >
              {y}
            </text>
          </g>
        ))}
        <text
          x={bounds.maxX}
          y={bounds.minY - gutter * 0.42}
          dx={gutter * 0.14}
          fontSize={Math.max(14, gutter * 0.2)}
        >
          mm
        </text>
        <circle cx={0} cy={toSvgY(0)} r={5} fill="#65A9C3" />
        <path
          d={`M 0 ${toSvgY(0)} h ${gutter * 0.34} M 0 ${toSvgY(0)} v ${-gutter * 0.34}`}
          stroke="#65A9C3"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={gutter * 0.14}
          y={toSvgY(0) - gutter * 0.12}
          fill="#65A9C3"
          fontSize={Math.max(14, gutter * 0.19)}
        >
          ORIGIN 0/0
        </text>
      </g>

      <g
        aria-hidden="true"
        stroke="#7E8991"
        fill="#AEB7BD"
        fontFamily="var(--font-geist-mono), monospace"
        fontSize={Math.max(20, gutter * 0.28)}
      >
        <line
          x1={bounds.minX}
          y1={bounds.maxY + bottomGutter * 0.62}
          x2={bounds.maxX}
          y2={bounds.maxY + bottomGutter * 0.62}
          markerStart={`url(#${arrowId})`}
          markerEnd={`url(#${arrowId})`}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={(bounds.minX + bounds.maxX) / 2}
          y={bounds.maxY + bottomGutter * 0.48}
          textAnchor="middle"
          stroke="none"
        >
          {width} mm
        </text>
        <line
          x1={bounds.maxX + rightGutter * 0.5}
          y1={bounds.minY}
          x2={bounds.maxX + rightGutter * 0.5}
          y2={bounds.maxY}
          markerStart={`url(#${arrowId})`}
          markerEnd={`url(#${arrowId})`}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={bounds.maxX + rightGutter * 0.74}
          y={(bounds.minY + bounds.maxY) / 2}
          textAnchor="middle"
          transform={`rotate(90 ${bounds.maxX + rightGutter * 0.74} ${(bounds.minY + bounds.maxY) / 2})`}
          stroke="none"
        >
          {height} mm
        </text>
      </g>
    </svg>
  );
}

function comparisonText(comparison: PatternComparison): string {
  switch (comparison.status) {
    case "exact":
      return `Exact physical footprint · ${comparison.acceptedSymmetry}`;
    case "integer-compatible":
      return `Legacy integer-compatible · max Δ ${comparison.maximumAxisDisplacementMm?.toFixed(3)} mm · ${comparison.acceptedSymmetry}`;
    case "count-mismatch":
      return `Count differs · reference ${comparison.referenceCount} / current ${comparison.currentCount}`;
    case "no-match":
      return "No accepted footprint match in the pallet symmetry orbit";
    default:
      return "Attach a reference and generate or save a current layer to compare";
  }
}

export function MeasuredPlanField({
  reference,
  current,
  comparison,
  mode,
  referenceLabel = "Reference",
  currentLabel = "Current",
}: MeasuredPlanFieldProps) {
  const sharedSplitBounds =
    mode === "split" ? drawingBounds(reference, current) : undefined;

  return (
    <section className="planning-plan-field grid h-full max-h-[32.5rem] min-h-0 grid-rows-[auto_minmax(0,1fr)] self-start border border-[var(--steel-rule)] bg-[var(--deck-black)]">
      <header className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--steel-rule)] px-3 py-1.5 text-[11px]">
        <span className="font-semibold tracking-[0.14em] text-[var(--chalk-text)] uppercase">
          Calibrated plan field
        </span>
        <span className="flex items-center gap-1.5 text-[var(--measured-blue)]">
          <span className="inline-block h-2.5 w-4 border border-dashed border-current" />
          {referenceLabel}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--selection-amber)]">
          <span className="inline-block h-2.5 w-4 border border-current bg-current/20" />
          {currentLabel}
        </span>
        <span className="ml-auto font-mono text-[var(--muted-text)]">
          {comparisonText(comparison)}
        </span>
      </header>
      <div
        className={`min-h-0 p-2 ${mode === "split" ? "overflow-auto" : "overflow-hidden"}`}
      >
        {mode === "split" ? (
          <div className="grid min-h-[720px] gap-px bg-[var(--steel-rule)] 2xl:h-full 2xl:min-h-0 2xl:grid-cols-2">
            <div className="h-[360px] min-h-0 bg-[var(--deck-black)] 2xl:h-auto">
              <MeasuredSvg
                reference={reference}
                current={null}
                label={`${referenceLabel} measured pallet layer`}
                drawingBoundsOverride={sharedSplitBounds}
              />
            </div>
            <div className="h-[360px] min-h-0 bg-[var(--deck-black)] 2xl:h-auto">
              <MeasuredSvg
                reference={null}
                current={current}
                label={`${currentLabel} measured pallet layer`}
                drawingBoundsOverride={sharedSplitBounds}
              />
            </div>
          </div>
        ) : (
          <MeasuredSvg
            reference={reference}
            current={current}
            label={`${referenceLabel} and ${currentLabel} measured overlay`}
          />
        )}
      </div>
    </section>
  );
}
