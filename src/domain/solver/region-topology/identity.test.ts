import { describe, expect, it } from "vitest";
import type {
  RegionGraphTemplate,
  RegionSearchBudget,
  RegionShape,
  SpacedRegionGraph,
} from "~/domain/solver/region-topology/model";
import {
  createRegionRealizationKey,
  createRegionTopologyIdentity,
  type RegionShapeAssignment,
} from "~/domain/solver/region-topology/identity";
import { createOrderedGuillotineCutTemplate } from "~/domain/solver/region-topology/topologies/guillotine";
import { buildPinwheelTopologyTemplates } from "~/domain/solver/region-topology/topologies/pinwheel";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";

const budget: RegionSearchBudget = {
  maxWorkUnits: 100,
  maxFrontierStates: 10,
  maxRetainedDrafts: 10,
};

const single: RegionShape = {
  key: "shape-single",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 1,
  rows: 1,
  packageCount: 1,
  naturalSizeMm: { length: 2, width: 1 },
};

const pair: RegionShape = {
  key: "shape-pair",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 2,
  rows: 1,
  packageCount: 2,
  naturalSizeMm: { length: 4, width: 1 },
};

function assignments(
  first: RegionShape,
  second: RegionShape,
): readonly RegionShapeAssignment[] {
  return [
    { slotId: "zone-0", shape: first },
    { slotId: "zone-1", shape: second },
  ];
}

function identify(
  template: RegionGraphTemplate,
  shapeAssignments: readonly RegionShapeAssignment[],
) {
  return createRegionTopologyIdentity(
    {
      template,
      assignments: shapeAssignments,
      targetCount: 3,
      frameBoundsMm: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
    },
    createRegionWorkLedger(budget),
  );
}

function pinwheelShape(
  key: string,
  footprintClass: RegionShape["footprintClass"],
  columns: number,
  rows: number,
): RegionShape {
  const footprint =
    footprintClass === "crosswise"
      ? { length: 1, width: 2 }
      : { length: 2, width: 1 };
  return {
    key,
    footprintClass,
    representativeRotation: footprintClass === "crosswise" ? 90 : 0,
    columns,
    rows,
    packageCount: columns * rows,
    naturalSizeMm: {
      length: columns * footprint.length,
      width: rows * footprint.width,
    },
  };
}

function pinwheelTemplate(key: string): RegionGraphTemplate {
  const template = buildPinwheelTopologyTemplates({ maxCoreDepth: 1 }).find(
    ({ templateKey }) => templateKey === key,
  );
  if (!template) throw new Error(`Missing synthetic pinwheel template ${key}.`);
  return template;
}

function pinwheelIdentity(
  template: RegionGraphTemplate,
  shapesByRole: Readonly<Record<string, RegionShape>>,
  assignmentOrder: "forward" | "reverse" = "forward",
) {
  const values = template.slots.map(({ id }) => ({
    slotId: id,
    shape: shapesByRole[id]!,
  }));
  const assignments =
    assignmentOrder === "forward" ? values : [...values].reverse();
  return createRegionTopologyIdentity(
    {
      template,
      assignments,
      targetCount: assignments.reduce(
        (sum, { shape }) => sum + shape.packageCount,
        0,
      ),
      frameBoundsMm: { minX: 0, minY: 0, maxX: 9, maxY: 7 },
    },
    createRegionWorkLedger({ ...budget, maxWorkUnits: 1_000 }),
  );
}

