import { rectangleSizeForRotation } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { realizeRegionLineSpacing } from "~/domain/solver/region-topology/spacing";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

export const STAIRCASE_WORK_LIMIT = 25_000;

/** Three offset grids, their four crosswise fillers, and an optional side grid. */
export function searchStaircasePatterns(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  workLimit = STAIRCASE_WORK_LIMIT,
): { workUsed: number; limited: boolean } {
  let workUsed = 0;
  let limited = false;
  const debit = (units = 1) => {
    if (!shouldContinue()) return false;
    if (workUsed + units > workLimit) {
      limited = true;
      return false;
    }
    workUsed += units;
    return true;
  };
  const done = () => ({ workUsed, limited });
  const count = input.constraints.minimumPackageCount;
  if (
    count !== input.constraints.maximumPackageCount ||
    count <= 0 ||
    count > input.constraints.maxPlacements ||
    !input.constraints.allowMixedPackageOrientations
  )
    return done();
  const rotations = [
    input.constraints.allowedRotations.find((rotation) => rotation === 0) ??
      input.constraints.allowedRotations.find((rotation) => rotation === 180),
    input.constraints.allowedRotations.find((rotation) => rotation === 90) ??
      input.constraints.allowedRotations.find((rotation) => rotation === 270),
  ];
  if (rotations.some((rotation) => rotation === undefined)) return done();
  const gap = input.package.clearanceMm;
  const span = (n: number, item: number) => n * item + (n - 1) * gap;
  const maximum = (available: number, item: number) =>
    Math.max(
      0,
      Math.min(
        input.constraints.maxBands,
        Math.floor(
          (available + gap + SOLVER_GEOMETRY_EPSILON_MM) / (item + gap),
        ),
      ),
    );

  for (const transpose of [false, true]) {
    const availableX = transpose
      ? input.generationBoundsMm.maxY - input.generationBoundsMm.minY
      : input.generationBoundsMm.maxX - input.generationBoundsMm.minX;
    const availableY = transpose
      ? input.generationBoundsMm.maxX - input.generationBoundsMm.minX
      : input.generationBoundsMm.maxY - input.generationBoundsMm.minY;
    for (const mainRotation of rotations as Rotation[]) {
      const crossRotation = rotations.find(
        (rotation) => rotation! % 180 !== mainRotation % 180,
      )!;
      const mainSize = rectangleSizeForRotation(
        input.package.dimensionsMm,
        mainRotation,
      );
      const crossSize = rectangleSizeForRotation(
        input.package.dimensionsMm,
        crossRotation,
      );
      const mainX = transpose ? mainSize.width : mainSize.length;
      const mainY = transpose ? mainSize.length : mainSize.width;
      const crossX = transpose ? crossSize.width : crossSize.length;
      const crossY = transpose ? crossSize.length : crossSize.width;
      for (let columns = 1; columns <= maximum(availableX, mainX); columns++) {
        for (let rows = 1; rows <= maximum(availableY, mainY); rows++) {
          if (!debit()) return done();
          const mainCount = columns * rows;
          if (3 * mainCount >= count) continue;
          const mainWidth = span(columns, mainX);
          const mainHeight = span(rows, mainY);
          for (
            let bandRows = 1;
            bandRows <=
            maximum((availableY - mainHeight - 2 * gap) / 2, crossY);
            bandRows++
          ) {
            if (!debit()) return done();
            const bandHeight = span(bandRows, crossY);
            if (
              bandHeight + gap >= mainHeight ||
              mainHeight > 2 * bandHeight + gap
            )
              continue;
            const height = mainHeight + 2 * bandHeight + 2 * gap;
            const corridorRows = maximum(height, crossY);
            for (
              let corridorColumns = 0;
              corridorColumns <= maximum(availableX - mainWidth - gap, crossX);
              corridorColumns++
            ) {
              if (!debit()) return done();
              const bandColumns =
                (count - 3 * mainCount - corridorColumns * corridorRows) /
                (3 * bandRows);
              if (
                !Number.isInteger(bandColumns) ||
                bandColumns < 2 ||
                bandColumns > input.constraints.maxBands
              )
                continue;
              const bandWidth = span(bandColumns, crossX);
              const bodyWidth = mainWidth + gap + bandWidth;
              const width =
                bodyWidth +
                (corridorColumns ? gap + span(corridorColumns, crossX) : 0);
              if (width > availableX + SOLVER_GEOMETRY_EPSILON_MM) continue;
              for (
                let leftColumns = 1;
                leftColumns < bandColumns;
                leftColumns++
              ) {
                if (!debit()) return done();
                const leftWidth = span(leftColumns, crossX);
                const rightWidth = span(bandColumns - leftColumns, crossX);
                if (
                  leftWidth + SOLVER_GEOMETRY_EPSILON_MM < mainWidth ||
                  rightWidth + SOLVER_GEOMETRY_EPSILON_MM < mainWidth
                )
                  continue;
                // Count feasibility is established before allocating any placements.
                for (const corridorSpacing of corridorColumns
                  ? (["continuous-space-between", "integer-balanced"] as const)
                  : (["compact"] as const)) {
                  if (!debit(count)) return done();
                  const placements: GeneratedPlacement[] = [];
                  const grid = (
                    x: number,
                    y: number,
                    cols: number,
                    rs: number,
                    dx: number,
                    dy: number,
                    rotation: Rotation,
                    distributedHeight?: number,
                  ) => {
                    const line = realizeRegionLineSpacing({
                      minimumMm: y,
                      maximumMm: y + (distributedHeight ?? span(rs, dy)),
                      itemSpanMm: dy,
                      clearanceMm: gap,
                      count: rs,
                      policy:
                        distributedHeight === undefined
                          ? "compact"
                          : corridorSpacing,
                      ...(distributedHeight !== undefined &&
                      corridorSpacing === "integer-balanced"
                        ? {
                            centerPhaseMm: (dy / 2) % 1 === 0.5 ? 0.5 : 0,
                          }
                        : {}),
                    });
                    if (line.status !== "feasible") return;
                    for (const centerY of line.centersMm)
                      for (let col = 0; col < cols; col++) {
                        const centerX = x + dx / 2 + col * (dx + gap);
                        placements.push({
                          positionMm: transpose
                            ? { x: centerY, y: centerX }
                            : { x: centerX, y: centerY },
                          rotation,
                        });
                      }
                  };
                  grid(0, 0, columns, rows, mainX, mainY, mainRotation);
                  grid(
                    leftWidth + gap,
                    bandHeight + gap,
                    columns,
                    rows,
                    mainX,
                    mainY,
                    mainRotation,
                  );
                  grid(
                    bandWidth + gap,
                    2 * (bandHeight + gap),
                    columns,
                    rows,
                    mainX,
                    mainY,
                    mainRotation,
                  );
                  grid(
                    mainWidth + gap,
                    0,
                    bandColumns,
                    bandRows,
                    crossX,
                    crossY,
                    crossRotation,
                  );
                  grid(
                    0,
                    mainHeight + gap,
                    leftColumns,
                    bandRows,
                    crossX,
                    crossY,
                    crossRotation,
                  );
                  grid(
                    leftWidth + mainWidth + 2 * gap,
                    bandHeight + gap,
                    bandColumns - leftColumns,
                    bandRows,
                    crossX,
                    crossY,
                    crossRotation,
                  );
                  grid(
                    0,
                    mainHeight + bandHeight + 2 * gap,
                    bandColumns,
                    bandRows,
                    crossX,
                    crossY,
                    crossRotation,
                  );
                  if (corridorColumns)
                    grid(
                      bodyWidth + gap,
                      0,
                      corridorColumns,
                      corridorRows,
                      crossX,
                      crossY,
                      crossRotation,
                      height,
                    );
                  if (placements.length !== count) continue;
                  if (
                    !emit(placements, {
                      family: "mixed-orientation",
                      variant: "staircase-v1",
                      parameters: {
                        transpose,
                        mainRotation,
                        columns,
                        rows,
                        bandColumns,
                        bandRows,
                        leftColumns,
                        corridorColumns,
                        corridorRows: corridorColumns ? corridorRows : 0,
                        corridorSpacing,
                        requestedCount: count,
                      },
                    })
                  )
                    return done();
                }
              }
            }
          }
        }
      }
    }
  }
  return done();
}
