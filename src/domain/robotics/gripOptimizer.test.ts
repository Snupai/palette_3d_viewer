import { describe, expect, it } from "vitest";

import {
  optimizeSuctionGroups,
  type GripOptimizerPlacement,
} from "~/domain/robotics/gripOptimizer";

const SPAN = 180;
const CROSS = 130;

function box(
  id: string,
  x: number,
  y: number,
  rotation: GripOptimizerPlacement["rotation"] = 0,
): GripOptimizerPlacement {
  return { id, positionMm: { x, y }, rotation };
}

/**
 * Candidate-12-like layer: a 5 x 6 block of lengthwise packages and a right
 * column of four crosswise packages separated by 20 mm gaps.
 */
function blockWithGappedColumn(): GripOptimizerPlacement[] {
  const block = Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) =>
      box(`r${row}c${column}`, 90 + column * SPAN, 65 + row * CROSS),
    ),
  ).flat();
  const column = [0, 1, 2, 3].map((index) =>
    box(`k${index}`, 965, 90 + index * (SPAN + 20), 90),
  );
  return [...block, ...column];
}

/** Two packages far left and right that define the layer's x edges. */
function frame(leftX: number, rightX: number, y: number) {
  return [box("frame-left", leftX, y), box("frame-right", rightX, y)];
}

function withoutFrame(groups: string[][]): string[][] {
  return groups.filter((group) => !group[0]!.startsWith("frame"));
}

const options = {
  spanMm: SPAN,
  packageSizeMm: { length: SPAN, width: CROSS },
  maxPackagesPerPick: 2,
  maxShiftMm: SPAN,
};

