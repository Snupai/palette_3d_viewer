import { describe, expect, it } from "vitest";
import {
  buildGuillotineTopologyTemplates,
  createFullGridGuillotineTemplate,
  createOrderedGuillotineCutTemplate,
  type GuillotineTopologyCatalogLimits,
} from "~/domain/solver/region-topology/topologies/guillotine";

const limits: GuillotineTopologyCatalogLimits = {
  maxRegionsPerTopology: 3,
};

describe("guillotine topology catalog", () => {
  it("contains flat cuts and every ordered axis-dual recursive insertion", () => {
    expect(
      buildGuillotineTopologyTemplates(limits).map(
        ({ templateKey }) => templateKey,
      ),
    ).toEqual([
      "guillotine-v1:full-grid",
      "guillotine-v1:ordered-x-2",
      "guillotine-v1:ordered-y-2",
      "guillotine-v1:ordered-x-3",
      "guillotine-v1:ordered-y-3",
      "guillotine-v1:recursive-x-y-branch-0",
      "guillotine-v1:recursive-x-y-branch-1",
      "guillotine-v1:recursive-y-x-branch-0",
      "guillotine-v1:recursive-y-x-branch-1",
    ]);
  });

  it("keeps the recursive branch at its ordered insertion position", () => {
    const templates = buildGuillotineTopologyTemplates(limits);

    expect(
      templates.find(
        ({ templateKey }) =>
          templateKey === "guillotine-v1:recursive-x-y-branch-0",
      )?.witness,
    ).toEqual({
      kind: "guillotine-cut-tree",
      root: {
        kind: "cut",
        axis: "x",
        children: [
          {
            kind: "cut",
            axis: "y",
            children: [
              { kind: "slot", slotId: "zone-0" },
              { kind: "slot", slotId: "zone-1" },
            ],
          },
          { kind: "slot", slotId: "zone-2" },
        ],
      },
    });
    expect(
      templates.find(
        ({ templateKey }) =>
          templateKey === "guillotine-v1:recursive-x-y-branch-1",
      )?.witness,
    ).toEqual({
      kind: "guillotine-cut-tree",
      root: {
        kind: "cut",
        axis: "x",
        children: [
          { kind: "slot", slotId: "zone-0" },
          {
            kind: "cut",
            axis: "y",
            children: [
              { kind: "slot", slotId: "zone-1" },
              { kind: "slot", slotId: "zone-2" },
            ],
          },
        ],
      },
    });
  });

  it("encodes child order in the cut witness and adjacency relations", () => {
    const template = createOrderedGuillotineCutTemplate("x", 3);

    expect(template.witness).toEqual({
      kind: "guillotine-cut-tree",
      root: {
        kind: "cut",
        axis: "x",
        children: [
          { kind: "slot", slotId: "zone-0" },
          { kind: "slot", slotId: "zone-1" },
          { kind: "slot", slotId: "zone-2" },
        ],
      },
    });
    expect(
      template.relations
        .filter(({ kind }) => kind === "order")
        .map((relation) => relation.id),
    ).toEqual(["order-x-0-1", "order-x-1-2"]);
  });

  it("honors the region cap without changing template order", () => {
    expect(
      buildGuillotineTopologyTemplates({
        ...limits,
        maxRegionsPerTopology: 1,
      }),
    ).toEqual([createFullGridGuillotineTemplate()]);
    expect(
      buildGuillotineTopologyTemplates({
        ...limits,
        maxRegionsPerTopology: 2,
      }).map(({ templateKey }) => templateKey),
    ).toEqual([
      "guillotine-v1:full-grid",
      "guillotine-v1:ordered-x-2",
      "guillotine-v1:ordered-y-2",
    ]);
  });

  it("rejects region limits above the implemented slice", () => {
    expect(() =>
      buildGuillotineTopologyTemplates({
        ...limits,
        maxRegionsPerTopology: 4,
      }),
    ).toThrowError(
      "limits.maxRegionsPerTopology must not exceed 3 in the guillotine slice.",
    );
  });
});
