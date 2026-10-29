/**
 * Layout for the dimensioned plan field (docs/DESIGN.md "Signature"): the
 * pallet is dimensioned like a technical drawing, with a second, outer chain
 * for the load only when it overhangs the pallet on that axis.
 */
export type PlanBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type DimensionChain = {
  axis: "x" | "y";
  kind: "pallet" | "load";
  /** Extent along the axis, in drawing millimetres. */
  from: number;
  to: number;
  /** Chain position counted outward from the drawing edge (1 = innermost). */
  level: number;
  label: string;
  /** Overhang beyond the pallet at the low / high end (load chains only). */
  overhangStart: number;
  overhangEnd: number;
};

export type PlanFieldGeometry = {
  gutter: number;
  rightGutter: number;
  bottomGutter: number;
  /** Distance between the drawing edge and successive chains. */
  chainSpacing: number;
  chains: DimensionChain[];
};

/** Differences below this are rounding noise, not overhang. */
const OVERHANG_TOLERANCE_MM = 0.5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function axisChains(
  axis: "x" | "y",
  pallet: PlanBounds | null,
  load: PlanBounds | null,
): DimensionChain[] {
  const lo = axis === "x" ? "minX" : "minY";
  const hi = axis === "x" ? "maxX" : "maxY";
  const chains: DimensionChain[] = [];
  if (pallet) {
    chains.push({
      axis,
      kind: "pallet",
      from: pallet[lo],
      to: pallet[hi],
      level: 1,
      label: formatMm(pallet[hi] - pallet[lo]),
      overhangStart: 0,
      overhangEnd: 0,
    });
  }
  if (load) {
    const overhangStart = pallet ? Math.max(0, pallet[lo] - load[lo]) : 0;
    const overhangEnd = pallet ? Math.max(0, load[hi] - pallet[hi]) : 0;
    const overhangs =
      overhangStart > OVERHANG_TOLERANCE_MM ||
      overhangEnd > OVERHANG_TOLERANCE_MM;
    if (!pallet || overhangs) {
      chains.push({
        axis,
        kind: "load",
        from: load[lo],
        to: load[hi],
        level: chains.length + 1,
        label: formatMm(load[hi] - load[lo]),
        overhangStart: round2(overhangStart),
        overhangEnd: round2(overhangEnd),
      });
    }
  }
  return chains;
}

export function planFieldGeometry(
  bounds: PlanBounds,
  pallet: PlanBounds | null,
  load: PlanBounds | null,
): PlanFieldGeometry {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const gutter = round2(Math.max(56, Math.min(width, height) * 0.09));
  const chainSpacing = round2(gutter * 0.45);
  const chains = [
    ...axisChains("x", pallet, load),
    ...axisChains("y", pallet, load),
  ];
  const levels = (axis: "x" | "y") =>
    Math.max(
      1,
      ...chains.filter((chain) => chain.axis === axis).map((c) => c.level),
    );
  return {
    gutter,
    chainSpacing,
    bottomGutter: round2(chainSpacing * (levels("x") + 0.9)),
    rightGutter: round2(chainSpacing * (levels("y") + 0.9)),
    chains,
  };
}

/** Union of the package footprints, or null for an empty layer. */
export function loadBounds(
  items: readonly {
    centerMm: { x: number; y: number };
    sizeMm: { x: number; y: number };
  }[],
): PlanBounds | null {
  if (items.length === 0) return null;
  let result: PlanBounds | null = null;
  for (const item of items) {
    const next = {
      minX: item.centerMm.x - item.sizeMm.x / 2,
      minY: item.centerMm.y - item.sizeMm.y / 2,
      maxX: item.centerMm.x + item.sizeMm.x / 2,
      maxY: item.centerMm.y + item.sizeMm.y / 2,
    };
    result = result
      ? {
          minX: Math.min(result.minX, next.minX),
          minY: Math.min(result.minY, next.minY),
          maxX: Math.max(result.maxX, next.maxX),
          maxY: Math.max(result.maxY, next.maxY),
        }
      : next;
  }
  return result;
}
