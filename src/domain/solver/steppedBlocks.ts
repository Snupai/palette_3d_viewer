import { rectangleSizeForRotation } from "~/domain/geometry";
import {
  contiguousSuctionGroupSizes,
  DEFAULT_SUCTION_GROUPING_TOLERANCE_MM,
} from "~/domain/robotics/grouping";

import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import type { Rotation } from "~/domain/palletTypes";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

type Plan = {
  kind: "five" | "six" | "seven" | "nine";
  fixedLeftColumns?: number;
  coreRotation?: Rotation;
  transpose: boolean;
  rotation: Rotation;
  other: Rotation;
  w: number;
  h: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  crossColumns: number;
  crossRows: number;
  mainColumns: number;
  mainRows: number;
  sideColumns: number;
  sideRows: number;
  sideHeight: number;
  count: number;
};

/** Filled rings and seven-/nine-grid interlocking layouts, derived from grid counts. */
export function searchSteppedBlocks(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  workLimit = 50_000,
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
  const constraints = input.constraints;
  if (
    !constraints.allowMixedPackageOrientations ||
    constraints.requiredShape !== "any"
  )
    return done();
  const rotations = [
    constraints.allowedRotations.find((r) => r === 0) ??
      constraints.allowedRotations.find((r) => r === 180),
    constraints.allowedRotations.find((r) => r === 90) ??
      constraints.allowedRotations.find((r) => r === 270),
  ];
  if (rotations.some((r) => r === undefined)) return done();
  const gap = input.package.clearanceMm;
  const span = (count: number, size: number) =>
    count * size + (count - 1) * gap;
  const maximum = (available: number, size: number) =>
    Math.max(
      0,
      Math.min(
        constraints.maxBands,
        Math.floor(
          (available + gap + SOLVER_GEOMETRY_EPSILON_MM) / (size + gap),
        ),
      ),
    );
  const bounds = input.generationBoundsMm;
  const plans: Plan[] = [];
  search: for (const transpose of [false, true]) {
    const availableWidth = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const availableHeight = transpose
      ? bounds.maxX - bounds.minX
      : bounds.maxY - bounds.minY;
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const size = rectangleSizeForRotation(
        input.package.dimensionsMm,
        rotation,
      );
      const w = transpose ? size.width : size.length;
      const h = transpose ? size.length : size.width;
      for (let columns = 2; columns <= maximum(availableWidth, w); columns++)
        for (
          let crossColumns = 1;
          crossColumns <= maximum(availableWidth - span(columns, w) - gap, h);
          crossColumns++
        )
          for (let rows = 1; rows <= maximum(availableHeight, h); rows++)
            for (
              let crossRows = 1;
              crossRows <= maximum(availableHeight - span(rows, h) - gap, w);
              crossRows++
            ) {
              if (!debit()) break search;
              const normalHeight = span(rows, h),
                crossHeight = span(crossRows, w);
              const width = span(columns, w) + gap + span(crossColumns, h);
              for (
                let mainRows = 1;
                mainRows <=
                maximum(
                  availableHeight - normalHeight - crossHeight - 2 * gap,
                  h,
                );
                mainRows++
              )
                for (
                  let sideColumns = 1;
                  sideColumns <= maximum(width - w - gap, h);
                  sideColumns++
                ) {
                  if (!debit()) break search;
                  const mainColumns = maximum(
                    width - span(sideColumns, h) - gap,
                    w,
                  );
                  const height =
                    span(mainRows, h) + normalHeight + crossHeight + 2 * gap;
                  if (!mainColumns) continue;
                  const extendedSideHeight = height - normalHeight - gap;
                  const extendedSideRows = maximum(extendedSideHeight, w);
                  for (
                    let leftColumns = 1;
                    leftColumns < columns;
                    leftColumns++
                  ) {
                    if (!debit()) break search;
                    if (
                      span(sideColumns, h) > span(columns - leftColumns, w) ||
                      (crossHeight > normalHeight &&
                        span(leftColumns, w) < span(crossColumns, h)) ||
                      (normalHeight > crossHeight &&
                        span(leftColumns, w) > span(crossColumns, h))
                    )
                      continue;
                    const count =
                      mainColumns * mainRows +
                      sideColumns * extendedSideRows +
                      (columns + leftColumns) * rows +
                      2 * crossColumns * crossRows;
                    if (
                      !extendedSideRows ||
                      count < constraints.minimumPackageCount ||
                      count > constraints.maximumPackageCount ||
                      count > constraints.maxPlacements
                    )
                      continue;
                    plans.push({
                      kind: "six",
                      fixedLeftColumns: leftColumns,
                      transpose,
                      rotation,
                      other,
                      w,
                      h,
                      width,
                      height,
                      columns,
                      rows,
                      crossColumns,
                      crossRows,
                      mainColumns,
                      mainRows,
                      sideColumns,
                      sideRows: extendedSideRows,
                      sideHeight: extendedSideHeight,
                      count,
                    });
                  }
                  if (crossHeight < normalHeight + gap) continue;
                  const sideHeight = height - 2 * normalHeight - 2 * gap;
                  const sideRows = maximum(sideHeight, w);
                  if (!mainColumns || !sideRows) continue;
                  const count =
                    mainColumns * mainRows +
                    sideColumns * sideRows +
                    2 * columns * rows +
                    2 * crossColumns * crossRows;
                  if (
                    count < constraints.minimumPackageCount ||
                    count > constraints.maximumPackageCount ||
                    count > constraints.maxPlacements
                  )
                    continue;
                  plans.push({
                    kind: "seven",
                    transpose,
                    rotation,
                    other,
                    w,
                    h,
                    width,
                    height,
                    columns,
                    rows,
                    crossColumns,
                    crossRows,
                    mainColumns,
                    mainRows,
                    sideColumns,
                    sideRows,
                    sideHeight,
                    count,
                  });
                }
            }
    }
  }
  five: for (const transpose of [false, true]) {
    const availableWidth = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const availableHeight = transpose
      ? bounds.maxX - bounds.minX
      : bounds.maxY - bounds.minY;
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const size = rectangleSizeForRotation(
        input.package.dimensionsMm,
        rotation,
      );
      const w = transpose ? size.width : size.length,
        h = transpose ? size.length : size.width;
      for (let columns = 1; columns <= maximum(availableWidth, w); columns++)
        for (
          let crossColumns = 1;
          crossColumns <= maximum(availableWidth - span(columns, w) - gap, h);
          crossColumns++
        )
          for (let rows = 1; rows <= maximum(availableHeight, h); rows++)
            for (
              let crossRows = 1;
              crossRows <= maximum(availableHeight - span(rows, h) - gap, w);
              crossRows++
            ) {
              if (!debit()) break five;
              const width = span(columns, w) + span(crossColumns, h) + gap;
              const height = span(rows, h) + span(crossRows, w) + gap;
              const coreWidth = width - 2 * span(crossColumns, h) - 2 * gap;
              const coreHeight = height - 2 * span(rows, h) - 2 * gap;
              for (const coreRotation of rotations as Rotation[]) {
                const cs = rectangleSizeForRotation(
                  input.package.dimensionsMm,
                  coreRotation,
                );
                const mainColumns = maximum(
                  coreWidth,
                  transpose ? cs.width : cs.length,
                );
                const mainRows = maximum(
                  coreHeight,
                  transpose ? cs.length : cs.width,
                );
                if (!mainColumns || !mainRows) continue;
                const count =
                  2 * columns * rows +
                  2 * crossColumns * crossRows +
                  mainColumns * mainRows;
                if (
                  count < constraints.minimumPackageCount ||
                  count > constraints.maximumPackageCount ||
                  count > constraints.maxPlacements
                )
                  continue;
                plans.push({
                  kind: "five",
                  coreRotation,
                  transpose,
                  rotation,
                  other,
                  w,
                  h,
                  width,
                  height,
                  columns,
                  rows,
                  crossColumns,
                  crossRows,
                  mainColumns,
                  mainRows,
                  sideColumns: 0,
                  sideRows: 0,
                  sideHeight: 0,
                  count,
                });
              }
            }
    }
  }
  nine: for (const transpose of [false, true]) {
    const availableWidth = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const availableHeight = transpose
      ? bounds.maxX - bounds.minX
      : bounds.maxY - bounds.minY;
    for (const rotation of rotations as Rotation[]) {
      const other = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const size = rectangleSizeForRotation(
        input.package.dimensionsMm,
        rotation,
      );
      const w = transpose ? size.width : size.length,
        h = transpose ? size.length : size.width;
      for (
        let mainColumns = 1;
        mainColumns <= maximum(availableWidth / 2, w);
        mainColumns++
      )
        for (
          let mainRows = 1;
          mainRows <= maximum(availableHeight / 2, h);
          mainRows++
        )
          for (
            let crossColumns = 1;
            crossColumns <=
            maximum(availableWidth - 2 * span(mainColumns, w) - 2 * gap, h);
            crossColumns++
          )
            for (
              let crossRows = 1;
              crossRows <=
              maximum(availableHeight - 2 * span(mainRows, h) - 2 * gap, w);
              crossRows++
            ) {
              if (!debit()) break nine;
              const a = span(mainColumns, w),
                b = span(mainRows, h),
                c = span(crossColumns, h),
                d = span(crossRows, w);
              if (c < a || b < d) continue;
              for (
                let rows = 1;
                rows <= maximum(availableHeight - 2 * b - d - 3 * gap, h);
                rows++
              )
                for (
                  let sideColumns = 1;
                  sideColumns <=
                  maximum(availableWidth - 2 * a - c - 3 * gap, h);
                  sideColumns++
                ) {
                  if (!debit()) break nine;
                  const bodyWidth = 2 * a + c + 2 * gap;
                  const width = bodyWidth + span(sideColumns, h) + gap;
                  const height = span(rows, h) + 2 * b + d + 3 * gap;
                  const columns = maximum(bodyWidth, w),
                    sideRows = maximum(height, w);
                  const count =
                    6 * mainColumns * mainRows +
                    3 * crossColumns * crossRows +
                    columns * rows +
                    sideColumns * sideRows;
                  if (
                    !columns ||
                    !sideRows ||
                    count < constraints.minimumPackageCount ||
                    count > constraints.maximumPackageCount ||
                    count > constraints.maxPlacements
                  )
                    continue;
                  plans.push({
                    kind: "nine",
                    transpose,
                    rotation,
                    other,
                    w,
                    h,
                    width,
                    height,
                    columns,
                    rows,
                    crossColumns,
                    crossRows,
                    mainColumns,
                    mainRows,
                    sideColumns,
                    sideRows,
                    sideHeight: height,
                    count,
                  });
                }
            }
    }
  }
  // Dense constructions are materialized first, independently of callback batching.
  plans.sort(
    (a, b) => b.count - a.count || a.width * a.height - b.width * b.height,
  );
  for (const p of plans) {
    const normalHeight = span(p.rows, p.h),
      crossHeight = span(p.crossRows, p.w);
    const mainHeight = span(p.mainRows, p.h);
    for (
      let leftColumns = p.fixedLeftColumns ?? 1;
      leftColumns <
      (p.fixedLeftColumns !== undefined
        ? p.fixedLeftColumns + 1
        : p.kind === "five"
          ? 10
          : p.kind === "nine"
            ? 2
            : p.columns);
      leftColumns++
    ) {
      const leftWidth = span(leftColumns, p.w),
        rightWidth = span(p.columns - leftColumns, p.w);
      const sideWidth = span(p.sideColumns, p.h);
      if (
        p.kind === "seven" &&
        leftWidth + SOLVER_GEOMETRY_EPSILON_MM < span(p.crossColumns, p.h)
      )
        continue;
      // The side corridor and inner crosswise arm coexist above the right block.
      if (
        p.kind === "seven" &&
        sideWidth > rightWidth + SOLVER_GEOMETRY_EPSILON_MM
      )
        continue;
      for (const reflectX of [false, true])
        for (const reflectY of [false, true]) {
          if (!debit(p.count)) return done();
          const placements: GeneratedPlacement[] = [];
          const offsetX =
            bounds.minX +
            (bounds.maxX - bounds.minX - (p.transpose ? p.height : p.width)) /
              2;
          const offsetY =
            bounds.minY +
            (bounds.maxY - bounds.minY - (p.transpose ? p.width : p.height)) /
              2;
          const grid = (
            x: number,
            y: number,
            columns: number,
            rows: number,
            dx: number,
            dy: number,
            rotation: Rotation,
            regionHeight = span(rows, dy),
            regionWidth = span(columns, dx),
            compactPickup = false,
          ) => {
            const line = (
              start: number,
              count: number,
              item: number,
              available: number,
            ) =>
              Array.from({ length: count }, (_, i) =>
                count === 1
                  ? start + available / 2
                  : start + item / 2 + (i * (available - item)) / (count - 1),
              );
            let xs = line(x, columns, dx, regionWidth);
            let ys = line(y, rows, dy, regionHeight);
            if (reflectX) xs = xs.map((v) => p.width - v);
            if (reflectY) ys = ys.map((v) => p.height - v);
            let worldX = p.transpose ? ys : xs,
              worldY = p.transpose ? xs : ys;
            worldX = worldX.map((v) => v + offsetX);
            worldY = worldY.map((v) => v + offsetY);
            if (compactPickup && gap <= DEFAULT_SUCTION_GROUPING_TOLERANCE_MM) {
              const alongX = rotation % 180 === 0;
              const centers = [...(alongX ? worldX : worldY)].sort(
                (a, b) => a - b,
              );
              const sizes = contiguousSuctionGroupSizes(
                centers.length,
                constraints.provisionalPackagesPerCycle,
                rotation,
                constraints.suctionRemainderPolicy,
              );
              let index = 0;
              const quantized: number[] = [];
              const grouped = sizes.flatMap((count) => {
                const center =
                  (centers[index]! + centers[index + count - 1]!) / 2;
                index += count;
                return Array.from({ length: count }, (_, i) => {
                  const offset =
                    (i - (count - 1) / 2) *
                    (input.package.dimensionsMm.length + gap);
                  quantized.push(Math.floor(center + 1e-9) + offset);
                  return center + offset;
                });
              });
              // Quantize pickup centers only where the cap's slack permits it.
              // Never introduce the half-millimeter overlaps possible in ROB text.
              const quantizationFits = quantized.every(
                (center, i) =>
                  center >= centers[0]! - SOLVER_GEOMETRY_EPSILON_MM &&
                  center <=
                    centers[centers.length - 1]! + SOLVER_GEOMETRY_EPSILON_MM &&
                  (i === 0 ||
                    center - quantized[i - 1]! >=
                      input.package.dimensionsMm.length +
                        gap -
                        SOLVER_GEOMETRY_EPSILON_MM),
              );
              const selected = quantizationFits ? quantized : grouped;
              if (alongX) worldX = selected;
              else worldY = selected;
            }
            for (const y of worldY)
              for (const x of worldX)
                placements.push({ positionMm: { x, y }, rotation });
          };
          if (p.kind === "five") {
            const crossWidth = span(p.crossColumns, p.h),
              normalWidth = span(p.columns, p.w);
            grid(0, 0, p.crossColumns, p.crossRows, p.h, p.w, p.other);
            grid(crossWidth + gap, 0, p.columns, p.rows, p.w, p.h, p.rotation);
            grid(
              normalWidth + gap,
              normalHeight + gap,
              p.crossColumns,
              p.crossRows,
              p.h,
              p.w,
              p.other,
            );
            grid(0, crossHeight + gap, p.columns, p.rows, p.w, p.h, p.rotation);
            const cs = rectangleSizeForRotation(
              input.package.dimensionsMm,
              p.coreRotation!,
            );
            const dx = p.transpose ? cs.width : cs.length,
              dy = p.transpose ? cs.length : cs.width;
            const coreWidth = p.width - 2 * crossWidth - 2 * gap,
              coreHeight = p.height - 2 * normalHeight - 2 * gap;
            const alignmentX = ((leftColumns - 1) % 3) / 2,
              alignmentY = Math.floor((leftColumns - 1) / 3) / 2;
            grid(
              crossWidth +
                gap +
                (coreWidth - span(p.mainColumns, dx)) * alignmentX,
              normalHeight +
                gap +
                (coreHeight - span(p.mainRows, dy)) * alignmentY,
              p.mainColumns,
              p.mainRows,
              dx,
              dy,
              p.coreRotation!,
            );
          } else if (p.kind === "nine") {
            const a = span(p.mainColumns, p.w),
              b = span(p.mainRows, p.h),
              c = span(p.crossColumns, p.h),
              d = span(p.crossRows, p.w),
              cap = span(p.rows, p.h);
            grid(
              0,
              0,
              p.columns,
              p.rows,
              p.w,
              p.h,
              p.rotation,
              cap,
              p.width - sideWidth - gap,
              true,
            );
            grid(
              p.width - sideWidth,
              0,
              p.sideColumns,
              p.sideRows,
              p.h,
              p.w,
              p.other,
              p.height,
            );
            grid(0, cap + gap, p.crossColumns, p.crossRows, p.h, p.w, p.other);
            grid(
              a + gap,
              cap + b + 2 * gap,
              p.crossColumns,
              p.crossRows,
              p.h,
              p.w,
              p.other,
            );
            grid(
              2 * a + 2 * gap,
              cap + 2 * b + 3 * gap,
              p.crossColumns,
              p.crossRows,
              p.h,
              p.w,
              p.other,
            );
            grid(
              0,
              cap + d + 2 * gap,
              p.mainColumns,
              2 * p.mainRows,
              p.w,
              p.h,
              p.rotation,
            );
            grid(
              a + gap,
              cap + b + d + 3 * gap,
              p.mainColumns,
              p.mainRows,
              p.w,
              p.h,
              p.rotation,
            );
            grid(
              c + gap,
              cap + gap,
              2 * p.mainColumns,
              p.mainRows,
              p.w,
              p.h,
              p.rotation,
            );
            grid(
              a + c + 2 * gap,
              cap + b + 2 * gap,
              p.mainColumns,
              p.mainRows,
              p.w,
              p.h,
              p.rotation,
            );
          } else {
            grid(0, 0, p.mainColumns, p.mainRows, p.w, p.h, p.rotation);
            grid(
              p.width - sideWidth,
              0,
              p.sideColumns,
              p.sideRows,
              p.h,
              p.w,
              p.other,
              p.sideHeight,
            );
            grid(
              0,
              mainHeight + gap,
              leftColumns,
              p.rows,
              p.w,
              p.h,
              p.rotation,
            );
            grid(
              leftWidth + gap,
              mainHeight + gap,
              p.crossColumns,
              p.crossRows,
              p.h,
              p.w,
              p.other,
            );
            if (p.kind !== "six")
              grid(
                p.width - rightWidth,
                p.height - 2 * normalHeight - gap,
                p.columns - leftColumns,
                p.rows,
                p.w,
                p.h,
                p.rotation,
              );
            grid(
              0,
              p.height - crossHeight,
              p.crossColumns,
              p.crossRows,
              p.h,
              p.w,
              p.other,
            );
            grid(
              p.width - span(p.columns, p.w),
              p.height - normalHeight,
              p.columns,
              p.rows,
              p.w,
              p.h,
              p.rotation,
            );
          }
          if (
            !emit(placements, {
              family: "stepped-block",
              variant:
                p.kind === "five"
                  ? "filled-five-grid-ring"
                  : p.kind === "six"
                    ? "six-grid-ring"
                    : p.kind === "seven"
                      ? "seven-grid-ring"
                      : "nine-grid-staircase",
              parameters: {
                transpose: p.transpose,
                rotation: p.rotation,
                coreRotation: p.coreRotation ?? null,
                columns: p.columns,
                rows: p.rows,
                crossColumns: p.crossColumns,
                crossRows: p.crossRows,
                mainColumns: p.mainColumns,
                mainRows: p.mainRows,
                sideColumns: p.sideColumns,
                sideRows: p.sideRows,
                leftColumns,
                reflectX,
                reflectY,
              },
            })
          )
            return done();
        }
    }
  }
  return done();
}
