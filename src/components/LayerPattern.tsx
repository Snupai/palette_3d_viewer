import type { SVGProps } from "react";
import type { RectangleBoundsMm } from "~/domain/geometry";
import type {
  LayerPatternPreview,
  LayerPatternPreviewItem,
} from "~/domain/layerPatternPreview";

export type LayerPatternProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "viewBox"
> & {
  preview: LayerPatternPreview;
  showGrid?: boolean;
  showGroupLabels?: boolean;
  showLabelSides?: boolean;
  paddingMm?: number;
};

function labelSidePath(
  item: LayerPatternPreviewItem,
  svgY: number,
): string | null {
  const { x: width, y: length } = item.sizeMm;
  const left = item.centerMm.x - width / 2;
  const right = item.centerMm.x + width / 2;
  const top = svgY - length / 2;
  const bottom = svgY + length / 2;
  const cornerSize = Math.min(width, length) * 0.22;

  switch (item.labelSide) {
    case "top":
      return `M ${left} ${top} L ${right} ${top}`;
    case "right":
      return `M ${right} ${top} L ${right} ${bottom}`;
    case "bottom":
      return `M ${left} ${bottom} L ${right} ${bottom}`;
    case "left":
      return `M ${left} ${top} L ${left} ${bottom}`;
    case "top_right":
      return `M ${right - cornerSize} ${top} L ${right} ${top} L ${right} ${top + cornerSize}`;
    case "bottom_right":
      return `M ${right - cornerSize} ${bottom} L ${right} ${bottom} L ${right} ${bottom - cornerSize}`;
    case "bottom_left":
      return `M ${left + cornerSize} ${bottom} L ${left} ${bottom} L ${left} ${bottom - cornerSize}`;
    case "top_left":
      return `M ${left + cornerSize} ${top} L ${left} ${top} L ${left} ${top + cornerSize}`;
    default:
      return null;
  }
}

function unionBounds(
  current: RectangleBoundsMm,
  next: RectangleBoundsMm,
): RectangleBoundsMm {
  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

function previewDrawingBounds(preview: LayerPatternPreview): RectangleBoundsMm {
  let bounds = { ...preview.palletBoundsMm };
  if (preview.effectiveEnvelopeMm) {
    bounds = unionBounds(bounds, preview.effectiveEnvelopeMm);
  }
  if (preview.generationBoundsMm) {
    bounds = unionBounds(bounds, preview.generationBoundsMm);
  }
  for (const item of preview.items) {
    bounds = unionBounds(bounds, {
      minX: item.centerMm.x - item.sizeMm.x / 2,
      minY: item.centerMm.y - item.sizeMm.y / 2,
      maxX: item.centerMm.x + item.sizeMm.x / 2,
      maxY: item.centerMm.y + item.sizeMm.y / 2,
    });
  }
  return bounds;
}

/**
 * Read-only SVG renderer shared by candidate thumbnails, large previews, and reports.
 * It intentionally has no editor events, selection state, or browser-only APIs.
 */
export function LayerPattern({
  preview,
  showGrid = true,
  showGroupLabels = true,
  showLabelSides = true,
  paddingMm = 0,
  role = "img",
  "aria-label": ariaLabel,
  ...svgProps
}: LayerPatternProps) {
  const drawingBounds = previewDrawingBounds(preview);
  const { minX, minY, maxX, maxY } = drawingBounds;
  const width = Math.max(1, maxX - minX);
  const length = Math.max(1, maxY - minY);
  const pallet = preview.palletBoundsMm;
  const palletWidth = Math.max(1, pallet.maxX - pallet.minX);
  const palletLength = Math.max(1, pallet.maxY - pallet.minY);
  const safePadding = Number.isFinite(paddingMm) ? Math.max(0, paddingMm) : 0;
  const toSvgY = (y: number) => minY + maxY - y;
  const boundsSvgY = (bounds: RectangleBoundsMm) => toSvgY(bounds.maxY);

  return (
    <svg
      {...svgProps}
      viewBox={`${minX - safePadding} ${minY - safePadding} ${width + safePadding * 2} ${length + safePadding * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role={role}
      aria-label={ariaLabel ?? preview.label}
      data-layer-pattern-id={preview.id}
    >
      <title>{preview.label}</title>
      {preview.effectiveEnvelopeMm ? (
        <rect
          data-pattern-frame="effective-envelope"
          x={preview.effectiveEnvelopeMm.minX}
          y={boundsSvgY(preview.effectiveEnvelopeMm)}
          width={Math.max(
            1,
            preview.effectiveEnvelopeMm.maxX - preview.effectiveEnvelopeMm.minX,
          )}
          height={Math.max(
            1,
            preview.effectiveEnvelopeMm.maxY - preview.effectiveEnvelopeMm.minY,
          )}
          fill="none"
          stroke="#71717a"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {preview.generationBoundsMm ? (
        <rect
          data-pattern-frame="generation-envelope"
          x={preview.generationBoundsMm.minX}
          y={boundsSvgY(preview.generationBoundsMm)}
          width={Math.max(
            1,
            preview.generationBoundsMm.maxX - preview.generationBoundsMm.minX,
          )}
          height={Math.max(
            1,
            preview.generationBoundsMm.maxY - preview.generationBoundsMm.minY,
          )}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <rect
        data-pattern-frame="physical-pallet"
        x={pallet.minX}
        y={boundsSvgY(pallet)}
        width={palletWidth}
        height={palletLength}
        rx={4}
        fill="#18181b"
        stroke="#52525b"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {showGrid ? (
        <g opacity={0.18} pointerEvents="none" aria-hidden="true">
          {Array.from({ length: 11 }, (_, index) => {
            const x = pallet.minX + (palletWidth / 10) * index;
            return (
              <line
                key={`vertical-${index}`}
                x1={x}
                y1={boundsSvgY(pallet)}
                x2={x}
                y2={boundsSvgY(pallet) + palletLength}
                stroke="#71717a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {Array.from({ length: 11 }, (_, index) => {
            const y = toSvgY(pallet.minY + (palletLength / 10) * index);
            return (
              <line
                key={`horizontal-${index}`}
                x1={pallet.minX}
                y1={y}
                x2={pallet.maxX}
                y2={y}
                stroke="#71717a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      ) : null}
      {preview.items.map((item) => {
        const svgY = toSvgY(item.centerMm.y);
        const path = showLabelSides ? labelSidePath(item, svgY) : null;
        const fontSize = Math.max(
          12,
          Math.min(item.sizeMm.x, item.sizeMm.y) * 0.16,
        );
        return (
          <g key={item.id} data-pattern-item={item.id}>
            <rect
              x={item.centerMm.x - item.sizeMm.x / 2}
              y={svgY - item.sizeMm.y / 2}
              width={item.sizeMm.x}
              height={item.sizeMm.y}
              rx={3}
              fill="#2f2f36"
              stroke="#a1a1aa"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            {path ? (
              <path
                d={path}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {showGroupLabels && item.groupLabel ? (
              <text
                x={item.centerMm.x}
                y={svgY}
                dy="0.35em"
                textAnchor="middle"
                fill="#d4d4d8"
                fontSize={fontSize}
                fontFamily="ui-monospace, monospace"
                pointerEvents="none"
              >
                {item.groupLabel}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
