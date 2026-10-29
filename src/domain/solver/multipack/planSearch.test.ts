import { describe, expect, it } from "vitest";
import {
  tileMuster,
  isValidMusterLayer,
} from "~/domain/solver/multipack/layer";
import { generateMultiPackMuster } from "~/domain/solver/multipack/optimizer";
import { searchMultiPackPlans } from "~/domain/solver/multipack/planSearch";

const PALETTE = { x: 12000, y: 8000 };

function search(length: number, width: number) {
  return searchMultiPackPlans({
    paletteDmm: PALETTE,
    package: { length, width },
    clearanceDmm: 0,
  });
}

function recordCount(variant: string): number {
  return Number(/:n(\d+):/.exec(variant)?.[1]);
}

function classes(variant: string): string {
  return /:c(\d+):/.exec(variant)?.[1] ?? "";
}

describe("MultiPack plan search", () => {
  it("tiles every record to its own package count without overlaps", () => {
    for (const [length, width, plans] of [
      [1570, 1060, 89],
      [500, 400, 124],
      [1200, 800, 117],
      [2100, 1300, 61],
    ] as const) {
      const result = search(length, width);
      expect(result).toHaveLength(plans);
      for (const { variant, solution } of result) {
        const packages = tileMuster(
          generateMultiPackMuster({ ...solution, interactiveQuality: false }),
        );
        expect(packages).toHaveLength(recordCount(variant));
        expect(isValidMusterLayer(packages, PALETTE, 0)).toBe(true);
      }
    }
  });

  it("offers every family on the 120 by 80 sheet", () => {
    const histogram: Record<string, number> = {};
    for (const { variant } of search(1200, 800)) {
      const klass = classes(variant);
      histogram[klass] = (histogram[klass] ?? 0) + 1;
    }
    expect(histogram).toEqual({
      "1": 2,
      "2": 15,
      "3": 4,
      "4": 11,
      "5": 12,
      "7": 7,
      "8": 13,
      "9": 3,
      "10": 25,
      "11": 9,
      "12": 8,
      "15": 3,
      "16": 4,
      "17": 1,
    });
  });

  it("emits the nested kombi block with a band beside it", () => {
    const plan = search(1200, 800).find(
      ({ variant }) => classes(variant) === "10",
    );
    expect(plan?.variant).toBe("mp:39:c10:n100:12000x8000");
    expect(plan?.solution.slots).toEqual([
      {
        kind: "kombi",
        type: 2,
        x0: 0,
        x1: 9600,
        y0: 0,
        y1: 8000,
        columns: 6,
        ratio: 2,
        steps: 1,
        toothColumns: 4,
        toothRows: 7,
        descending: false,
      },
      {
        kind: "simple",
        type: 1,
        x0: 9600,
        x1: 12000,
        y0: 0,
        y1: 8000,
        countX: 2,
        countY: 10,
      },
    ]);
  });

  it("emits the pinwheel with a center block", () => {
    const plan = search(1200, 800).find(
      ({ variant }) => classes(variant) === "8",
    );
    expect(plan?.variant).toBe("mp:43:c8:n100:12000x8000");
    expect(
      plan?.solution.slots.map((slot) =>
        slot.kind === "simple"
          ? [
              slot.type,
              slot.x0,
              slot.x1,
              slot.y0,
              slot.y1,
              slot.countX,
              slot.countY,
            ]
          : [],
      ),
    ).toEqual([
      [1, 0, 4800, 0, 5600, 4, 7],
      [2, 4800, 12000, 0, 2400, 9, 2],
      [2, 0, 9600, 5600, 8000, 12, 2],
      [1, 9600, 12000, 2400, 8000, 2, 7],
      [1, 4800, 9600, 2400, 5600, 4, 4],
    ]);
  });

  it("stops at the first grid that reaches the target", () => {
    const plans = searchMultiPackPlans({
      paletteDmm: PALETTE,
      package: { length: 1570, width: 1060 },
      clearanceDmm: 0,
      targetCount: 55,
      stopAtTarget: true,
    });
    expect(plans.map(({ variant }) => variant)).toEqual([
      "mp:0:c1:n55:11660x7850",
    ]);
  });

  it("cuts a larger grid to the target when no record matches it exactly", () => {
    const stopAt = (targetCount: number) =>
      searchMultiPackPlans({
        paletteDmm: PALETTE,
        package: { length: 1570, width: 1060 },
        clearanceDmm: 0,
        targetCount,
        stopAtTarget: true,
      });
    const [cut] = stopAt(53);
    expect(cut?.variant).toBe("mp:0:c2:n53:11660x7850");
    const packages = tileMuster(
      generateMultiPackMuster({ ...cut!.solution, interactiveQuality: false }),
    );
    expect(packages).toHaveLength(53);
    expect(isValidMusterLayer(packages, PALETTE, 0)).toBe(true);
    expect(stopAt(40).map(({ variant }) => variant)).toEqual([
      "mp:0:c1:n40:8480x7850",
      "mp:1:c1:n40:10600x6280",
      "mp:2:c2:n40:9420x7420",
      "mp:3:c2:n40:10990x6360",
    ]);
  });

  it("keeps the nested families inside a portrait palette", () => {
    const portrait = { x: 8000, y: 12000 };
    const plans = searchMultiPackPlans({
      paletteDmm: portrait,
      package: { length: 1200, width: 800 },
      clearanceDmm: 0,
    });
    expect(plans).toHaveLength(117);
    for (const { variant, solution } of plans) {
      const packages = tileMuster(
        generateMultiPackMuster({ ...solution, interactiveQuality: false }),
      );
      expect(packages).toHaveLength(recordCount(variant));
      expect(isValidMusterLayer(packages, portrait, 0)).toBe(true);
    }
  });

  it("is independent of which side is passed as length", () => {
    const swapped = search(800, 1200).map(({ variant }) => variant);
    expect(swapped).toEqual(search(1200, 800).map(({ variant }) => variant));
  });
});