describe("region topology identity", () => {
  it("canonicalizes rectangular D2 symmetry before spacing", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);
    const leftToRight = identify(template, assignments(single, pair));
    const rightToLeft = identify(template, assignments(pair, single));

    expect(leftToRight.status).toBe("completed");
    expect(rightToLeft.status).toBe("completed");
    if (
      leftToRight.status !== "completed" ||
      rightToLeft.status !== "completed"
    ) {
      throw new Error("Expected completed topology identities.");
    }
    expect(leftToRight.graph.topologyFingerprint).toBe(
      rightToLeft.graph.topologyFingerprint,
    );
    expect(leftToRight.topologyId).toBe(rightToLeft.topologyId);
    expect(leftToRight.graph.topologyFingerprint).toMatch(/^topology-v1:/);
  });

  it("rejects an explicit 90-degree axis swap for a rectangular frame", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);

    expect(
      createRegionTopologyIdentity(
        {
          template,
          assignments: assignments(single, pair),
          targetCount: 3,
          frameBoundsMm: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
          symmetries: ["rotate-90"],
        },
        createRegionWorkLedger(budget),
      ),
    ).toEqual({
      status: "invalid",
      reason: "Topology symmetry rotate-90 swaps unequal frame axes.",
    });
  });

  it("ignores template collection order and child assignment order", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);
    const permutedTemplate: RegionGraphTemplate = {
      ...template,
      slots: [...template.slots].reverse(),
      relations: [...template.relations].reverse(),
      automorphisms: template.automorphisms.map((automorphism) =>
        Object.fromEntries(Object.entries(automorphism).reverse()),
      ),
    };
    const original = identify(template, assignments(single, pair));
    const permuted = identify(
      permutedTemplate,
      [...assignments(single, pair)].reverse(),
    );

    expect(original.status).toBe("completed");
    expect(permuted.status).toBe("completed");
    if (original.status !== "completed" || permuted.status !== "completed") {
      throw new Error("Expected completed topology identities.");
    }
    expect(permuted.graph).toEqual(original.graph);
  });

  it("ignores object property insertion order in identity and work", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);
    const reorderedTemplate: RegionGraphTemplate = {
      ...template,
      relations: template.relations.map(
        (relation) =>
          Object.fromEntries(
            Object.entries(relation).reverse(),
          ) as RegionGraphTemplate["relations"][number],
      ),
      automorphisms: template.automorphisms.map((automorphism) =>
        Object.fromEntries(Object.entries(automorphism).reverse()),
      ),
    };
    const originalLedger = createRegionWorkLedger(budget);
    const reorderedLedger = createRegionWorkLedger(budget);
    const request = {
      assignments: assignments(single, pair),
      targetCount: 3,
      frameBoundsMm: { minX: 0, minY: 0, maxX: 8, maxY: 4 },
      symmetries: ["identity"],
    } as const;

    const original = createRegionTopologyIdentity(
      { ...request, template },
      originalLedger,
    );
    const reordered = createRegionTopologyIdentity(
      { ...request, template: reorderedTemplate },
      reorderedLedger,
    );

    expect(original.status).toBe("completed");
    expect(reordered.status).toBe("completed");
    if (original.status !== "completed" || reordered.status !== "completed") {
      throw new Error("Expected completed topology identities.");
    }
    expect(reordered.graph).toEqual(original.graph);
    expect(reorderedLedger.snapshot().usedByKind["canonical-transform"]).toBe(
      1,
    );
    expect(reorderedLedger.snapshot()).toEqual(originalLedger.snapshot());
  });

  it("adds bounds and spacing only to realization-v1", () => {
    const identity = identify(
      createOrderedGuillotineCutTemplate("x", 2),
      assignments(single, pair),
    );
    expect(identity.status).toBe("completed");
    if (identity.status !== "completed") {
      throw new Error("Expected completed topology identity.");
    }

    const compact: SpacedRegionGraph = {
      topology: identity.graph,
      regionBoundsMm: [
        { minX: 0, minY: 0, maxX: 3, maxY: 4 },
        { minX: 3, minY: 0, maxX: 8, maxY: 4 },
      ],
      residualAssignments: [],
      framePolicy: "fill-generation-bounds",
      spacingByRegion: [
        {
          x: "compact",
          y: "compact",
          quantization: "continuous",
          xCentersMm: [1],
          yCentersMm: [0.5],
        },
        {
          x: "compact",
          y: "compact",
          quantization: "continuous",
          xCentersMm: [4, 6],
          yCentersMm: [0.5],
        },
      ],
      physicalMergeGroups: [[0], [1]],
    };
    const distributed: SpacedRegionGraph = {
      ...compact,
      spacingByRegion: compact.spacingByRegion.map((_, index) => ({
        x: "continuous-space-between" as const,
        y: "continuous-space-between" as const,
        quantization: "continuous" as const,
        xCentersMm: index === 0 ? [1.5] : [4, 7],
        yCentersMm: [2],
      })),
    };

    expect(createRegionRealizationKey(compact)).toMatch(/^realization-v1:/);
    expect(createRegionRealizationKey(distributed)).not.toBe(
      createRegionRealizationKey(compact),
    );
    expect(distributed.topology.topologyFingerprint).toBe(
      compact.topology.topologyFingerprint,
    );
  });

  it("canonicalizes a globally mirrored pinwheel through rectangular D2", () => {
    const bottom = pinwheelShape("bottom", "lengthwise", 3, 1);
    const right = pinwheelShape("right", "crosswise", 1, 2);
    const top = pinwheelShape("top", "lengthwise", 2, 1);
    const left = pinwheelShape("left", "crosswise", 1, 1);
    const clockwise = pinwheelIdentity(
      pinwheelTemplate("pinwheel-v1:d0:lengthwise-clockwise"),
      {
        "root-bottom": bottom,
        "root-right": right,
        "root-top": top,
        "root-left": left,
      },
    );
    const mirrored = pinwheelIdentity(
      pinwheelTemplate("pinwheel-v1:d0:lengthwise-counterclockwise"),
      {
        "root-bottom": bottom,
        "root-right": left,
        "root-top": top,
        "root-left": right,
      },
    );

    expect(clockwise.status).toBe("completed");
    expect(mirrored.status).toBe("completed");
    if (clockwise.status !== "completed" || mirrored.status !== "completed") {
      throw new Error("Expected completed pinwheel identities.");
    }
    expect(mirrored.graph.topologyFingerprint).toBe(
      clockwise.graph.topologyFingerprint,
    );
  });

  it("preserves local domino-core chirality and assignment-order invariance under an asymmetric outer frame", () => {
    const outer = {
      "root-bottom": pinwheelShape("outer-bottom", "lengthwise", 3, 1),
      "root-right": pinwheelShape("outer-right", "crosswise", 1, 2),
      "root-top": pinwheelShape("outer-top", "lengthwise", 2, 1),
      "root-left": pinwheelShape("outer-left", "crosswise", 1, 1),
    };
    const core = {
      "root-core-bottom": pinwheelShape("core-bottom", "crosswise", 2, 1),
      "root-core-right": pinwheelShape("core-right", "lengthwise", 1, 2),
      "root-core-top": pinwheelShape("core-top", "crosswise", 2, 1),
      "root-core-left": pinwheelShape("core-left", "lengthwise", 1, 2),
    };
    const clockwiseTemplate = pinwheelTemplate(
      "pinwheel-v1:d1:lengthwise-clockwise/crosswise-clockwise",
    );
    const clockwiseCore = pinwheelIdentity(clockwiseTemplate, {
      ...outer,
      ...core,
    });
    const reversedAssignments = pinwheelIdentity(
      clockwiseTemplate,
      { ...outer, ...core },
      "reverse",
    );
    const counterclockwiseCore = pinwheelIdentity(
      pinwheelTemplate(
        "pinwheel-v1:d1:lengthwise-clockwise/crosswise-counterclockwise",
      ),
      { ...outer, ...core },
    );

    expect(clockwiseCore.status).toBe("completed");
    expect(reversedAssignments.status).toBe("completed");
    expect(counterclockwiseCore.status).toBe("completed");
    if (
      clockwiseCore.status !== "completed" ||
      reversedAssignments.status !== "completed" ||
      counterclockwiseCore.status !== "completed"
    ) {
      throw new Error("Expected completed recursive pinwheel identities.");
    }
    expect(reversedAssignments.graph).toEqual(clockwiseCore.graph);
    expect(counterclockwiseCore.graph.topologyFingerprint).not.toBe(
      clockwiseCore.graph.topologyFingerprint,
    );
  });
});
