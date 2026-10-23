import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import {
  emptyPlanFilters,
  filterPlanEntries,
  planLibraryEntry,
} from "./planLibraryModel";

function plan(id: string, counts: number[], length = 400) {
  return createProject(
    {
      id,
      package: { dimensionsMm: { length, width: 200, height: 150 } },
      pallet: "euro",
      activeSolutionId: `${id}-solution`,
      solutions: [
        {
          id: `${id}-solution`,
          name: "Plan",
          origin: "manual",
          patterns: counts.map((n, i) => ({
            id: `pattern-${i}`,
            name: `Lage ${i + 1}`,
            grips: [],
            placements: Array.from({ length: n }, (_, j) => ({
              id: `p-${i}-${j}`,
              sequence: j,
              positionMm: { x: 200 + j * 100, y: 200 },
              rotation: 0 as const,
              gripId: null,
              labelSide: null,
            })),
          })),
          stack: {
            layers: counts.map((_, i) => ({
              id: `layer-${i}`,
              patternId: `pattern-${i}`,
              interlayerBefore: 0,
            })),
            interlayerThicknessMm: 3,
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
    },
    { now: () => 1, createId: (k) => `${id}-${k}` },
  );
}
describe("plan library dimensions and layer filters", () => {
  it("reads counts from each physical layer, including a different top layer", () => {
    const e = planLibraryEntry(plan("a", [4, 4, 2]));
    expect(e.layerCount).toBe(3);
    expect(e.total).toBe(10);
    expect(e.perLayer).toEqual([2, 4]);
    expect(e.perLayerLabel).toBe("2 / 4");
  });
  it("combines dimensions, layer range and any matching physical layer count", () => {
    const entries = [
      planLibraryEntry(plan("a", [4, 4, 2])),
      planLibraryEntry(plan("b", [4, 4], 300)),
      planLibraryEntry(plan("c", [6], 400)),
    ];
    const f = {
      ...emptyPlanFilters,
      lengthMin: "350",
      lengthMax: "400",
      layersMin: "2",
      boxesMin: "2",
      boxesMax: "2",
    };
    expect(filterPlanEntries(entries, f).map((e) => e.project.id)).toEqual([
      "a",
    ]);
    expect(
      filterPlanEntries(entries, { ...f, boxesMin: "3", boxesMax: "3" }),
    ).toEqual([]);
  });
  it("keeps input-only projects findable without pretending they have a stack", () => {
    const entry = planLibraryEntry(
      createProject(
        { id: "draft" },
        { now: () => 1, createId: (k) => `draft-${k}` },
      ),
    );
    expect(entry.layerCount).toBe(0);
    expect(entry.total).toBe(0);
    expect(entry.perLayerLabel).toBe("–");
    expect(filterPlanEntries([entry], emptyPlanFilters)).toEqual([entry]);
    expect(
      filterPlanEntries([entry], { ...emptyPlanFilters, boxesMin: "1" }),
    ).toEqual([]);
  });
});
