import { describe, expect, it } from "vitest";
import {
  envelopePreservingSymmetries,
  transformPlacements,
} from "~/domain/geometry";
import type { LayerSymmetry } from "~/domain/geometry/transforms";
import { realizeRegionConstraints } from "~/domain/solver/region-topology/constraints";
import { createRegionTopologyIdentity } from "~/domain/solver/region-topology/identity";
import { materializeRegionTopologyDraft } from "~/domain/solver/region-topology/materialization";
import type {
  OwnedStructuralRegionGraph,
  RegionSearchBudget,
  RegionShape,
} from "~/domain/solver/region-topology/model";
import {
  realizeRegionSpacing,
  type RegionSpacingSelection,
} from "~/domain/solver/region-topology/spacing";
import { buildPinwheelTopologyTemplates } from "~/domain/solver/region-topology/topologies/pinwheel";
import { createRegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";
import { matchPhysicalFootprintPlacements } from "~/lib/parity/physicalGeometry";

const budget: RegionSearchBudget = {
  maxWorkUnits: 2_000,
  maxFrontierStates: 100,
  maxRetainedDrafts: 100,
};

type SyntheticGeometry = Readonly<{
  packageSizeMm: Readonly<{ length: number; width: number }>;
  frameBoundsMm: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
}>;

const defaultGeometry: SyntheticGeometry = Object.freeze({
  packageSizeMm: Object.freeze({ length: 2, width: 1 }),
  frameBoundsMm: Object.freeze({ minX: 0, minY: 0, maxX: 9, maxY: 7 }),
});

const rectangularDominoGeometry: SyntheticGeometry = Object.freeze({
  packageSizeMm: Object.freeze({ length: 3, width: 2 }),
  frameBoundsMm: Object.freeze({ minX: 0, minY: 0, maxX: 15, maxY: 13 }),
});

function input(
  targetCount: number,
  geometry: SyntheticGeometry = defaultGeometry,
): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: geometry.packageSizeMm,
      clearanceMm: 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: geometry.frameBoundsMm,
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: geometry.frameBoundsMm,
    generationBoundsMm: geometry.frameBoundsMm,
    constraints: {
      allowedRotations: [0, 90],
      edgeClearanceMm: 0,
      minimumPackageCount: targetCount,
      maximumPackageCount: targetCount,
      maxPlacements: targetCount,
      maxBands: 4,
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
  packageSizeMm: SyntheticGeometry["packageSizeMm"] = defaultGeometry.packageSizeMm,
): RegionShape {
  const footprint =
    footprintClass === "crosswise"
      ? { length: packageSizeMm.width, width: packageSizeMm.length }
      : packageSizeMm;
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

function emptyCoreTopology(): OwnedStructuralRegionGraph {
  const template = buildPinwheelTopologyTemplates({ maxCoreDepth: 0 }).find(
    ({ templateKey }) => templateKey === "pinwheel-v1:d0:lengthwise-clockwise",
  );
  if (!template) throw new Error("Expected the synthetic pinwheel template.");
  const result = createRegionTopologyIdentity(
    {
      template,
      assignments: [
        {
          slotId: "root-bottom",
          shape: shape("bottom", "lengthwise", 3, 1),
        },
        {
          slotId: "root-right",
          shape: shape("right", "crosswise", 1, 2),
        },
        {
          slotId: "root-top",
          shape: shape("top", "lengthwise", 2, 1),
        },
        {
          slotId: "root-left",
          shape: shape("left", "crosswise", 1, 1),
        },
      ],
      targetCount: 8,
      frameBoundsMm: input(8).generationBoundsMm,
      symmetries: ["identity"],
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

function independentlySizedTopology(
  chirality: "clockwise" | "counterclockwise",
): OwnedStructuralRegionGraph {
  const template = buildPinwheelTopologyTemplates({ maxCoreDepth: 0 }).find(
    ({ templateKey }) =>
      templateKey === `pinwheel-v1:d0:lengthwise-${chirality}`,
  );
  if (!template)
    throw new Error("Expected the independent-arm pinwheel template.");
  const result = createRegionTopologyIdentity(
    {
      template,
      assignments: [
        {
          slotId: "root-bottom",
          shape: shape("bottom", "lengthwise", 3, 1),
        },
        {
          slotId: "root-right",
          shape: shape("right", "crosswise", 1, 2),
        },
        {
          slotId: "root-top",
          shape: shape("top", "lengthwise", 1, 1),
        },
        {
          slotId: "root-left",
          shape: shape("left", "crosswise", 1, 1),
        },
      ],
      targetCount: 7,
      frameBoundsMm: input(7).generationBoundsMm,
      symmetries: ["identity"],
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return result.graph;
}

function seamSpacing(
  count: number,
  recursiveCoreAlignment?: RegionSpacingSelection["recursiveCoreAlignment"],
  pinwheelResidualPlacement?: RegionSpacingSelection["pinwheelResidualPlacement"],
): readonly RegionSpacingSelection[] {
  return Object.freeze(
    Array.from(
      { length: count },
      () =>
        Object.freeze({
          x: "inter-region-seam",
          y: "inter-region-seam",
          recursiveCoreAlignment,
          pinwheelResidualPlacement,
        }) satisfies RegionSpacingSelection,
    ),
  );
}

function recursiveCoreTopology(
  coreShape: "singleton" | "domino",
  coreChirality: "clockwise" | "counterclockwise",
  symmetries: readonly LayerSymmetry[] = ["identity"],
  geometry: SyntheticGeometry = defaultGeometry,
): Readonly<{ topology: OwnedStructuralRegionGraph; targetCount: number }> {
  const templateKey = `pinwheel-v1:d1:lengthwise-clockwise/crosswise-${coreChirality}`;
  const template = buildPinwheelTopologyTemplates({ maxCoreDepth: 1 }).find(
    ({ templateKey: candidateKey }) => candidateKey === templateKey,
  );
  if (!template) throw new Error("Expected the recursive pinwheel template.");
  const domino = coreShape === "domino";
  const targetCount = domino ? 16 : 12;
  const packageSizeMm = geometry.packageSizeMm;
  const result = createRegionTopologyIdentity(
    {
      template,
      assignments: [
        {
          slotId: "root-bottom",
          shape: shape("outer-bottom", "lengthwise", 3, 1, packageSizeMm),
        },
        {
          slotId: "root-right",
          shape: shape("outer-right", "crosswise", 1, 2, packageSizeMm),
        },
        {
          slotId: "root-top",
          shape: shape("outer-top", "lengthwise", 2, 1, packageSizeMm),
        },
        {
          slotId: "root-left",
          shape: shape("outer-left", "crosswise", 1, 1, packageSizeMm),
        },
        {
          slotId: "root-core-bottom",
          shape: shape(
            "core-bottom",
            "crosswise",
            domino ? 2 : 1,
            1,
            packageSizeMm,
          ),
        },
        {
          slotId: "root-core-right",
          shape: shape(
            "core-right",
            "lengthwise",
            1,
            domino ? 2 : 1,
            packageSizeMm,
          ),
        },
        {
          slotId: "root-core-top",
          shape: shape(
            "core-top",
            "crosswise",
            domino ? 2 : 1,
            1,
            packageSizeMm,
          ),
        },
        {
          slotId: "root-core-left",
          shape: shape(
            "core-left",
            "lengthwise",
            1,
            domino ? 2 : 1,
            packageSizeMm,
          ),
        },
      ],
      targetCount,
      frameBoundsMm: input(targetCount, geometry).generationBoundsMm,
      symmetries,
    },
    createRegionWorkLedger(budget),
  );
  if (result.status !== "completed") {
    throw new Error(`Expected completed identity, received ${result.status}.`);
  }
  return Object.freeze({ topology: result.graph, targetCount });
}

function materializeTopology(
  topology: OwnedStructuralRegionGraph,
  targetCount: number,
  selections: readonly RegionSpacingSelection[],
  geometry: SyntheticGeometry = defaultGeometry,
) {
  const normalizedInput = input(targetCount, geometry);
  const constraints = realizeRegionConstraints(
    normalizedInput,
    topology,
    "center-occupied-bounds",
    selections,
    createRegionWorkLedger(budget),
  );
  if (constraints.status !== "completed") {
    throw new Error(
      `Expected completed constraints, received ${constraints.status}: ${constraints.reason}`,
    );
  }
  const spacing = realizeRegionSpacing(
    normalizedInput,
    constraints.graph,
    selections,
    createRegionWorkLedger(budget),
  );
  if (spacing.status !== "completed") {
    throw new Error(`Expected completed spacing, received ${spacing.status}.`);
  }
  return materializeRegionTopologyDraft(
    normalizedInput,
    spacing.graph,
    createRegionWorkLedger(budget),
  );
}

function materializeRecursiveCore(
  coreShape: "singleton" | "domino",
  coreChirality: "clockwise" | "counterclockwise",
) {
  const { topology, targetCount } = recursiveCoreTopology(
    coreShape,
    coreChirality,
  );
  return materializeTopology(
    topology,
    targetCount,
    seamSpacing(topology.nodes.length),
  );
}

describe("pinwheel constraints", () => {
  it("allocates an interior opposite-arm residual split in both chiralities", () => {
    for (const chirality of ["clockwise", "counterclockwise"] as const) {
      const topology = independentlySizedTopology(chirality);
      if (topology.witness.kind !== "four-arm-cycle") {
        throw new Error("Expected a pinwheel witness.");
      }
      const extrasByRole =
        chirality === "clockwise"
          ? [
              { x: 0, y: 0 },
              { x: 3, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ]
          : [
              { x: 0, y: 1 },
              { x: 0, y: 0 },
              { x: 3, y: 0 },
              { x: 1, y: 1 },
            ];
      const roleByRegionIndex = new Map(
        topology.witness.root.armSlotIds.map((slotId, roleIndex) => [
          Number(slotId.slice("region-".length)),
          roleIndex,
        ]),
      );
      const selections = topology.nodes.map(({ canonicalIndex }) => {
        const roleIndex = roleByRegionIndex.get(canonicalIndex);
        if (roleIndex === undefined) throw new Error("Expected an arm region.");
        const extras = extrasByRole[roleIndex]!;
        return Object.freeze({
          x: extras.x > 0 ? "continuous-space-between" : "compact",
          y: extras.y > 0 ? "continuous-space-between" : "compact",
          pinwheelArmResidualPolicy: "spacing-directed",
          pinwheelArmResidualMm: Object.freeze(extras),
        }) satisfies RegionSpacingSelection;
      });

      const result = realizeRegionConstraints(
        input(7),
        topology,
        "center-occupied-bounds",
        selections,
        createRegionWorkLedger(budget),
      );

      expect(result.status).toBe("completed");
      if (result.status !== "completed") {
        throw new Error(
          `Expected completed constraints, received ${result.status}.`,
        );
      }
      expect(
        topology.witness.root.armSlotIds.map((slotId) => ({
          x:
            result.graph.residualAssignments.find(
              ({ sinkKey }) => sinkKey === `${slotId}:x`,
            )?.amountMm ?? 0,
          y:
            result.graph.residualAssignments.find(
              ({ sinkKey }) => sinkKey === `${slotId}:y`,
            )?.amountMm ?? 0,
        })),
      ).toEqual(extrasByRole);
    }
  });

  it("assigns unequal opposing-chain residuals to inter-region seams", () => {
    const topology = emptyCoreTopology();
    const result = realizeRegionConstraints(
      input(8),
      topology,
      "center-occupied-bounds",
      seamSpacing(4),
      createRegionWorkLedger(budget),
    );

    expect(result).toEqual({
      status: "completed",
      graph: {
        topology,
        regionBoundsMm: [
          { minX: 2, minY: 1, maxX: 8, maxY: 2 },
          { minX: 7, minY: 2, maxX: 8, maxY: 6 },
          { minX: 1, minY: 5, maxX: 5, maxY: 6 },
          { minX: 1, minY: 1, maxX: 2, maxY: 3 },
        ],
        residualAssignments: [
          { sinkKey: "root:x:top-right:seam", amountMm: 2 },
          { sinkKey: "root:y:left-top:seam", amountMm: 2 },
        ],
        framePolicy: "center-occupied-bounds",
      },
    });
  });

  it("assigns unused recursive-core frame space to an outer core seam", () => {
    const { topology, targetCount } = recursiveCoreTopology(
      "singleton",
      "clockwise",
    );
    const result = realizeRegionConstraints(
      input(targetCount),
      topology,
      "center-occupied-bounds",
      seamSpacing(topology.nodes.length, "min-x-max-y"),
      createRegionWorkLedger(budget),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      throw new Error(
        `Expected completed constraints, received ${result.status}.`,
      );
    }
    expect(result.graph.residualAssignments).toContainEqual({
      sinkKey: "root:core-frame:x:max",
      amountMm: 2,
    });
    expect(result.graph.residualAssignments).not.toContainEqual({
      sinkKey: "root-core:x:left-bottom:seam",
      amountMm: 2,
    });
  });

  it("keeps intra-region and seam residual realizations geometrically distinct", () => {
    const topology = emptyCoreTopology();
    const normalizedInput = input(8);
    const distributed = Object.freeze(
      Array.from(
        { length: topology.nodes.length },
        () =>
          Object.freeze({
            x: "continuous-space-between",
            y: "continuous-space-between",
          }) satisfies RegionSpacingSelection,
      ),
    );
    const realize = (selections: readonly RegionSpacingSelection[]) => {
      const constraints = realizeRegionConstraints(
        normalizedInput,
        topology,
        "fill-generation-bounds",
        selections,
        createRegionWorkLedger(budget),
      );
      if (constraints.status !== "completed") {
        throw new Error(
          `Expected completed constraints, received ${constraints.status}.`,
        );
      }
      const spacing = realizeRegionSpacing(
        normalizedInput,
        constraints.graph,
        selections,
        createRegionWorkLedger(budget),
      );
      if (spacing.status !== "completed") {
        throw new Error(
          `Expected completed spacing, received ${spacing.status}.`,
        );
      }
      return materializeRegionTopologyDraft(
        normalizedInput,
        spacing.graph,
        createRegionWorkLedger(budget),
      );
    };

    const seam = realize(seamSpacing(topology.nodes.length));
    const intraRegion = realize(distributed);
    expect(seam.status).toBe("completed");
    expect(intraRegion.status).toBe("completed");
    if (seam.status !== "completed" || intraRegion.status !== "completed") {
      throw new Error("Expected completed residual materializations.");
    }
    expect(seam.draft.placements).toHaveLength(8);
    expect(intraRegion.draft.placements).toHaveLength(8);
    expect(seam.validation).toEqual({ valid: true, issues: [] });
    expect(intraRegion.validation).toEqual({ valid: true, issues: [] });
    expect(intraRegion.draft.topologyFingerprint).toBe(
      seam.draft.topologyFingerprint,
    );
    expect(intraRegion.draft.realizationKey).not.toBe(
      seam.draft.realizationKey,
    );
    expect(intraRegion.draft.placements).not.toEqual(seam.draft.placements);
  });

  it("keeps cycle-seam realization equivariant under canonical D2 transforms", () => {
    const direct = recursiveCoreTopology("singleton", "clockwise", [
      "identity",
    ]);
    const canonical = recursiveCoreTopology("singleton", "clockwise", [
      "identity",
      "mirror-x",
      "mirror-y",
      "rotate-180",
    ]);
    const directResult = materializeTopology(
      direct.topology,
      direct.targetCount,
      seamSpacing(direct.topology.nodes.length, "fill-parent", "cycle-seams"),
    );
    const canonicalResult = materializeTopology(
      canonical.topology,
      canonical.targetCount,
      seamSpacing(
        canonical.topology.nodes.length,
        "fill-parent",
        "cycle-seams",
      ),
    );

    expect(directResult.status).toBe("completed");
    expect(canonicalResult.status).toBe("completed");
    if (
      directResult.status !== "completed" ||
      canonicalResult.status !== "completed"
    ) {
      throw new Error("Expected completed canonical materializations.");
    }
    const normalizedInput = input(direct.targetCount);
    const sourceVariants = [
      directResult.draft.placements,
      ...envelopePreservingSymmetries(
        normalizedInput.generationBoundsMm,
        false,
      ).map((symmetry) =>
        transformPlacements(
          directResult.draft.placements,
          normalizedInput.generationBoundsMm,
          symmetry,
        ),
      ),
    ];
    expect(
      sourceVariants.some(
        (placements) =>
          matchPhysicalFootprintPlacements(
            placements,
            canonicalResult.draft.placements,
            normalizedInput.package.dimensionsMm,
            0,
          ).matched,
      ),
    ).toBe(true);
  });

  it("keeps four rectangular domino core arms equivariant through every D2 embedding", () => {
    const d2Symmetries = Object.freeze([
      "identity",
      "mirror-x",
      "mirror-y",
      "rotate-180",
    ] as const satisfies readonly LayerSymmetry[]);
    const directPlacementsByChirality = new Map<
      "clockwise" | "counterclockwise",
      Readonly<ReturnType<typeof transformPlacements>>
    >();

    for (const coreChirality of ["clockwise", "counterclockwise"] as const) {
      const direct = recursiveCoreTopology(
        "domino",
        coreChirality,
        ["identity"],
        rectangularDominoGeometry,
      );
      if (
        direct.topology.witness.kind !== "four-arm-cycle" ||
        direct.topology.witness.root.core.kind !== "cycle"
      ) {
        throw new Error("Expected a recursive pinwheel witness.");
      }
      const nodeBySlotId = new Map(
        direct.topology.nodes.map((node) => [
          `region-${node.canonicalIndex}`,
          node,
        ]),
      );
      expect(
        direct.topology.witness.root.core.cycle.armSlotIds.map((slotId) => {
          const node = nodeBySlotId.get(slotId);
          return node ? [node.columns, node.rows] : null;
        }),
      ).toEqual([
        [2, 1],
        [1, 2],
        [2, 1],
        [1, 2],
      ]);

      const selections = seamSpacing(
        direct.topology.nodes.length,
        "fill-parent",
        "cycle-seams",
      );
      const directResult = materializeTopology(
        direct.topology,
        direct.targetCount,
        selections,
        rectangularDominoGeometry,
      );
      expect(directResult.status).toBe("completed");
      if (directResult.status !== "completed") {
        throw new Error("Expected completed domino core materialization.");
      }
      directPlacementsByChirality.set(
        coreChirality,
        directResult.draft.placements,
      );

      for (const symmetry of d2Symmetries) {
        const transformed = recursiveCoreTopology(
          "domino",
          coreChirality,
          [symmetry],
          rectangularDominoGeometry,
        );
        const transformedResult = materializeTopology(
          transformed.topology,
          transformed.targetCount,
          seamSpacing(
            transformed.topology.nodes.length,
            "fill-parent",
            "cycle-seams",
          ),
          rectangularDominoGeometry,
        );
        expect(transformedResult.status).toBe("completed");
        if (transformedResult.status !== "completed") {
          throw new Error("Expected completed transformed materialization.");
        }
        const expected = transformPlacements(
          directResult.draft.placements,
          rectangularDominoGeometry.frameBoundsMm,
          symmetry,
        );
        expect(
          matchPhysicalFootprintPlacements(
            expected,
            transformedResult.draft.placements,
            rectangularDominoGeometry.packageSizeMm,
            0,
          ).matched,
        ).toBe(true);
      }
    }

    const clockwise = directPlacementsByChirality.get("clockwise");
    const counterclockwise =
      directPlacementsByChirality.get("counterclockwise");
    if (!clockwise || !counterclockwise) {
      throw new Error("Expected both local core chiralities.");
    }
    expect(
      d2Symmetries.some(
        (symmetry) =>
          matchPhysicalFootprintPlacements(
            transformPlacements(
              clockwise,
              rectangularDominoGeometry.frameBoundsMm,
              symmetry,
            ),
            counterclockwise,
            rectangularDominoGeometry.packageSizeMm,
            0,
          ).matched,
      ),
    ).toBe(false);
  });

  it("materializes singleton and domino recursive cores in both chiralities", () => {
    for (const [coreShape, expectedCount] of [
      ["singleton", 12],
      ["domino", 16],
    ] as const) {
      const clockwise = materializeRecursiveCore(coreShape, "clockwise");
      const counterclockwise = materializeRecursiveCore(
        coreShape,
        "counterclockwise",
      );
      expect(clockwise.status).toBe("completed");
      expect(counterclockwise.status).toBe("completed");
      if (
        clockwise.status !== "completed" ||
        counterclockwise.status !== "completed"
      ) {
        throw new Error("Expected completed recursive materializations.");
      }
      expect(clockwise.draft.placements).toHaveLength(expectedCount);
      expect(counterclockwise.draft.placements).toHaveLength(expectedCount);
      expect(clockwise.validation).toEqual({ valid: true, issues: [] });
      expect(counterclockwise.validation).toEqual({ valid: true, issues: [] });
      expect(counterclockwise.draft.placements).not.toEqual(
        clockwise.draft.placements,
      );
    }
  });
});
