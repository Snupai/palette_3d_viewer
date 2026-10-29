import type { Rotation } from "~/domain/palletTypes";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import type {
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

export const STEPPED_STRIP_WORK_LIMITS = {
  descriptorAttempts: 10_000,
  materializedPlacements: 100_000,
} as const;

type Plan = {
  transpose: boolean;
  rotation: Rotation;
  otherRotation: Rotation;
  inlineSpan: number;
  crossSpan: number;
  crossColumns: number;
  topColumns: number;
  leftColumns: number;
  sideColumns: number;
  baseColumns: number;
  baseRows: number;
  sideRows: number;
  baseHeight: number;
  sideHeight: number;
  width: number;
  height: number;
  count: number;
};

type WorkLimits = {
  descriptorAttempts: number;
  materializedPlacements: number;
};

/** Two staggered crossbars above a base grid, closed by a distributed side strip. */
export function searchSteppedStripPatterns(
  input: NormalizedLayerSolverInput,
  emit: (
    placements: readonly GeneratedPlacement[],
    provenance: GeneratorProvenance,
  ) => boolean,
  shouldContinue: () => boolean,
  limits: WorkLimits = STEPPED_STRIP_WORK_LIMITS,
): {
  descriptorAttempts: number;
  materializedPlacements: number;
  limitReached: keyof WorkLimits | null;
} {
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    throw new RangeError(
      "Stepped-strip work limits must be non-negative safe integers.",
    );
  }
  let descriptorAttempts = 0;
  let materializedPlacements = 0;
  let limitReached: keyof WorkLimits | null = null;
  const result = () => ({
    descriptorAttempts,
    materializedPlacements,
    limitReached,
  });
  const debit = () => {
    if (!shouldContinue()) return false;
    if (descriptorAttempts === limits.descriptorAttempts) {
      limitReached = "descriptorAttempts";
      return false;
    }
    descriptorAttempts++;
    return true;
  };
  const rotations = [
    ([0, 180] as const).find((r) =>
      input.constraints.allowedRotations.includes(r),
    ),
    ([90, 270] as const).find((r) =>
      input.constraints.allowedRotations.includes(r),
    ),
  ];
  if (
    rotations.some((r) => r === undefined) ||
    !input.constraints.allowMixedPackageOrientations ||
    input.constraints.requiredShape !== "any"
  )
    return result();

  const gap = input.package.clearanceMm;
  const bounds = input.generationBoundsMm;
  const span = (count: number, item: number) =>
    count * item + (count - 1) * gap;
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
  const plans: Plan[] = [];
  search: for (const transpose of [false, true]) {
    const availableWidth = transpose
      ? bounds.maxY - bounds.minY
      : bounds.maxX - bounds.minX;
    const availableHeight = transpose
      ? bounds.maxX - bounds.minX
      : bounds.maxY - bounds.minY;
    for (const rotation of rotations as Rotation[]) {
      const otherRotation = rotations.find((r) => r! % 180 !== rotation % 180)!;
      const horizontal = rotation % 180 === 0;
      const w =
        horizontal !== transpose
          ? input.package.dimensionsMm.length
          : input.package.dimensionsMm.width;
      const h =
        horizontal !== transpose
          ? input.package.dimensionsMm.width
          : input.package.dimensionsMm.length;
      // The crossbars rise by w - h; only this orientation interlocks.
      if (w <= h) continue;
      for (let a = 1; a <= maximum(availableWidth, h); a++) {
        for (let b = 2; b <= maximum(availableWidth, w); b++) {
          if (!debit()) break search;
          const crossWidth = span(a, h);
          const width = crossWidth + gap + span(b, w);
          if (width > availableWidth + SOLVER_GEOMETRY_EPSILON_MM) continue;
          for (let c = 1; c < b; c++) {
            if (!debit()) break search;
            if (span(c, w) < crossWidth - SOLVER_GEOMETRY_EPSILON_MM) continue;
            for (let s = 1; s <= maximum(span(b - c, w), h); s++) {
              if (!debit()) break search;
              const sideWidth = span(s, h);
              const baseColumns = maximum(width - sideWidth - gap, w);
              if (
                !baseColumns ||
                span(c, w) + gap + crossWidth >
                  width - sideWidth - gap + SOLVER_GEOMETRY_EPSILON_MM
              )
                continue;
              for (
                let rows = maximum(availableHeight - w - h - 2 * gap, h);
                rows >= 1;
                rows--
              ) {
                if (!debit()) break search;
                const baseHeight = span(rows, h);
                const height = baseHeight + w + h + 2 * gap;
                const sideHeight = baseHeight + w - h;
                const sideRows = maximum(sideHeight, w);
                if (!sideRows) continue;
                const count = baseColumns * rows + 2 * a + 2 * b + s * sideRows;
                if (
                  count < input.constraints.minimumPackageCount ||
                  count >
                    Math.min(
                      input.constraints.maximumPackageCount,
                      input.constraints.maxPlacements,
                    )
                )
                  continue;
                plans.push({
                  transpose,
                  rotation,
                  otherRotation,
                  inlineSpan: w,
                  crossSpan: h,
                  crossColumns: a,
                  topColumns: b,
                  leftColumns: c,
                  sideColumns: s,
                  baseColumns,
                  baseRows: rows,
                  sideRows,
                  baseHeight,
                  sideHeight,
                  width,
                  height,
                  count,
                });
                // A shorter base with the same crossbars is an avoidable
                // partial layer. Descending search still finds the largest
                // feasible base when a package-count cap prevents a full one.
                break;
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
  for (const plan of plans) {
    for (const mirrorX of [false, true]) {
      for (const mirrorY of [false, true]) {
        if (!shouldContinue()) return result();
        if (
          materializedPlacements + plan.count >
          limits.materializedPlacements
        ) {
          limitReached = "materializedPlacements";
          return result();
        }
        materializedPlacements += plan.count;
        const placements: GeneratedPlacement[] = [];
        const grid = (
          x: number,
          y: number,
          columns: number,
          rows: number,
          dx: number,
          dy: number,
          rotation: Rotation,
          height = span(rows, dy),
        ) => {
          for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
              let centerX = x + dx / 2 + column * (dx + gap);
              let centerY =
                rows === 1
                  ? y + height / 2
                  : y + dy / 2 + (row * (height - dy)) / (rows - 1);
              if (mirrorX) centerX = plan.width - centerX;
              if (mirrorY) centerY = plan.height - centerY;
              placements.push({
                positionMm: plan.transpose
                  ? { x: centerY, y: centerX }
                  : { x: centerX, y: centerY },
                rotation,
              });
            }
          }
        };
        const w = plan.inlineSpan,
          h = plan.crossSpan;
        const a = plan.crossColumns,
          b = plan.topColumns,
          c = plan.leftColumns;
        grid(0, 0, plan.baseColumns, plan.baseRows, w, h, plan.rotation);
        grid(0, plan.baseHeight + h + 2 * gap, a, 1, h, w, plan.otherRotation);
        grid(span(a, h) + gap, plan.height - h, b, 1, w, h, plan.rotation);
        grid(0, plan.baseHeight + gap, c, 1, w, h, plan.rotation);
        grid(
          span(c, w) + gap,
          plan.baseHeight + gap,
          a,
          1,
          h,
          w,
          plan.otherRotation,
        );
        grid(
          span(c, w) + span(a, h) + 2 * gap,
          plan.baseHeight + w - h + gap,
          b - c,
          1,
          w,
          h,
          plan.rotation,
        );
        // Keep the side strip's residual spacing: separated packages are individual picks.
        grid(
          plan.width - span(plan.sideColumns, h),
          0,
          plan.sideColumns,
          plan.sideRows,
          h,
          w,
          plan.otherRotation,
          plan.sideHeight,
        );
        if (
          !emit(placements, {
            family: "stepped-strip",
            variant: "staggered-crossbars",
            parameters: {
              transpose: plan.transpose,
              rotation: plan.rotation,
              mirrorX,
              mirrorY,
              crossColumns: a,
              topColumns: b,
              leftColumns: c,
              sideColumns: plan.sideColumns,
              baseColumns: plan.baseColumns,
              baseRows: plan.baseRows,
              sideRows: plan.sideRows,
            },
          })
        )
          return result();
      }
    }
  }
  return result();
}