describe("optimizeSuctionGroups", () => {
  it("closes small gaps so separated packages share grips", () => {
    const result = optimizeSuctionGroups(blockWithGappedColumn(), options);

    // 6 rows x 3 grips + 2 column pairs instead of 4 column singles.
    expect(result.groups).toHaveLength(20);
    expect(result.groups.filter((group) => group[0]!.startsWith("k"))).toEqual([
      ["k0", "k1"],
      ["k2", "k3"],
    ]);
    // Each pair closes toward its outer package; the outer ones stay put.
    expect([...result.movedPositions]).toEqual([
      ["k1", { x: 965, y: 270 }],
      ["k2", { x: 965, y: 510 }],
    ]);
  });

  it("keeps the gapped column as singles without shifting", () => {
    const result = optimizeSuctionGroups(blockWithGappedColumn(), {
      ...options,
      maxShiftMm: 0,
    });

    expect(result.groups).toHaveLength(22);
    expect(result.movedPositions.size).toBe(0);
  });

  it("puts single grips inside the layer and avoids single chains", () => {
    const result = optimizeSuctionGroups(blockWithGappedColumn(), options);
    const singles = result.groups
      .filter((group) => group.length === 1)
      .map(([id]) => id);

    // Bottom row splits 2 + 1 + 2; the rows above alternate the single so
    // no two single grips touch and none sits on the outer left edge.
    expect(singles).toEqual(["r0c2", "r1c4", "r2c2", "r3c4", "r4c2", "r5c4"]);
  });

  it("prefers chunks without single grips when the count is equal", () => {
    const row = Array.from({ length: 7 }, (_, index) =>
      box(`p${index + 1}`, 90 + index * SPAN, 65),
    );

    expect(
      optimizeSuctionGroups(row, { ...options, maxPackagesPerPick: 3 }).groups,
    ).toEqual([
      ["p1", "p2", "p3"],
      ["p4", "p5"],
      ["p6", "p7"],
    ]);
  });

  it("does not shift a package into a neighbouring package", () => {
    // Closing the 130 mm gap would push p1 or p2 into the crosswise q.
    const placements = [
      box("p1", 90, 65),
      box("p2", 400, 65),
      box("q", 245, 90, 90),
    ];

    const result = optimizeSuctionGroups(placements, options);

    expect(result.groups).toEqual([["p1"], ["p2"], ["q"]]);
    expect(result.movedPositions.size).toBe(0);
  });

  it("does not shift farther than the allowed distance", () => {
    // Closing the 20 mm gap needs at least 10 mm per package. The frame
    // packages keep p1 and p2 off the layer's outer edges.
    const placements = [
      box("p1", 90, 65),
      box("p2", 290, 65),
      ...frame(-100, 480, 265),
    ];

    expect(
      withoutFrame(
        optimizeSuctionGroups(placements, { ...options, maxShiftMm: 9 }).groups,
      ),
    ).toEqual([["p1"], ["p2"]]);
    const split = optimizeSuctionGroups(placements, {
      ...options,
      maxShiftMm: 10,
    });
    expect(withoutFrame(split.groups)).toEqual([["p1", "p2"]]);
    expect([...split.movedPositions]).toEqual([
      ["p1", { x: 100, y: 65 }],
      ["p2", { x: 280, y: 65 }],
    ]);
  });

  it("moves both packages when neither end can anchor the grip", () => {
    const size = { length: 100, width: 50 };
    const result = optimizeSuctionGroups(
      [box("p1", 50, 25), box("p2", 350, 25), ...frame(-60, 460, 125)],
      {
        spanMm: 100,
        packageSizeMm: size,
        maxPackagesPerPick: 2,
        maxShiftMm: 100,
      },
    );

    expect(withoutFrame(result.groups)).toEqual([["p1", "p2"]]);
    expect([...result.movedPositions]).toEqual([
      ["p1", { x: 150, y: 25 }],
      ["p2", { x: 250, y: 25 }],
    ]);
  });

  it("uses the least total movement for a longer grip", () => {
    const result = optimizeSuctionGroups(
      [
        box("p1", 50, 25),
        box("p2", 160, 25),
        box("p3", 270, 25),
        ...frame(-60, 380, 125),
      ],
      {
        spanMm: 100,
        packageSizeMm: { length: 100, width: 50 },
        maxPackagesPerPick: 3,
        maxShiftMm: 100,
      },
    );

    // 10 + 0 + 10 mm instead of 0 + 10 + 20 mm with p1 fixed.
    expect([...result.movedPositions]).toEqual([
      ["p1", { x: 60, y: 25 }],
      ["p3", { x: 260, y: 25 }],
    ]);
  });

  it("never slides packages when a clearance is required", () => {
    const result = optimizeSuctionGroups(
      [box("p1", 50, 25), box("p2", 160, 25)],
      {
        spanMm: 100,
        packageSizeMm: { length: 100, width: 50 },
        maxPackagesPerPick: 2,
        maxShiftMm: 100,
        clearanceMm: 10,
      },
    );

    expect(result.groups).toEqual([["p1"], ["p2"]]);
    expect(result.movedPositions.size).toBe(0);
  });

  it("never slides packages when the pickup span is not the package length", () => {
    // Imported crosswise plans group by width: closing to a 50 mm centre
    // distance would overlap 100 mm long packages.
    const result = optimizeSuctionGroups(
      [box("p1", 50, 50), box("p2", 150, 50)],
      {
        spanMm: 50,
        packageSizeMm: { length: 100, width: 50 },
        maxPackagesPerPick: 2,
        maxShiftMm: 50,
      },
    );

    expect(result.groups).toEqual([["p1"], ["p2"]]);
    expect(result.movedPositions.size).toBe(0);
  });

  it("avoids a chain with a single grip of a later line", () => {
    const row = Array.from({ length: 5 }, (_, index) =>
      box(`p${index + 1}`, 50 + index * 100, 25),
    );
    const result = optimizeSuctionGroups([...row, box("above", 250, 75)], {
      spanMm: 100,
      packageSizeMm: { length: 100, width: 50 },
      maxPackagesPerPick: 2,
    });

    // The middle single p3 would touch the unavoidable single above it.
    expect(result.groups).toEqual([
      ["p1", "p2"],
      ["p3", "p4"],
      ["p5"],
      ["above"],
    ]);
  });

  it("keeps re-deciding lines until no single chain is left", () => {
    // Four passes left (500,75) touching the single (550,125); a later pass
    // makes (300,75) the single instead.
    const rows: [number, number[]][] = [
      [25, [1200]],
      [75, [300, 400, 500]],
      [125, [350, 450, 550]],
      [175, [375, 625, 725, 825]],
      [225, [475, 575, 675]],
      [275, [200, 550]],
    ];
    const placements = rows.flatMap(([y, xs]) =>
      xs.map((x) => box(`${x}/${y}`, x, y)),
    );
    const result = optimizeSuctionGroups(placements, {
      spanMm: 100,
      packageSizeMm: { length: 100, width: 50 },
      maxPackagesPerPick: 2,
    });

    expect(result.groups).toHaveLength(12);
    expect(result.groups).toContainEqual(["300/75"]);
    expect(result.groups).toContainEqual(["400/75", "500/75"]);
  });

  it("never slides packages for any positive clearance", () => {
    const result = optimizeSuctionGroups(
      [box("p1", 50, 25), box("p2", 160, 25)],
      {
        spanMm: 100,
        packageSizeMm: { length: 100, width: 50 },
        maxPackagesPerPick: 2,
        maxShiftMm: 100,
        clearanceMm: 0.001,
      },
    );

    expect(result.movedPositions.size).toBe(0);
  });

  it("rejects a slide that overlaps a neighbour by less than the tolerance", () => {
    // q's bottom edge sits at 49.9995 mm, 0.0005 mm inside the row.
    const result = optimizeSuctionGroups(
      [box("p1", 50, 25), box("p2", 250, 25), box("q", 125, 99.9995, 90)],
      {
        spanMm: 100,
        packageSizeMm: { length: 100, width: 50 },
        maxPackagesPerPick: 2,
        maxShiftMm: 100,
      },
    );

    expect(result.movedPositions.size).toBe(0);
    expect(result.groups).toEqual([["p1"], ["p2"], ["q"]]);
  });

  const slideSettings = {
    spanMm: 100,
    packageSizeMm: { length: 100, width: 50 },
    maxShiftMm: 100,
  };

  /** Optimizes, applies the moves, and optimizes the result again. */
  function runTwice(
    placements: GripOptimizerPlacement[],
    maxPackagesPerPick: number,
  ) {
    const settings = { ...slideSettings, maxPackagesPerPick };
    const first = optimizeSuctionGroups(placements, settings);
    const shifted = placements.map((placement) => ({
      ...placement,
      positionMm:
        first.movedPositions.get(placement.id) ?? placement.positionMm,
    }));
    return { first, second: optimizeSuctionGroups(shifted, settings) };
  }

  function rowsOf(rows: [number, number[]][]): GripOptimizerPlacement[] {
    return rows.flatMap(([y, xs]) => xs.map((x) => box(`${x}/${y}`, x, y)));
  }

  it("gives the same result when run again on its own output", () => {
    // Shrinking the layer outline used to change edge costs on the 2nd run.
    const { first, second } = runTwice(
      rowsOf([
        [25, [695]],
        [75, [50, 155, 370, 577, 812]],
        [125, [599, 886]],
      ]),
      2,
    );

    // Packages on the outer edges, like (50,75) on the left, never slide.
    expect(first.movedPositions.has("50/75")).toBe(false);
    expect(second.groups).toEqual(first.groups);
    expect(second.movedPositions.size).toBe(0);
  });

  it("settles a slide that frees a single from a chain", () => {
    // Sliding C (400) to 480 ends its contact with the single above, which
    // makes a different split better; one call already settles on it.
    const { first, second } = runTwice(
      rowsOf([
        [25, [350]],
        [75, [50, 150, 400, 580, 680]],
      ]),
      2,
    );

    expect(second.groups).toEqual(first.groups);
    expect(second.movedPositions.size).toBe(0);
  });

  it("settles slides that enable a larger grip in the next step", () => {
    const { first, second } = runTwice(
      [...rowsOf([[25, [50, 150, 250, 460]]]), box("frame", 975, 125)],
      4,
    );

    // Each step slides at most 100 mm; together the last package travels
    // 110 mm to complete the four-package grip.
    expect(first.groups).toContainEqual([
      "50/25",
      "150/25",
      "250/25",
      "460/25",
    ]);
    expect(first.movedPositions.get("460/25")).toEqual({ x: 350, y: 25 });
    expect(second.groups).toEqual(first.groups);
    expect(second.movedPositions.size).toBe(0);
  });

  it("is independent of the input order", () => {
    const placements = blockWithGappedColumn();
    const reversed = [...placements].reverse();

    expect(optimizeSuctionGroups(reversed, options)).toEqual(
      optimizeSuctionGroups(placements, options),
    );
  });
});
