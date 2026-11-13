import { describe, expect, it } from "vitest";
import {
  buildGripDeltaDependencies,
  buildGripVerticalOverlapDependencies,
  createGripPocketGuard,
  enclosedGripsInOrder,
  deriveGripDeltasForPlacementOrder,
  insertMergedGripByDeltaDependencies,
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

  it("does not invent opposing dependencies for vertically interleaved multipackage grips", () => {
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

describe("free-access grip order", () => {
  // 100 x 50 mm packages at rotation 0; one package per grip.
  const size = { length: 100, width: 50 };
  const footprint = (
    gripId: string,
    x: number,
    y: number,
  ): GripPlacementFootprint => ({ gripId, positionMm: { x, y }, rotation: 0 });
  const position = (id: string, x: number, y: number) => ({ id, x, y });

  it("never sets a grip between two placed neighbours of one axis", () => {
    // a | b | c in one row, 5 mm gaps; the preferred order a, c, b would
    // leave b in a slot closed left and right.
    const footprints = [
      footprint("a", 50, 25),
      footprint("b", 155, 25),
      footprint("c", 260, 25),
    ];
    const guard = createGripPocketGuard(["a", "b", "c"], footprints, size);
    const rank = { a: 0, c: 1, b: 2 } as Record<string, number>;
    const grips = [
      position("a", 50, 25),
      position("b", 155, 25),
      position("c", 260, 25),
    ];
    const byRank = (left: { id: string }, right: { id: string }) =>
      rank[left.id]! - rank[right.id]!;

    expect(enclosedGripsInOrder(["a", "c", "b"], guard)).toEqual(["b"]);
    expect(
      orderGripsByDependencies(grips, [], undefined, byRank).map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "c", "b"]);
    expect(
      orderGripsByDependencies(grips, [], undefined, byRank, guard).map(
        ({ id }) => id,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("only blocks a side within the approach offset", () => {
    // c is 85 mm away from b: room for the 80 mm approach, so b stays open.
    const guard = createGripPocketGuard(
      ["a", "b", "c"],
      [
        footprint("a", 50, 25),
        footprint("b", 150, 25),
        footprint("c", 335, 25),
      ],
      size,
    );
    expect(enclosedGripsInOrder(["a", "c", "b"], guard)).toEqual([]);
  });

  it("treats front and back like left and right", () => {
    // Column of three: bottom and top placed first close the middle one.
    const guard = createGripPocketGuard(
      ["low", "mid", "top"],
      [
        footprint("low", 50, 25),
        footprint("mid", 50, 75),
        footprint("top", 50, 125),
      ],
      size,
    );
    expect(guard.newDeadlocks("top", new Set(["low"]))).toBe(1);
    expect(guard.newDeadlocks("mid", new Set(["low"]))).toBe(0);
    expect(enclosedGripsInOrder(["low", "top", "mid"], guard)).toEqual(["mid"]);
  });

  it("does not close a run of open slots at both ends", () => {
    // Row a b c d: with a placed, placing d leaves b and c between two
    // placed grips; whichever goes first, the other one is enclosed.
    const ids = ["a", "b", "c", "d"];
    const guard = createGripPocketGuard(
      ids,
      ids.map((id, index) => footprint(id, 50 + index * 100, 25)),
      size,
    );
    expect(guard.isEnclosed("d", new Set(["a"]))).toBe(false);
    expect(guard.newDeadlocks("d", new Set(["a"]))).toBe(2);
    expect(guard.newDeadlocks("b", new Set(["a"]))).toBe(0);
    const preferD = (left: { id: string }, right: { id: string }) =>
      (left.id === "d" ? -1 : 0) - (right.id === "d" ? -1 : 0) ||
      left.id.localeCompare(right.id);
    expect(
      orderGripsByDependencies(
        ids.map((id, index) => position(id, 50 + index * 100, 25)),
        [],
        undefined,
        preferD,
        guard,
      ).map(({ id }) => id),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("finishes the neighbouring column before resting a pair against half of it", () => {
    // Right column: single r1 below pair r2; left column: pair l1 below
    // single l2. Placing l1 right after r1 would lean it on r1 only.
    const footprints = [
      footprint("r1", 150, 25),
      footprint("r2", 150, 75),
      footprint("r2", 150, 125),
      footprint("l1", 50, 25),
      footprint("l1", 50, 75),
      footprint("l2", 50, 125),
    ];
    const guard = createGripPocketGuard(
      ["r1", "r2", "l1", "l2"],
      footprints,
      size,
    );
    expect(guard.partialSides("l1", new Set(["r1"]))).toBe(1);
    expect(guard.partialSides("l1", new Set(["r1", "r2"]))).toBe(0);
    const rank: Record<string, number> = { r1: 0, l1: 1, r2: 2, l2: 3 };
    expect(
      orderGripsByDependencies(
        [
          position("r1", 150, 25),
          position("r2", 150, 100),
          position("l1", 50, 50),
          position("l2", 50, 125),
        ],
        [],
        undefined,
        (left, right) => rank[left.id]! - rank[right.id]!,
        guard,
      ).map(({ id }) => id),
    ).toEqual(["r1", "r2", "l1", "l2"]);
  });
});
