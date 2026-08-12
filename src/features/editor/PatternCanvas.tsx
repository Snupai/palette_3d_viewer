"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  blueLinePath,
  gripDeltaArrow,
} from "~/components/layer-editor/gripVisualGeometry";
import { placementRectangleBounds } from "~/domain/geometry";
import { parseBlueLine } from "~/domain/palletGeometry";
import type { LayerPattern, Project } from "~/domain/project/projectSchema";
import {
  placementIdsInMarquee,
  projectEditorEnvelope,
  type ProjectEditorGroup,
} from "~/features/editor/editorModel";

type PointerState =
  | {
      kind: "marquee";
      pointerId: number;
      start: { x: number; y: number };
      current: { x: number; y: number };
    }
  | {
      kind: "drag";
      pointerId: number;
      start: { x: number; y: number };
      current: { x: number; y: number };
      placementIds: readonly string[];
    };

export type PatternCanvasProps = {
  project: Project;
  pattern: LayerPattern;
  groups: readonly ProjectEditorGroup[];
  selectedPlacementIds: ReadonlySet<string>;
  fineStepMm: number;
  coarseStepMm: number;
  onSelectionChange: (placementIds: ReadonlySet<string>) => void;
  onMoveSelection: (
    deltaMm: { x: number; y: number },
    placementIds: readonly string[],
  ) => void;
  onNudgeSelection: (deltaMm: { x: number; y: number }) => void;
  onDeleteSelection: () => void;
  onRotateSelection: () => void;
};

function toggleSelectionUnit(
  current: ReadonlySet<string>,
  placementIds: readonly string[],
): Set<string> {
  const next = new Set(current);
  const remove = placementIds.every((placementId) => next.has(placementId));
  for (const placementId of placementIds) {
    if (remove) next.delete(placementId);
    else next.add(placementId);
  }
  return next;
}

