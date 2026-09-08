import { describe, expect, it } from "vitest";
import { transformPlacements } from "~/domain/geometry";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { realizeRegionConstraints } from "~/domain/solver/region-topology/constraints";
import { createRegionTopologyIdentity } from "~/domain/solver/region-topology/identity";
import { materializeRegionTopologyDraft } from "~/domain/solver/region-topology/materialization";
import type {
  OwnedStructuralRegionGraph,
  RegionSearchBudget,
  RegionShape,
  RegionShapeCatalog,
} from "~/domain/solver/region-topology/model";
import { searchRegionTopologies } from "~/domain/solver/region-topology/search";
import {
  realizeRegionSpacing,
  type RegionSpacingSelection,
} from "~/domain/solver/region-topology/spacing";
import { buildPinwheelTopologyTemplates } from "~/domain/solver/region-topology/topologies/pinwheel";
import {
  buildStepSpineTopologyTemplates,
  createStepSpineTopologyTemplate,
} from "~/domain/solver/region-topology/topologies/stepSpine";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";
import { matchPhysicalFootprintPlacements } from "~/lib/parity/physicalGeometry";

const budget: RegionSearchBudget = {
  maxWorkUnits: 20_000,
  maxFrontierStates: 100,
  maxRetainedDrafts: 100,
};

function input(): NormalizedLayerSolverInput {
  const bounds = { minX: 0, minY: 0, maxX: 11, maxY: 8 };
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: bounds,
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: bounds,
    generationBoundsMm: bounds,
    constraints: {
      allowedRotations: [0, 90],
      edgeClearanceMm: 0,
      minimumPackageCount: 13,
      maximumPackageCount: 13,
      maxPlacements: 13,
      maxBands: 8,
      maxCandidatesPerGenerator: 100,
      provisionalPackagesPerCycle: 1,
      suctionRemainderPolicy: "centered-singleton",
      allowMixedPackageOrientations: true,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "fill-generation-bounds",
    },
  };
}

