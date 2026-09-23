import { rectangleSizeForRotation } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
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

/** Three crosswise steps may have different first-arm widths and heights. */
export function searchVariableStaircase(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  active: () => boolean,
  workLimit = 400_000,
) {
  let workUsed = 0,
    limited = false;
  const debit = (n = 1) => {
    if (!active()) return false;
    if (workUsed + n > workLimit) {
      limited = true;
      return false;
    }
    workUsed += n;
    return true;
  };
  const done = () => ({ workUsed, limited });
  const c = input.constraints,
    gap = input.package.clearanceMm;
  if (!c.allowMixedPackageOrientations || c.requiredShape !== "any")
    return done();
  const rotations = [
    c.allowedRotations.find((r) => r === 0) ??
      c.allowedRotations.find((r) => r === 180),
    c.allowedRotations.find((r) => r === 90) ??
      c.allowedRotations.find((r) => r === 270),
  ];
  if (rotations.some((r) => r === undefined)) return done();
  const span = (n: number, d: number) => n * d + Math.max(0, n - 1) * gap;
  const max = (s: number, d: number) =>
    Math.max(0, Math.min(c.maxBands, Math.floor((s + gap + 1e-9) / (d + gap))));
  const bounds = input.generationBoundsMm,
    plans: GridPlan[] = [];
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
      for (let columns = 2; columns <= max(aw, dx); columns++) {
        const crossColumns = max(aw - span(columns, dx) - gap, dy);
        if (!crossColumns) continue;
        const crossWidth = span(crossColumns, dy),
          baseWidth = span(columns, dx) + gap + crossWidth;
        const widths = new Set([baseWidth]);
        for (let n = 0; n <= max(aw, dx); n++) {
          const m = max(aw - span(n, dx) - (n ? gap : 0), dy);
          const w = span(n, dx) + span(m, dy) + (n && m ? gap : 0);
          if (w >= baseWidth && w <= aw + 1e-9) widths.add(w);
        }
        for (const width of widths) {
          for (let crossRows = 1; crossRows <= max(ah, dx); crossRows++) {
            const crossHeight = span(crossRows, dx),
              rows = max(ah - crossHeight - gap, dy);
            if (rows < 2) continue;
            const baseHeight = span(rows, dy) + gap + crossHeight;
            const heights = new Set([baseHeight]);
            for (let n = 0; n <= max(ah, dy); n++) {
              const m = max(ah - span(n, dy) - (n ? gap : 0), dx);
              const h = span(n, dy) + span(m, dx) + (n && m ? gap : 0);
              if (h >= baseHeight && h <= ah + 1e-9) heights.add(h);
            }
            for (const height of heights) {
              for (
                let firstColumns = 2;
                firstColumns <= columns;
                firstColumns++
              )
                for (
                  let firstCrossRows = 1;
                  firstCrossRows <= crossRows;
                  firstCrossRows++
                ) {
                  if (firstColumns === columns && firstCrossRows === crossRows)
                    continue;
                  const firstX = span(firstColumns, dx) + gap,
                    firstWidth = width - firstX;
                  const firstCrossColumns = max(firstWidth, dy),
                    firstHeight = span(firstCrossRows, dx);
                  if (!firstCrossColumns) continue;
                  for (let firstRows = 1; firstRows < rows; firstRows++)
                    for (
                      let middleColumns = 1;
                      middleColumns < firstColumns;
                      middleColumns++
                    ) {
                      if (workUsed >= Math.floor(workLimit / 2)) {
                        limited = true;
                        break discovery;
                      }
                      if (!debit()) break discovery;
                      const middleX = span(middleColumns, dx) + gap,
                        middleY =
                          height -
                          crossHeight -
                          gap -
                          span(rows - firstRows, dy);
                      const middleBottom = middleY + crossHeight,
                        rightX = middleX + crossWidth + gap;
                      const rightColumns = max(width - rightX, dx),
                        rightRows = max(middleBottom - firstHeight - gap, dy);
                      if (!rightColumns || !rightRows) continue;
                      const count =
                        firstCrossColumns * firstCrossRows +
                        2 * crossColumns * crossRows +
                        firstColumns * firstRows +
                        middleColumns * (rows - firstRows) +
                        rightColumns * rightRows +
                        columns * (rows - firstRows);
                      if (
                        count < c.minimumPackageCount ||
                        count > c.maximumPackageCount ||
                        count > c.maxPlacements
                      )
                        continue;
                      // Reject intersecting cross arms before allocating the
                      // complementary grids; shared-column merging keeps count.
                      const bottomY = height - crossHeight;
                      if (
                        (firstX < middleX + crossWidth + gap - 1e-9 &&
                          middleY < firstHeight + gap - 1e-9) ||
                        (middleX < crossWidth + gap - 1e-9 &&
                          bottomY < middleBottom + gap - 1e-9) ||
                        (firstX < crossWidth + gap - 1e-9 &&
                          bottomY < firstHeight + gap - 1e-9)
                      )
                        continue;
                      const grids: Grid[] = [
                        {
                          x: firstX,
                          y: 0,
                          cols: firstCrossColumns,
                          rows: firstCrossRows,
                          dx: dy,
                          dy: dx,
                          rotation: other,
                          width: firstWidth,
                        },
                        {
                          x: middleX,
                          y: middleY,
                          cols: crossColumns,
                          rows: crossRows,
                          dx: dy,
                          dy: dx,
                          rotation: other,
                          width: crossWidth,
                        },
                        {
                          x: 0,
                          y: height - crossHeight,
                          cols: crossColumns,
                          rows: crossRows,
                          dx: dy,
                          dy: dx,
                          rotation: other,
                          width: crossWidth,
                        },
                        {
                          x: 0,
                          y: 0,
                          cols: firstColumns,
                          rows: firstRows,
                          dx,
                          dy,
                          rotation,
                          width: span(firstColumns, dx),
                        },
                        {
                          x: 0,
                          y: middleY,
                          cols: middleColumns,
                          rows: rows - firstRows,
                          dx,
                          dy,
                          rotation,
                          width: span(middleColumns, dx),
                        },
                        {
                          x: rightX,
                          y: middleBottom - span(rightRows, dy),
                          cols: rightColumns,
                          rows: rightRows,
                          dx,
                          dy,
                          rotation,
                          width: width - rightX,
                        },
                        {
                          x: crossWidth + gap,
                          y: middleBottom + gap,
                          cols: columns,
                          rows: rows - firstRows,
                          dx,
                          dy,
                          rotation,
                          width: width - crossWidth - gap,
                        },
                      ];
                      if (height > baseHeight + 1e-9) {
                        grids[3] = {
                          x: span(middleColumns, dx) + gap,
                          y: 0,
                          cols: firstColumns - middleColumns,
                          rows: firstRows,
                          dx,
                          dy,
                          rotation,
                          width: span(firstColumns - middleColumns, dx),
                        };
                        grids[4] = {
                          x: 0,
                          y: 0,
                          cols: middleColumns,
                          rows,
                          dx,
                          dy,
                          rotation,
                          width: span(middleColumns, dx),
                          height: height - crossHeight - gap,
                        };
                      }
                      if (width > baseWidth + 1e-9) {
                        grids[5] = {
                          ...grids[5]!,
                          rows: rightRows + rows - firstRows,
                        };
                        grids[6] = {
                          ...grids[6]!,
                          cols: columns - rightColumns,
                          width: span(columns - rightColumns, dx),
                        };
                      }
                      if (
                        !grids.every((a, i) =>
                          grids
                            .slice(i + 1)
                            .every(
                              (b) =>
                                a.x + a.width + gap <= b.x + 1e-9 ||
                                b.x + b.width + gap <= a.x + 1e-9 ||
                                a.y + (a.height ?? span(a.rows, a.dy)) + gap <=
                                  b.y + 1e-9 ||
                                b.y + (b.height ?? span(b.rows, b.dy)) + gap <=
                                  a.y + 1e-9,
                            ),
                        )
                      )
                        continue;
                      plans.push({
                        transpose,
                        width,
                        height,
                        count,
                        grids,
                        parameters: {
                          rotation,
                          columns,
                          crossColumns,
                          rows,
                          crossRows,
                          firstColumns,
                          firstCrossRows,
                          firstRows,
                          middleColumns,
                        },
                      });
                    }
                }
            }
          }
        }
      }
    }
  plans.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  const seen = new Set<string>();
  for (const reflectX of [false, true])
    for (const reflectY of [false, true])
      for (const base of plans) {
        const plan = {
          ...base,
          grids: base.grids.map((g) => ({
            ...g,
            x: reflectX ? base.width - g.x - g.width : g.x,
            y: reflectY
              ? base.height - g.y - (g.height ?? span(g.rows, g.dy))
              : g.y,
          })),
        };
        for (const grouped of [false, true])
          for (const quantization of [
            "floor-clamped",
            "edge-rounded",
            "floor-step",
            "continuous",
            "nearest",
          ] as const) {
            if (!debit()) return done();
            const placements = materializeGridPlan(
              input,
              plan,
              grouped,
              quantization,
            );
            const key = placements
              .map(
                (p) =>
                  `${p.rotation % 180}:${p.positionMm.x}:${p.positionMm.y}`,
              )
              .sort()
              .join(";");
            if (seen.has(key)) continue;
            seen.add(key);
            if (!debit(plan.count)) return done();
            if (
              !emit(placements, {
                family: "staircase-variable",
                variant: "unequal-first-arm",
                parameters: {
                  ...base.parameters,
                  transpose: base.transpose,
                  width: base.width,
                  height: base.height,
                  reflectX,
                  reflectY,
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
