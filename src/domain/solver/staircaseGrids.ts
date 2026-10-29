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

/** A monotone chain of crosswise blocks with complementary uniform stair fills. */
export function searchStaircaseGrids(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  workLimit = 300_000,
  family: "staircase" | "staircase-exchange" = "staircase",
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
  const c = input.constraints,
    gap = input.package.clearanceMm,
    bounds = input.generationBoundsMm;
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
  const max = (a: number, d: number) =>
    Math.max(0, Math.min(c.maxBands, Math.floor((a + gap + 1e-9) / (d + gap))));
  const plans: GridPlan[] = [];
  const gridsFit = (grids: Grid[]) =>
    grids.every((a, i) =>
      grids
        .slice(i + 1)
        .every(
          (b) =>
            a.x + a.width + gap <= b.x + 1e-9 ||
            b.x + b.width + gap <= a.x + 1e-9 ||
            a.y + span(a.rows, a.dy) + gap <= b.y + 1e-9 ||
            b.y + span(b.rows, b.dy) + gap <= a.y + 1e-9,
        ),
    );
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
        const crossColumns = max(aw - span(columns, dx) - 2 * gap, dy);
        if (!crossColumns) continue;
        const crossWidth = span(crossColumns, dy),
          width = span(columns, dx) + 2 * gap + crossWidth;
        for (let crossRows = 1; crossRows <= max(ah, dx); crossRows++) {
          if (
            family === "staircase-exchange" &&
            (crossRows < 2 || crossColumns < 2)
          )
            continue;
          const crossHeight = span(crossRows, dx),
            rows = max(ah - crossHeight - 2 * gap, dy);
          if (rows < 2) continue;
          const height = span(rows, dy) + 2 * gap + crossHeight;
          const nodes: { column: number; row: number }[] = [
            { column: columns, row: 0 },
          ];
          const visit = (column: number, row: number): boolean => {
            if (!debit()) return false;
            if (column === 0 && row === rows) {
              if (nodes.length < 3) return true;
              const grids: Grid[] = nodes.map((n) => ({
                x: n.column * (dx + gap),
                y: n.row * (dy + gap),
                cols: crossColumns,
                rows: crossRows,
                dx: dy,
                dy: dx,
                rotation: other,
                width: crossWidth,
              }));
              for (let i = 0; i < nodes.length - 1; i++) {
                const a = nodes[i]!,
                  b = nodes[i + 1]!,
                  nr = b.row - a.row;
                grids.push({
                  x: 0,
                  y: a.row * (dy + gap),
                  cols: a.column,
                  rows: nr,
                  dx,
                  dy,
                  rotation,
                  width: span(a.column, dx),
                });
                grids.push({
                  x: b.column * (dx + gap) + crossWidth + gap,
                  y: a.row * (dy + gap) + crossHeight + gap,
                  cols: columns - b.column,
                  rows: nr,
                  dx,
                  dy,
                  rotation,
                  width: span(columns - b.column, dx),
                });
              }
              const add = (
                regions: Grid[],
                parameters: GeneratorProvenance["parameters"],
              ) => {
                const count = regions.reduce((s, g) => s + g.cols * g.rows, 0);
                if (
                  count >= c.minimumPackageCount &&
                  count <= c.maximumPackageCount &&
                  count <= c.maxPlacements &&
                  gridsFit(regions)
                )
                  plans.push({
                    transpose,
                    width,
                    height,
                    grids: regions,
                    count,
                    parameters: {
                      rotation,
                      columns,
                      rows,
                      crossColumns,
                      crossRows,
                      steps: nodes.map((n) => `${n.column}:${n.row}`).join("/"),
                      ...parameters,
                    },
                  });
              };
              if (family === "staircase") add(grids, {});
              else
                for (let i = 0; i < nodes.length - 1; i++) {
                  const upper = grids[i]!,
                    lower = grids[i + 1]!;
                  for (let qr = 1; qr < crossRows; qr++)
                    for (
                      let upperColumns = 1;
                      upperColumns < crossColumns;
                      upperColumns++
                    )
                      for (
                        let lowerColumns = 1;
                        lowerColumns < crossColumns;
                        lowerColumns++
                      ) {
                        if (!debit()) return false;
                        const upperSplit =
                          upper.y + (crossRows - qr) * (dx + gap);
                        const lowerSplit = lower.y + qr * (dx + gap);
                        const x =
                          lower.x + span(crossColumns - lowerColumns, dy) + gap;
                        const y = Math.max(lower.y, upperSplit);
                        const right = upper.x + upperColumns * (dy + gap) - gap;
                        const bottom = Math.min(
                          lowerSplit - gap,
                          upper.y + crossHeight,
                        );
                        const nc = max(right - x, dx),
                          nr = max(bottom - y, dy);
                        if (!nc || !nr) continue;
                        add(
                          [
                            ...grids.filter((_, k) => k !== i && k !== i + 1),
                            { ...upper, rows: crossRows - qr },
                            {
                              ...upper,
                              x: upper.x + upperColumns * (dy + gap),
                              y: upperSplit,
                              cols: crossColumns - upperColumns,
                              rows: qr,
                              width: span(crossColumns - upperColumns, dy),
                            },
                            {
                              ...lower,
                              cols: crossColumns - lowerColumns,
                              rows: qr,
                              width: span(crossColumns - lowerColumns, dy),
                            },
                            { ...lower, y: lowerSplit, rows: crossRows - qr },
                            {
                              x,
                              y,
                              cols: nc,
                              rows: nr,
                              dx,
                              dy,
                              rotation,
                              width: span(nc, dx),
                            },
                          ],
                          {
                            exchangeIndex: i,
                            exchangeRows: qr,
                            upperColumns,
                            lowerColumns,
                          },
                        );
                      }
                }
              return true;
            }
            // Both coordinates move monotonically; adjacent cross blocks must be separated.
            for (let nextColumn = column - 1; nextColumn >= 0; nextColumn--)
              for (let nextRow = row + 1; nextRow <= rows; nextRow++) {
                if ((nextColumn === 0) !== (nextRow === rows)) continue;
                if (
                  family === "staircase" &&
                  (column - nextColumn) * (dx + gap) <
                    crossWidth + gap - 1e-9 &&
                  (nextRow - row) * (dy + gap) < crossHeight + gap - 1e-9
                )
                  continue;
                if (
                  (column - nextColumn) * (dx + gap) >
                    crossWidth + gap + 1e-9 &&
                  (nextRow - row) * (dy + gap) > crossHeight + gap + 1e-9
                )
                  continue;
                nodes.push({ column: nextColumn, row: nextRow });
                if (!visit(nextColumn, nextRow)) return false;
                nodes.pop();
              }
            return true;
          };
          if (!visit(columns, 0)) break discovery;
        }
      }
    }
  phaseLimit = workLimit;
  plans.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  let orderedPlans = plans;
  if (family === "staircase-exchange") {
    orderedPlans = [];
    for (const count of new Set(plans.map((p) => p.count))) {
      const buckets = new Map<string, GridPlan[]>();
      for (const plan of plans.filter((p) => p.count === count)) {
        const p = plan.parameters!;
        const key = JSON.stringify([
          plan.transpose,
          p.rotation,
          p.columns,
          p.rows,
          p.crossRows,
          String(p.steps).split("/").length,
        ]);
        const bucket = buckets.get(key) ?? [];
        bucket.push(plan);
        buckets.set(key, bucket);
      }
      const groups = [...buckets.values()];
      for (let i = 0; i < Math.max(0, ...groups.map((g) => g.length)); i++)
        for (const group of groups) if (group[i]) orderedPlans.push(group[i]!);
    }
  }
  const seen = new Set<string>();
  for (const reflectX of [false, true])
    for (const reflectY of [false, true])
      for (const plan of orderedPlans) {
        if (!debit(plan.count)) return done();
        const reflected = {
          ...plan,
          grids: plan.grids.map((g) => ({
            ...g,
            x: reflectX ? plan.width - g.x - g.width : g.x,
            y: reflectY ? plan.height - g.y - span(g.rows, g.dy) : g.y,
          })),
        };
        const placements = materializeGridPlan(
          input,
          reflected,
          false,
          "continuous",
        );
        const key = placements
          .map((p) => `${p.rotation % 180}:${p.positionMm.x}:${p.positionMm.y}`)
          .sort()
          .join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        if (
          !emit(placements, {
            family,
            variant:
              family === "staircase"
                ? "monotone-cross-block-chain"
                : "cross-arm-exchange",
            parameters: {
              ...plan.parameters,
              transpose: plan.transpose,
              width: plan.width,
              height: plan.height,
              reflectX,
              reflectY,
            },
          })
        )
          return done();
      }
  return done();
}
