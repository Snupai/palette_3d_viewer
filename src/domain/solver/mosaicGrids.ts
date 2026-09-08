import { rectangleSizeForRotation } from "~/domain/geometry";
import {
  materializeGridPlan,
  type Grid,
  type GridPlan,
} from "~/domain/solver/gridPlan";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";
import type { Rotation } from "~/domain/palletTypes";
import { buildRingMosaics } from "~/domain/solver/ringMosaics";
import { buildAsymmetricRings } from "~/domain/solver/asymmetricRings";

/** A mixed column strip can itself occupy any seam between uniform row bands. */
export function searchMosaicGrids(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  workLimit = 300_000,
  family: "mosaic" | "asymmetric-ring" | "nested-strip" = "mosaic",
) {
  let workUsed = 0,
    limited = false;
  let phaseLimit = Math.floor(workLimit / 2);
  const debit = (n = 1) => {
    if (!shouldContinue()) return false;
    if (workUsed + n > phaseLimit) {
      limited = true;
      return false;
    }
    workUsed += n;
    return true;
  };
  const done = () => ({ workUsed, limited });
  const c = input.constraints;
  if (!c.allowMixedPackageOrientations || c.requiredShape !== "any")
    return done();
  const rotations = [
    c.allowedRotations.find((r) => r === 0) ??
      c.allowedRotations.find((r) => r === 180),
    c.allowedRotations.find((r) => r === 90) ??
      c.allowedRotations.find((r) => r === 270),
  ];
  if (rotations.some((r) => r === undefined)) return done();
  const gap = input.package.clearanceMm;
  const span = (n: number, d: number) => n * d + Math.max(0, n - 1) * gap;
  const maximum = (available: number, d: number) =>
    Math.max(
      0,
      Math.min(c.maxBands, Math.floor((available + gap + 1e-9) / (d + gap))),
    );
  const plans: GridPlan[] =
    family === "mosaic"
      ? buildRingMosaics(input, () => debit())
      : family === "asymmetric-ring"
        ? buildAsymmetricRings(input, () => debit())
        : [];
  const keys = new Set<string>();
  const bounds = input.generationBoundsMm;
  search: for (const transpose of [false, true]) {
    if (family !== "nested-strip") break;
    const aw = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const ah = transpose
      ? bounds.maxX - bounds.minX
      : bounds.maxY - bounds.minY;
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const size = rectangleSizeForRotation(
        input.package.dimensionsMm,
        rotation,
      );
      const dx = transpose ? size.width : size.length,
        dy = transpose ? size.length : size.width;
      const widths = new Set([
        span(maximum(aw, dx), dx),
        span(maximum(aw, dy), dy),
      ]);
      for (let a = 1; a <= maximum(aw, dx); a++) {
        const b = maximum(aw - span(a, dx) - gap, dy);
        if (b) widths.add(span(a, dx) + gap + span(b, dy));
      }
      for (const width of [...widths].sort((a, b) => b - a)) {
        const columns = maximum(width, dx);
        for (let rows = 1; rows < maximum(ah, dy); rows++) {
          for (
            let crossRows = 1;
            crossRows <= maximum(ah - span(rows, dy) - gap, dx);
            crossRows++
          ) {
            const stripHeight = span(crossRows, dx);
            const height = span(rows, dy) + gap + stripHeight;
            // A full extra row would dominate this root without changing its topology.
            if (height + Math.min(dx, dy) + gap <= ah + 1e-9) continue;
            for (const stripRotation of [rotation, other]) {
              const sx = stripRotation === rotation ? dx : dy;
              const sy = stripRotation === rotation ? dy : dx;
              if (!maximum(stripHeight, sx) || !maximum(stripHeight, sy))
                continue;
              const insertedRotation =
                stripRotation === rotation ? other : rotation;
              for (let a = 1; a <= maximum(width, sx); a++) {
                const b = maximum(width - span(a, sx) - gap, sy);
                if (!b) continue;
                const splits = Array.from({ length: a + 1 }, (_, i) => i).sort(
                  (x, y) => Math.abs(x - a / 2) - Math.abs(y - a / 2) || x - y,
                );
                for (const split of splits) {
                  if (!debit()) break search;
                  const separators = split > 0 && split < a ? 2 : 1;
                  const insertedWidth =
                    width -
                    span(split, sx) -
                    span(a - split, sx) -
                    separators * gap;
                  if (span(b, sy) > insertedWidth + 1e-9) continue;
                  for (let seam = 0; seam <= rows; seam++) {
                    const rowSeparators = seam > 0 && seam < rows ? 2 : 1;
                    const totalHeight = height + (rowSeparators - 1) * gap;
                    if (totalHeight > ah + 1e-9) continue;
                    const stripY = seam ? span(seam, dy) + gap : 0;
                    const leftWidth = span(split, sx);
                    const insertedX = leftWidth + (split ? gap : 0);
                    const rightX =
                      insertedX + insertedWidth + (split < a ? gap : 0);
                    for (const compactParent of [false, true])
                      for (const alignment of [
                        "start",
                        "center",
                        "end",
                        "distributed",
                      ] as const) {
                        const grids: Grid[] = [];
                        const parentWidth = compactParent
                          ? span(columns, dx)
                          : width;
                        if (seam)
                          grids.push({
                            x: 0,
                            y: 0,
                            cols: columns,
                            rows: seam,
                            dx,
                            dy,
                            rotation,
                            width: parentWidth,
                          });
                        if (seam < rows)
                          grids.push({
                            x: 0,
                            y: stripY + stripHeight + gap,
                            cols: columns,
                            rows: rows - seam,
                            dx,
                            dy,
                            rotation,
                            width: parentWidth,
                          });
                        for (const region of [
                          {
                            x: 0,
                            width: leftWidth,
                            cols: split,
                            dx: sx,
                            dy: sy,
                            rotation: stripRotation,
                          },
                          {
                            x: insertedX,
                            width: insertedWidth,
                            cols: b,
                            dx: sy,
                            dy: sx,
                            rotation: insertedRotation,
                          },
                          {
                            x: rightX,
                            width: span(a - split, sx),
                            cols: a - split,
                            dx: sx,
                            dy: sy,
                            rotation: stripRotation,
                          },
                        ]) {
                          if (!region.cols) continue;
                          const nr = maximum(stripHeight, region.dy);
                          if (!nr) continue;
                          const used = span(nr, region.dy);
                          const y =
                            stripY +
                            (alignment === "end"
                              ? stripHeight - used
                              : alignment === "center"
                                ? (stripHeight - used) / 2
                                : 0);
                          grids.push({
                            ...region,
                            y,
                            rows: nr,
                            height:
                              alignment === "distributed" ? stripHeight : used,
                          });
                        }
                        const count = grids.reduce(
                          (s, g) => s + g.cols * g.rows,
                          0,
                        );
                        if (
                          count < c.minimumPackageCount ||
                          count > c.maximumPackageCount ||
                          count > c.maxPlacements
                        )
                          continue;
                        const key = JSON.stringify([
                          transpose,
                          width,
                          totalHeight,
                          grids,
                        ]);
                        if (keys.has(key)) continue;
                        keys.add(key);
                        plans.push({
                          transpose,
                          width,
                          height: totalHeight,
                          count,
                          grids,
                          parameters: {
                            kind: "nested-mixed-strip",
                            rotation,
                            rows,
                            crossRows,
                            stripRotation,
                            columns: a,
                            insertedColumns: b,
                            split,
                            seam,
                            alignment,
                            compactParent,
                          },
                        });
                      }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  phaseLimit = workLimit;
  plans.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  // Sample each structural partition before spending the budget on all seam and
  // alignment permutations of the first partition.
  const buckets = new Map<string, GridPlan[]>();
  for (const plan of plans) {
    const p = plan.parameters!;
    const key = JSON.stringify([
      p.kind,
      plan.transpose,
      plan.width,
      plan.height,
      p.rotation,
      p.rows,
      p.crossRows,
      p.stripRotation,
      p.columns,
      p.insertedColumns,
      p.crossColumns,
      p.capRotation,
      p.capRows,
      p.sideRotation,
      p.sideCols,
      p.bottomColumns,
      p.bottomRows,
    ]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(plan);
    buckets.set(key, bucket);
  }
  const interleaved: GridPlan[] = [];
  const groups = [...buckets.values()];
  if (family === "nested-strip") {
    const alignments = ["start", "distributed", "center", "end"];
    for (const bucket of groups)
      bucket.sort((a, b) => {
        const p = a.parameters!,
          q = b.parameters!;
        return (
          Number(p.seam) - Number(q.seam) ||
          Number(p.compactParent) - Number(q.compactParent) ||
          alignments.indexOf(String(p.alignment)) -
            alignments.indexOf(String(q.alignment))
        );
      });
  }
  for (let i = 0; i < Math.max(0, ...groups.map((g) => g.length)); i += 4)
    for (const g of groups)
      for (let j = i; j < i + 4; j++) if (g[j]) interleaved.push(g[j]!);
  const emittedGeometry = new Set<string>();
  for (const plan of interleaved)
    for (const grouped of [false, true])
      for (const quantization of [
        "floor-clamped",
        "edge-rounded",
        "floor-step",
        "continuous",
      ] as const) {
        if (!debit()) return done();
        const placements = materializeGridPlan(
          input,
          plan,
          grouped,
          quantization,
        );
        const geometry = placements
          .map((p) => `${p.rotation % 180}:${p.positionMm.x}:${p.positionMm.y}`)
          .sort()
          .join(";");
        if (emittedGeometry.has(geometry)) continue;
        emittedGeometry.add(geometry);
        if (!debit(plan.count)) return done();
        if (
          !emit(placements, {
            family,
            variant: String(plan.parameters?.kind),
            parameters: {
              ...plan.parameters,
              transpose: plan.transpose,
              width: plan.width,
              height: plan.height,
              grouped,
              quantization,
            },
          })
        )
          return done();
      }
  return done();
}
