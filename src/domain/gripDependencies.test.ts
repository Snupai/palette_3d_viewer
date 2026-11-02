import { describe, expect, it } from "vitest";
import {
  buildGripDeltaDependencies,
  buildGripVerticalOverlapDependencies,
  compareGripsByLayerRows,
  createGripOrderLayout,
  deriveGripDeltasForPlacementOrder,
  insertMergedGripByDeltaDependencies,
  lowerHalfSplitYMm,
  mergeGripOrderDependencies,
  orderGripsByDependencies,
  type GripPlacementFootprint,
} from "~/domain/gripDependencies";
import type { Grip, Rotation } from "~/domain/palletTypes";

function grip(
  id: string,
  x: number,
  y: number,
  dx = 0,
  dy = 0,
  overrides: Partial<Grip> = {},
): Grip {
  return {
    id,
    pickX: 50,
    pickY: -50,
    pickRotation: 0,
    x,
    y,
    rotation: 0,
    numPackages: 1,
    dx,
    dy,
    ...overrides,
  };
}

function footprint(
  gripId: string,
  x: number,
  y: number,
  rotation: Rotation = 0,
): GripPlacementFootprint {
  return { gripId, positionMm: { x, y }, rotation };
}

function byDependency(
  left: { prerequisiteIndex: number; dependentIndex: number },
  right: { prerequisiteIndex: number; dependentIndex: number },
): number {
  return (
    left.dependentIndex - right.dependentIndex ||
    left.prerequisiteIndex - right.prerequisiteIndex
  );
}

describe("grip execution order", () => {
  it("continues a newly available right-side chain before moving left", () => {
    const ordered = orderGripsByDependencies(
      [
        grip("left-top", 50, 150),
        grip("right-top", 150, 150),
        grip("left-bottom", 50, 50),
        grip("right-bottom", 150, 50),
      ],
      [
        {
          beforeGripId: "right-bottom",
          afterGripId: "right-top",
        },
        {
          beforeGripId: "left-bottom",
          afterGripId: "left-top",
        },
      ],
    );

    expect(ordered.map(({ id }) => id)).toEqual([
      "right-bottom",
      "right-top",
      "left-bottom",
      "left-top",
    ]);
  });

  it("orders every lower overlapping grip before the upper grip", () => {
    const placements = [
      footprint("lower-right", 100, 50),
      footprint("upper", 100, 150),
      footprint("lower-left", 50, 50),
    ];
    const dependencies = buildGripVerticalOverlapDependencies(
      ["upper", "lower-left", "lower-right"],
      placements,
      { length: 100, width: 100 },
    );

    expect(dependencies).toEqual([
      { beforeGripId: "lower-left", afterGripId: "upper" },
      { beforeGripId: "lower-right", afterGripId: "upper" },
    ]);
    expect(
      orderGripsByDependencies(
        [
          grip("upper", 100, 150),
          grip("lower-left", 50, 50),
          grip("lower-right", 100, 50),
        ],
        dependencies,
      ).map(({ id }) => id),
    ).toEqual(["lower-right", "lower-left", "upper"]);
  });

  it("rejects cyclic hard dependencies instead of emitting an invalid order", () => {
    expect(() =>
      orderGripsByDependencies(
        [grip("a", 150, 50), grip("b", 50, 150)],
        [
          { beforeGripId: "a", afterGripId: "b", source: "explicit" },
          { beforeGripId: "b", afterGripId: "a", source: "inferred" },
        ],
      ),
    ).toThrow(/dependencies contain a cycle.*a, b/i);
  });

  it("counts 1 mm of X overlap but not touching edges", () => {
    const overlapping = buildGripVerticalOverlapDependencies(
      ["lower", "upper"],
      [footprint("lower", 50, 50), footprint("upper", 149, 150)],
      { length: 100, width: 100 },
    );
    const touching = buildGripVerticalOverlapDependencies(
      ["lower", "upper"],
      [footprint("lower", 50, 50), footprint("upper", 150, 150)],
      { length: 100, width: 100 },
    );

    expect(overlapping).toEqual([
      { beforeGripId: "lower", afterGripId: "upper" },
    ]);
    expect(touching).toEqual([]);
  });

  it("uses individual package footprints for multipackage grips", () => {
    const dependencies = buildGripVerticalOverlapDependencies(
      ["lower-double", "upper-single"],
      [
        footprint("lower-double", 50, 50),
        footprint("lower-double", 250, 50),
        footprint("upper-single", 299, 150),
      ],
      { length: 100, width: 100 },
    );

    expect(dependencies).toEqual([
      { beforeGripId: "lower-double", afterGripId: "upper-single" },
    ]);
  });

  it("orders staggered multipackage grips from their X-overlapping package pairs", () => {
    const dependencies = buildGripVerticalOverlapDependencies(
      ["g4", "g7"],
      [
        footprint("g7", 200, 45.5),
        footprint("g7", 500, 136.5),
        footprint("g4", 250, 136.5),
        footprint("g4", 700, 45.5),
      ],
      { length: 135, width: 91 },
    );

    expect(dependencies).toEqual([
      {
        beforeGripId: "g7",
        afterGripId: "g4",
      },
    ]);
  });

  it("keeps an explicit dependency when current geometry infers the same edge", () => {
    expect(
      mergeGripOrderDependencies(
        [
          {
            beforeGripId: "lower",
            afterGripId: "upper",
            source: "explicit",
          },
        ],
        [
          {
            beforeGripId: "lower",
            afterGripId: "upper",
            source: "inferred",
          },
        ],
      ),
    ).toEqual([
      {
        beforeGripId: "lower",
        afterGripId: "upper",
        source: "explicit",
      },
    ]);
  });

  it("does not invent opposing dependencies for vertically interleaved multipacks", () => {
    const placements = [
      footprint("a", 50, 50),
      footprint("a", 50, 250),
      footprint("b", 50, 150),
      footprint("b", 50, 350),
    ];

    expect(
      buildGripVerticalOverlapDependencies(["b", "a"], placements, {
        length: 100,
        width: 100,
      }),
    ).toEqual([]);
    expect(
      buildGripVerticalOverlapDependencies(
        ["a", "b"],
        [...placements].reverse(),
        { length: 100, width: 100 },
      ),
    ).toEqual([]);
  });
});

