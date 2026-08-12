import { describe, expect, it } from "vitest";
import type { PlacementGeometry } from "~/domain/geometry";
import {
  matchPhysicalFootprintPlacements,
  physicalFootprintGeometryFingerprint,
  physicalFootprintOrientationHistogram,
} from "~/lib/parity/physicalGeometry";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("parity physical footprint geometry", () => {
  it("collapses antiparallel yaw and every square-package yaw without changing centers", () => {
    const rectangular: PlacementGeometry[] = [
      { positionMm: { x: 10, y: 20 }, rotation: 0 },
      { positionMm: { x: 30, y: 40 }, rotation: 90 },
    ];
    const antiparallel: PlacementGeometry[] = [
      { positionMm: { x: 30, y: 40 }, rotation: 270 },
      { positionMm: { x: 10, y: 20 }, rotation: 180 },
    ];

    expect(
      physicalFootprintGeometryFingerprint(rectangular, {
        length: 100,
        width: 50,
      }),
    ).toBe(
      physicalFootprintGeometryFingerprint(antiparallel, {
        length: 100,
        width: 50,
      }),
    );
    expect(
      physicalFootprintOrientationHistogram(antiparallel, {
        length: 100,
        width: 100,
      }),
    ).toEqual({ lengthwise: 0, crosswise: 0, square: 2 });
  });

  it("matches permuted half-millimeter jitter deterministically across seeded layouts", () => {
    const random = seededRandom(0x50_00_01);
    for (let caseIndex = 0; caseIndex < 20; caseIndex += 1) {
      const source: PlacementGeometry[] = Array.from(
        { length: 12 },
        (_, index) => ({
          positionMm: {
            x: (index % 4) * 150 + 50,
            y: Math.floor(index / 4) * 120 + 50,
          },
          rotation: index % 2 === 0 ? 0 : 90,
        }),
      );
      const candidate = source
        .map((placement) => ({
          positionMm: {
            x: placement.positionMm.x + (random() < 0.5 ? -0.5 : 0.5),
            y: placement.positionMm.y + (random() < 0.5 ? -0.5 : 0.5),
          },
          rotation: (placement.rotation + 180) as 180 | 270,
        }))
        .sort(() => random() - 0.5);

      expect(
        matchPhysicalFootprintPlacements(
          source,
          candidate,
          { length: 100, width: 60 },
          0.500_001,
        ),
      ).toEqual({ matched: true, maximumAxisDisplacementMm: 0.5 });
      expect(
        matchPhysicalFootprintPlacements(
          source,
          candidate,
          { length: 100, width: 60 },
          0.499_999,
        ).matched,
      ).toBe(false);
    }
  });

  it("requires a true one-to-one placement assignment", () => {
    const source: PlacementGeometry[] = [
      { positionMm: { x: 0, y: 0 }, rotation: 0 },
      { positionMm: { x: 0.5, y: 0 }, rotation: 180 },
    ];
    const candidate: PlacementGeometry[] = [
      { positionMm: { x: 0.4, y: 0 }, rotation: 0 },
      { positionMm: { x: 0.9, y: 0 }, rotation: 180 },
    ];

    expect(
      matchPhysicalFootprintPlacements(
        source,
        candidate,
        { length: 1, width: 1 },
        0.5,
      ),
    ).toEqual({ matched: true, maximumAxisDisplacementMm: 0.4 });
  });
});
