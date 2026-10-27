import type {
  MultiPackPackageDmm,
  SimpleFamilySlot,
  SlotType,
} from "~/domain/solver/multipack/families";
import type { MultiPackSolution } from "~/domain/solver/multipack/optimizer";

/**
 * Bounded enumeration of MultiPack solution records. The legacy candidate
 * enumerator is not part of the reverse-engineered specification, so this
 * covers the slot shapes whose generation is specified: single-orientation
 * grids and two orthogonal bands. Kombi staircases (`emitKombiFamily`) are
 * not enumerated: a probe against the captured oracle exports reproduced one
 * layout while adding hundreds of drafts per case.
 */
export type MultiPackEnumerationInput = {
  paletteDmm: { x: number; y: number };
  package: MultiPackPackageDmm;
  clearanceDmm: number;
};

export type EnumeratedMultiPackSolution = {
  variant: string;
  solution: MultiPackSolution;
};

function fit(span: number, item: number, clearance: number): number {
  if (span < item) return 0;
  return Math.floor((span + clearance) / (item + clearance));
}

function used(count: number, item: number, clearance: number): number {
  return count <= 0 ? 0 : count * (item + clearance) - clearance;
}

function extents(type: SlotType, pkg: MultiPackPackageDmm) {
  return type === 1
    ? { x: pkg.length, y: pkg.width }
    : { x: pkg.width, y: pkg.length };
}

const TYPES: readonly SlotType[] = [1, 2];

function grids(
  input: MultiPackEnumerationInput,
): EnumeratedMultiPackSolution[] {
  const { paletteDmm, clearanceDmm: c } = input;
  const result: EnumeratedMultiPackSolution[] = [];
  for (const type of TYPES) {
    const size = extents(type, input.package);
    const countX = fit(paletteDmm.x, size.x, c);
    const countY = fit(paletteDmm.y, size.y, c);
    if (countX === 0 || countY === 0) continue;
    const block = { x: used(countX, size.x, c), y: used(countY, size.y, c) };
    result.push({
      variant: `grid:t${type}:${countX}x${countY}`,
      solution: {
        paletteDmm,
        blockDmm: block,
        package: input.package,
        clearanceDmm: c,
        slots: [
          {
            kind: "simple",
            type,
            x0: 0,
            x1: block.x,
            y0: 0,
            y1: block.y,
            countX,
            countY,
          },
        ],
      },
    });
  }
  return result;
}

/** Two bands of different orientation stacked along `axis`, both spanning the block width. */
function bands(
  input: MultiPackEnumerationInput,
): EnumeratedMultiPackSolution[] {
  const { paletteDmm, clearanceDmm: c } = input;
  const result: EnumeratedMultiPackSolution[] = [];
  for (const axis of ["y", "x"] as const) {
    const cross = axis === "y" ? "x" : "y";
    for (const first of TYPES) {
      const second: SlotType = first === 1 ? 2 : 1;
      const a = extents(first, input.package);
      const b = extents(second, input.package);
      const crossA = fit(paletteDmm[cross], a[cross], c);
      const crossB = fit(paletteDmm[cross], b[cross], c);
      if (crossA === 0 || crossB === 0) continue;
      const crossSpan = Math.max(
        used(crossA, a[cross], c),
        used(crossB, b[cross], c),
      );
      const maxA = fit(paletteDmm[axis], a[axis], c);
      for (let countA = 1; countA < maxA; countA += 1) {
        const spanA = countA * (a[axis] + c);
        const countB = fit(paletteDmm[axis] - spanA, b[axis], c);
        if (countB === 0) continue;
        const along = spanA + used(countB, b[axis], c);
        const slot = (
          type: SlotType,
          start: number,
          end: number,
          countAlong: number,
          countCross: number,
        ): SimpleFamilySlot =>
          axis === "y"
            ? {
                kind: "simple",
                type,
                x0: 0,
                x1: crossSpan,
                y0: start,
                y1: end,
                countX: countCross,
                countY: countAlong,
              }
            : {
                kind: "simple",
                type,
                x0: start,
                x1: end,
                y0: 0,
                y1: crossSpan,
                countX: countAlong,
                countY: countCross,
              };
        result.push({
          variant: `bands:${axis}:t${first}x${countA}:t${second}x${countB}`,
          solution: {
            paletteDmm,
            blockDmm:
              axis === "y"
                ? { x: crossSpan, y: along }
                : { x: along, y: crossSpan },
            package: input.package,
            clearanceDmm: c,
            slots: [
              slot(first, 0, used(countA, a[axis], c), countA, crossA),
              slot(second, spanA, along, countB, crossB),
            ],
          },
        });
      }
    }
  }
  return result;
}

export function enumerateMultiPackSolutions(
  input: MultiPackEnumerationInput,
): EnumeratedMultiPackSolution[] {
  return [...grids(input), ...bands(input)];
}