describe("derived grip approach deltas", () => {
  const quadrant = [
    grip("right-bottom", 150, 50),
    grip("right-top", 150, 150),
    grip("left-bottom", 50, 50),
    grip("left-top", 50, 150),
  ];

  it("stores the opposite approach offset while target-side references stay unchanged", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      quadrant,
      100,
      100,
      0,
      { maxReferenceGapMm: 0 },
    );

    expect(deltas).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: -1, dy: 1 },
    ]);
    expect(dependencies).toEqual([
      { prerequisiteIndex: 0, dependentIndex: 1 },
      { prerequisiteIndex: 0, dependentIndex: 2 },
      { prerequisiteIndex: 1, dependentIndex: 3 },
      { prerequisiteIndex: 2, dependentIndex: 3 },
    ]);
  });

  it("re-infers the same target-side dependencies from the derived deltas", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      quadrant,
      100,
      100,
      0,
      { maxReferenceGapMm: 0 },
    );
    const inferred = buildGripDeltaDependencies(
      quadrant.map((entry, index) => ({
        ...entry,
        dx: deltas[index]!.dx,
        dy: deltas[index]!.dy,
      })),
      100,
      100,
      0,
    );

    expect([...inferred].sort(byDependency)).toEqual(
      [...dependencies].sort(byDependency),
    );
  });

  it("rejects a horizontal delta when an earlier package blocks the 80 mm sweep", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      [
        grip("target-right", 20, 0),
        grip("approach-blocker", -40, 0),
        grip("current", 0, 0),
      ],
      20,
      20,
      0,
      { maxReferenceGapMm: 0 },
    );

    expect(deltas).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(dependencies).toEqual([]);
  });

  it("falls back from a blocked diagonal to a safe cardinal movement", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      [
        grip("target-right", 20, 0),
        grip("target-bottom", 0, -20),
        grip("diagonal-blocker", -40, 40),
        grip("current", 0, 0),
      ],
      20,
      20,
      0,
      { maxReferenceGapMm: 0 },
    );

    expect(deltas[3]).toEqual({ dx: -1, dy: 0 });
    expect(
      dependencies.filter(({ dependentIndex }) => dependentIndex === 3),
    ).toEqual([{ prerequisiteIndex: 0, dependentIndex: 3 }]);
  });

  it("rejects the whole multipackage grip when only an outer package is blocked", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      [
        grip("target-right-lower", 20, -10),
        grip("approach-blocker-upper", -40, 10),
        grip("double", 0, 0, 0, 0, { rotation: 90, numPackages: 2 }),
      ],
      20,
      20,
      0,
      { maxReferenceGapMm: 0 },
    );

    expect(deltas[2]).toEqual({ dx: 0, dy: 0 });
    expect(
      dependencies.filter(({ dependentIndex }) => dependentIndex === 2),
    ).toEqual([]);
  });

  it("uses the nearest earlier grip across a layout gap by default", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      [grip("right", 200, 50), grip("left", 50, 50)],
      100,
      100,
      0,
    );

    expect(deltas).toEqual([
      { dx: 0, dy: 0 },
      { dx: -1, dy: 0 },
    ]);
    expect(dependencies).toEqual([{ prerequisiteIndex: 0, dependentIndex: 1 }]);
  });

  it("keeps a lone grip and grips beyond an explicit reference gap at zero", () => {
    const { deltas, dependencies } = deriveGripDeltasForPlacementOrder(
      [grip("a", 50, 50), grip("far", 950, 50)],
      100,
      100,
      0,
      { maxReferenceGapMm: 5 },
    );

    expect(deltas).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(dependencies).toEqual([]);
  });
});

