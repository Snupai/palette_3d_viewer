import { describe, expect, it } from "vitest";
import { realizeRegionConstraints } from "~/domain/solver/region-topology/constraints";
import { createRegionTopologyIdentity } from "~/domain/solver/region-topology/identity";
import { materializeRegionTopologyDraft } from "~/domain/solver/region-topology/materialization";
import type {
  RegionSearchBudget,
  RegionShape,
  RegionShapeCatalog,
} from "~/domain/solver/region-topology/model";
import { searchRegionTopologies } from "~/domain/solver/region-topology/search";
import { realizeRegionSpacing } from "~/domain/solver/region-topology/spacing";
import {
  BRIDGE_CHAIN_MOTIFS,
  buildBridgeChainTopologyTemplates,
  createBridgeChainTopologyTemplate,
} from "~/domain/solver/region-topology/topologies/bridgeChain";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

const budget: RegionSearchBudget = {
  maxWorkUnits: 100_000,
  maxFrontierStates: 1_000,
  maxRetainedDrafts: 1_000,
};

function input(targetCount: number): NormalizedLayerSolverInput {
  const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
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
      minimumPackageCount: targetCount,
      maximumPackageCount: targetCount,
      maxPlacements: targetCount,
      maxBands: 10,
      maxCandidatesPerGenerator: 1_000,
      provisionalPackagesPerCycle: 1,
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

function catalog(shapes: readonly RegionShape[]): RegionShapeCatalog {
  const countsAscending = [
    ...new Set(shapes.map(({ packageCount }) => packageCount)),
  ].sort((left, right) => left - right);
  return {
    maximumPackageCount: Math.max(...countsAscending),
    orderedShapes: shapes,
    countsAscending,
    shapesByCount: new Map(
      countsAscending.map((count) => [
        count,
        shapes.filter(({ packageCount }) => packageCount === count),
      ]),
    ),
    shapesByFootprintClass: new Map([
      [
        "lengthwise",
        shapes.filter(({ footprintClass }) => footprintClass === "lengthwise"),
      ],
      [
        "crosswise",
        shapes.filter(({ footprintClass }) => footprintClass === "crosswise"),
      ],
    ]),
  };
}

function completedIdentity(
  template: ReturnType<typeof createBridgeChainTopologyTemplate>,
  shapeBySlotId: Readonly<Record<string, RegionShape>>,
) {
  const assignments = template.slots.map(({ id }) => ({
    slotId: id,
    shape: shapeBySlotId[id]!,
  }));
  const result = createRegionTopologyIdentity(
    {
      template,
      assignments,
      targetCount: assignments.reduce(
        (sum, { shape: assignedShape }) => sum + assignedShape.packageCount,
        0,
      ),
      frameBoundsMm: input(1).generationBoundsMm,
      symmetries: ["identity"],
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

describe("bridge-chain topology catalog", () => {
  it("enumerates every motif, axis, phase, and chirality declaratively", () => {
    const templates = buildBridgeChainTopologyTemplates();

    expect(templates).toHaveLength(32);
    expect(
      new Set(
        templates.map(({ witness }) =>
          witness.kind === "embedded-bridge" ? witness.graph : null,
        ),
      ),
    ).toEqual(new Set(BRIDGE_CHAIN_MOTIFS));
    expect(
      new Set(
        templates.map(({ templateKey }) =>
          templateKey.endsWith(":clockwise") ? "clockwise" : "counterclockwise",
        ),
      ),
    ).toEqual(new Set(["clockwise", "counterclockwise"]));
    expect(
      templates.every(
        ({ slots, embedding }) =>
          slots.length >= 4 &&
          slots.length <= 5 &&
          embedding.rotationSystem.length === slots.length,
      ),
    ).toBe(true);
  });

  it("searches an exact path count through shared DP and materialization", () => {
    const lengthwise = shape("lengthwise-single", "lengthwise", 1, 1);
    const crosswise = shape("crosswise-single", "crosswise", 1, 1);
    const result = searchRegionTopologies({
      input: input(5),
      catalog: catalog([lengthwise, crosswise]),
      templates: [
        createBridgeChainTopologyTemplate(
          "path",
          "x",
          "lengthwise",
          "clockwise",
        ),
      ],
      targetCountsDescending: [5],
      ledger: createRegionWorkLedger(budget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.statistics.completedAssignmentCount).toBe(1);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toHaveLength(5);
    expect(result.drafts[0]?.provenance).toEqual([
      {
        family: "nested-side",
        variant: "region-topology-bridge-chain-v1",
        parameters: {
          source: "region-topology-v1",
          ownerFamily: "bridge-chain",
          framePolicy: "center-occupied-bounds",
        },
      },
    ]);
  });

  it("searches bridge layouts that require a later independent spacing plan", () => {
    const baseTemplate = createBridgeChainTopologyTemplate(
      "corner-chain",
      "x",
      "crosswise",
      "counterclockwise",
    );
    const grids = [
      [1, 1],
      [1, 2],
      [2, 1],
      [1, 4],
      [1, 1],
    ] as const;
    const packageDimensionsMm = { length: 3, width: 2 };
    const exactShapes: RegionShape[] = baseTemplate.slots.map((slot, index) => {
      const [columns, rows] = grids[index]!;
      const footprintClass = slot.footprintClasses[0]!;
      const footprint =
        footprintClass === "crosswise"
          ? {
              length: packageDimensionsMm.width,
              width: packageDimensionsMm.length,
            }
          : packageDimensionsMm;
      return {
        key: `independent-bridge-${index}`,
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
    });
    const template = {
      ...baseTemplate,
      slots: baseTemplate.slots.map((slot, index) => ({
        ...slot,
        minimumColumns: exactShapes[index]!.columns,
        maximumColumns: exactShapes[index]!.columns,
        minimumRows: exactShapes[index]!.rows,
        maximumRows: exactShapes[index]!.rows,
        packageCounts: [exactShapes[index]!.packageCount],
      })),
    };
    const bounds = { minX: 0, minY: 0, maxX: 8, maxY: 11 };
    const baseInput = input(10);
    const exactInput: NormalizedLayerSolverInput = {
      ...baseInput,
      package: {
        ...baseInput.package,
        dimensionsMm: packageDimensionsMm,
      },
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
    };
    const identity = createRegionTopologyIdentity(
      {
        template,
        assignments: template.slots.map((slot, index) => ({
          slotId: slot.id,
          shape: exactShapes[index]!,
        })),
        targetCount: 10,
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
    const independentSelections = [
      { x: "integer-balanced", y: "compact" },
      { x: "inter-region-seam", y: "inter-region-seam" },
      { x: "compact", y: "compact" },
      { x: "compact", y: "compact" },
      { x: "compact", y: "compact" },
    ] as const;
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
      catalog: catalog(exactShapes),
      templates: [template],
      targetCountsDescending: [10],
      ledger: createRegionWorkLedger({
        maxWorkUnits: 500_000,
        maxFrontierStates: 1_000,
        maxRetainedDrafts: 1_000,
      }),
      framePolicies: ["fill-generation-bounds"],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts.map(({ placements }) => placements)).toContainEqual(
      expected.draft.placements,
    );
  });

  it("preserves distinct planar embeddings with one region-size multiset", () => {
    const template = createBridgeChainTopologyTemplate(
      "k2,3",
      "x",
      "lengthwise",
      "clockwise",
    );
    const firstSupport = shape("first-support", "lengthwise", 1, 2);
    const secondSupport = shape("second-support", "lengthwise", 1, 3);
    const firstBridge = shape("first-bridge", "crosswise", 1, 1);
    const middleBridge = shape("middle-bridge", "crosswise", 2, 1);
    const lastBridge = shape("last-bridge", "crosswise", 3, 1);
    const direct = completedIdentity(template, {
      "support-first": firstSupport,
      "support-second": secondSupport,
      "bridge-first": firstBridge,
      "bridge-middle": middleBridge,
      "bridge-last": lastBridge,
    });
    const reordered = completedIdentity(template, {
      "support-first": firstSupport,
      "support-second": secondSupport,
      "bridge-first": middleBridge,
      "bridge-middle": firstBridge,
      "bridge-last": lastBridge,
    });

    expect(
      direct.nodes
        .map(({ packageCount }) => packageCount)
        .sort((a, b) => a - b),
    ).toEqual(
      reordered.nodes
        .map(({ packageCount }) => packageCount)
        .sort((a, b) => a - b),
    );
    expect(reordered.topologyFingerprint).not.toBe(direct.topologyFingerprint);
  });

  it("retains directed chirality before global symmetry canonicalization", () => {
    const clockwise = createBridgeChainTopologyTemplate(
      "corner-chain",
      "x",
      "lengthwise",
      "clockwise",
    );
    const counterclockwise = createBridgeChainTopologyTemplate(
      "corner-chain",
      "x",
      "lengthwise",
      "counterclockwise",
    );
    const shapes = Object.fromEntries(
      clockwise.slots.map(({ id, footprintClasses }, index) => [
        id,
        shape(`chirality-${index}`, footprintClasses[0]!, index + 1, 1),
      ]),
    );
    const clockwiseIdentity = completedIdentity(clockwise, shapes);
    const counterclockwiseIdentity = completedIdentity(
      counterclockwise,
      shapes,
    );

    expect(counterclockwiseIdentity.topologyFingerprint).not.toBe(
      clockwiseIdentity.topologyFingerprint,
    );
    expect(counterclockwise.witness).toEqual({
      kind: "embedded-bridge",
      graph: "corner-chain",
      rotationSystemRelationIds: [
        ...(clockwise.witness.kind === "embedded-bridge"
          ? clockwise.witness.rotationSystemRelationIds
          : []),
      ].reverse(),
    });
  });

  it("merges connected phase-compatible lobes only during shared spacing normalization", () => {
    const template = createBridgeChainTopologyTemplate(
      "k2,3",
      "x",
      "lengthwise",
      "clockwise",
    );
    const support = shape("support", "lengthwise", 1, 6);
    const bridge = shape("bridge", "crosswise", 2, 1);
    const topology = completedIdentity(template, {
      "support-first": support,
      "support-second": support,
      "bridge-first": bridge,
      "bridge-middle": bridge,
      "bridge-last": bridge,
    });
    const spacingSelections = topology.nodes.map(() => ({
      x: "compact" as const,
      y: "compact" as const,
    }));
    const constraints = realizeRegionConstraints(
      input(18),
      topology,
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
      input(18),
      constraints.graph,
      spacingSelections,
      createRegionWorkLedger(budget),
    );
    if (spacing.status !== "completed") {
      throw new Error(
        `Expected completed spacing, received ${spacing.status}.`,
      );
    }
    const materialized = materializeRegionTopologyDraft(
      input(18),
      spacing.graph,
      createRegionWorkLedger(budget),
    );

    expect(
      spacing.graph.physicalMergeGroups.map((group) => group.length),
    ).toEqual([1, 1, 3]);
    expect(materialized.status).toBe("completed");
    if (materialized.status !== "completed") {
      throw new Error(
        `Expected completed materialization, received ${materialized.status}.`,
      );
    }
    expect(materialized.draft.placements).toHaveLength(18);
  });
});