export function PatternCanvas({
  project,
  pattern,
  groups,
  selectedPlacementIds,
  fineStepMm,
  coarseStepMm,
  onSelectionChange,
  onMoveSelection,
  onNudgeSelection,
  onDeleteSelection,
  onRotateSelection,
}: PatternCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const deltaArrowMarkerId = `pattern-grip-delta-arrow-${useId().replaceAll(":", "")}`;
  const [pointer, setPointer] = useState<PointerState | null>(null);
  const envelope = projectEditorEnvelope(project) ?? {
    minX: 0,
    minY: 0,
    maxX: project.pallet?.dimensionsMm.length ?? 1_200,
    maxY: project.pallet?.dimensionsMm.width ?? 800,
  };
  const width = envelope.maxX - envelope.minX;
  const height = envelope.maxY - envelope.minY;
  const canvasMaxY = envelope.minY + envelope.maxY;
  const groupByPlacementId = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.placementIds.map(
            (placementId) =>
              [
                placementId,
                {
                  groupNumber: group.groupNumber,
                  orderIndex: group.orderIndex,
                },
              ] as const,
          ),
        ),
      ),
    [groups],
  );
  const gripById = useMemo(
    () => new Map(pattern.grips.map((grip) => [grip.id, grip])),
    [pattern.grips],
  );
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const placementById = useMemo(
    () => new Map(pattern.placements.map((placement) => [placement.id, placement])),
    [pattern.placements],
  );
  const gripPlacementIds = useMemo(() => {
    const idsByGrip = new Map<string, string[]>();
    for (const placement of pattern.placements) {
      if (placement.gripId === null || !gripById.has(placement.gripId)) continue;
      const ids = idsByGrip.get(placement.gripId) ?? [];
      ids.push(placement.id);
      idsByGrip.set(placement.gripId, ids);
    }
    return idsByGrip;
  }, [gripById, pattern.placements]);
  const selectionUnit = (placementId: string): readonly string[] => {
    const placement = placementById.get(placementId);
    if (!placement?.gripId) return [placementId];
    return gripPlacementIds.get(placement.gripId) ?? [placementId];
  };

  const pointFromClient = (clientX: number, clientY: number) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: envelope.minX + ((clientX - bounds.left) / bounds.width) * width,
      y: envelope.maxY - ((clientY - bounds.top) / bounds.height) * height,
    };
  };

  const capture = (
    event: ReactPointerEvent<SVGSVGElement | SVGRectElement>,
  ) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startBackground = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    if (!event.shiftKey) {
      onSelectionChange(new Set());
      return;
    }
    capture(event);
    setPointer({
      kind: "marquee",
      pointerId: event.pointerId,
      start: point,
      current: point,
    });
  };

  const startPlacement = (
    event: ReactPointerEvent<SVGRectElement>,
    placementId: string,
  ) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    const unit = selectionUnit(placementId);
    const unitSelected = unit.every((id) => selectedPlacementIds.has(id));
    const selection = unitSelected
      ? new Set(selectedPlacementIds)
      : new Set(unit);
    if (!unitSelected) onSelectionChange(selection);
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    capture(event);
    setPointer({
      kind: "drag",
      pointerId: event.pointerId,
      start: point,
      current: point,
      placementIds: [...selection],
    });
  };

  const clickPlacement = (
    event: ReactMouseEvent<SVGRectElement>,
    placementId: string,
  ) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    event.stopPropagation();
    onSelectionChange(
      toggleSelectionUnit(selectedPlacementIds, selectionUnit(placementId)),
    );
  };

  const updatePointer = (
    event: ReactPointerEvent<SVGSVGElement | SVGRectElement>,
  ) => {
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setPointer((current) => (current ? { ...current, current: point } : null));
  };

  const finishPointer = (
    event: ReactPointerEvent<SVGSVGElement | SVGRectElement>,
  ) => {
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const point =
      pointFromClient(event.clientX, event.clientY) ?? pointer.current;
    if (pointer.kind === "marquee") {
      const selected = placementIdsInMarquee(
        project,
        pattern,
        pointer.start,
        point,
      );
      onSelectionChange(
        new Set([
          ...selectedPlacementIds,
          ...selected.flatMap((placementId) => selectionUnit(placementId)),
        ]),
      );
    } else {
      const deltaMm = {
        x: Math.round((point.x - pointer.start.x) * 10) / 10,
        y: Math.round((point.y - pointer.start.y) * 10) / 10,
      };
      if (deltaMm.x !== 0 || deltaMm.y !== 0) {
        onMoveSelection(deltaMm, pointer.placementIds);
      }
    }
    setPointer(null);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectionChange(new Set());
      setPointer(null);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedPlacementIds.size === 0) return;
      event.preventDefault();
      onDeleteSelection();
      return;
    }
    if (event.key.toLocaleLowerCase() === "r") {
      if (selectedPlacementIds.size === 0) return;
      event.preventDefault();
      onRotateSelection();
      return;
    }
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
    if (!movement || selectedPlacementIds.size === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? coarseStepMm : fineStepMm;
    onNudgeSelection({ x: movement.x * step, y: movement.y * step });
  };

  const dragDelta =
    pointer?.kind === "drag"
      ? {
          x: pointer.current.x - pointer.start.x,
          y: pointer.current.y - pointer.start.y,
        }
      : { x: 0, y: 0 };
  const draggingIds = new Set(
    pointer?.kind === "drag" ? pointer.placementIds : [],
  );
  const marquee =
    pointer?.kind === "marquee"
      ? {
          x: Math.min(pointer.start.x, pointer.current.x),
          y: canvasMaxY - Math.max(pointer.start.y, pointer.current.y),
          width: Math.abs(pointer.current.x - pointer.start.x),
          height: Math.abs(pointer.current.y - pointer.start.y),
        }
      : null;

  return (
    <div className="min-h-[520px] overflow-hidden border border-zinc-800 bg-zinc-950 p-2 focus-within:border-zinc-500">
      <p className="sr-only" id="project-pattern-editor-instructions">
        Click a package to select it. Control or Command click toggles multiple
        packages. Hold Shift and drag empty pallet space for marquee selection.
        Arrow keys nudge the selection; Shift plus an arrow uses the configured
        coarse step. Press R to rotate, Delete to remove, and Escape to clear.
      </p>
      <svg
        ref={svgRef}
        viewBox={`${envelope.minX} ${envelope.minY} ${width} ${height}`}
        role="application"
        aria-label={`Editable top view of ${pattern.name}`}
        aria-describedby="project-pattern-editor-instructions"
        tabIndex={0}
        data-testid="project-pattern-canvas"
        className="h-full min-h-[500px] w-full touch-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-amber-400"
        onKeyDown={handleKeyDown}
        onPointerDown={startBackground}
        onPointerMove={updatePointer}
        onPointerUp={finishPointer}
        onPointerCancel={() => setPointer(null)}
      >
        <defs>
          <marker
            id={deltaArrowMarkerId}
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
          x={envelope.minX}
          y={envelope.minY}
          width={width}
          height={height}
          fill="#18181b"
          stroke="#71717a"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {project.pallet ? (
          <rect
            x={0}
            y={canvasMaxY - project.pallet.dimensionsMm.width}
            width={project.pallet.dimensionsMm.length}
            height={project.pallet.dimensionsMm.width}
            fill="none"
            stroke="#a1a1aa"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
        <g opacity={0.2} pointerEvents="none" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => {
            const x = envelope.minX + (width * index) / 8;
            const y = envelope.minY + (height * index) / 8;
            return (
              <g key={index}>
                <line
                  x1={x}
                  y1={envelope.minY}
                  x2={x}
                  y2={envelope.maxY}
                  stroke="#71717a"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={envelope.minX}
                  y1={y}
                  x2={envelope.maxX}
                  y2={y}
                  stroke="#71717a"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </g>

        {pattern.placements.map((placement) => {
          const isSelected = selectedPlacementIds.has(placement.id);
          const dragged = draggingIds.has(placement.id);
          const previewPlacement = dragged
            ? {
                ...placement,
                positionMm: {
                  x: placement.positionMm.x + dragDelta.x,
                  y: placement.positionMm.y + dragDelta.y,
                },
              }
            : placement;
          const bounds = placementRectangleBounds(
            previewPlacement,
            project.package.dimensionsMm,
          );
          const x = bounds.minX;
          const y = canvasMaxY - bounds.maxY;
          const rectWidth = bounds.maxX - bounds.minX;
          const rectHeight = bounds.maxY - bounds.minY;
          const group = groupByPlacementId.get(placement.id);
          const grip = placement.gripId ? gripById.get(placement.gripId) : null;
          const path = blueLinePath(
            grip ? parseBlueLine(grip.dx, grip.dy) : placement.labelSide,
            x + rectWidth / 2,
            y + rectHeight / 2,
            rectWidth,
            rectHeight,
          );
          return (
            <g key={placement.id} data-placement-id={placement.id}>
              <rect
                x={x}
                y={y}
                width={rectWidth}
                height={rectHeight}
                rx={3}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Package ${placement.sequence + 1}, X ${placement.positionMm.x}, Y ${placement.positionMm.y}${group ? `, group ${group.groupNumber}, order ${group.orderIndex + 1}` : ", ungrouped"}`}
                fill={isSelected ? "#3f3412" : "#27272a"}
                stroke={isSelected ? "#fbbf24" : "#a1a1aa"}
                strokeWidth={isSelected ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
                className="cursor-grab focus:outline-none focus-visible:stroke-amber-200 active:cursor-grabbing"
                onPointerDown={(event) => startPlacement(event, placement.id)}
                onClick={(event) => clickPlacement(event, placement.id)}
                onPointerMove={updatePointer}
                onPointerUp={finishPointer}
                onPointerCancel={() => setPointer(null)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelectionChange(new Set(selectionUnit(placement.id)));
                }}
              >
                <title>
                  {`Package ${placement.sequence + 1}; ${placement.positionMm.x}, ${placement.positionMm.y} mm; ${placement.rotation}°${group ? `; group ${group.groupNumber}; order ${group.orderIndex + 1}` : "; ungrouped"}`}
                </title>
              </rect>
              {path ? (
                <path
                  d={path}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              ) : null}
              {!grip ? (
                <text
                  x={x + rectWidth / 2}
                  y={y + rectHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#e4e4e7"
                  fontSize={Math.max(
                    11,
                    Math.min(rectWidth, rectHeight) * 0.2,
                  )}
                  fontFamily="ui-monospace, monospace"
                  pointerEvents="none"
                >
                  #{placement.sequence + 1}
                </text>
              ) : null}
            </g>
          );
        })}

        {pattern.grips.map((grip, gripIndex) => {
          const placementIds = gripPlacementIds.get(grip.id) ?? [];
          const placements = placementIds.flatMap((placementId) => {
            const placement = placementById.get(placementId);
            return placement ? [placement] : [];
          });
          if (placements.length === 0) return null;

          const isDragging = placementIds.every((placementId) =>
            draggingIds.has(placementId),
          );
          const footprints = placements.map((placement) => {
            const previewPlacement = isDragging
              ? {
                  ...placement,
                  positionMm: {
                    x: placement.positionMm.x + dragDelta.x,
                    y: placement.positionMm.y + dragDelta.y,
                  },
                }
              : placement;
            const bounds = placementRectangleBounds(
              previewPlacement,
              project.package.dimensionsMm,
            );
            return {
              left: bounds.minX,
              right: bounds.maxX,
              top: canvasMaxY - bounds.maxY,
              bottom: canvasMaxY - bounds.minY,
            };
          });
          const center = {
            x: grip.x + (isDragging ? dragDelta.x : 0),
            y: canvasMaxY - grip.y + (isDragging ? -dragDelta.y : 0),
          };
          const deltaArrow = gripDeltaArrow(center, grip, footprints);
          const firstFootprint = footprints[0]!;
          const groupNumber =
            grip.groupNumber ??
            groupById.get(grip.id)?.groupNumber ??
            gripIndex + 1;
          const isSelected = placementIds.some((placementId) =>
            selectedPlacementIds.has(placementId),
          );

          return (
            <g key={`grip-overlay-${grip.id}`} pointerEvents="none">
              {deltaArrow ? (
                <g data-testid={`grip-delta-${grip.id}`} aria-hidden="true">
                  <line
                    x1={deltaArrow.centerX}
                    y1={deltaArrow.centerY}
                    x2={deltaArrow.endX}
                    y2={deltaArrow.endY}
                    stroke="#fbbf24"
                    strokeWidth={isSelected ? 5 : 2.5}
                    strokeLinecap="round"
                    markerEnd={`url(#${deltaArrowMarkerId})`}
                    vectorEffect="non-scaling-stroke"
                    opacity={isSelected ? 1 : 0.55}
                  />
                  <circle
                    cx={deltaArrow.centerX}
                    cy={deltaArrow.centerY}
                    r={isSelected ? 6 : 4}
                    fill="#fbbf24"
                    opacity={isSelected ? 1 : 0.55}
                    vectorEffect="non-scaling-stroke"
                  />
                  {isSelected ? (
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
              <text
                data-testid={`grip-label-${grip.id}`}
                x={(firstFootprint.left + firstFootprint.right) / 2}
                y={(firstFootprint.top + firstFootprint.bottom) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#e4e4e7"
                fontSize={Math.max(
                  11,
                  Math.min(
                    firstFootprint.right - firstFootprint.left,
                    firstFootprint.bottom - firstFootprint.top,
                  ) * 0.2,
                )}
                fontFamily="ui-monospace, monospace"
              >
                G{groupNumber}
              </text>
            </g>
          );
        })}

        {marquee ? (
          <rect
            data-testid="selection-marquee"
            x={marquee.x}
            y={marquee.y}
            width={marquee.width}
            height={marquee.height}
            fill="#fbbf24"
            fillOpacity={0.08}
            stroke="#fbbf24"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
      </svg>
      <p className="sr-only" role="status" aria-live="polite">
        {selectedPlacementIds.size} package
        {selectedPlacementIds.size === 1 ? "" : "s"} selected.
      </p>
    </div>
  );
}
