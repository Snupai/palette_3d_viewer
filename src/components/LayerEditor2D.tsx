"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Grip, Rotation } from "~/lib/robParser";
import {
  findGripCollision,
  footprintSize,
  gripsToBoxes,
  mergeGrips,
  pickOffsetForCount,
  splitGrip,
} from "~/lib/robParser";

type LayerEditor2DProps = {
  uniqueLayerId: number;
  grips: Grip[];
  packageWidth: number;
  packageLength: number;
  inputDirection: 0 | 1;
  pallet: { width: number; length: number } | null;
  selectedGripIndex: number | null;
  onSelectGrip: (index: number | null) => void;
  onCommitGrips: (nextGrips: Grip[]) => void;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  layerSelector?: ReactNode;
};

type DragState = {
  gripIndex: number;
  gripId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  pickX: number;
  pickY: number;
  pickPlaceOffsetX: number;
  pickPlaceOffsetY: number;
};

type NumericDraft = {
  pickX: string;
  pickY: string;
  pickRotation: string;
  x: string;
  y: string;
  rotation: string;
  dx: string;
  dy: string;
};

const INPUT_CLASS =
  "w-full rounded border border-cyan-500/20 bg-slate-950/50 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-0";
const COLLISION_MESSAGE = "Boxes cannot overlap. The change was not applied.";

