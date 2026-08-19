import { placementRectangleBounds } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";

export type SequenceCanvasPlacement = {
  id: string;
  positionMm: { x: number; y: number };
  rotation: Rotation;
  label: string;
  detail: string;
};

export type SequenceCanvasProps = {
  ariaLabel: string;
  envelope: { minX: number; minY: number; maxX: number; maxY: number };
  pallet: { length: number; width: number } | null;
  packageDimensions: { length: number; width: number };
  placements: readonly SequenceCanvasPlacement[];
  currentPlacementIds?: ReadonlySet<string>;
  completedPlacementIds?: ReadonlySet<string>;
  className?: string;
};

export function SequenceCanvas({
  ariaLabel,
  envelope,
  pallet,
  packageDimensions,
  placements,
  currentPlacementIds = new Set(),
  completedPlacementIds = new Set(),
  className = "",
}: SequenceCanvasProps) {
  const width = envelope.maxX - envelope.minX;
  const height = envelope.maxY - envelope.minY;
  const canvasMaxY = envelope.minY + envelope.maxY;
  return (
    <svg
      viewBox={`${envelope.minX} ${envelope.minY} ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className={`mx-auto block h-auto w-full max-w-[min(100%,34rem)] ${className}`}
      style={{
        aspectRatio: `${Math.max(width, 1)} / ${Math.max(height, 1)}`,
      }}
    >
      <rect
        x={envelope.minX}
        y={envelope.minY}
        width={width}
        height={height}
        fill="var(--canvas)"
        stroke="var(--line)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {pallet ? (
        <rect
          x={0}
          y={canvasMaxY - pallet.width}
          width={pallet.length}
          height={pallet.width}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {placements.map((placement) => {
        const bounds = placementRectangleBounds(placement, packageDimensions);
        const x = bounds.minX;
        const y = canvasMaxY - bounds.maxY;
        const rectWidth = bounds.maxX - bounds.minX;
        const rectHeight = bounds.maxY - bounds.minY;
        const current = currentPlacementIds.has(placement.id);
        const completed = completedPlacementIds.has(placement.id);
        return (
          <g key={placement.id}>
            <rect
              x={x}
              y={y}
              width={rectWidth}
              height={rectHeight}
              rx={3}
              fill={
                current
                  ? "var(--plan-fill)"
                  : completed
                    ? "var(--surface-hover)"
                    : "var(--surface)"
              }
              stroke={
                current
                  ? "var(--brand)"
                  : completed
                    ? "var(--muted)"
                    : "var(--plan-stroke)"
              }
              strokeWidth={current ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{placement.detail}</title>
            </rect>
            <text
              x={x + rectWidth / 2}
              y={y + rectHeight / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="var(--ink)"
              stroke="var(--canvas)"
              strokeWidth={3}
              paintOrder="stroke"
              fontSize={Math.max(11, Math.min(rectWidth, rectHeight) * 0.22)}
              fontFamily="ui-monospace, monospace"
              pointerEvents="none"
            >
              {placement.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
