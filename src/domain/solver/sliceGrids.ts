import { rectangleSizeForRotation } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

import {
  materializeGridPlan,
  type Grid,
  type GridPlan as Plan,
} from "~/domain/solver/gridPlan";

/** Enumerate band seams and paired, oppositely capped rasters from integer grid counts. */
export function searchSliceGrids(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  workLimit = 100_000,
  family: "slice-grid" | "paired-grid" = "slice-grid",
): { workUsed: number; limited: boolean } {
  const c = input.constraints;
  let workUsed = 0;
  const done = (limited = false) => ({ workUsed, limited });
  const debit = (amount = 1) => {
    if (!shouldContinue() || workUsed + amount > workLimit) return false;
    workUsed += amount;
    return true;
  };
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
  const maximum = (a: number, d: number) =>
    Math.max(0, Math.min(c.maxBands, Math.floor((a + gap + 1e-9) / (d + gap))));
  const bounds = input.generationBoundsMm;
  const plans: Plan[] = [];
  const planKeys = new Set<string>();
  const add = (
    transpose: boolean,
    width: number,
    height: number,
    grids: Grid[],
    parameters: Plan["parameters"],
  ) => {
    grids = grids.filter((g) => g.cols > 0 && g.rows > 0);
    const count = grids.reduce((s, g) => s + g.cols * g.rows, 0);
    if (
      count >= c.minimumPackageCount &&
      count <= c.maximumPackageCount &&
      count <= c.maxPlacements
    )
      for (const reflectX of family === "paired-grid"
        ? [false, true]
        : [false]) {
        const regions = reflectX
          ? grids.map((g) => ({ ...g, x: width - g.x - g.width }))
          : grids;
        const key = JSON.stringify([transpose, width, height, regions]);
        if (planKeys.has(key)) continue;
        planKeys.add(key);
        plans.push({
          transpose,
          width,
          height,
          count,
          grids: regions,
          parameters: { ...parameters, reflectX },
        });
      }
  };
  for (const transpose of [false, true]) {
    const width = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const height = transpose
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
      const n = maximum(width, dx),
        m = maximum(width, dy);
      if (!n || !m) continue;
      for (let a = 1; a <= maximum(height, dy); a++)
        for (let b = 1; b <= maximum(height - span(a, dy) - gap, dx); b++) {
          if (!debit()) return done(shouldContinue());
          const h = span(a, dy) + gap + span(b, dx);
          if (family === "slice-grid") {
            for (const w of new Set([
              Math.max(span(n, dx), span(m, dy)),
              width,
            ]))
              for (let split = 0; split <= a; split++) {
                if (!debit()) return done(shouldContinue());
                const middle = split ? span(split, dy) + gap : 0;
                add(
                  transpose,
                  w,
                  h,
                  [
                    {
                      x: 0,
                      y: 0,
                      cols: n,
                      rows: split,
                      dx,
                      dy,
                      rotation,
                      width: w,
                    },
                    {
                      x: 0,
                      y: middle,
                      cols: m,
                      rows: b,
                      dx: dy,
                      dy: dx,
                      rotation: other,
                      width: w,
                    },
                    {
                      x: 0,
                      y: middle + span(b, dx) + gap,
                      cols: n,
                      rows: a - split,
                      dx,
                      dy,
                      rotation,
                      width: w,
                    },
                  ],
                  { rotation, rows: a, crossRows: b, split },
                );
              }
          } else {
            const w = span(n, dx);
            const capHeight = span(b, dx);
            for (let left = 1; left < n; left++)
              for (let right = 1; right < n; right++) {
                if (!debit()) return done(shouldContinue());
                if (left + right > n && 2 * capHeight + gap > h + 1e-9)
                  continue;
                const lw = span(left, dx),
                  rw = span(right, dx);
                const lc = maximum(lw, dy),
                  rc = maximum(rw, dy);
                if (!lc || !rc) continue;
                // The shared columns between the caps are shorter than either outer arm.
                const cuts = [...new Set([0, left, n - right, n])].sort(
                  (a, b) => a - b,
                );
                for (const alignment of ["end", "start", "center"] as const)
                  for (const compactLeft of [true, false])
                    for (const compactRight of [false, true]) {
                      const grids: Grid[] = [];
                      for (let i = 1; i < cuts.length; i++) {
                        const first = cuts[i - 1]!,
                          last = cuts[i]!;
                        const top = first >= n - right,
                          bottom = last <= left;
                        const minY = top ? capHeight + gap : 0;
                        const maxY = h - (bottom ? capHeight + gap : 0);
                        const available = maxY - minY;
                        const rows = maximum(available, dy);
                        if (!rows) continue;
                        const used = span(rows, dy);
                        const y =
                          minY +
                          (alignment === "end"
                            ? available - used
                            : alignment === "center"
                              ? (available - used) / 2
                              : 0);
                        grids.push({
                          x: first * (dx + gap),
                          y,
                          cols: last - first,
                          rows,
                          dx,
                          dy,
                          rotation,
                          width: span(last - first, dx),
                        });
                      }
                      const leftWidth = compactLeft ? span(lc, dy) : lw;
                      const rightWidth = compactRight ? span(rc, dy) : rw;
                      grids.push({
                        x: 0,
                        y: h - capHeight,
                        cols: lc,
                        rows: b,
                        dx: dy,
                        dy: dx,
                        rotation: other,
                        width: leftWidth,
                      });
                      grids.push({
                        x: w - rightWidth,
                        y: 0,
                        cols: rc,
                        rows: b,
                        dx: dy,
                        dy: dx,
                        rotation: other,
                        width: rightWidth,
                      });
                      add(transpose, w, h, grids, {
                        rotation,
                        rows: a,
                        crossRows: b,
                        left,
                        right,
                        alignment,
                        compactLeft,
                        compactRight,
                      });
                    }
              }
          }
        }
    }
  }
  plans.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  let orderedPlans = plans;
  if (family === "paired-grid") {
    const partitions = new Map<string, Plan[]>();
    for (const plan of plans) {
      const p = plan.parameters!;
      const key = JSON.stringify([
        plan.count,
        plan.transpose,
        plan.width,
        plan.height,
        p.rotation,
        p.rows,
        p.crossRows,
        p.left,
        p.right,
      ]);
      const bucket = partitions.get(key) ?? [];
      bucket.push(plan);
      partitions.set(key, bucket);
    }
    orderedPlans = [];
    const buckets = [...partitions.values()];
    for (const count of new Set(plans.map((p) => p.count))) {
      const sameCount = buckets.filter((b) => b[0]!.count === count);
      for (
        let i = 0;
        i < Math.max(0, ...sameCount.map((b) => b.length));
        i += 2
      )
        for (const bucket of sameCount)
          for (let j = i; j < i + 2; j++)
            if (bucket[j]) orderedPlans.push(bucket[j]!);
    }
  }
  for (const p of orderedPlans) {
    for (const grouped of [false, true])
      for (const quantization of [
        "floor",
        "edge-rounded",
        "floor-step",
        "continuous",
      ] as const) {
        if (!debit(p.count)) return done(shouldContinue());
        const placements = materializeGridPlan(input, p, grouped, quantization);
        if (
          !emit(placements, {
            family,
            variant:
              family === "slice-grid"
                ? "inserted-crosswise-band"
                : "oppositely-capped-rasters",
            parameters: {
              ...p.parameters,
              transpose: p.transpose,
              width: p.width,
              grouped,
              quantization,
            },
          })
        )
          return done();
      }
  }
  return done();
}
