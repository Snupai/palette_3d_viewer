import { rectangleSizeForRotation } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
import type { Grid, GridPlan } from "~/domain/solver/gridPlan";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

/** Four-arm rings, optionally filled, with an outer row cap and side corridor. */
export function buildRingMosaics(
  input: NormalizedLayerSolverInput,
  debit: () => boolean,
): GridPlan[] {
  const c = input.constraints,
    gap = input.package.clearanceMm;
  const rotations = [
    c.allowedRotations.find((r) => r === 0) ??
      c.allowedRotations.find((r) => r === 180),
    c.allowedRotations.find((r) => r === 90) ??
      c.allowedRotations.find((r) => r === 270),
  ];
  if (rotations.some((r) => r === undefined)) return [];
  const span = (n: number, d: number) => n * d + Math.max(0, n - 1) * gap;
  const max = (s: number, d: number) =>
    Math.max(0, Math.min(c.maxBands, Math.floor((s + gap + 1e-9) / (d + gap))));
  const bounds = input.generationBoundsMm,
    plans: GridPlan[] = [];
  for (const transpose of [false, true])
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const s = rectangleSizeForRotation(input.package.dimensionsMm, rotation);
      const dx = transpose ? s.width : s.length,
        dy = transpose ? s.length : s.width;
      const aw = transpose
        ? bounds.maxY - bounds.minY
        : bounds.maxX - bounds.minX;
      const ah = transpose
        ? bounds.maxX - bounds.minX
        : bounds.maxY - bounds.minY;
      for (let cols = 1; cols <= max(aw, dx); cols++)
        for (
          let crossCols = 1;
          crossCols <= max(aw - span(cols, dx) - gap, dy);
          crossCols++
        ) {
          const a = span(crossCols, dy),
            b = span(cols, dx),
            ringWidth = a + gap + b;
          for (let rows = 1; rows <= max(ah, dy); rows++)
            for (
              let crossRows = 1;
              crossRows <= max(ah - span(rows, dy) - gap, dx);
              crossRows++
            ) {
              if (!debit()) return plans;
              const top = span(rows, dy),
                left = span(crossRows, dx),
                ringHeight = top + gap + left;
              const ring: Grid[] = [
                {
                  x: 0,
                  y: 0,
                  cols: crossCols,
                  rows: crossRows,
                  dx: dy,
                  dy: dx,
                  rotation: other,
                  width: a,
                },
                { x: a + gap, y: 0, cols, rows, dx, dy, rotation, width: b },
                {
                  x: b + gap,
                  y: top + gap,
                  cols: crossCols,
                  rows: crossRows,
                  dx: dy,
                  dy: dx,
                  rotation: other,
                  width: a,
                },
                { x: 0, y: left + gap, cols, rows, dx, dy, rotation, width: b },
              ];
              // The four arms must leave a rectangular center instead of overlapping.
              if (a > b + 1e-9 || top > left + 1e-9) continue;
              const coreWidth = b - a - gap,
                coreHeight = left - top - gap;
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
                  for (const ay of [0, 0.5, 1])
                    cores.push([
                      {
                        x: a + gap + (coreWidth - span(nc, cx)) * ax,
                        y: top + gap + (coreHeight - span(nr, cy)) * ay,
                        cols: nc,
                        rows: nr,
                        dx: cx,
                        dy: cy,
                        rotation: coreRotation,
                        width: span(nc, cx),
                      },
                    ]);
              }
              for (const capRotation of rotations as Rotation[]) {
                const capDx = capRotation === rotation ? dx : dy,
                  capDy = capRotation === rotation ? dy : dx;
                for (
                  let capRows = 0;
                  capRows <= max(ah - ringHeight - gap, capDy);
                  capRows++
                ) {
                  if (!capRows && capRotation !== rotation) continue;
                  const capHeight = span(capRows, capDy),
                    height = ringHeight + (capRows ? gap + capHeight : 0);
                  if (height + Math.min(dx, dy) + gap <= ah + 1e-9) continue;
                  const capCols = max(ringWidth, capDx);
                  if (capRows && !capCols) continue;
                  for (const sideRotation of rotations as Rotation[]) {
                    const sideDx = sideRotation === rotation ? dx : dy,
                      sideDy = sideRotation === rotation ? dy : dx;
                    for (
                      let sideCols = 0;
                      sideCols <= max(aw - ringWidth - gap, sideDx);
                      sideCols++
                    ) {
                      if (!sideCols && sideRotation !== rotation) continue;
                      if (!debit()) return plans;
                      const sideWidth = span(sideCols, sideDx),
                        width = ringWidth + (sideCols ? gap + sideWidth : 0);
                      if (width + Math.min(dx, dy) + gap <= aw + 1e-9) continue;
                      const sideRows = max(height, sideDy);
                      if (sideCols && !sideRows) continue;
                      for (const core of cores)
                        for (const capAtEnd of capRows
                          ? [false, true]
                          : [false])
                          for (const reflectX of [false, true])
                            for (const reflectY of [false, true])
                              for (const ringReflectX of [false, true]) {
                                if (!debit()) return plans;
                                let grids = [...ring, ...core].map((g) => ({
                                  ...g,
                                  x: ringReflectX
                                    ? ringWidth - g.x - g.width
                                    : g.x,
                                  y:
                                    g.y +
                                    (capRows && !capAtEnd
                                      ? capHeight + gap
                                      : 0),
                                }));
                                if (capRows)
                                  grids.push({
                                    x: 0,
                                    y: capAtEnd ? ringHeight + gap : 0,
                                    cols: capCols,
                                    rows: capRows,
                                    dx: capDx,
                                    dy: capDy,
                                    rotation: capRotation,
                                    width: ringWidth,
                                  });
                                if (sideCols)
                                  grids.push({
                                    x: ringWidth + gap,
                                    y: 0,
                                    cols: sideCols,
                                    rows: sideRows,
                                    dx: sideDx,
                                    dy: sideDy,
                                    rotation: sideRotation,
                                    width: sideWidth,
                                    height,
                                  });
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
                                grids = grids.map((g) => ({
                                  ...g,
                                  x: reflectX ? width - g.x - g.width : g.x,
                                  y: reflectY
                                    ? height -
                                      g.y -
                                      (g.height ?? span(g.rows, g.dy))
                                    : g.y,
                                }));
                                plans.push({
                                  transpose,
                                  width,
                                  height,
                                  count,
                                  grids,
                                  parameters: {
                                    kind: "capped-ring-corridor",
                                    rotation,
                                    columns: cols,
                                    crossColumns: crossCols,
                                    rows,
                                    crossRows,
                                    capRotation,
                                    capRows,
                                    capAtEnd,
                                    sideRotation,
                                    sideCols,
                                    coreRotation: core[0]?.rotation ?? null,
                                    coreX: core[0]?.x ?? null,
                                    coreY: core[0]?.y ?? null,
                                    ringReflectX,
                                    reflectX,
                                    reflectY,
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
  return plans;
}