describe("merged grip dependency placement", () => {
  it("inserts a merged grip between its prerequisites and dependents", () => {
    const prerequisite = grip("prerequisite", 350, 100);
    const firstSelected = grip("selected-1", 250, 100, -1);
    const secondSelected = grip("selected-2", 150, 100, -1);
    const dependent = grip("dependent", 50, 100, -1);
    const mergedGrip = grip("merged", 200, 100, -1, 0, { numPackages: 2 });

    const result = insertMergedGripByDeltaDependencies(
      [prerequisite, firstSelected, secondSelected, dependent],
      new Set([1, 2]),
      mergedGrip,
      100,
      100,
      0,
    );

    expect(result?.mergedIndex).toBe(1);
    expect(result?.grips.map(({ id }) => id)).toEqual([
      "prerequisite",
      "merged",
      "dependent",
    ]);
  });

  it("rejects selections with fewer than two valid grips", () => {
    const grips = [grip("first", 150, 100), grip("second", 50, 100, -1)];

    expect(
      insertMergedGripByDeltaDependencies(
        grips,
        new Set([0, 99]),
        grip("merged", 100, 100, 0, 0, { numPackages: 2 }),
        100,
        100,
        0,
      ),
    ).toBeNull();
  });
});

describe("lower-half-first grip order", () => {
  const rows = (count: number, height: number) =>
    Array.from({ length: count }, (_, row) => ({
      minY: row * height,
      maxY: (row + 1) * height,
    }));

  it("splits at the row boundary nearest the layer midline", () => {
    // Six 130 mm rows: midline and boundary coincide at 390 mm.
    expect(lowerHalfSplitYMm(rows(6, 130))).toBe(390);
    // Five 100 mm rows: midline 250 mm; 200 and 300 are equally near, the
    // lower boundary wins so the middle row belongs to the upper half.
    expect(lowerHalfSplitYMm(rows(5, 100))).toBe(200);
    // A single row has no inner boundary, so the midline is used.
    expect(lowerHalfSplitYMm(rows(1, 130))).toBe(65);
    expect(lowerHalfSplitYMm([])).toBeNull();
  });

  // Two 100 mm rows of 100 x 50 mm packages (pitch 50) beside a 50 mm wide
  // column whose pairs are 200 mm tall; split at y = 100.
  const layout = createGripOrderLayout([
    { gripId: "row0", minY: 0, maxY: 50 },
    { gripId: "row1", minY: 50, maxY: 100 },
    { gripId: "row2", minY: 100, maxY: 150 },
    { gripId: "row3", minY: 150, maxY: 200 },
    { gripId: "row0-left", minY: 0, maxY: 50 },
    { gripId: "column-low", minY: 0, maxY: 100 },
    { gripId: "column-high", minY: 110, maxY: 200 },
  ]);

  it("derives split, origin and row pitch from the footprints", () => {
    expect(layout).toMatchObject({
      splitYMm: 100,
      originYMm: 0,
      rowPitchMm: 50,
    });
  });

  it("orders lower half first, row band by band, right to left", () => {
    const grips = [
      { id: "row3", x: 100, y: 175 },
      { id: "column-high", x: 300, y: 155 },
      { id: "row0-left", x: 50, y: 25 },
      { id: "row1", x: 100, y: 75 },
      { id: "row2", x: 100, y: 125 },
      { id: "column-low", x: 300, y: 50 },
      { id: "row0", x: 150, y: 25 },
    ];

    // Each column grip joins the band of its bottom edge and, being
    // rightmost, leads it.
    expect(
      orderGripsByDependencies(
        grips,
        [],
        undefined,
        compareGripsByLayerRows(layout),
      ).map(({ id }) => id),
    ).toEqual([
      "column-low",
      "row0",
      "row0-left",
      "row1",
      "column-high",
      "row2",
      "row3",
    ]);
  });

  it("assigns a grip that straddles the split by its centre", () => {
    const compare = compareGripsByLayerRows({
      splitYMm: 390,
      originYMm: 0,
      rowPitchMm: 130,
      bottomYById: new Map([
        ["on-line", 300],
        ["above-line", 330],
        ["lower-left", 0],
      ]),
    });
    // A pair spanning 300..480 mm has its centre (390) on the line and counts
    // as lower; one spanning 330..510 mm (centre 420) as upper.
    const onLine = { id: "on-line", x: 100, y: 390 };
    const aboveLine = { id: "above-line", x: 900, y: 420 };
    const lowerLeft = { id: "lower-left", x: 50, y: 100 };

    expect(compare(onLine, aboveLine)).toBe(-1);
    expect(compare(aboveLine, lowerLeft)).toBe(1);
    // Both lower: band 2 (bottom 300) after band 0.
    expect(compare(onLine, lowerLeft)).toBe(2);
  });
});
