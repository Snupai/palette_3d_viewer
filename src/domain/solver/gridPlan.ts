import type { Rotation } from "~/domain/palletTypes";
import { contiguousSuctionGroupSizes } from "~/domain/robotics/grouping";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

export type Grid = {
  x: number;
  y: number;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  rotation: Rotation;
  width: number;
  height?: number;
};
export type GridPlan = {
  transpose: boolean;
  width: number;
  height: number;
  count: number;
  grids: Grid[];
  parameters: GeneratorProvenance["parameters"];
};

export type GridQuantization =
  | "floor"
  | "floor-clamped"
  | "edge-rounded"
  | "floor-step"
  | "floor-pick-step"
  | "nearest"
  | "continuous";
export function materializeGridPlan(
  input: NormalizedLayerSolverInput,
  p: GridPlan,
  grouped: boolean,
  quantization: GridQuantization,
): GeneratedPlacement[] {
  const c = input.constraints,
    gap = input.package.clearanceMm;
  const span = (n: number, d: number) => n * d + Math.max(0, n - 1) * gap;
  const bounds = input.generationBoundsMm;
  const ox =
    (bounds.minX + bounds.maxX - (p.transpose ? p.height : p.width)) / 2;
  const oy =
    (bounds.minY + bounds.maxY - (p.transpose ? p.width : p.height)) / 2;
  const placements: GeneratedPlacement[] = [];
  for (const g of p.grids) {
    const line = (
      start: number,
      count: number,
      item: number,
      available: number,
      pickup: boolean,
    ) => {
      const continuous = Array.from({ length: count }, (_, i) =>
        count === 1
          ? start + available / 2
          : start + item / 2 + (i * (available - item)) / (count - 1),
      );
      let values = continuous;
      if (grouped && pickup && gap === 0) {
        let offset = 0;
        values = contiguousSuctionGroupSizes(
          count,
          c.provisionalPackagesPerCycle,
          g.rotation,
          c.suctionRemainderPolicy,
        ).flatMap((size) => {
          const center =
            (continuous[offset]! + continuous[offset + size - 1]!) / 2;
          offset += size;
          return Array.from(
            { length: size },
            (_, i) =>
              (quantization === "continuous"
                ? center
                : quantization === "nearest"
                  ? Math.round(center)
                  : Math.floor(center + 1e-9)) +
              (i - (size - 1) / 2) * item,
          );
        });
      } else if (quantization === "floor")
        values = continuous.map((v) => Math.floor(v + 1e-9));
      else if (quantization === "nearest")
        values = continuous.map((v) =>
          Math.max(
            start + item / 2,
            Math.min(start + available - item / 2, Math.round(v)),
          ),
        );
      else if (quantization === "floor-clamped")
        values = continuous.map((v) =>
          Math.max(
            start + item / 2,
            Math.min(start + available - item / 2, Math.floor(v + 1e-9)),
          ),
        );
      else if (quantization === "floor-step" && count > 1)
        values = continuous.map(
          (_, i) =>
            Math.floor(continuous[0]! + 1e-9) +
            i * Math.floor((available - item) / (count - 1) + 1e-9),
        );
      else if (quantization === "floor-pick-step" && count > 1) {
        const units = c.provisionalPackagesPerCycle;
        const step =
          Math.floor(((available - item) / (count - 1)) * units + 1e-9) / units;
        values = continuous.map((_, i) =>
          Math.max(
            start + item / 2,
            Math.floor(continuous[0]! + i * step + 1e-9),
          ),
        );
      } else if (quantization === "edge-rounded") {
        const shift = Math.floor(start + 1e-9) - start;
        values = continuous.map((v) =>
          Math.max(
            start + item / 2,
            Math.min(
              start + available - item / 2,
              Math.ceil(v + shift - 0.5 - 1e-9),
            ),
          ),
        );
      }
      const fits = values.every(
        (v, i) =>
          v >= start + item / 2 - 1e-9 &&
          v <= start + available - item / 2 + 1e-9 &&
          (i === 0 || v - values[i - 1]! >= item + gap - 1e-9),
      );
      return fits ? values : continuous;
    };
    const xs = p.transpose
      ? line(
          ox + g.y,
          g.rows,
          g.dy,
          g.height ?? span(g.rows, g.dy),
          g.rotation % 180 === 0,
        )
      : line(ox + g.x, g.cols, g.dx, g.width, g.rotation % 180 === 0);
    const ys = p.transpose
      ? line(oy + g.x, g.cols, g.dx, g.width, g.rotation % 180 !== 0)
      : line(
          oy + g.y,
          g.rows,
          g.dy,
          g.height ?? span(g.rows, g.dy),
          g.rotation % 180 !== 0,
        );
    for (const y of ys)
      for (const x of xs)
        placements.push({ positionMm: { x, y }, rotation: g.rotation });
  }

  return placements;
}
