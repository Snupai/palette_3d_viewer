// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatMm,
  loadBounds,
  planFieldGeometry,
} from "~/features/planning-case/planFieldGeometry";

const euro = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };

describe("planFieldGeometry", () => {
  it("dimensions only the pallet when the load stays inside it", () => {
    const load = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
    const geometry = planFieldGeometry(euro, euro, load);

    expect(geometry).toEqual({
      gutter: 72,
      chainSpacing: 32.4,
      bottomGutter: 61.56,
      rightGutter: 61.56,
      chains: [
        {
          axis: "x",
          kind: "pallet",
          from: 0,
          to: 1200,
          level: 1,
          label: "1200",
          overhangStart: 0,
          overhangEnd: 0,
        },
        {
          axis: "y",
          kind: "pallet",
          from: 0,
          to: 800,
          level: 1,
          label: "800",
          overhangStart: 0,
          overhangEnd: 0,
        },
      ],
    });
  });

  it("adds an outer load chain with per-side overhang on the overhanging axis only", () => {
    const load = { minX: -20, minY: 0, maxX: 1230, maxY: 800 };
    const bounds = { minX: -20, minY: 0, maxX: 1230, maxY: 800 };
    const geometry = planFieldGeometry(bounds, euro, load);

    expect(geometry.chains.map((chain) => [chain.axis, chain.kind])).toEqual([
      ["x", "pallet"],
      ["x", "load"],
      ["y", "pallet"],
    ]);
    expect(geometry.chains[1]).toEqual({
      axis: "x",
      kind: "load",
      from: -20,
      to: 1230,
      level: 2,
      label: "1250",
      overhangStart: 20,
      overhangEnd: 30,
    });
    expect(geometry.bottomGutter).toBe(93.96);
    expect(geometry.rightGutter).toBe(61.56);
  });

  it("ignores sub-millimetre rounding at the pallet edge", () => {
    const load = { minX: -0.4, minY: 0, maxX: 1200.3, maxY: 800 };
    expect(planFieldGeometry(euro, euro, load).chains).toHaveLength(2);
  });
});

describe("loadBounds", () => {
  it("returns the union of package footprints and null for an empty layer", () => {
    expect(loadBounds([])).toBeNull();
    expect(
      loadBounds([
        { centerMm: { x: 150, y: 100 }, sizeMm: { x: 300, y: 200 } },
        { centerMm: { x: 1100, y: 700 }, sizeMm: { x: 300, y: 200 } },
      ]),
    ).toEqual({ minX: 0, minY: 0, maxX: 1250, maxY: 800 });
  });

  it("formats millimetres without float noise", () => {
    expect(formatMm(1199.99999)).toBe("1200");
    expect(formatMm(412.25)).toBe("412.3");
  });
});
