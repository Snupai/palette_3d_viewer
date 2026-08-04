import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { footprintSize, gripsToBoxes } from "~/domain/palletGeometry";
import type { Grip } from "~/domain/palletTypes";
import type { PalletPoint } from "~/hooks/useLayerEditor";

export type LayerCanvasProps = {
  uniqueLayerId: number;
  grips: Grip[];
  packageWidth: number;
  packageLength: number;
  inputDirection: 0 | 1;
  palletWidth: number;
  palletLength: number;
  selectedGripIndex: number | null;
  mergeSelection: ReadonlySet<number>;
  onClearSelection: () => void;
  onGripKeyboardSelect: (gripIndex: number) => void;
  onSelectedGripMove: (deltaX: number, deltaY: number) => void;
  onGripPointerStart: (
    gripIndex: number,
    point: PalletPoint | null,
    extendMergeSelection: boolean,
  ) => boolean;
  onGripPointerMove: (point: PalletPoint) => void;
  onGripPointerEnd: (point: PalletPoint | null) => void;
  onGripPointerCancel: () => void;
};

type EditorBox = ReturnType<typeof gripsToBoxes>[number];

function blueLinePath(
  blueLine: EditorBox["blueLine"],
  x: number,
  y: number,
  width: number,
  length: number,
): string | null {
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y - length / 2;
  const bottom = y + length / 2;
  const cornerSize = Math.min(width, length) * 0.22;

  switch (blueLine) {
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

function gripDeltaArrow(
  grip: Grip,
  boxes: EditorBox[],
  palletLength: number,
): {
  centerX: number;
  centerY: number;
  endX: number;
  endY: number;
  labelX: number;
  labelY: number;
} | null {
  if ((grip.dx === 0 && grip.dy === 0) || boxes.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const size = footprintSize(box);
    const svgY = palletLength - box.rect.y;
    left = Math.min(left, box.rect.x - size.width / 2);
    right = Math.max(right, box.rect.x + size.width / 2);
    top = Math.min(top, svgY - size.length / 2);
    bottom = Math.max(bottom, svgY + size.length / 2);
  }

  const centerX = grip.x;
  const centerY = palletLength - grip.y;
  const vectorX = -grip.dx;
  const vectorY = grip.dy;
  const vectorLength = Math.hypot(vectorX, vectorY);
  const unitX = vectorX / vectorLength;
  const unitY = vectorY / vectorLength;
  const distanceX =
    unitX === 0
      ? Number.POSITIVE_INFINITY
      : unitX > 0
        ? (right - centerX) / unitX
        : (centerX - left) / -unitX;
  const distanceY =
    unitY === 0
      ? Number.POSITIVE_INFINITY
      : unitY > 0
        ? (bottom - centerY) / unitY
        : (centerY - top) / -unitY;
  const boundaryDistance = Math.min(distanceX, distanceY);
  const arrowDistance = Math.max(
    16,
    boundaryDistance - Math.min(12, boundaryDistance * 0.2),
  );
  const labelDistance = arrowDistance * 0.55;

  return {
    centerX,
    centerY,
    endX: centerX + unitX * arrowDistance,
    endY: centerY + unitY * arrowDistance,
    labelX: centerX + unitX * labelDistance - unitY * 16,
    labelY: centerY + unitY * labelDistance + unitX * 16,
  };
}

export function LayerCanvas({
  uniqueLayerId,
  grips,
  packageWidth,
  packageLength,
  inputDirection,
  palletWidth,
  palletLength,
  selectedGripIndex,
  mergeSelection,
  onClearSelection,
  onGripKeyboardSelect,
  onSelectedGripMove,
  onGripPointerStart,
  onGripPointerMove,
  onGripPointerEnd,
  onGripPointerCancel,
}: LayerCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxesByGrip = useMemo(
    () =>
      grips.map((grip) =>
        gripsToBoxes([grip], packageWidth, packageLength, 0, inputDirection),
      ),
    [grips, inputDirection, packageLength, packageWidth],
  );
  const instructionsId = useId();
  const selectionStatusId = useId();
  const activeSelectedGripIndex =
    selectedGripIndex !== null && grips[selectedGripIndex]
      ? selectedGripIndex
      : null;
  const activeSelectedGrip =
    activeSelectedGripIndex === null
      ? null
      : (grips[activeSelectedGripIndex] ?? null);

  useEffect(() => {
    if (
      document.activeElement === svgRef.current &&
      activeSelectedGripIndex === null &&
      grips.length > 0
    ) {
      onGripKeyboardSelect(0);
    }
  }, [
    activeSelectedGripIndex,
    grips.length,
    onGripKeyboardSelect,
    uniqueLayerId,
  ]);

  const ensureKeyboardSelection = () => {
    if (activeSelectedGripIndex === null && grips.length > 0) {
      onGripKeyboardSelect(0);
    }
  };

  const selectRelativeGrip = (offset: number) => {
    if (grips.length === 0) return;
    const currentIndex = activeSelectedGripIndex ?? 0;
    onGripKeyboardSelect((currentIndex + offset + grips.length) % grips.length);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "Home" || event.key === "End") {
      if (grips.length === 0) return;
      event.preventDefault();
      onGripKeyboardSelect(event.key === "Home" ? 0 : grips.length - 1);
      return;
    }

    if (event.key === "PageUp" || event.key === "[") {
      event.preventDefault();
      selectRelativeGrip(-1);
      return;
    }

    if (event.key === "PageDown" || event.key === "]") {
      event.preventDefault();
      selectRelativeGrip(1);
      return;
    }

    if (activeSelectedGripIndex === null) return;
    const movement =
      event.key === "ArrowLeft"
        ? { x: -1, y: 0 }
        : event.key === "ArrowRight"
          ? { x: 1, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: 1 }
            : event.key === "ArrowDown"
              ? { x: 0, y: -1 }
              : null;
    if (!movement) return;
    event.preventDefault();
    onSelectedGripMove(movement.x, movement.y);
  };

  const clientToPallet = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: palletLength - local.y };
  };

  const startPointerInteraction = (
    event: ReactPointerEvent<SVGRectElement>,
    gripIndex: number,
  ) => {
    event.stopPropagation();
    const point = event.shiftKey
      ? null
      : clientToPallet(event.clientX, event.clientY);
    if (onGripPointerStart(gripIndex, point, event.shiftKey)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const updatePointerInteraction = (
    event: ReactPointerEvent<SVGRectElement>,
  ) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = clientToPallet(event.clientX, event.clientY);
    if (point) onGripPointerMove(point);
  };

  const finishPointerInteraction = (
    event: ReactPointerEvent<SVGRectElement>,
  ) => {
    onGripPointerEnd(clientToPallet(event.clientX, event.clientY));
  };

  return (
    <div className="min-h-[60vh] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 p-3 focus-within:border-zinc-500 lg:min-h-0">
      <p id={instructionsId} className="sr-only">
        Keyboard controls: Tab to focus the canvas. Home and End select the
        first and last grip. Page Up or left bracket selects the previous grip;
        Page Down or right bracket selects the next grip. Arrow keys move the
        selected grip one millimeter, with pallet support and collision limits.
        Continue with Tab to edit the selected grip in Grip details.
      </p>
      <p
        id={selectionStatusId}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {activeSelectedGrip && activeSelectedGripIndex !== null
          ? `Grip ${activeSelectedGripIndex + 1} of ${grips.length} selected. Place X ${activeSelectedGrip.x}, Place Y ${activeSelectedGrip.y}.`
          : grips.length === 0
            ? "No grips are available."
            : "No grip selected."}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${palletWidth} ${palletLength}`}
        role="application"
        aria-label={`Top-down editor for unique layer ${uniqueLayerId}`}
        aria-describedby={`${instructionsId} ${selectionStatusId}`}
        tabIndex={0}
        className="h-full min-h-[calc(60vh-1.5rem)] w-full touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-400 lg:min-h-0"
        onFocus={ensureKeyboardSelection}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          onClearSelection();
        }}
      >
        <defs>
          <marker
            id={`grip-delta-arrow-${uniqueLayerId}`}
            viewBox="0 0 8 8"
            refX={7}
            refY={4}
            markerWidth={4}
            markerHeight={4}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#fbbf24" />
          </marker>
        </defs>
        <rect
          x={1}
          y={1}
          width={Math.max(0, palletWidth - 2)}
          height={Math.max(0, palletLength - 2)}
          rx={4}
          fill="#18181b"
          stroke="#52525b"
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <g opacity={0.18} pointerEvents="none">
          {Array.from({ length: 11 }, (_, index) => {
            const x = (palletWidth / 10) * index;
            return (
              <line
                key={`vertical-${index}`}
                x1={x}
                y1={0}
                x2={x}
                y2={palletLength}
                stroke="#71717a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {Array.from({ length: 11 }, (_, index) => {
            const y = (palletLength / 10) * index;
            return (
              <line
                key={`horizontal-${index}`}
                x1={0}
                y1={y}
                x2={palletWidth}
                y2={y}
                stroke="#71717a"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>

        {boxesByGrip.map((boxes, gripIndex) => {
          const grip = grips[gripIndex]!;
          const isPrimary = selectedGripIndex === gripIndex;
          const isMergeSelected = mergeSelection.has(gripIndex);
          const deltaArrow = gripDeltaArrow(grip, boxes, palletLength);
          const firstBox = boxes[0];
          const firstBoxSize = firstBox ? footprintSize(firstBox) : null;
          return (
            <g key={grip.id}>
              {boxes.map((box, boxIndex) => {
                const { width, length } = footprintSize(box);
                const svgY = palletLength - box.rect.y;
                const path = blueLinePath(
                  box.blueLine,
                  box.rect.x,
                  svgY,
                  width,
                  length,
                );
                return (
                  <g key={`${grip.id}-${boxIndex}`}>
                    <rect
                      x={box.rect.x - width / 2}
                      y={svgY - length / 2}
                      width={width}
                      height={length}
                      rx={4}
                      fill={
                        isPrimary
                          ? "#42350f"
                          : isMergeSelected
                            ? "#332a10"
                            : "#2f2f36"
                      }
                      stroke={
                        isPrimary || isMergeSelected ? "#fbbf24" : "#a1a1aa"
                      }
                      strokeWidth={isPrimary ? 3 : 2}
                      vectorEffect="non-scaling-stroke"
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(event) =>
                        startPointerInteraction(event, gripIndex)
                      }
                      onPointerMove={updatePointerInteraction}
                      onPointerUp={finishPointerInteraction}
                      onPointerCancel={onGripPointerCancel}
                    />
                    {path ? (
                      <path
                        d={path}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    ) : null}
                  </g>
                );
              })}
              {deltaArrow ? (
                <g pointerEvents="none" aria-hidden="true">
                  <line
                    x1={deltaArrow.centerX}
                    y1={deltaArrow.centerY}
                    x2={deltaArrow.endX}
                    y2={deltaArrow.endY}
                    stroke="#fbbf24"
                    strokeWidth={isPrimary ? 5 : 2.5}
                    strokeLinecap="round"
                    markerEnd={`url(#grip-delta-arrow-${uniqueLayerId})`}
                    vectorEffect="non-scaling-stroke"
                    opacity={isPrimary ? 1 : 0.55}
                  />
                  <circle
                    cx={deltaArrow.centerX}
                    cy={deltaArrow.centerY}
                    r={isPrimary ? 6 : 4}
                    fill="#fbbf24"
                    opacity={isPrimary ? 1 : 0.55}
                    vectorEffect="non-scaling-stroke"
                  />
                  {isPrimary ? (
                    <text
                      x={deltaArrow.labelX}
                      y={deltaArrow.labelY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fef3c7"
                      stroke="#18181b"
                      strokeWidth={5}
                      paintOrder="stroke"
                      fontSize={17}
                      fontWeight={700}
                      fontFamily="ui-monospace, monospace"
                    >
                      Δx {grip.dx} / Δy {grip.dy}
                    </text>
                  ) : null}
                </g>
              ) : null}
              {firstBox && firstBoxSize ? (
                <text
                  x={firstBox.rect.x}
                  y={palletLength - firstBox.rect.y}
                  dy="0.35em"
                  textAnchor="middle"
                  fill="#d4d4d8"
                  fontSize={Math.max(
                    18,
                    Math.min(firstBoxSize.width, firstBoxSize.length) * 0.16,
                  )}
                  fontFamily="ui-monospace, monospace"
                  pointerEvents="none"
                >
                  G{gripIndex + 1}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