function createGripId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `grip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function gripDraft(grip: Grip | null): NumericDraft {
  return {
    pickX: grip ? String(grip.pickX) : "",
    pickY: grip ? String(grip.pickY) : "",
    pickRotation: grip ? String(grip.pickRotation) : "",
    x: grip ? String(grip.x) : "",
    y: grip ? String(grip.y) : "",
    rotation: grip ? String(grip.rotation) : "",
    dx: grip ? String(grip.dx) : "",
    dy: grip ? String(grip.dy) : "",
  };
}

function blueLinePath(
  blueLine: ReturnType<typeof gripsToBoxes>[number]["blueLine"],
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

type EditorBox = ReturnType<typeof gripsToBoxes>[number];

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
  // dx/dy encode the marked package side: +dx is left, +dy is bottom.
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

export function LayerEditor2D({
  uniqueLayerId,
  grips,
  packageWidth,
  packageLength,
  inputDirection,
  pallet,
  selectedGripIndex,
  onSelectGrip,
  onCommitGrips,
  hasUnsavedChanges,
  isSaving,
  onSave,
  onDiscard,
  layerSelector,
}: LayerEditor2DProps) {
  const palletWidth = pallet?.width ?? 1200;
  const palletLength = pallet?.length ?? 800;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [mergeSelection, setMergeSelection] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  const previewGrips = useMemo(() => {
    if (!drag) return grips;
    return grips.map((grip, index) =>
      index === drag.gripIndex
        ? {
            ...grip,
            pickX: drag.pickX,
            pickY: drag.pickY,
            x: drag.x,
            y: drag.y,
          }
        : grip,
    );
  }, [drag, grips]);
  const selectedGrip =
    selectedGripIndex === null
      ? null
      : (previewGrips[selectedGripIndex] ?? null);
  const [draft, setDraft] = useState<NumericDraft>(() =>
    gripDraft(selectedGrip),
  );

  useEffect(() => {
    setDrag(null);
    setMergeSelection(new Set());
    setMessage(null);
  }, [uniqueLayerId]);

  useEffect(() => {
    setDraft(gripDraft(selectedGrip));
  }, [selectedGrip]);

  useEffect(() => {
    if (selectedGripIndex !== null && selectedGripIndex >= grips.length) {
      onSelectGrip(null);
    }
  }, [grips.length, onSelectGrip, selectedGripIndex]);

  const boxesByGrip = useMemo(
    () =>
      previewGrips.map((grip) =>
        gripsToBoxes([grip], packageWidth, packageLength, 0, inputDirection),
      ),
    [inputDirection, packageLength, packageWidth, previewGrips],
  );

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

  const withReplacedGrip = (index: number, nextGrip: Grip) =>
    grips.map((grip, gripIndex) => (gripIndex === index ? nextGrip : grip));

  const hasCollision = (nextGrips: Grip[]) =>
    findGripCollision(
      nextGrips,
      packageWidth,
      packageLength,
      inputDirection,
    ) !== null;

  const replaceGrip = (index: number, nextGrip: Grip) => {
    onCommitGrips(withReplacedGrip(index, nextGrip));
  };

  const replacePlacedGrip = (index: number, nextGrip: Grip) => {
    const next = withReplacedGrip(index, nextGrip);
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      setDraft(gripDraft(grips[index] ?? null));
      return false;
    }
    setMessage(null);
    onCommitGrips(next);
    return true;
  };

  const selectForPointer = (
    event: ReactPointerEvent<SVGRectElement>,
    gripIndex: number,
  ) => {
    const grip = previewGrips[gripIndex];
    if (!grip) return;
    event.stopPropagation();
    setMessage(null);
    onSelectGrip(gripIndex);

    if (event.shiftKey) {
      setMergeSelection((current) => {
        const next = new Set(current);
        if (next.has(gripIndex)) next.delete(gripIndex);
        else next.add(gripIndex);
        return next;
      });
      return;
    }

    setMergeSelection(new Set([gripIndex]));
    const point = clientToPallet(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      gripIndex,
      gripId: grip.id,
      offsetX: point.x - grip.x,
      offsetY: point.y - grip.y,
      x: grip.x,
      y: grip.y,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickPlaceOffsetX: grip.pickX - grip.x,
      pickPlaceOffsetY: grip.pickY - grip.y,
    });
  };

  const updateDrag = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId))
      return;
    const point = clientToPallet(event.clientX, event.clientY);
    if (!point) return;
    const x = Math.round(point.x - drag.offsetX);
    const y = Math.round(point.y - drag.offsetY);
    const currentGrip = grips[drag.gripIndex];
    if (!currentGrip || currentGrip.id !== drag.gripId) return;
    const candidate = {
      ...currentGrip,
      x,
      y,
      pickX: x + drag.pickPlaceOffsetX,
      pickY: y + drag.pickPlaceOffsetY,
    };
    if (hasCollision(withReplacedGrip(drag.gripIndex, candidate))) {
      setMessage(COLLISION_MESSAGE);
      return;
    }
    setMessage(null);
    setDrag((current) =>
      current
        ? {
            ...current,
            x,
            y,
            pickX: x + current.pickPlaceOffsetX,
            pickY: y + current.pickPlaceOffsetY,
          }
        : null,
    );
  };

  const commitDrag = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!drag) return;
    const point = clientToPallet(event.clientX, event.clientY);
    const currentGrip = grips[drag.gripIndex];
    setDrag(null);
    if (!point || !currentGrip || currentGrip.id !== drag.gripId) return;
    const pointerX = Math.round(point.x - drag.offsetX);
    const pointerY = Math.round(point.y - drag.offsetY);
    const pointerCandidate = {
      ...currentGrip,
      pickX: pointerX + drag.pickPlaceOffsetX,
      pickY: pointerY + drag.pickPlaceOffsetY,
      x: pointerX,
      y: pointerY,
    };
    const pointerCollides = hasCollision(
      withReplacedGrip(drag.gripIndex, pointerCandidate),
    );
    const x = pointerCollides ? drag.x : pointerX;
    const y = pointerCollides ? drag.y : pointerY;
    if (pointerCollides) setMessage(COLLISION_MESSAGE);
    if (x === currentGrip.x && y === currentGrip.y) return;
    replaceGrip(drag.gripIndex, {
      ...currentGrip,
      pickX: x + drag.pickPlaceOffsetX,
      pickY: y + drag.pickPlaceOffsetY,
      x,
      y,
    });
  };

  const commitDraftField = (field: keyof NumericDraft) => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip) return;
    const value = Number(draft[field]);
    if (!Number.isFinite(value)) {
      setDraft(gripDraft(grip));
      return;
    }

    const rounded = Math.round(value);
    if (
      (field === "rotation" || field === "pickRotation") &&
      !([0, 90, 180, 270] as number[]).includes(rounded)
    ) {
      setMessage("Rotation must be 0°, 90°, 180°, or 270°.");
      setDraft(gripDraft(grip));
      return;
    }

    setMessage(null);
    if (field === "x") {
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickX: grip.pickX + rounded - grip.x,
        x: rounded,
      });
    } else if (field === "y") {
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickY: grip.pickY + rounded - grip.y,
        y: rounded,
      });
    } else if (field === "rotation") {
      const rotationDelta = (rounded - grip.rotation + 360) % 360;
      replacePlacedGrip(selectedGripIndex, {
        ...grip,
        pickRotation: ((grip.pickRotation + rotationDelta) % 360) as Rotation,
        rotation: rounded as Rotation,
      });
    } else if (field === "pickX") {
      replaceGrip(selectedGripIndex, { ...grip, pickX: rounded });
    } else if (field === "pickY") {
      replaceGrip(selectedGripIndex, { ...grip, pickY: rounded });
    } else if (field === "pickRotation") {
      replaceGrip(selectedGripIndex, {
        ...grip,
        pickRotation: rounded as Rotation,
      });
    } else if (field === "dx") {
      replaceGrip(selectedGripIndex, { ...grip, dx: rounded });
    } else {
      replaceGrip(selectedGripIndex, { ...grip, dy: rounded });
    }
  };

  const rotateSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip) return;
    const rotations: Rotation[] = [0, 90, 180, 270];
    const nextIndex = (rotations.indexOf(grip.rotation) + 1) % rotations.length;
    replacePlacedGrip(selectedGripIndex, {
      ...grip,
      pickRotation:
        rotations[
          (rotations.indexOf(grip.pickRotation) + 1) % rotations.length
        ]!,
      rotation: rotations[nextIndex]!,
    });
  };

  const splitSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip || grip.numPackages <= 1) return;
    const split = splitGrip(grip, packageWidth, packageLength, inputDirection);
    const next = [
      ...grips.slice(0, selectedGripIndex),
      ...split,
      ...grips.slice(selectedGripIndex + 1),
    ];
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      return;
    }
    setMergeSelection(
      new Set(split.map((_, index) => selectedGripIndex + index)),
    );
    setMessage(`${split.length} single packages created.`);
    onSelectGrip(selectedGripIndex);
    onCommitGrips(next);
  };

  const mergeSelected = () => {
    const selected = grips.filter((_, index) => mergeSelection.has(index));
    const merged = mergeGrips(
      selected,
      packageWidth,
      packageLength,
      inputDirection,
    );
    if (!merged) {
      setMessage(
        "Selected packages must share compatible pick/place rotations, pick origins, and even place spacing.",
      );
      return;
    }

    const firstIndex = Math.min(...mergeSelection);
    const next: Grip[] = [];
    grips.forEach((grip, index) => {
      if (index === firstIndex) next.push(merged);
      if (!mergeSelection.has(index)) next.push(grip);
    });
    if (hasCollision(next)) {
      setMessage(COLLISION_MESSAGE);
      return;
    }
    setMergeSelection(new Set([firstIndex]));
    setMessage(`${selected.length} packages merged into one grip.`);
    onSelectGrip(firstIndex);
    onCommitGrips(next);
  };

  const deleteSelected = () => {
    if (selectedGripIndex === null) return;
    const grip = grips[selectedGripIndex];
    if (!grip || !window.confirm("Delete this grip group?")) return;
    const next = grips.filter((_, index) => index !== selectedGripIndex);
    setMergeSelection(new Set());
    setMessage("Grip group deleted.");
    onSelectGrip(null);
    onCommitGrips(next);
  };

  const addPackage = () => {
    const reference = selectedGrip ?? grips[0] ?? null;
    const pickRotation = reference?.pickRotation ?? 0;
    const referencePickOffset = reference
      ? pickOffsetForCount(
          packageWidth,
          packageLength,
          inputDirection,
          pickRotation,
          reference.numPackages,
        )
      : { x: 0, y: 0 };
    const singlePickOffset = pickOffsetForCount(
      packageWidth,
      packageLength,
      inputDirection,
      pickRotation,
      1,
    );
    const pickOriginX = reference ? reference.pickX - referencePickOffset.x : 0;
    const pickOriginY = reference ? reference.pickY - referencePickOffset.y : 0;
    const baseGrip: Grip = {
      id: createGripId(),
      pickX: pickOriginX + singlePickOffset.x,
      pickY: pickOriginY + singlePickOffset.y,
      pickRotation,
      x: Math.round(palletWidth / 2),
      y: Math.round(palletLength / 2),
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const box = gripsToBoxes(
      [baseGrip],
      packageWidth,
      packageLength,
      0,
      inputDirection,
    )[0];
    if (!box) return;
    const size = footprintSize(box);
    const existingBoxes = gripsToBoxes(
      grips,
      packageWidth,
      packageLength,
      0,
      inputDirection,
    );
    const xCandidates = new Set<number>([
      Math.round(palletWidth / 2),
      size.width / 2,
      palletWidth - size.width / 2,
    ]);
    const yCandidates = new Set<number>([
      Math.round(palletLength / 2),
      size.length / 2,
      palletLength - size.length / 2,
    ]);
    for (const existing of existingBoxes) {
      const existingSize = footprintSize(existing);
      xCandidates.add(
        existing.rect.x - existingSize.width / 2 - size.width / 2,
      );
      xCandidates.add(
        existing.rect.x + existingSize.width / 2 + size.width / 2,
      );
      yCandidates.add(
        existing.rect.y - existingSize.length / 2 - size.length / 2,
      );
      yCandidates.add(
        existing.rect.y + existingSize.length / 2 + size.length / 2,
      );
    }
    const candidates = [...xCandidates]
      .flatMap((x) => [...yCandidates].map((y) => ({ x, y })))
      .filter(
        ({ x, y }) =>
          x >= size.width / 2 &&
          x <= palletWidth - size.width / 2 &&
          y >= size.length / 2 &&
          y <= palletLength - size.length / 2,
      )
      .sort(
        (a, b) =>
          (a.x - palletWidth / 2) ** 2 +
          (a.y - palletLength / 2) ** 2 -
          ((b.x - palletWidth / 2) ** 2 + (b.y - palletLength / 2) ** 2),
      );
    const freePosition = candidates.find(
      ({ x, y }) => !hasCollision([...grips, { ...baseGrip, x, y }]),
    );
    if (!freePosition) {
      setMessage("No non-overlapping position is available on the pallet.");
      return;
    }
    const nextGrip = { ...baseGrip, ...freePosition };
    const next = [...grips, nextGrip];
    setMergeSelection(new Set([next.length - 1]));
    setMessage("Package added at the nearest free position.");
    onSelectGrip(next.length - 1);
    onCommitGrips(next);
  };

  const fieldInput = (
    label: string,
    field: keyof NumericDraft,
    options?: { readOnly?: boolean },
  ) => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      <span>{label}</span>
      <input
        type="number"
        value={draft[field]}
        readOnly={options?.readOnly}
        disabled={!selectedGrip}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            [field]: event.target.value,
          }))
        }
        onBlur={() => commitDraftField(field)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(gripDraft(selectedGrip));
        }}
        className={`${INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-45 ${
          options?.readOnly ? "cursor-default text-slate-400" : ""
        }`}
      />
    </label>
  );

  return (
    <section className="rounded border border-cyan-500/15 bg-slate-900/70 p-4 shadow-lg shadow-cyan-500/10 backdrop-blur">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-cyan-200">
            Unique Layer {uniqueLayerId} Editor
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Dragging moves pick and place together. Shift-click packages to
            build a merge selection.
          </p>
        </div>
        {layerSelector}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs ${
                hasUnsavedChanges ? "text-amber-200" : "text-emerald-200"
              }`}
              role="status"
            >
              {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              type="button"
              onClick={onSave}
              disabled={!hasUnsavedChanges || isSaving}
              className="cursor-pointer rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={!hasUnsavedChanges || isSaving}
              className="cursor-pointer rounded border border-amber-400/30 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard changes
            </button>
          </div>
          <button
            type="button"
            onClick={addPackage}
            className="cursor-pointer rounded bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Add package
          </button>
          <button
            type="button"
            onClick={splitSelected}
            disabled={!selectedGrip || selectedGrip.numPackages <= 1}
            className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Split into singles
          </button>
          <button
            type="button"
            onClick={mergeSelected}
            disabled={mergeSelection.size < 2}
            className="cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Merge selected ({mergeSelection.size})
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            disabled={!selectedGrip}
            className="cursor-pointer rounded border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete group
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-h-[300px] overflow-hidden rounded border border-cyan-500/15 bg-slate-950/70 p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${palletWidth} ${palletLength}`}
            role="application"
            aria-label={`Top-down editor for unique layer ${uniqueLayerId}`}
            className="h-full min-h-[276px] w-full touch-none"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              onSelectGrip(null);
              setMergeSelection(new Set());
              setMessage(null);
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
              rx={10}
              fill="#0f2237"
              stroke="#64748b"
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
                    stroke="#67e8f9"
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
                    stroke="#67e8f9"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>

            {boxesByGrip.map((boxes, gripIndex) => {
              const grip = previewGrips[gripIndex]!;
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
                              ? "#155e75"
                              : isMergeSelected
                                ? "#164e63"
                                : "#1e293b"
                          }
                          stroke={
                            isPrimary || isMergeSelected ? "#67e8f9" : "#94a3b8"
                          }
                          strokeWidth={isPrimary ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                          className="cursor-grab active:cursor-grabbing"
                          onPointerDown={(event) =>
                            selectForPointer(event, gripIndex)
                          }
                          onPointerMove={updateDrag}
                          onPointerUp={commitDrag}
                          onPointerCancel={() => setDrag(null)}
                        />
                        {path ? (
                          <path
                            d={path}
                            fill="none"
                            stroke="#38bdf8"
                            strokeWidth={5}
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
                        strokeWidth={isPrimary ? 5 : 3}
                        strokeLinecap="round"
                        markerEnd={`url(#grip-delta-arrow-${uniqueLayerId})`}
                        vectorEffect="non-scaling-stroke"
                        opacity={isPrimary ? 1 : 0.8}
                      />
                      <circle
                        cx={deltaArrow.centerX}
                        cy={deltaArrow.centerY}
                        r={isPrimary ? 6 : 4}
                        fill="#fbbf24"
                        vectorEffect="non-scaling-stroke"
                      />
                      {isPrimary ? (
                        <text
                          x={deltaArrow.labelX}
                          y={deltaArrow.labelY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#fef3c7"
                          stroke="#0f172a"
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
                      fill="#e0f2fe"
                      fontSize={Math.max(
                        18,
                        Math.min(firstBoxSize.width, firstBoxSize.length) *
                          0.16,
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

        <aside className="rounded border border-cyan-500/10 bg-slate-950/35 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-cyan-200">
              Grip details
            </h3>
            <span className="font-mono text-[10px] text-cyan-200/70">
              {selectedGripIndex === null
                ? "none"
                : `${selectedGripIndex + 1}/${grips.length}`}
            </span>
          </div>
          <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
            Place pose
          </p>
          <div className="grid grid-cols-2 gap-2">
            {fieldInput("Place X", "x")}
            {fieldInput("Place Y", "y")}
            {fieldInput("Place rotation", "rotation")}
          </div>
          <p className="mt-4 mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
            Pick pose
          </p>
          <div className="grid grid-cols-2 gap-2">
            {fieldInput("Pick X", "pickX")}
            {fieldInput("Pick Y", "pickY")}
            {fieldInput("Pick rotation", "pickRotation")}
          </div>
          <p className="mt-4 mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
            Grip
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>Packages</span>
              <input
                type="number"
                value={selectedGrip?.numPackages ?? ""}
                readOnly
                disabled={!selectedGrip}
                className={`${INPUT_CLASS} cursor-default text-slate-400 disabled:cursor-not-allowed disabled:opacity-45`}
              />
            </label>
            {fieldInput("dx", "dx")}
            {fieldInput("dy", "dy")}
          </div>
          <button
            type="button"
            onClick={rotateSelected}
            disabled={!selectedGrip}
            className="mt-3 w-full cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Rotate 90°
          </button>
          {message ? (
            <p
              className="mt-3 text-xs leading-relaxed text-cyan-100"
              role="status"
            >
              {message}
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
