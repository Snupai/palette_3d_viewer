import { describe, expect, it } from "vitest";
import {
  compareGripPositionsBottomRightRowMajor,
  deriveGripDeltasForPlacementOrder,
} from "~/domain/gripDependencies";
import { solveLayer } from "~/domain/solver/solve";

describe("generated candidate blue lines", () => {
  const result = solveLayer({
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 50 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
  });

  it("leaves the first grip of every candidate without a reference", () => {
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.grips[0]).toMatchObject({ dx: 0, dy: 0 });
    }
  });

  it("orders grips bottom-row-first from right to left and keeps every generated approach reproducible", () => {
    const referencing = result.candidates.flatMap((candidate) =>
      candidate.grips.filter((grip) => grip.dx !== 0 || grip.dy !== 0),
    );
    expect(referencing.length).toBeGreaterThan(0);

    for (const candidate of result.candidates) {
      expect(
        [...candidate.grips].sort(
          (left, right) =>
            compareGripPositionsBottomRightRowMajor(left, right) ||
            left.id.localeCompare(right.id),
        ),
      ).toEqual(candidate.grips);
      expect(candidate.grips.map(({ sequence }) => sequence)).toEqual(
        candidate.grips.map((_, index) => index),
      );

      const derived = deriveGripDeltasForPlacementOrder(
        candidate.grips,
        100,
        50,
        0,
        { maxReferenceGapMm: 0 },
      );
      expect(candidate.grips.map(({ dx, dy }) => ({ dx, dy }))).toEqual(
        derived.deltas,
      );

      const position = new Map(
        candidate.grips.map((grip, index) => [grip.id, index]),
      );
      for (const { beforeGripId, afterGripId } of candidate.orderDependencies) {
        expect(position.get(beforeGripId)).toBeLessThan(
          position.get(afterGripId)!,
        );
      }
    }
  });
});
