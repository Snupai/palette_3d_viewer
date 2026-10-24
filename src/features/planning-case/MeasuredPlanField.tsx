"use client";

import { useId } from "react";
import type {
  LayerPatternPreview,
  LayerPatternPreviewItem,
} from "~/domain/layerPatternPreview";
import {
  type DimensionChain,
  formatMm,
  loadBounds,
  planFieldGeometry,
} from "~/features/planning-case/planFieldGeometry";
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
                  ? "color-mix(in srgb, var(--measure) 12%, transparent)"
                  : "var(--plan-fill)"
            }
            stroke={
              reference
                ? "var(--measure)"
                : overflow
                  ? "var(--danger)"
                  : "var(--plan-stroke)"
            }
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
  const physicalStroke =
    kind === "reference" ? "var(--measure)" : "var(--muted)";
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
          stroke="var(--line)"
          strokeWidth="1.25"
          strokeDasharray="8 5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {preview.generationBoundsMm ? (
        <rect
          {...frameRect(preview.generationBoundsMm, "generation-envelope")}
          fill="none"
          stroke="var(--plan-stroke)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <rect
        {...frameRect(physical, "physical-pallet")}
        fill="color-mix(in srgb, var(--canvas) 72%, transparent)"
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
  const dimensioned = current ?? reference;
  const { gutter, rightGutter, bottomGutter, chainSpacing, chains } =
    planFieldGeometry(
      bounds,
      dimensioned?.palletBoundsMm ?? null,
      dimensioned ? loadBounds(dimensioned.items) : null,
    );
  const stepX = tickStep(width);
  const stepY = tickStep(height);
  const toSvgY = (value: number) => bounds.minY + bounds.maxY - value;
  const overflowPatternId = `overflow-${uid}`;
  const tickId = `dimension-tick-${uid}`;

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
          <rect
            width="12"
            height="12"
            fill="color-mix(in srgb, var(--danger) 12%, transparent)"
          />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="12"
            stroke="var(--danger)"
            strokeWidth="3"
          />
        </pattern>
        {/* Architectural dimension tick: a 45° slash, as on a drawing. */}
        <marker
          id={tickId}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M 2 8 L 8 2"
            stroke="var(--ink)"
            strokeWidth="1.4"
            fill="none"
          />
        </marker>
      </defs>

      <rect
        x={bounds.minX - gutter}
        y={bounds.minY - gutter}
        width={width + gutter + rightGutter}
        height={height + gutter + bottomGutter}
        fill="var(--canvas)"
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
              stroke={major ? "var(--line)" : "var(--canvas)"}
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
              stroke={major ? "var(--line)" : "var(--canvas)"}
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
        fill="var(--muted)"
        fontFamily="var(--font-geist-mono), monospace"
      >
        {ticks(bounds.minX, bounds.maxX, stepX.label).map((x) => (
          <g key={`x-tick-${x}`}>
            <line
              x1={x}
              y1={bounds.minY - gutter * 0.3}
              x2={x}
              y2={bounds.minY}
              stroke="var(--muted)"
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
              stroke="var(--muted)"
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
        <circle cx={0} cy={toSvgY(0)} r={5} fill="var(--measure)" />
        <path
          d={`M 0 ${toSvgY(0)} h ${gutter * 0.34} M 0 ${toSvgY(0)} v ${-gutter * 0.34}`}
          stroke="var(--measure)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={gutter * 0.14}
          y={toSvgY(0) - gutter * 0.12}
          fill="var(--measure)"
          fontSize={Math.max(14, gutter * 0.19)}
        >
          ORIGIN 0/0
        </text>
      </g>

      <DimensionChains
        chains={chains}
        bounds={bounds}
        toSvgY={toSvgY}
        chainSpacing={chainSpacing}
        fontSize={Math.max(18, gutter * 0.26)}
        tickId={tickId}
      />
    </svg>
  );
}

function DimensionChains({
  chains,
  bounds,
  toSvgY,
  chainSpacing,
  fontSize,
  tickId,
}: {
  chains: DimensionChain[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  toSvgY: (value: number) => number;
  chainSpacing: number;
  fontSize: number;
  tickId: string;
}) {
  const overshoot = chainSpacing * 0.22;
  return (
    <g
      aria-hidden="true"
      data-plan-dimensions=""
      fontFamily="var(--font-geist-mono), monospace"
      fontSize={fontSize}
    >
      {chains.map((chain) => {
        const load = chain.kind === "load";
        const tone = load ? "var(--caution)" : "var(--ink)";
        const key = `${chain.axis}-${chain.kind}`;
        if (chain.axis === "x") {
          // Horizontal chain below the drawing; witness lines drop from the
          // dimensioned edge (svg y grows downward, toSvgY flips the plan).
          const y = bounds.maxY + chainSpacing * chain.level;
          const edge = toSvgY(bounds.minY);
          const mid = (chain.from + chain.to) / 2;
          return (
            <g key={key} data-dimension-chain={key}>
              {[chain.from, chain.to].map((x) => (
                <line
                  key={x}
                  x1={x}
                  y1={edge + chainSpacing * 0.15}
                  x2={x}
                  y2={y + overshoot}
                  stroke="var(--muted)"
                  strokeWidth="0.75"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <line
                x1={chain.from}
                y1={y}
                x2={chain.to}
                y2={y}
                stroke={tone}
                strokeWidth="1"
                markerStart={`url(#${tickId})`}
                markerEnd={`url(#${tickId})`}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={mid}
                y={y - chainSpacing * 0.18}
                textAnchor="middle"
                fill={tone}
              >
                {chain.label}
              </text>
              {chain.overhangStart > 0 ? (
                <text
                  x={chain.from}
                  y={y + chainSpacing * 0.62}
                  textAnchor="start"
                  fill="var(--caution)"
                  fontSize={fontSize * 0.8}
                >
                  +{formatMm(chain.overhangStart)}
                </text>
              ) : null}
              {chain.overhangEnd > 0 ? (
                <text
                  x={chain.to}
                  y={y + chainSpacing * 0.62}
                  textAnchor="end"
                  fill="var(--caution)"
                  fontSize={fontSize * 0.8}
                >
                  +{formatMm(chain.overhangEnd)}
                </text>
              ) : null}
            </g>
          );
        }
        const x = bounds.maxX + chainSpacing * chain.level;
        const top = toSvgY(chain.to);
        const bottom = toSvgY(chain.from);
        const mid = (top + bottom) / 2;
        return (
          <g key={key} data-dimension-chain={key}>
            {[top, bottom].map((y) => (
              <line
                key={y}
                x1={bounds.maxX + chainSpacing * 0.15}
                y1={y}
                x2={x + overshoot}
                y2={y}
                stroke="var(--muted)"
                strokeWidth="0.75"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={x}
              y1={top}
              x2={x}
              y2={bottom}
              stroke={tone}
              strokeWidth="1"
              markerStart={`url(#${tickId})`}
              markerEnd={`url(#${tickId})`}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x + chainSpacing * 0.22}
              y={mid}
              textAnchor="middle"
              fill={tone}
              transform={`rotate(90 ${x + chainSpacing * 0.22} ${mid})`}
            >
              {chain.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function comparisonText(
  comparison: PatternComparison,
  current: LayerPatternPreview | null,
): string {
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
      return current
        ? `${current.items.length} packages`
        : "Open a .rob file or generate a layer to inspect";
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
    <section className="planning-plan-field border-line bg-canvas grid h-full max-h-[32.5rem] min-h-0 grid-rows-[auto_minmax(0,1fr)] self-start border">
      <header className="border-line text-micro flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5">
        <span className="text-ink font-semibold">Plan field</span>
        {reference ? (
          <span className="text-measure flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 border border-dashed border-current" />
            {referenceLabel}
          </span>
        ) : null}
        <span className="text-brand flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 border border-current bg-current/20" />
          {currentLabel}
        </span>
        <span className="text-muted ml-auto font-mono">
          {comparisonText(comparison, current)}
        </span>
      </header>
      <div
        className={`min-h-0 p-2 ${mode === "split" ? "overflow-auto" : "overflow-hidden"}`}
      >
        {mode === "split" ? (
          <div className="bg-line grid min-h-[720px] gap-px 2xl:h-full 2xl:min-h-0 2xl:grid-cols-2">
            <div className="bg-canvas h-[360px] min-h-0 2xl:h-auto">
              <MeasuredSvg
                reference={reference}
                current={null}
                label={`${referenceLabel} measured pallet layer`}
                drawingBoundsOverride={sharedSplitBounds}
              />
            </div>
            <div className="bg-canvas h-[360px] min-h-0 2xl:h-auto">
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
            label={
              reference
                ? `${referenceLabel} and ${currentLabel} measured overlay`
                : `${currentLabel} measured pallet layer`
            }
          />
        )}
      </div>
    </section>
  );
}
