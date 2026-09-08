import { rectangleSizeForRotation } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
import type { Grid, GridPlan } from "~/domain/solver/gridPlan";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

/** Opposed arms may have different grid counts; the free center is filled separately. */
export function buildAsymmetricRings(
  input: NormalizedLayerSolverInput,
  debit: () => boolean,
): GridPlan[] {
  const c = input.constraints,
    gap = input.package.clearanceMm,
    bounds = input.generationBoundsMm;
  const rotations = [
    c.allowedRotations.find((r) => r === 0) ??
      c.allowedRotations.find((r) => r === 180),
    c.allowedRotations.find((r) => r === 90) ??
      c.allowedRotations.find((r) => r === 270),
  ];
  if (rotations.some((r) => r === undefined)) return [];
  const span = (n: number, d: number) => n * d + Math.max(0, n - 1) * gap;
  const max = (a: number, d: number) =>
    Math.max(0, Math.min(c.maxBands, Math.floor((a + gap + 1e-9) / (d + gap))));
  const ordered = (n: number, center = n / 2) =>
    Array.from({ length: n }, (_, i) => i + 1).sort(
      (a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b,
    );
  const plans: GridPlan[] = [];
  const seen = new Set<string>();
  const seeds: GridPlan[] = [];
  discovery: for (const transpose of [false, true])
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const size = rectangleSizeForRotation(
        input.package.dimensionsMm,
        rotation,
      );
      const dx = transpose ? size.width : size.length,
        dy = transpose ? size.length : size.width;
      const aw = transpose
        ? bounds.maxY - bounds.minY
        : bounds.maxX - bounds.minX;
      const ah = transpose
        ? bounds.maxX - bounds.minX
        : bounds.maxY - bounds.minY;
      for (const columns of ordered(max(aw, dx))) {
        const crossColumns = max(aw - span(columns, dx) - gap, dy);
        if (!crossColumns) continue;
        const leftWidth = span(crossColumns, dy);
        for (const rows of ordered(max(ah, dy))) {
          const crossRows = max(ah - span(rows, dy) - gap, dx);
          if (!crossRows) continue;
          for (const width of new Set([
            leftWidth + gap + span(columns, dx),
            aw,
          ]))
            for (const height of new Set([
              span(rows, dy) + gap + span(crossRows, dx),
              ah,
            ])) {
              if (!debit()) break discovery;
              const topHeight = span(rows, dy);
              for (const bottomColumns of ordered(
                max(width - gap, dx),
                columns,
              ))
                for (const bottomRows of ordered(max(height - gap, dy), rows)) {
                  if (!debit()) break discovery;
                  if (bottomColumns === columns && bottomRows === rows)
                    continue;
                  const bottomWidth = span(bottomColumns, dx),
                    bottomHeight = span(bottomRows, dy);
                  const leftRows = max(height - bottomHeight - gap, dx),
                    rightColumns = max(width - bottomWidth - gap, dy),
                    rightRows = max(height - topHeight - gap, dx);
                  if (
                    !leftRows ||
                    !rightColumns ||
                    !rightRows ||
                    leftWidth + gap > bottomWidth + 1e-9 ||
                    topHeight + bottomHeight + gap > height + 1e-9
                  )
                    continue;
                  const ring: Grid[] = [
                    {
                      x: 0,
                      y: 0,
                      cols: crossColumns,
                      rows: leftRows,
                      dx: dy,
                      dy: dx,
                      rotation: other,
                      width: leftWidth,
                      height: height - bottomHeight - gap,
                    },
                    {
                      x: leftWidth + gap,
                      y: 0,
                      cols: columns,
                      rows,
                      dx,
                      dy,
                      rotation,
                      width: width - leftWidth - gap,
                    },
                    {
                      x: bottomWidth + gap,
                      y: topHeight + gap,
                      cols: rightColumns,
                      rows: rightRows,
                      dx: dy,
                      dy: dx,
                      rotation: other,
                      width: width - bottomWidth - gap,
                      height: height - topHeight - gap,
                    },
                    {
                      x: 0,
                      y: height - bottomHeight,
                      cols: bottomColumns,
                      rows: bottomRows,
                      dx,
                      dy,
                      rotation,
                      width: bottomWidth,
                    },
                  ];
                  const coreWidth = bottomWidth - leftWidth - gap,
                    coreHeight = height - topHeight - bottomHeight - 2 * gap;
                  const cores: Grid[][] = [[]];
                  for (const coreRotation of rotations as Rotation[]) {
                    const cs = rectangleSizeForRotation(
                      input.package.dimensionsMm,
                      coreRotation,
                    );
                    const cx = transpose ? cs.width : cs.length,
                      cy = transpose ? cs.length : cs.width;
                    const nc = max(coreWidth, cx),
                      nr = max(coreHeight, cy);
                    if (!nc || !nr) continue;
                    for (const ax of [0, 0.5, 1])
                      for (const ay of [1, 0.5, 0])
                        cores.push([
                          {
                            x:
                              leftWidth + gap + ax * (coreWidth - span(nc, cx)),
                            y:
                              topHeight +
                              gap +
                              ay * (coreHeight - span(nr, cy)),
                            cols: nc,
                            rows: nr,
                            dx: cx,
                            dy: cy,
                            rotation: coreRotation,
                            width: span(nc, cx),
                          },
                        ]);
                  }
                  const uniqueCores = [
                    ...new Map(
                      (cores.length > 1 ? cores.slice(1) : cores).map(
                        (core) => [JSON.stringify(core), core],
                      ),
                    ).values(),
                  ];
                  for (const core of uniqueCores) {
                    const grids = [...ring, ...core];
                    const count = grids.reduce(
                      (n, g) => n + g.cols * g.rows,
                      0,
                    );
                    if (
                      count < c.minimumPackageCount ||
                      count > c.maximumPackageCount ||
                      count > c.maxPlacements
                    )
                      continue;
                    seeds.push({
                      transpose,
                      width,
                      height,
                      count,
                      grids,
                      parameters: {
                        kind: "asymmetric-ring",
                        rotation,
                        columns,
                        crossColumns,
                        rows,
                        crossRows,
                        bottomColumns,
                        bottomRows,
                        coreRotation: core[0]?.rotation ?? null,
                        coreX: core[0]?.x ?? null,
                        coreY: core[0]?.y ?? null,
                      },
                    });
                  }
                }
            }
        }
      }
    }
  // Discover partitions before expanding their reflections and spacing variants.
  // Otherwise an early partition can spend the entire budget on equivalent fills.
  seeds.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  for (const seed of seeds)
    for (const reflectX of [false, true])
      for (const reflectY of [false, true])
        for (const stretched of [true, false]) {
          const grids = seed.grids.map((original, i) => {
            const g =
              !stretched && (i === 0 || i === 2)
                ? {
                    ...original,
                    width: span(original.cols, original.dx),
                    height: span(original.rows, original.dy),
                  }
                : original;
            return {
              ...g,
              x: reflectX ? seed.width - g.x - g.width : g.x,
              y: reflectY
                ? seed.height - g.y - (g.height ?? span(g.rows, g.dy))
                : g.y,
            };
          });
          const key = JSON.stringify([
            seed.transpose,
            seed.width,
            seed.height,
            grids
              .map((g) =>
                JSON.stringify([
                  g.x,
                  g.y,
                  g.cols,
                  g.rows,
                  g.rotation,
                  g.width,
                  g.height,
                ]),
              )
              .sort(),
          ]);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!debit()) return plans;
          plans.push({
            ...seed,
            grids,
            parameters: { ...seed.parameters, reflectX, reflectY, stretched },
          });
        }
  return plans;
}