function shape(
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

const main = shape("main", "lengthwise", 3, 2);
const longBand = shape("long-band", "crosswise", 4, 1);
const sideStrip = shape("side-strip", "crosswise", 1, 2);
const corner = shape("corner", "lengthwise", 1, 1);

function assignments() {
  return [
    { slotId: "main", shape: main },
    { slotId: "long-band", shape: longBand },
    { slotId: "side-strip", shape: sideStrip },
    { slotId: "corner", shape: corner },
  ] as const;
}

function catalog(): RegionShapeCatalog {
  const shapes = [corner, sideStrip, longBand, main];
  return {
    maximumPackageCount: 13,
    orderedShapes: shapes,
    countsAscending: [1, 2, 4, 6],
    shapesByCount: new Map([
      [1, [corner]],
      [2, [sideStrip]],
      [4, [longBand]],
      [6, [main]],
    ]),
    shapesByFootprintClass: new Map([
      ["lengthwise", [corner, main]],
      ["crosswise", [sideStrip, longBand]],
    ]),
  };
}

function topology(symmetries: readonly ("identity" | "mirror-x")[]) {
  const result = createRegionTopologyIdentity(
    {
      template: createStepSpineTopologyTemplate("x", "lengthwise"),
      assignments: assignments(),
      targetCount: 13,
      frameBoundsMm: input().generationBoundsMm,
      symmetries,
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

function selections(
  policy: RegionSpacingSelection["x"],
): readonly RegionSpacingSelection[] {
  return Object.freeze(
    Array.from({ length: 4 }, () => Object.freeze({ x: policy, y: policy })),
  );
}

function materialize(
  graph: OwnedStructuralRegionGraph,
  spacingSelections: readonly RegionSpacingSelection[],
) {
  const constraints = realizeRegionConstraints(
    input(),
    graph,
    "center-occupied-bounds",
    spacingSelections,
    createRegionWorkLedger(budget),
  );
  if (constraints.status !== "completed") {
    throw new Error(
      `Expected completed constraints, received ${constraints.status}.`,
    );
  }
  const spacing = realizeRegionSpacing(
    input(),
    constraints.graph,
    spacingSelections,
    createRegionWorkLedger(budget),
  );
  if (spacing.status !== "completed") {
    throw new Error(`Expected completed spacing, received ${spacing.status}.`);
  }
  return materializeRegionTopologyDraft(
    input(),
    spacing.graph,
    createRegionWorkLedger(budget),
  );
}

describe("step-spine topology", () => {
  it("enumerates both axes and swaps footprint-class roles generically", () => {
    const templates = buildStepSpineTopologyTemplates();

    expect(templates).toHaveLength(4);
    expect(
      templates.map(({ witness }) =>
        witness.kind === "spine-tree" ? witness.axis : null,
      ),
    ).toEqual(["x", "x", "y", "y"]);
    expect(
      templates.map(({ slots }) =>
        slots.map(({ id, footprintClasses }) => ({ id, footprintClasses })),
      ),
    ).toEqual([
      [
        { id: "main", footprintClasses: ["lengthwise", "square"] },
        { id: "long-band", footprintClasses: ["crosswise", "square"] },
        {
          id: "side-strip",
          footprintClasses: ["lengthwise", "crosswise", "square"],
        },
        {
          id: "corner",
          footprintClasses: ["lengthwise", "crosswise", "square"],
        },
      ],
      [
        { id: "main", footprintClasses: ["crosswise", "square"] },
        { id: "long-band", footprintClasses: ["lengthwise", "square"] },
        {
          id: "side-strip",
          footprintClasses: ["crosswise", "lengthwise", "square"],
        },
        {
          id: "corner",
          footprintClasses: ["crosswise", "lengthwise", "square"],
        },
      ],
      [
        { id: "main", footprintClasses: ["lengthwise", "square"] },
        { id: "long-band", footprintClasses: ["crosswise", "square"] },
        {
          id: "side-strip",
          footprintClasses: ["lengthwise", "crosswise", "square"],
        },
        {
          id: "corner",
          footprintClasses: ["lengthwise", "crosswise", "square"],
        },
      ],
      [
        { id: "main", footprintClasses: ["crosswise", "square"] },
        { id: "long-band", footprintClasses: ["lengthwise", "square"] },
        {
          id: "side-strip",
          footprintClasses: ["crosswise", "lengthwise", "square"],
        },
        {
          id: "corner",
          footprintClasses: ["crosswise", "lengthwise", "square"],
        },
      ],
    ]);
  });

  it("searches the exact four-region count through the shared pipeline", () => {
    const result = searchRegionTopologies({
      input: input(),
      catalog: catalog(),
      templates: [createStepSpineTopologyTemplate("x", "lengthwise")],
      targetCountsDescending: [13],
      ledger: createRegionWorkLedger(budget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toHaveLength(13);
  });

  it("searches independent spacing choices for each region", () => {
    const mixedSelections = Object.freeze([
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "continuous-space-between", y: "compact" }),
    ] as const satisfies readonly RegionSpacingSelection[]);
    const expected = materialize(topology(["identity"]), mixedSelections);
    if (expected.status !== "completed") {
      throw new Error(
        `Expected completed mixed spacing, received ${expected.status}.`,
      );
    }

    const run = () =>
      searchRegionTopologies({
        input: input(),
        catalog: catalog(),
        templates: [createStepSpineTopologyTemplate("x", "lengthwise")],
        targetCountsDescending: [13],
        ledger: createRegionWorkLedger({
          maxWorkUnits: 200_000,
          maxFrontierStates: 100,
          maxRetainedDrafts: 2_000,
        }),
        framePolicies: ["center-occupied-bounds"],
        symmetries: ["identity"],
      });
    const result = run();
    const repeated = run();

    expect(repeated).toEqual(result);
    expect(result.status).toBe("completed");
    expect(result.statistics.completedAssignmentCount).toBe(1);
    expect(result.drafts.map(({ placements }) => placements)).toContainEqual(
      expected.draft.placements,
    );
  });

  it("searches independent spacing when every uniform plan is infeasible", () => {
    const bounds = { minX: 0, minY: 0, maxX: 19, maxY: 14 };
    const exactInput: NormalizedLayerSolverInput = {
      ...input(),
      package: {
        ...input().package,
        dimensionsMm: { length: 3, width: 2 },
      },
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...input().constraints,
        minimumPackageCount: 15,
        maximumPackageCount: 15,
        maxPlacements: 15,
      },
    };
    const template = createStepSpineTopologyTemplate("x", "lengthwise");
    const exactShapes = [
      {
        key: "independent-only-main",
        footprintClass: "lengthwise",
        representativeRotation: 0,
        columns: 2,
        rows: 3,
        packageCount: 6,
        naturalSizeMm: { length: 6, width: 6 },
      },
      {
        key: "independent-only-long-band",
        footprintClass: "crosswise",
        representativeRotation: 90,
        columns: 3,
        rows: 1,
        packageCount: 3,
        naturalSizeMm: { length: 6, width: 3 },
      },
      {
        key: "independent-only-side-strip",
        footprintClass: "lengthwise",
        representativeRotation: 0,
        columns: 1,
        rows: 5,
        packageCount: 5,
        naturalSizeMm: { length: 3, width: 10 },
      },
      {
        key: "independent-only-corner",
        footprintClass: "lengthwise",
        representativeRotation: 0,
        columns: 1,
        rows: 1,
        packageCount: 1,
        naturalSizeMm: { length: 3, width: 2 },
      },
    ] as const satisfies readonly RegionShape[];
    const exactCatalog: RegionShapeCatalog = {
      maximumPackageCount: 15,
      orderedShapes: exactShapes,
      countsAscending: [1, 3, 5, 6],
      shapesByCount: new Map([
        [1, [exactShapes[3]]],
        [3, [exactShapes[1]]],
        [5, [exactShapes[2]]],
        [6, [exactShapes[0]]],
      ]),
      shapesByFootprintClass: new Map([
        ["lengthwise", [exactShapes[3], exactShapes[2], exactShapes[0]]],
        ["crosswise", [exactShapes[1]]],
      ]),
    };
    const identity = createRegionTopologyIdentity(
      {
        template,
        assignments: [
          { slotId: "main", shape: exactShapes[0] },
          { slotId: "long-band", shape: exactShapes[1] },
          { slotId: "side-strip", shape: exactShapes[2] },
          { slotId: "corner", shape: exactShapes[3] },
        ],
        targetCount: 15,
        frameBoundsMm: bounds,
        symmetries: ["identity"],
      },
      createRegionWorkLedger(budget),
    );
    if (identity.status !== "completed") {
      throw new Error(
        `Expected completed identity, received ${identity.status}.`,
      );
    }
    const independentSelections = Object.freeze([
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "continuous-space-between", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
    ] as const satisfies readonly RegionSpacingSelection[]);
    const constraints = realizeRegionConstraints(
      exactInput,
      identity.graph,
      "fill-generation-bounds",
      independentSelections,
      createRegionWorkLedger(budget),
    );
    if (constraints.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${constraints.status}.`,
      );
    }
    const spacing = realizeRegionSpacing(
      exactInput,
      constraints.graph,
      independentSelections,
      createRegionWorkLedger(budget),
    );
    if (spacing.status !== "completed") {
      throw new Error(
        `Expected completed spacing, received ${spacing.status}.`,
      );
    }
    const expected = materializeRegionTopologyDraft(
      exactInput,
      spacing.graph,
      createRegionWorkLedger(budget),
    );
    if (expected.status !== "completed") {
      throw new Error(
        `Expected completed materialization, received ${expected.status}.`,
      );
    }

    const result = searchRegionTopologies({
      input: exactInput,
      catalog: exactCatalog,
      templates: [template],
      targetCountsDescending: [15],
      ledger: createRegionWorkLedger({
        maxWorkUnits: 200_000,
        maxFrontierStates: 100,
        maxRetainedDrafts: 2_000,
      }),
      framePolicies: ["fill-generation-bounds"],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.statistics.completedAssignmentCount).toBe(1);
    expect(
      result.drafts.some(
        ({ placements }) =>
          matchPhysicalFootprintPlacements(
            expected.draft.placements,
            placements,
            exactInput.package.dimensionsMm,
            0,
          ).matched,
      ),
    ).toBe(true);
  });

  it("realizes low-complexity independent spacing before deeper frontier work", () => {
    const mixedSelections = Object.freeze([
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "compact", y: "compact" }),
      Object.freeze({ x: "continuous-space-between", y: "compact" }),
    ] as const satisfies readonly RegionSpacingSelection[]);
    const expected = materialize(topology(["identity"]), mixedSelections);
    if (expected.status !== "completed") {
      throw new Error(
        `Expected completed mixed spacing, received ${expected.status}.`,
      );
    }
    const deeperTemplate = buildPinwheelTopologyTemplates({
      maxCoreDepth: 1,
    }).find(
      ({ witness }) =>
        witness.kind === "four-arm-cycle" && witness.root.core.kind === "cycle",
    );
    if (!deeperTemplate) {
      throw new Error("Expected a deeper synthetic topology template.");
    }

    const result = searchRegionTopologies({
      input: input(),
      catalog: catalog(),
      templates: [
        deeperTemplate,
        createStepSpineTopologyTemplate("x", "lengthwise"),
      ],
      targetCountsDescending: [13],
      ledger: createRegionWorkLedger({
        maxWorkUnits: 4_000,
        maxFrontierStates: 1_000,
        maxRetainedDrafts: 2_000,
      }),
      framePolicies: ["center-occupied-bounds"],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${result.status}.`);
    }
    expect(result.reason).toBe("work-budget-exhausted");
    expect(result.work.usedByKind["independent-spacing-axis"]).toBe(656);
    expect(result.drafts.map(({ placements }) => placements)).toContainEqual(
      expected.draft.placements,
    );
  });

  it("allocates exact centered bounds with offset T-junctions", () => {
    const graph = topology(["identity"]);
    const result = realizeRegionConstraints(
      input(),
      graph,
      "center-occupied-bounds",
      selections("compact"),
      createRegionWorkLedger(budget),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${result.status}.`,
      );
    }
    expect(result.graph.regionBoundsMm).toEqual([
      { minX: 3, minY: 1.5, maxX: 9, maxY: 3.5 },
      { minX: 5, minY: 4.5, maxX: 9, maxY: 6.5 },
      { minX: 2, minY: 1.5, maxX: 3, maxY: 5.5 },
      { minX: 2, minY: 5.5, maxX: 4, maxY: 6.5 },
    ]);
    const materialized = materialize(graph, selections("compact"));
    expect(materialized.status).toBe("completed");
    if (materialized.status !== "completed") {
      throw new Error(
        `Expected completed materialization, received ${materialized.status}.`,
      );
    }
    expect(materialized.draft.placements).toHaveLength(13);
    expect(materialized.validation).toEqual({ valid: true, issues: [] });
  });

  it("materializes an exact physical mirror under canonical symmetry", () => {
    const direct = materialize(
      topology(["identity"]),
      selections("continuous-space-between"),
    );
    const mirrored = materialize(
      topology(["mirror-x"]),
      selections("continuous-space-between"),
    );

    expect(direct.status).toBe("completed");
    expect(mirrored.status).toBe("completed");
    if (direct.status !== "completed" || mirrored.status !== "completed") {
      throw new Error("Expected completed mirrored materializations.");
    }
    const transformed = transformPlacements(
      direct.draft.placements,
      input().generationBoundsMm,
      "mirror-x",
    );
    expect(
      matchPhysicalFootprintPlacements(
        transformed,
        mirrored.draft.placements,
        input().package.dimensionsMm,
        SOLVER_GEOMETRY_EPSILON_MM,
      ).matched,
    ).toBe(true);
  });
});
