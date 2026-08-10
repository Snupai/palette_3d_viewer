import { describe, expect, it } from "vitest";
import {
  canonicalPlacementGeometryKey,
  canonicalizePlacementOrder,
  createCenteredEffectivePalletEnvelope,
  createEffectivePalletEnvelope,
  inverseLayerSymmetry,
  LAYER_SYMMETRIES,
  placementRectangleBounds,
  placementWithinBounds,
  placementsOverlap,
  rectangleBoundsLength,
  rectangleBoundsOverlap,
  rectangleBoundsWidth,
  transformPlacement,
  transformedEnvelopeBounds,
  type PlacementGeometry,
} from "~/domain/geometry";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("effective pallet envelopes", () => {
  it("applies signed overhang and underhang independently on every side", () => {
    const envelope = createEffectivePalletEnvelope(
      { length: 1200, width: 800 },
      {
        negativeX: 20,
        positiveX: -30,
        negativeY: -10,
        positiveY: 15,
      },
    );

    expect(envelope).toEqual({
      minX: -20,
      minY: 10,
      maxX: 1170,
      maxY: 815,
    });
  });

  it("supports centered total-dimension deltas without per-side ambiguity", () => {
    const envelope = createCenteredEffectivePalletEnvelope(
      { length: 1200, width: 800 },
      { length: -34, width: -11 },
    );

    expect(rectangleBoundsLength(envelope)).toBe(1166);
    expect(rectangleBoundsWidth(envelope)).toBe(789);
    expect(envelope).toEqual({
      minX: 17,
      minY: 5.5,
      maxX: 1183,
      maxY: 794.5,
    });
  });
});

describe("clearance-aware rectangle geometry", () => {
  it("allows exact clearance and rejects any smaller gap", () => {
    const packageSize = { length: 100, width: 50 };
    const left = { positionMm: { x: 50, y: 25 }, rotation: 0 as const };
    const exact = {
      positionMm: { x: 155, y: 25 },
      rotation: 0 as const,
    };
    const tooClose = {
      positionMm: { x: 154.999, y: 25 },
      rotation: 0 as const,
    };

    expect(placementsOverlap(left, exact, packageSize, 5)).toBe(false);
    expect(placementsOverlap(left, tooClose, packageSize, 5)).toBe(true);
  });

  it("matches an independent seeded overlap oracle and remains symmetric", () => {
    const random = seededRandom(0x5eed1234);
    const packageSize = { length: 23, width: 17 };
    for (let index = 0; index < 500; index += 1) {
      const left: PlacementGeometry = {
        positionMm: { x: random() * 100, y: random() * 100 },
        rotation: random() < 0.5 ? 0 : 90,
      };
      const right: PlacementGeometry = {
        positionMm: { x: random() * 100, y: random() * 100 },
        rotation: random() < 0.5 ? 0 : 90,
      };
      const clearance = random() * 8;
      const leftBounds = placementRectangleBounds(left, packageSize);
      const rightBounds = placementRectangleBounds(right, packageSize);
      const expected =
        leftBounds.minX - clearance / 2 < rightBounds.maxX + clearance / 2 &&
        leftBounds.maxX + clearance / 2 > rightBounds.minX - clearance / 2 &&
        leftBounds.minY - clearance / 2 < rightBounds.maxY + clearance / 2 &&
        leftBounds.maxY + clearance / 2 > rightBounds.minY - clearance / 2;

      expect(placementsOverlap(left, right, packageSize, clearance)).toBe(
        expected,
      );
      expect(placementsOverlap(right, left, packageSize, clearance)).toBe(
        expected,
      );
      expect(rectangleBoundsOverlap(leftBounds, rightBounds, clearance)).toBe(
        expected,
      );
    }
  });

  it("recognizes seeded in-bounds placements in both footprint rotations", () => {
    const random = seededRandom(0xb0a1d5);
    const envelope = { minX: -20, minY: 10, maxX: 380, maxY: 310 };
    const packageSize = { length: 40, width: 25 };
    for (let index = 0; index < 200; index += 1) {
      const rotation = random() < 0.5 ? (0 as const) : (90 as const);
      const length = rotation === 0 ? packageSize.length : packageSize.width;
      const width = rotation === 0 ? packageSize.width : packageSize.length;
      const placement = {
        positionMm: {
          x: envelope.minX + length / 2 + random() * (400 - length),
          y: envelope.minY + width / 2 + random() * (300 - width),
        },
        rotation,
      };
      expect(placementWithinBounds(placement, packageSize, envelope)).toBe(
        true,
      );
    }
  });
});

describe("orthogonal transforms and canonical placement ordering", () => {
  it("round-trips every symmetry for seeded placements", () => {
    const random = seededRandom(0x710f0a0d);
    const source = { minX: -30, minY: 25, maxX: 270, maxY: 225 };
    for (const symmetry of LAYER_SYMMETRIES) {
      const transformedBounds = transformedEnvelopeBounds(source, symmetry);
      for (let index = 0; index < 50; index += 1) {
        const placement: PlacementGeometry = {
          positionMm: {
            x: source.minX + random() * 300,
            y: source.minY + random() * 200,
          },
          rotation: [0, 90, 180, 270][
            index % 4
          ] as PlacementGeometry["rotation"],
        };
        const transformed = transformPlacement(placement, source, symmetry);
        const roundTripped = transformPlacement(
          transformed,
          transformedBounds,
          inverseLayerSymmetry(symmetry),
        );

        expect(roundTripped.positionMm.x).toBeCloseTo(
          placement.positionMm.x,
          10,
        );
        expect(roundTripped.positionMm.y).toBeCloseTo(
          placement.positionMm.y,
          10,
        );
        expect(roundTripped.rotation).toBe(placement.rotation);
      }
    }
  });

  it("canonicalizes independently of array order and transient ids", () => {
    const placements = [
      {
        id: "temporary-b",
        transientId: "generator-8",
        positionMm: { x: 30, y: 40 },
        rotation: 90 as const,
      },
      {
        id: "temporary-a",
        transientId: "generator-4",
        positionMm: { x: 10, y: 20 },
        rotation: 0 as const,
      },
    ];
    const renamed = [...placements].reverse().map((placement, index) => ({
      ...placement,
      id: `renamed-${index}`,
      transientId: `other-${index}`,
    }));

    expect(canonicalPlacementGeometryKey(placements)).toBe(
      canonicalPlacementGeometryKey(renamed),
    );
    expect(
      canonicalizePlacementOrder(renamed).map(({ positionMm, rotation }) => ({
        positionMm,
        rotation,
      })),
    ).toEqual(
      canonicalizePlacementOrder(placements).map(
        ({ positionMm, rotation }) => ({ positionMm, rotation }),
      ),
    );
  });
});
