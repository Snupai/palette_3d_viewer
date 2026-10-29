import { describe, expect, it } from "vitest";
import {
  buildPinwheelTopologyTemplates,
  type PinwheelTopologyCatalogLimits,
} from "~/domain/solver/region-topology/topologies/pinwheel";

const limits: PinwheelTopologyCatalogLimits = {
  maxCoreDepth: 1,
};

function cycleDepth(
  cycle: Extract<
    ReturnType<typeof buildPinwheelTopologyTemplates>[number]["witness"],
    { kind: "four-arm-cycle" }
  >["root"],
): number {
  return cycle.core.kind === "cycle" ? 1 + cycleDepth(cycle.core.cycle) : 0;
}

describe("pinwheel topology catalog", () => {
  it("enumerates both chiralities and a bounded recursive core", () => {
    const templates = buildPinwheelTopologyTemplates(limits);
    const cycles = templates.map(({ witness }) => {
      if (witness.kind !== "four-arm-cycle") {
        throw new Error("Expected a pinwheel witness.");
      }
      return witness.root;
    });

    expect(templates).toHaveLength(24);
    expect(cycles.filter((cycle) => cycle.core.kind === "empty")).toHaveLength(
      4,
    );
    expect(cycles.filter((cycle) => cycle.core.kind === "grid")).toHaveLength(
      4,
    );
    expect(cycles.filter((cycle) => cycleDepth(cycle) === 1)).toHaveLength(16);
    expect(new Set(cycles.map(({ chirality }) => chirality))).toEqual(
      new Set(["clockwise", "counterclockwise"]),
    );
  });

  it("keeps all arm slots independent and alternates footprint classes", () => {
    const template = buildPinwheelTopologyTemplates(limits).find(
      ({ templateKey }) =>
        templateKey ===
        "pinwheel-v1:d1:lengthwise-clockwise/crosswise-counterclockwise",
    );
    expect(template).toBeDefined();
    if (!template || template.witness.kind !== "four-arm-cycle") {
      throw new Error("Expected the selected recursive pinwheel template.");
    }
    const core = template.witness.root.core;
    if (core.kind !== "cycle") {
      throw new Error("Expected a recursive core cycle.");
    }

    expect(template.witness.root.armSlotIds).toEqual([
      "root-bottom",
      "root-right",
      "root-top",
      "root-left",
    ]);
    expect(core.cycle.armSlotIds).toEqual([
      "root-core-bottom",
      "root-core-right",
      "root-core-top",
      "root-core-left",
    ]);
    expect(new Set(template.slots.map(({ id }) => id)).size).toBe(8);
    expect(
      template.slots.map(({ id, packageCounts }) => ({ id, packageCounts })),
    ).toEqual([
      { id: "root-bottom", packageCounts: undefined },
      { id: "root-right", packageCounts: undefined },
      { id: "root-top", packageCounts: undefined },
      { id: "root-left", packageCounts: undefined },
      { id: "root-core-bottom", packageCounts: [1, 2] },
      { id: "root-core-right", packageCounts: [1, 2] },
      { id: "root-core-top", packageCounts: [1, 2] },
      { id: "root-core-left", packageCounts: [1, 2] },
    ]);
    const corePackageCountDomains = template.slots
      .filter(({ id }) => id.startsWith("root-core-"))
      .map(({ packageCounts }) => packageCounts);
    expect(new Set(corePackageCountDomains).size).toBe(4);
    expect(corePackageCountDomains.every(Object.isFrozen)).toBe(true);
    expect(
      template.slots.map(({ id, footprintClasses }) => ({
        id,
        footprintClasses,
      })),
    ).toEqual([
      { id: "root-bottom", footprintClasses: ["lengthwise", "square"] },
      { id: "root-right", footprintClasses: ["crosswise", "square"] },
      { id: "root-top", footprintClasses: ["lengthwise", "square"] },
      { id: "root-left", footprintClasses: ["crosswise", "square"] },
      {
        id: "root-core-bottom",
        footprintClasses: ["crosswise", "square"],
      },
      {
        id: "root-core-right",
        footprintClasses: ["lengthwise", "square"],
      },
      {
        id: "root-core-top",
        footprintClasses: ["crosswise", "square"],
      },
      {
        id: "root-core-left",
        footprintClasses: ["lengthwise", "square"],
      },
    ]);
  });

  it("adds one unrestricted rectangular grid core per outer phase and chirality", () => {
    const templates = buildPinwheelTopologyTemplates(limits).filter(
      ({ witness }) =>
        witness.kind === "four-arm-cycle" && witness.root.core.kind === "grid",
    );

    expect(templates).toHaveLength(4);
    expect(
      templates.map(({ slots, witness }) => {
        if (
          witness.kind !== "four-arm-cycle" ||
          witness.root.core.kind !== "grid"
        ) {
          throw new Error("Expected a grid-core pinwheel template.");
        }
        const coreSlotId = witness.root.core.slotId;
        const core = slots.find(({ id }) => id === coreSlotId);
        return {
          slotCount: slots.length,
          core: core
            ? {
                optionalZero: core.optionalZero,
                footprintClasses: core.footprintClasses,
                packageCounts: core.packageCounts,
              }
            : null,
        };
      }),
    ).toEqual(
      Array.from({ length: 4 }, () => ({
        slotCount: 5,
        core: {
          optionalZero: false,
          footprintClasses: ["lengthwise", "crosswise", "square"],
          packageCounts: undefined,
        },
      })),
    );
  });

  it("leaves empty-core root arms unconstrained like recursive root arms", () => {
    const template = buildPinwheelTopologyTemplates(limits).find(
      ({ witness }) =>
        witness.kind === "four-arm-cycle" && witness.root.core.kind === "empty",
    );
    expect(template).toBeDefined();
    if (!template || template.witness.kind !== "four-arm-cycle") {
      throw new Error("Expected an empty-core pinwheel template.");
    }

    expect(template.slots.map(({ packageCounts }) => packageCounts)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("rejects recursion beyond the finite catalog bound", () => {
    expect(() =>
      buildPinwheelTopologyTemplates({ maxCoreDepth: 3 }),
    ).toThrowError("limits.maxCoreDepth must not exceed 2.");
  });
});
