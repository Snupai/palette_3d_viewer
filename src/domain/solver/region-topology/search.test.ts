import { describe, expect, it } from "vitest";
import { boundingRectangleForPlacements } from "~/domain/geometry";
import type {
  RegionFramePolicy,
  RegionGraphTemplate,
  RegionSearchBudget,
  RegionShape,
  RegionShapeCatalog,
  RegionTopologyFamily,
} from "~/domain/solver/region-topology/model";
import {
  createBoundedRegionDraftRetention,
  type RegionTopologySearchDraft,
  searchRegionTopologies,
} from "~/domain/solver/region-topology/search";
import {
  buildGuillotineTopologyTemplates,
  createFullGridGuillotineTemplate,
  createOrderedGuillotineCutTemplate,
} from "~/domain/solver/region-topology/topologies/guillotine";
import { buildPinwheelTopologyTemplates } from "~/domain/solver/region-topology/topologies/pinwheel";
import { seedGridCorePinwheels } from "~/domain/solver/region-topology/pinwheelSeeds";
import { createStepSpineTopologyTemplate } from "~/domain/solver/region-topology/topologies/stepSpine";
import {
  createRegionWorkLedger,
  type RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";
import { validateCandidatePlacements } from "~/domain/solver/validation";

const generousBudget: RegionSearchBudget = {
  maxWorkUnits: 10_000,
  maxFrontierStates: 200,
  maxRetainedDrafts: 100,
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

const triple: RegionShape = {
  key: "shape-triple",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 3,
  rows: 1,
  packageCount: 3,
  naturalSizeMm: { length: 6, width: 1 },
};

const verticalPair: RegionShape = {
  key: "shape-vertical-pair",
  footprintClass: "lengthwise",
  representativeRotation: 0,
  columns: 1,
  rows: 2,
  packageCount: 2,
  naturalSizeMm: { length: 2, width: 2 },
};

const crosswiseVerticalPair: RegionShape = {
  key: "shape-crosswise-vertical-pair",
  footprintClass: "crosswise",
  representativeRotation: 90,
  columns: 1,
  rows: 2,
  packageCount: 2,
  naturalSizeMm: { length: 1, width: 4 },
};

function input(targetCount: number): NormalizedLayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    generationBoundsMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    constraints: {
      allowedRotations: [0],
      edgeClearanceMm: 0,
      minimumPackageCount: targetCount,
      maximumPackageCount: targetCount,
      maxPlacements: targetCount,
      maxBands: 2,
      maxCandidatesPerGenerator: 20,
      provisionalPackagesPerCycle: 1,
      allowMixedPackageOrientations: false,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "fill-generation-bounds",
    },
  };
}

function rangeInput(
  minimumPackageCount: number,
  maximumPackageCount: number,
): NormalizedLayerSolverInput {
  const base = input(maximumPackageCount);
  return {
    ...base,
    constraints: {
      ...base.constraints,
      minimumPackageCount,
      maximumPackageCount,
      maxPlacements: maximumPackageCount,
      maxBands: 4,
    },
  };
}

function catalog(
  shapes: readonly RegionShape[] = [single, pair],
): RegionShapeCatalog {
  const sortedCounts = [
    ...new Set(shapes.map(({ packageCount }) => packageCount)),
  ].sort((left, right) => left - right);
  return {
    maximumPackageCount: Math.max(...sortedCounts),
    orderedShapes: shapes,
    countsAscending: sortedCounts,
    shapesByCount: new Map(
      sortedCounts.map((count) => [
        count,
        shapes.filter(({ packageCount }) => packageCount === count),
      ]),
    ),
    shapesByFootprintClass: new Map([["lengthwise", shapes]]),
  };
}

const spacingSelections = [
  { x: "compact", y: "compact" },
  {
    x: "continuous-space-between",
    y: "continuous-space-between",
  },
] as const;

function permutedTemplate(template: RegionGraphTemplate): RegionGraphTemplate {
  return {
    ...template,
    slots: [...template.slots].reverse(),
    relations: [...template.relations].reverse(),
    automorphisms: [...template.automorphisms]
      .reverse()
      .map((automorphism) =>
        Object.fromEntries(Object.entries(automorphism).reverse()),
      ),
    collapseRules: [...template.collapseRules].reverse(),
    framePolicies: [...template.framePolicies].reverse(),
  };
}

function gridCoreFixture(clearanceMm = 0) {
  const crossSingle: RegionShape = {
    ...single,
    key: "shape-cross-single",
    footprintClass: "crosswise",
    representativeRotation: 90,
    naturalSizeMm: { length: 1, width: 2 },
  };
  const crossPair: RegionShape = {
    ...crossSingle,
    key: "shape-cross-pair",
    columns: 1,
    rows: 2,
    packageCount: 2,
    naturalSizeMm: { length: 1, width: 4 + clearanceMm },
  };
  const shapes = [
    single,
    { ...pair, naturalSizeMm: { length: 4 + clearanceMm, width: 1 } },
    crossSingle,
    crossPair,
  ];
  const templates = buildPinwheelTopologyTemplates({ maxCoreDepth: 0 }).filter(
    ({ templateKey }) =>
      templateKey === "pinwheel-v1:d0:lengthwise-clockwise/grid" ||
      templateKey === "pinwheel-v1:d0:lengthwise-counterclockwise/grid",
  );
  const base = input(9);
  const bounds = {
    minX: 0,
    minY: 0,
    maxX: 5 + 2 * clearanceMm,
    maxY: 5 + 2 * clearanceMm,
  };
  const normalizedInput: NormalizedLayerSolverInput = {
    ...base,
    package: { ...base.package, clearanceMm },
    envelopeMm: bounds,
    usableEnvelopeMm: bounds,
    generationBoundsMm: bounds,
    constraints: {
      ...base.constraints,
      allowedRotations: [0, 90],
      allowMixedPackageOrientations: true,
      maxBands: 4,
    },
  };
  return { shapes, templates, normalizedInput, bounds };
}

function syntheticRetentionDraft(
  label: string,
  ownerFamily: RegionTopologyFamily,
  topology: string,
  framePolicy: RegionFramePolicy,
  realization: string,
): RegionTopologySearchDraft {
  return Object.freeze({
    placements: Object.freeze([]),
    provenance: Object.freeze([
      Object.freeze({
        family: "block" as const,
        variant: label,
        parameters: Object.freeze({ ownerFamily }),
      }),
    ]),
    topologyFingerprint: `topology-v1:${topology}`,
    topologyId: `topology-v1-${topology}`,
    realizationKey: `realization-v1:${realization}`,
    regionFramePolicy: framePolicy,
    canonicalRealizationOrderKey: label,
  });
}

describe("region topology search", () => {
  it("keeps grouped pinwheel spacing deterministic under reversed catalog order", () => {
    const bounds = { minX: 0, minY: 0, maxX: 19, maxY: 6 };
    const base = input(55);
    const normalizedInput: NormalizedLayerSolverInput = {
      ...base,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...base.constraints,
        maxBands: 16,
        provisionalPackagesPerCycle: 3,
        allowedRotations: [0, 90],
        allowMixedPackageOrientations: true,
      },
    };
    const shapes: RegionShape[] = [
      single,
      {
        ...single,
        key: "long-arm",
        columns: 8,
        rows: 2,
        packageCount: 16,
        naturalSizeMm: { length: 16, width: 2 },
      },
      {
        ...single,
        key: "short-arm",
        columns: 2,
        rows: 2,
        packageCount: 4,
        naturalSizeMm: { length: 4, width: 2 },
      },
      {
        ...single,
        key: "wide-cross-arm",
        footprintClass: "crosswise",
        representativeRotation: 90,
        columns: 15,
        rows: 2,
        packageCount: 30,
        naturalSizeMm: { length: 15, width: 4 },
      },
      {
        ...single,
        key: "narrow-cross-arm",
        footprintClass: "crosswise",
        representativeRotation: 90,
        columns: 2,
        rows: 2,
        packageCount: 4,
        naturalSizeMm: { length: 2, width: 4 },
      },
    ];
    const templates = buildPinwheelTopologyTemplates({ maxCoreDepth: 0 })
      .filter(
        ({ templateKey }) =>
          templateKey === "pinwheel-v1:d0:lengthwise-clockwise/grid",
      )
      .map((template) => ({
        ...template,
        slots: template.slots.map((slot, index) => ({
          ...slot,
          packageCounts: [[16], [30], [4], [4], [1]][index]!,
        })),
      }));
    const run = (
      orderedTemplates: readonly RegionGraphTemplate[],
      orderedShapes: readonly RegionShape[],
    ) =>
      searchRegionTopologies({
        input: normalizedInput,
        catalog: catalog(orderedShapes),
        templates: orderedTemplates,
        targetCountsDescending: [55],
        framePolicies: ["center-occupied-bounds"],
        ledger: createRegionWorkLedger({
          maxWorkUnits: 200_000,
          maxFrontierStates: 200,
          maxRetainedDrafts: 200,
        }),
      });
    const forward = run(templates, shapes);
    const reversed = run(
      templates.map(permutedTemplate),
      [...shapes].reverse(),
    );
    expect(forward.status).toBe("completed");
    expect(reversed).toEqual(forward);
    const grouped = forward.drafts.filter(({ canonicalRealizationOrderKey }) =>
      canonicalRealizationOrderKey.includes("suction-group-aware"),
    );
    expect([
      ...new Set(grouped.map(({ placements }) => placements.length)),
    ]).toEqual([55]);
    for (const { placements } of grouped)
      expect(
        validateCandidatePlacements(normalizedInput, placements).valid,
      ).toBe(true);
  });

  it.each([0, 1])(
    "keeps seeded grid-core geometry and work invariant to input order at %i mm clearance",
    (clearanceMm) => {
      const { shapes, templates, normalizedInput, bounds } =
        gridCoreFixture(clearanceMm);
      const run = (
        templateOrder: readonly RegionGraphTemplate[],
        shapeOrder: readonly RegionShape[],
      ) =>
        searchRegionTopologies({
          input: normalizedInput,
          catalog: catalog(shapeOrder),
          templates: templateOrder,
          targetCountsDescending: [9],
          ledger: createRegionWorkLedger(generousBudget),
          framePolicies: ["center-occupied-bounds"],
          spacingSelections: [{ x: "compact", y: "compact" }],
        });

      const forward = run(templates, shapes);
      const reversed = run(
        [...templates].reverse().map(permutedTemplate),
        [...shapes].reverse(),
      );

      expect(reversed).toEqual(forward);
      expect([
        ...new Set(forward.drafts.map(({ placements }) => placements.length)),
      ]).toEqual([9]);
      for (const { placements } of forward.drafts) {
        expect(
          validateCandidatePlacements(normalizedInput, placements).valid,
        ).toBe(true);
        expect(
          boundingRectangleForPlacements(
            placements,
            normalizedInput.package.dimensionsMm,
          ),
        ).toEqual(bounds);
      }
    },
  );

  it("bounds seed allocation and stops seeding on cancellation", () => {
    const { shapes, templates, normalizedInput } = gridCoreFixture();
    const template = templates[0]!;
    const slotIds = template.slots.map(({ id }) => id);
    const domains = template.slots.map(({ footprintClasses }) =>
      shapes.filter(({ footprintClass }) =>
        footprintClasses.includes(footprintClass),
      ),
    );
    const run = (
      maximumAttempts: number,
      maximumAssignments: number,
      shouldCancel?: () => boolean,
    ) => {
      const ledger = createRegionWorkLedger(generousBudget, shouldCancel);
      const seeds = seedGridCorePinwheels(
        normalizedInput,
        template,
        slotIds,
        domains,
        9,
        ledger,
        maximumAttempts,
        maximumAssignments,
      );
      return { seeds, work: ledger.snapshot() };
    };

    expect(run(0, 10).seeds).toEqual({
      assignments: [],
      attempts: 0,
      stopReason: null,
    });
    expect(run(10, 0).seeds).toEqual({
      assignments: [],
      attempts: 0,
      stopReason: null,
    });
    const bounded = run(1, 1);
    expect(bounded.seeds.assignments).toHaveLength(1);
    expect(
      bounded.seeds.assignments[0]!.reduce(
        (count, { shape }) => count + shape.packageCount,
        0,
      ),
    ).toBe(9);
    expect(bounded.work.totalUsed).toBe(1);
    const cancelled = run(10, 10, () => true);
    expect(cancelled.seeds).toEqual({
      assignments: [],
      attempts: 0,
      stopReason: "cancelled",
    });
    expect(cancelled.work.cancellationObserved).toBe(true);
  });

  it("prunes an unreachable count sum before any frontier pop", () => {
    const ledger = createRegionWorkLedger(generousBudget);
    const result = searchRegionTopologies({
      input: input(3),
      catalog: catalog([pair]),
      templates: [createOrderedGuillotineCutTemplate("x", 2)],
      targetCountsDescending: [3],
      ledger,
      framePolicies: ["fill-generation-bounds"],
      spacingSelections,
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toEqual([]);
    expect(result.statistics).toEqual({
      rootStateCount: 1,
      frontierPopCount: 0,
      expandedStateCount: 0,
      countPrunedStateCount: 1,
      constraintPrunedStateCount: 0,
      completedAssignmentCount: 0,
      duplicateRealizationCount: 0,
      infeasibleRealizationCount: 0,
      invalidMaterializationCount: 0,
    });
    expect(result.work.usedByKind["materialize-placement"]).toBe(0);
  });

  it("keeps canonical symmetries within the input's available footprint orientations", () => {
    const squareBounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const baseInput = input(2);
    const singleOrientationInput: NormalizedLayerSolverInput = {
      ...baseInput,
      envelopeMm: squareBounds,
      usableEnvelopeMm: squareBounds,
      generationBoundsMm: squareBounds,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0],
      },
    };
    const result = searchRegionTopologies({
      input: singleOrientationInput,
      catalog: catalog([pair]),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [2],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toEqual([
      { positionMm: { x: 1, y: 2 }, rotation: 0 },
      { positionMm: { x: 3, y: 2 }, rotation: 0 },
    ]);
  });

  it("charges every reachable-count transition to the work ledger", () => {
    const result = searchRegionTopologies({
      input: input(3),
      catalog: catalog([single, pair]),
      templates: [createOrderedGuillotineCutTemplate("x", 2)],
      targetCountsDescending: [3],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["fill-generation-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.work.usedByKind["count-dp-word"]).toBe(6);
    expect(result.work.usedByKind["template-expansion"]).toBe(4);
  });

  it("stops before inserting the first child above the frontier limit", () => {
    const result = searchRegionTopologies({
      input: input(4),
      catalog: catalog([single, pair, triple]),
      templates: [createOrderedGuillotineCutTemplate("x", 2)],
      targetCountsDescending: [4],
      ledger: createRegionWorkLedger({
        ...generousBudget,
        maxFrontierStates: 1,
      }),
      framePolicies: ["fill-generation-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${result.status}.`);
    }
    expect(result.reason).toBe("frontier-budget-exhausted");
    expect(result.statistics.expandedStateCount).toBe(2);
    expect(result.work.frontierPeak).toBe(1);
  });

  it("continues after storage saturation and retains a late owner family", () => {
    const gridFour: RegionShape = {
      key: "shape-grid-four",
      footprintClass: "lengthwise",
      representativeRotation: 0,
      columns: 2,
      rows: 2,
      packageCount: 4,
      naturalSizeMm: { length: 4, width: 2 },
    };
    const crossSingle: RegionShape = {
      key: "shape-cross-single",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 1,
      rows: 1,
      packageCount: 1,
      naturalSizeMm: { length: 1, width: 2 },
    };
    const pinwheel = buildPinwheelTopologyTemplates({
      maxCoreDepth: 0,
      includeGridCore: false,
    }).find(
      ({ templateKey }) =>
        templateKey === "pinwheel-v1:d0:lengthwise-clockwise",
    );
    if (!pinwheel) throw new Error("Expected a pinwheel template.");
    const baseInput = input(4);
    const mixedInput: NormalizedLayerSolverInput = {
      ...baseInput,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0, 90],
        maxBands: 4,
        allowMixedPackageOrientations: true,
      },
    };
    const run = (
      maxRetainedDrafts: number,
      templates: readonly RegionGraphTemplate[],
      shapes: readonly RegionShape[],
    ) =>
      searchRegionTopologies({
        input: mixedInput,
        catalog: catalog(shapes),
        templates,
        targetCountsDescending: [4],
        ledger: createRegionWorkLedger({
          ...generousBudget,
          maxWorkUnits: 100_000,
          maxRetainedDrafts,
        }),
        framePolicies: ["center-occupied-bounds", "fill-generation-bounds"],
        spacingSelections,
        symmetries: ["identity"],
      });
    const templates = [createFullGridGuillotineTemplate(), pinwheel];
    const shapes = [single, crossSingle, gridFour];

    const bounded = run(2, templates, shapes);
    const permuted = run(
      2,
      [...templates].reverse().map(permutedTemplate),
      [...shapes].reverse(),
    );
    const unbounded = run(100, templates, shapes);
    const ownerFamilies = (result: typeof bounded) =>
      result.drafts.map(
        ({ provenance }) => provenance[0]?.parameters?.ownerFamily,
      );

    expect(unbounded.status).toBe("completed");
    expect(unbounded.drafts).toHaveLength(6);
    expect(new Set(ownerFamilies(unbounded))).toEqual(
      new Set(["guillotine", "pinwheel"]),
    );
    expect(bounded.status).toBe("completed");
    expect(bounded.drafts).toHaveLength(2);
    expect(new Set(ownerFamilies(bounded))).toEqual(
      new Set(["guillotine", "pinwheel"]),
    );
    expect(bounded.work.totalUsed).toBe(unbounded.work.totalUsed);
    expect(bounded.work.usedByKind).toEqual(unbounded.work.usedByKind);
    expect(permuted).toEqual(bounded);
    expect(bounded.work).toMatchObject({
      discoveredDraftCount: 6,
      retainedDraftCount: 2,
      storageReplacementOccurred: true,
    });
  });

  it("keeps stratified retention invariant to discovery order and within its hard bound", () => {
    const entries = [
      {
        ownerFamily: "pinwheel" as const,
        draft: syntheticRetentionDraft(
          "pinwheel-alpha-center-first",
          "pinwheel",
          "alpha",
          "center-occupied-bounds",
          "alpha",
        ),
      },
      {
        ownerFamily: "pinwheel" as const,
        draft: syntheticRetentionDraft(
          "pinwheel-alpha-center-second",
          "pinwheel",
          "alpha",
          "center-occupied-bounds",
          "beta",
        ),
      },
      {
        ownerFamily: "pinwheel" as const,
        draft: syntheticRetentionDraft(
          "pinwheel-alpha-fill-first",
          "pinwheel",
          "alpha",
          "fill-generation-bounds",
          "alpha",
        ),
      },
      {
        ownerFamily: "pinwheel" as const,
        draft: syntheticRetentionDraft(
          "pinwheel-beta-center-first",
          "pinwheel",
          "beta",
          "center-occupied-bounds",
          "alpha",
        ),
      },
      {
        ownerFamily: "pinwheel" as const,
        draft: syntheticRetentionDraft(
          "pinwheel-beta-fill-first",
          "pinwheel",
          "beta",
          "fill-generation-bounds",
          "alpha",
        ),
      },
      {
        ownerFamily: "guillotine" as const,
        draft: syntheticRetentionDraft(
          "guillotine-alpha-center-first",
          "guillotine",
          "alpha",
          "center-occupied-bounds",
          "alpha",
        ),
      },
      {
        ownerFamily: "spine-corridor" as const,
        draft: syntheticRetentionDraft(
          "spine-alpha-center-first",
          "spine-corridor",
          "alpha",
          "center-occupied-bounds",
          "alpha",
        ),
      },
    ];
    const orders = [
      entries,
      [...entries].reverse(),
      [
        entries[5]!,
        entries[2]!,
        entries[6]!,
        ...entries.slice(0, 2),
        ...entries.slice(3, 5),
      ],
    ];
    const runs = orders.map((order) => {
      const retention = createBoundedRegionDraftRetention(4);
      const retainedCounts = order.map(
        ({ ownerFamily, draft }) =>
          retention.consider(ownerFamily, draft).retainedDraftCount,
      );
      return {
        retainedCounts,
        labels: retention
          .drafts()
          .map(({ provenance }) => provenance[0]!.variant),
      };
    });

    expect(runs.map(({ retainedCounts }) => retainedCounts)).toEqual([
      [1, 2, 3, 4, 4, 4, 4],
      [1, 2, 3, 4, 4, 4, 4],
      [1, 2, 3, 4, 4, 4, 4],
    ]);
    expect(runs.map(({ labels }) => labels)).toEqual([
      [
        "guillotine-alpha-center-first",
        "pinwheel-alpha-center-first",
        "spine-alpha-center-first",
        "pinwheel-alpha-fill-first",
      ],
      [
        "guillotine-alpha-center-first",
        "pinwheel-alpha-center-first",
        "spine-alpha-center-first",
        "pinwheel-alpha-fill-first",
      ],
      [
        "guillotine-alpha-center-first",
        "pinwheel-alpha-center-first",
        "spine-alpha-center-first",
        "pinwheel-alpha-fill-first",
      ],
    ]);
  });

  it("searches every target tier after draft storage saturates", () => {
    const eight: RegionShape = {
      key: "shape-eight",
      footprintClass: "lengthwise",
      representativeRotation: 0,
      columns: 2,
      rows: 4,
      packageCount: 8,
      naturalSizeMm: { length: 4, width: 4 },
    };
    const nine: RegionShape = {
      key: "shape-nine",
      footprintClass: "lengthwise",
      representativeRotation: 0,
      columns: 3,
      rows: 3,
      packageCount: 9,
      naturalSizeMm: { length: 6, width: 3 },
    };
    const result = searchRegionTopologies({
      input: rangeInput(8, 9),
      catalog: catalog([eight, nine]),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [8, 9],
      ledger: createRegionWorkLedger({
        ...generousBudget,
        maxRetainedDrafts: 1,
      }),
      framePolicies: ["fill-generation-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toHaveLength(9);
    expect(result.work).toMatchObject({
      discoveredDraftCount: 2,
      retainedDraftCount: 1,
      stopReason: null,
    });
  });

  it("rejects explicit empty and unknown realization options", () => {
    const request = {
      input: input(2),
      catalog: catalog(),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [2],
    } as const;

    const emptyFrames = searchRegionTopologies({
      ...request,
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: [],
    });
    expect(emptyFrames.status).toBe("invalid");
    if (emptyFrames.status !== "invalid") {
      throw new Error(
        `Expected invalid search, received ${emptyFrames.status}.`,
      );
    }
    expect(emptyFrames.reason).toBe(
      "At least one region frame policy is required.",
    );

    const emptySpacing = searchRegionTopologies({
      ...request,
      ledger: createRegionWorkLedger(generousBudget),
      spacingSelections: [],
    });
    expect(emptySpacing.status).toBe("invalid");
    if (emptySpacing.status !== "invalid") {
      throw new Error(
        `Expected invalid search, received ${emptySpacing.status}.`,
      );
    }
    expect(emptySpacing.reason).toBe(
      "At least one region spacing selection is required.",
    );

    const emptyPlan = searchRegionTopologies({
      ...request,
      targetCountsDescending: [],
      ledger: createRegionWorkLedger(generousBudget),
      spacingSelections: [],
    });
    expect(emptyPlan.status).toBe("invalid");
    if (emptyPlan.status !== "invalid") {
      throw new Error(`Expected invalid search, received ${emptyPlan.status}.`);
    }
    expect(emptyPlan.reason).toBe(
      "At least one region spacing selection is required.",
    );

    const futureSpacing = searchRegionTopologies({
      ...request,
      ledger: createRegionWorkLedger(generousBudget),
      spacingSelections: [{ x: "unknown-policy" as never, y: "compact" }],
    });
    expect(futureSpacing.status).toBe("invalid");
    if (futureSpacing.status !== "invalid") {
      throw new Error(
        `Expected invalid search, received ${futureSpacing.status}.`,
      );
    }
    expect(futureSpacing.reason).toBe("Unknown x spacing policy.");
  });

  it("filters default spacing alternatives to a template's supported subset", () => {
    const template = createFullGridGuillotineTemplate();
    const compactOnly: RegionGraphTemplate = {
      ...template,
      slots: template.slots.map((slot) => ({
        ...slot,
        spacingX: ["compact"],
        spacingY: ["compact"],
      })),
    };
    const result = searchRegionTopologies({
      input: input(2),
      catalog: catalog(),
      templates: [compactOnly],
      targetCountsDescending: [2],
      ledger: createRegionWorkLedger(generousBudget),
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(2);
  });

  it("combines independent region spacing policies in one guillotine cut", () => {
    const baseTemplate = createOrderedGuillotineCutTemplate("x", 3);
    const exactGrids = [
      { footprintClass: "lengthwise" as const, columns: 1, rows: 2 },
      { footprintClass: "lengthwise" as const, columns: 1, rows: 2 },
      { footprintClass: "crosswise" as const, columns: 1, rows: 2 },
    ];
    const template: RegionGraphTemplate = {
      ...baseTemplate,
      slots: baseTemplate.slots.map((slot, index) => ({
        ...slot,
        footprintClasses: [exactGrids[index]!.footprintClass],
        minimumColumns: exactGrids[index]!.columns,
        maximumColumns: exactGrids[index]!.columns,
        minimumRows: exactGrids[index]!.rows,
        maximumRows: exactGrids[index]!.rows,
      })),
    };
    const baseInput = input(6);
    const mixedInput: NormalizedLayerSolverInput = {
      ...baseInput,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0, 90],
        allowMixedPackageOrientations: true,
      },
    };
    const run = (
      shapes: readonly RegionShape[],
      selectedTemplate: RegionGraphTemplate,
    ) =>
      searchRegionTopologies({
        input: mixedInput,
        catalog: catalog(shapes),
        templates: [selectedTemplate],
        targetCountsDescending: [6],
        ledger: createRegionWorkLedger(generousBudget),
        framePolicies: ["center-occupied-bounds"],
        symmetries: ["identity"],
      });
    const result = run([verticalPair, crosswiseVerticalPair], template);
    const permuted = run(
      [crosswiseVerticalPair, verticalPair],
      permutedTemplate(template),
    );

    expect(result.status).toBe("completed");
    expect(
      result.drafts.some(({ placements }) =>
        placements.every((placement, index) => {
          const expected = [
            { positionMm: { x: 1.5, y: 0.5 }, rotation: 0 },
            { positionMm: { x: 1.5, y: 3.5 }, rotation: 0 },
            { positionMm: { x: 3.5, y: 0.5 }, rotation: 0 },
            { positionMm: { x: 3.5, y: 1.5 }, rotation: 0 },
            { positionMm: { x: 5, y: 1 }, rotation: 90 },
            { positionMm: { x: 5, y: 3 }, rotation: 90 },
          ][index];
          return (
            expected !== undefined &&
            placement.positionMm.x === expected.positionMm.x &&
            placement.positionMm.y === expected.positionMm.y &&
            placement.rotation === expected.rotation
          );
        }),
      ),
    ).toBe(true);
    expect(
      result.drafts.every(({ placements }) => placements.length === 6),
    ).toBe(true);
    expect(result.drafts).toHaveLength(7);
    expect(result.work.totalUsed).toBe(1_681);
    expect(result.work.usedByKind["independent-spacing-axis"]).toBe(270);
    expect(result.work.retainedDraftCount).toBe(7);
    expect(permuted).toEqual(result);
  });

  it("enumerates every ordered insertion position for one cross band", () => {
    const baseTemplate = createOrderedGuillotineCutTemplate("x", 3);
    const baseInput = input(6);
    const bounds = { minX: 0, minY: 0, maxX: 5, maxY: 4 };
    const mixedInput: NormalizedLayerSolverInput = {
      ...baseInput,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0, 90],
        allowMixedPackageOrientations: true,
      },
    };
    const result = searchRegionTopologies({
      input: mixedInput,
      catalog: catalog([verticalPair, crosswiseVerticalPair]),
      templates: [baseTemplate],
      targetCountsDescending: [6],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    const insertionCenters = [
      ...new Set(
        result.drafts.flatMap(({ placements }) => {
          const crosswise = placements.filter(
            ({ rotation }) => rotation === 90 || rotation === 270,
          );
          return crosswise.length === 2 ? [crosswise[0]!.positionMm.x] : [];
        }),
      ),
    ].sort((left, right) => left - right);
    expect(insertionCenters).toEqual([0.5, 2.5, 4.5]);
  });

  it("materializes an axis-dual recursive side corridor in witness order", () => {
    const recursive = buildGuillotineTopologyTemplates({
      maxRegionsPerTopology: 3,
    }).find(
      ({ templateKey }) =>
        templateKey === "guillotine-v1:recursive-x-y-branch-1",
    );
    if (!recursive)
      throw new Error("Expected a recursive guillotine template.");
    const exactGrids = [
      { footprintClass: "lengthwise" as const, columns: 1, rows: 4 },
      { footprintClass: "crosswise" as const, columns: 2, rows: 1 },
      { footprintClass: "lengthwise" as const, columns: 1, rows: 2 },
    ];
    const template: RegionGraphTemplate = {
      ...recursive,
      slots: recursive.slots.map((slot, index) => ({
        ...slot,
        footprintClasses: [exactGrids[index]!.footprintClass],
        minimumColumns: exactGrids[index]!.columns,
        maximumColumns: exactGrids[index]!.columns,
        minimumRows: exactGrids[index]!.rows,
        maximumRows: exactGrids[index]!.rows,
      })),
    };
    const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
    const baseInput = input(8);
    const recursiveInput: NormalizedLayerSolverInput = {
      ...baseInput,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0, 90],
        maxBands: 4,
        allowMixedPackageOrientations: true,
      },
    };
    const longCorridor: RegionShape = {
      key: "shape-long-corridor",
      footprintClass: "lengthwise",
      representativeRotation: 0,
      columns: 1,
      rows: 4,
      packageCount: 4,
      naturalSizeMm: { length: 2, width: 4 },
    };
    const crossBand: RegionShape = {
      key: "shape-cross-band",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 2,
      rows: 1,
      packageCount: 2,
      naturalSizeMm: { length: 2, width: 2 },
    };
    const result = searchRegionTopologies({
      input: recursiveInput,
      catalog: catalog([longCorridor, crossBand, verticalPair]),
      templates: [template],
      targetCountsDescending: [8],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toEqual([
      { positionMm: { x: 1, y: 0.5 }, rotation: 0 },
      { positionMm: { x: 1, y: 1.5 }, rotation: 0 },
      { positionMm: { x: 1, y: 2.5 }, rotation: 0 },
      { positionMm: { x: 1, y: 3.5 }, rotation: 0 },
      { positionMm: { x: 2.5, y: 1 }, rotation: 90 },
      { positionMm: { x: 3.5, y: 1 }, rotation: 90 },
      { positionMm: { x: 3, y: 2.5 }, rotation: 0 },
      { positionMm: { x: 3, y: 3.5 }, rotation: 0 },
    ]);
  });

  it("materializes bounded residual-seam alternatives after uniform spacing", () => {
    const baseInput = input(3);
    const bounds = { minX: 0, minY: 0, maxX: 8, maxY: 4 };
    const seamInput: NormalizedLayerSolverInput = {
      ...baseInput,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
    };
    const baseTemplate = createOrderedGuillotineCutTemplate("x", 2);
    const template: RegionGraphTemplate = {
      ...baseTemplate,
      slots: baseTemplate.slots.map((slot, index) => ({
        ...slot,
        minimumColumns: index === 0 ? 1 : 2,
        maximumColumns: index === 0 ? 1 : 2,
        minimumRows: 1,
        maximumRows: 1,
      })),
    };
    const result = searchRegionTopologies({
      input: seamInput,
      catalog: catalog([single, pair]),
      templates: [template],
      targetCountsDescending: [3],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["fill-generation-bounds"],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(
      result.drafts.some(({ placements }) =>
        placements.every((placement, index) => {
          const expected = [
            { positionMm: { x: 1, y: 0.5 }, rotation: 0 },
            { positionMm: { x: 5, y: 0.5 }, rotation: 0 },
            { positionMm: { x: 7, y: 0.5 }, rotation: 0 },
          ][index];
          return (
            expected !== undefined &&
            placement.positionMm.x === expected.positionMm.x &&
            placement.positionMm.y === expected.positionMm.y &&
            placement.rotation === expected.rotation
          );
        }),
      ),
    ).toBe(true);
    expect(result.drafts).toHaveLength(14);
    expect(result.work.totalUsed).toBe(552);
    expect(result.work.usedByKind["independent-spacing-axis"]).toBe(76);
    expect(result.work.retainedDraftCount).toBe(14);
  });

  it("keeps a complete valid draft within the hard storage bound", () => {
    const ledger = createRegionWorkLedger({
      ...generousBudget,
      maxRetainedDrafts: 1,
    });
    const normalizedInput = input(2);
    const result = searchRegionTopologies({
      input: normalizedInput,
      catalog: catalog(),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [2],
      ledger,
      framePolicies: ["fill-generation-bounds"],
      spacingSelections,
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]!.placements).toHaveLength(2);
    expect(
      validateCandidatePlacements(
        normalizedInput,
        result.drafts[0]!.placements,
      ),
    ).toEqual({ valid: true, issues: [] });
    expect(result.work).toMatchObject({
      discoveredDraftCount: 2,
      retainedDraftCount: 1,
      stopReason: null,
    });
  });

  it("discards retained drafts when later cancellation is observed", () => {
    let cancel = false;
    const base = createRegionWorkLedger(generousBudget, () => cancel);
    const ledger: RegionWorkLedger = Object.freeze({
      checkpoint: base.checkpoint,
      debit: base.debit,
      observeFrontierSize: base.observeFrontierSize,
      observeDraftStorage(observation) {
        const decision = base.observeDraftStorage(observation);
        if (decision === "continue" && observation.retainedDraftCount === 1) {
          cancel = true;
        }
        return decision;
      },
      snapshot: base.snapshot,
    });
    const result = searchRegionTopologies({
      input: input(2),
      catalog: catalog(),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [2],
      ledger,
      framePolicies: ["fill-generation-bounds"],
      spacingSelections,
      symmetries: ["identity"],
    });

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${result.status}.`);
    }
    expect(result.reason).toBe("cancelled");
    expect(result.drafts).toEqual([]);
    expect(result.work.retainedDraftCount).toBe(1);
    expect(result.work.cancellationObserved).toBe(true);
  });

  it("is invariant to template, slot, relation, and child-domain order", () => {
    const xCut = createOrderedGuillotineCutTemplate("x", 2);
    const yCut = createOrderedGuillotineCutTemplate("y", 2);
    const first = searchRegionTopologies({
      input: input(3),
      catalog: catalog([single, pair]),
      templates: [xCut, yCut],
      targetCountsDescending: [3],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["fill-generation-bounds"],
      spacingSelections,
    });
    const second = searchRegionTopologies({
      input: input(3),
      catalog: catalog([pair, single]),
      templates: [permutedTemplate(yCut), permutedTemplate(xCut)],
      targetCountsDescending: [3],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["fill-generation-bounds"],
      spacingSelections: [...spacingSelections].reverse(),
    });

    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");
    expect(
      first.drafts.map(({ realizationKey, placements }) => ({
        realizationKey,
        placements,
      })),
    ).toEqual(
      second.drafts.map(({ realizationKey, placements }) => ({
        realizationKey,
        placements,
      })),
    );
    expect(first.statistics).toEqual(second.statistics);
    expect(first.work).toEqual(second.work);
  });

  it("keeps recursive pinwheel output and exact work invariant to input order", () => {
    const templateKeys = [
      "pinwheel-v1:d1:lengthwise-clockwise/crosswise-clockwise",
      "pinwheel-v1:d1:lengthwise-clockwise/crosswise-counterclockwise",
    ];
    const templates = buildPinwheelTopologyTemplates({
      maxCoreDepth: 1,
    }).filter(({ templateKey }) => templateKeys.includes(templateKey));
    expect(templates).toHaveLength(2);
    const crossSingle: RegionShape = {
      key: "shape-cross-single",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 1,
      rows: 1,
      packageCount: 1,
      naturalSizeMm: { length: 1, width: 2 },
    };
    const crossPair: RegionShape = {
      key: "shape-cross-pair",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 1,
      rows: 2,
      packageCount: 2,
      naturalSizeMm: { length: 1, width: 4 },
    };
    const shapes = [single, pair, triple, crossSingle, crossPair];
    const base = input(12);
    const bounds = { minX: 0, minY: 0, maxX: 9, maxY: 7 };
    const normalizedInput: NormalizedLayerSolverInput = {
      ...base,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...base.constraints,
        allowedRotations: [0, 90],
        maxBands: 4,
        allowMixedPackageOrientations: true,
      },
    };
    const selections = [
      {
        x: "inter-region-seam",
        y: "inter-region-seam",
        recursiveCoreAlignment: "max-x-min-y",
        pinwheelResidualPlacement: "between",
      },
      {
        x: "inter-region-seam",
        y: "inter-region-seam",
        recursiveCoreAlignment: "fill-parent",
        pinwheelResidualPlacement: "cycle-seams",
      },
    ] as const;
    const searchBudget: RegionSearchBudget = {
      maxWorkUnits: 100_000,
      maxFrontierStates: 2_000,
      maxRetainedDrafts: 1_000,
    };
    const run = (
      templateOrder: readonly RegionGraphTemplate[],
      shapeOrder: readonly RegionShape[],
      selectionOrder: readonly (typeof selections)[number][],
    ) =>
      searchRegionTopologies({
        input: normalizedInput,
        catalog: catalog(shapeOrder),
        templates: templateOrder,
        targetCountsDescending: [12],
        ledger: createRegionWorkLedger(searchBudget),
        framePolicies: ["center-occupied-bounds"],
        spacingSelections: selectionOrder,
      });

    const forward = run(templates, shapes, selections);
    const reversed = run(
      [...templates].reverse().map(permutedTemplate),
      [...shapes].reverse(),
      [...selections].reverse(),
    );

    expect(forward.status).toBe("completed");
    expect(reversed.status).toBe("completed");
    expect(
      forward.drafts.map(({ realizationKey, placements }) => ({
        realizationKey,
        placements,
      })),
    ).toEqual(
      reversed.drafts.map(({ realizationKey, placements }) => ({
        realizationKey,
        placements,
      })),
    );
    expect(forward.statistics).toEqual(reversed.statistics);
    expect(forward.work).toEqual(reversed.work);
  });

  it("searches an independently dimensioned four-arm pinwheel", () => {
    const baseTemplate = buildPinwheelTopologyTemplates({
      maxCoreDepth: 0,
    }).find(
      ({ templateKey }) =>
        templateKey === "pinwheel-v1:d0:lengthwise-clockwise",
    );
    if (!baseTemplate) throw new Error("Expected a pinwheel template.");
    const exactGridBySlot = {
      "root-bottom": { columns: 3, rows: 1 },
      "root-right": { columns: 1, rows: 2 },
      "root-top": { columns: 2, rows: 1 },
      "root-left": { columns: 1, rows: 1 },
    } as const;
    const template: RegionGraphTemplate = {
      ...baseTemplate,
      slots: baseTemplate.slots.map((slot) => {
        const grid = exactGridBySlot[slot.id as keyof typeof exactGridBySlot];
        return {
          ...slot,
          minimumColumns: grid.columns,
          maximumColumns: grid.columns,
          minimumRows: grid.rows,
          maximumRows: grid.rows,
        };
      }),
    };
    const crossSingle: RegionShape = {
      key: "shape-cross-single",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 1,
      rows: 1,
      packageCount: 1,
      naturalSizeMm: { length: 1, width: 2 },
    };
    const crossPair: RegionShape = {
      key: "shape-cross-pair",
      footprintClass: "crosswise",
      representativeRotation: 90,
      columns: 1,
      rows: 2,
      packageCount: 2,
      naturalSizeMm: { length: 1, width: 4 },
    };
    const normalizedInput: NormalizedLayerSolverInput = {
      ...input(8),
      envelopeMm: { minX: 0, minY: 0, maxX: 9, maxY: 7 },
      usableEnvelopeMm: { minX: 0, minY: 0, maxX: 9, maxY: 7 },
      generationBoundsMm: { minX: 0, minY: 0, maxX: 9, maxY: 7 },
      constraints: {
        ...input(8).constraints,
        allowedRotations: [0, 90],
        maxBands: 4,
        allowMixedPackageOrientations: true,
      },
    };
    const result = searchRegionTopologies({
      input: normalizedInput,
      catalog: catalog([single, pair, triple, crossSingle, crossPair]),
      templates: [createFullGridGuillotineTemplate(), template],
      targetCountsDescending: [8],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "inter-region-seam", y: "inter-region-seam" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("completed");
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.placements).toHaveLength(8);
    expect(
      validateCandidatePlacements(
        normalizedInput,
        result.drafts[0]?.placements ?? [],
      ),
    ).toEqual({ valid: true, issues: [] });

    const constrainedBounds = { minX: 0, minY: 0, maxX: 6, maxY: 4 };
    const constrainedInput: NormalizedLayerSolverInput = {
      ...normalizedInput,
      envelopeMm: constrainedBounds,
      usableEnvelopeMm: constrainedBounds,
      generationBoundsMm: constrainedBounds,
    };
    const pruned = searchRegionTopologies({
      input: constrainedInput,
      catalog: catalog([single, pair, triple, crossSingle, crossPair]),
      templates: [createFullGridGuillotineTemplate(), template],
      targetCountsDescending: [8],
      ledger: createRegionWorkLedger(generousBudget),
      framePolicies: ["center-occupied-bounds"],
      spacingSelections: [{ x: "inter-region-seam", y: "inter-region-seam" }],
      symmetries: ["identity"],
    });
    expect(pruned.status).toBe("completed");
    expect(pruned.drafts).toEqual([]);
    expect(pruned.statistics.expandedStateCount).toBe(2);
    expect(pruned.statistics.completedAssignmentCount).toBe(0);
    expect(pruned.statistics.countPrunedStateCount).toBe(1);
    expect(pruned.statistics.constraintPrunedStateCount).toBe(1);
    expect(pruned.statistics.infeasibleRealizationCount).toBe(0);
  });

  it("searches every collision-safe interior arm split in both chiralities", () => {
    const armShapes = [
      {
        key: "independent-bottom",
        footprintClass: "lengthwise",
        representativeRotation: 0,
        columns: 3,
        rows: 1,
        packageCount: 3,
        naturalSizeMm: { length: 6, width: 1 },
      },
      {
        key: "independent-right",
        footprintClass: "crosswise",
        representativeRotation: 90,
        columns: 1,
        rows: 2,
        packageCount: 2,
        naturalSizeMm: { length: 1, width: 4 },
      },
      {
        key: "independent-top",
        footprintClass: "lengthwise",
        representativeRotation: 0,
        columns: 1,
        rows: 1,
        packageCount: 1,
        naturalSizeMm: { length: 2, width: 1 },
      },
      {
        key: "independent-left",
        footprintClass: "crosswise",
        representativeRotation: 90,
        columns: 1,
        rows: 1,
        packageCount: 1,
        naturalSizeMm: { length: 1, width: 2 },
      },
    ] as const satisfies readonly RegionShape[];
    const pinwheelCatalog: RegionShapeCatalog = {
      maximumPackageCount: 3,
      orderedShapes: armShapes,
      countsAscending: [1, 2, 3],
      shapesByCount: new Map([
        [1, [armShapes[2], armShapes[3]]],
        [2, [armShapes[1]]],
        [3, [armShapes[0]]],
      ]),
      shapesByFootprintClass: new Map([
        ["lengthwise", [armShapes[0], armShapes[2]]],
        ["crosswise", [armShapes[1], armShapes[3]]],
      ]),
    };
    const base = input(7);
    const bounds = { minX: 0, minY: 0, maxX: 9, maxY: 7 };
    const normalizedInput: NormalizedLayerSolverInput = {
      ...base,
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...base.constraints,
        allowedRotations: [0, 90],
        maxBands: 4,
        allowMixedPackageOrientations: true,
      },
    };
    const expectedByChirality = {
      clockwise: [
        [3, 1.5, 0],
        [5, 1.5, 0],
        [7, 1.5, 0],
        [6, 3, 90],
        [6, 5, 90],
        [2.5, 5, 0],
        [1.5, 2.5, 90],
      ],
      counterclockwise: [
        [2, 2, 0],
        [4, 2, 0],
        [6, 2, 0],
        [7.5, 2, 90],
        [7.5, 4, 90],
        [5.5, 5.5, 0],
        [2, 4.5, 90],
      ],
    } as const;
    const geometry = (
      placements: readonly Readonly<{
        positionMm: Readonly<{ x: number; y: number }>;
        rotation: number;
      }>[],
    ) =>
      placements
        .map(
          ({ positionMm, rotation }) =>
            [positionMm.x, positionMm.y, rotation] as const,
        )
        .sort(
          (left, right) =>
            left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
        );

    for (const chirality of ["clockwise", "counterclockwise"] as const) {
      const baseTemplate = buildPinwheelTopologyTemplates({
        maxCoreDepth: 0,
        includeGridCore: false,
      }).find(
        ({ templateKey }) =>
          templateKey === `pinwheel-v1:d0:lengthwise-${chirality}`,
      );
      if (!baseTemplate) throw new Error("Expected a pinwheel template.");
      const template: RegionGraphTemplate = {
        ...baseTemplate,
        slots: baseTemplate.slots.map((slot, roleIndex) => {
          const arm = armShapes[roleIndex]!;
          return {
            ...slot,
            minimumColumns: arm.columns,
            maximumColumns: arm.columns,
            minimumRows: arm.rows,
            maximumRows: arm.rows,
            packageCounts: [arm.packageCount],
          };
        }),
      };
      const result = searchRegionTopologies({
        input: normalizedInput,
        catalog: pinwheelCatalog,
        templates: [template],
        targetCountsDescending: [7],
        ledger: createRegionWorkLedger({
          maxWorkUnits: 100_000,
          maxFrontierStates: 1_000,
          maxRetainedDrafts: 1_000,
        }),
        framePolicies: ["center-occupied-bounds"],
        symmetries: ["identity"],
      });

      expect(result.status).toBe("completed");
      expect(
        result.drafts.some(
          ({ placements }) =>
            JSON.stringify(geometry(placements)) ===
            JSON.stringify(
              [...expectedByChirality[chirality]].sort(
                (left, right) =>
                  left[0] - right[0] ||
                  left[1] - right[1] ||
                  left[2] - right[2],
              ),
            ),
        ),
      ).toBe(true);
    }
  });

  it("bounds large pinwheel residual domains by searchable work", () => {
    const largeSpanMm = 5_000_000_000;
    const baseTemplate = buildPinwheelTopologyTemplates({
      maxCoreDepth: 0,
      includeGridCore: false,
    }).find(
      ({ templateKey }) =>
        templateKey === "pinwheel-v1:d0:lengthwise-clockwise",
    );
    if (!baseTemplate) throw new Error("Expected an empty-core pinwheel.");
    const grids = [
      [3, 1],
      [1, 2],
      [1, 1],
      [1, 1],
    ] as const;
    const shapes: RegionShape[] = baseTemplate.slots.map((slot, index) => {
      const [columns, rows] = grids[index]!;
      const footprintClass = slot.footprintClasses[0]!;
      const footprint =
        footprintClass === "crosswise"
          ? { length: 1, width: largeSpanMm }
          : { length: largeSpanMm, width: 1 };
      return {
        key: `large-residual-${index}`,
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
    const template: RegionGraphTemplate = {
      ...baseTemplate,
      slots: baseTemplate.slots.map((slot, index) => ({
        ...slot,
        minimumColumns: shapes[index]!.columns,
        maximumColumns: shapes[index]!.columns,
        minimumRows: shapes[index]!.rows,
        maximumRows: shapes[index]!.rows,
        packageCounts: [shapes[index]!.packageCount],
      })),
    };
    const bounds = {
      minX: 0,
      minY: 0,
      maxX: largeSpanMm * 4,
      maxY: largeSpanMm * 4,
    };
    const baseInput = input(7);
    const largeInput: NormalizedLayerSolverInput = {
      ...baseInput,
      package: {
        ...baseInput.package,
        dimensionsMm: { length: largeSpanMm, width: 1 },
      },
      envelopeMm: bounds,
      usableEnvelopeMm: bounds,
      generationBoundsMm: bounds,
      constraints: {
        ...baseInput.constraints,
        allowedRotations: [0, 90],
        maxBands: 10,
        allowMixedPackageOrientations: true,
      },
    };
    const result = searchRegionTopologies({
      input: largeInput,
      catalog: catalog(shapes),
      templates: [template],
      targetCountsDescending: [7],
      ledger: createRegionWorkLedger({
        maxWorkUnits: 10_000,
        maxFrontierStates: 100,
        maxRetainedDrafts: 100,
      }),
      framePolicies: ["center-occupied-bounds"],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${result.status}.`);
    }
    expect(result.reason).toBe("work-budget-exhausted");
    expect(result.work.totalUsed).toBe(9_994);
  });

  it("shares structural prefix work across descending target tiers", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);
    const run = (
      shapes: readonly RegionShape[],
      templates: readonly RegionGraphTemplate[],
      targetCountsDescending: readonly number[],
    ) =>
      searchRegionTopologies({
        input: rangeInput(2, 4),
        catalog: catalog(shapes),
        templates,
        targetCountsDescending,
        ledger: createRegionWorkLedger(generousBudget),
        framePolicies: ["fill-generation-bounds"],
        spacingSelections: [{ x: "compact", y: "compact" }],
        symmetries: ["identity"],
      });

    const forward = run([single, pair], [template], [4, 3, 2]);
    const permuted = run(
      [pair, single],
      [permutedTemplate(template)],
      [2, 4, 3],
    );

    expect(forward.status).toBe("completed");
    expect(permuted.status).toBe("completed");
    expect(forward.drafts).toEqual(permuted.drafts);
    expect(forward.statistics).toEqual(permuted.statistics);
    expect(forward.work).toEqual(permuted.work);
    expect(forward.statistics.rootStateCount).toBe(3);
    expect(forward.statistics.expandedStateCount).toBe(6);
    expect(forward.work.usedByKind["template-expansion"]).toBe(6);
  });

  it("keeps budget-stop results invariant to target, template, and shape order", () => {
    const template = createOrderedGuillotineCutTemplate("x", 2);
    const run = (
      shapes: readonly RegionShape[],
      templates: readonly RegionGraphTemplate[],
      targetCountsDescending: readonly number[],
    ) =>
      searchRegionTopologies({
        input: rangeInput(2, 4),
        catalog: catalog(shapes),
        templates,
        targetCountsDescending,
        ledger: createRegionWorkLedger({
          maxWorkUnits: 50,
          maxFrontierStates: 200,
          maxRetainedDrafts: 100,
        }),
        framePolicies: ["fill-generation-bounds"],
        spacingSelections: [...spacingSelections].reverse(),
        symmetries: ["identity"],
      });

    const forward = run([single, pair], [template], [4, 3, 2]);
    const permuted = run(
      [pair, single],
      [permutedTemplate(template)],
      [2, 4, 3],
    );

    expect(forward.status).toBe("stopped");
    if (forward.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${forward.status}.`);
    }
    expect(forward.reason).toBe("work-budget-exhausted");
    expect(permuted).toEqual(forward);
  });

  it("observes cancellation requested after the final retained draft", () => {
    let cancel = false;
    const base = createRegionWorkLedger(generousBudget, () => cancel);
    const ledger: RegionWorkLedger = Object.freeze({
      checkpoint: base.checkpoint,
      debit: base.debit,
      observeFrontierSize: base.observeFrontierSize,
      observeDraftStorage(observation) {
        const decision = base.observeDraftStorage(observation);
        if (decision === "continue" && observation.retainedDraftCount === 1) {
          cancel = true;
        }
        return decision;
      },
      snapshot: base.snapshot,
    });

    const result = searchRegionTopologies({
      input: input(2),
      catalog: catalog([pair]),
      templates: [createFullGridGuillotineTemplate()],
      targetCountsDescending: [2],
      ledger,
      framePolicies: ["fill-generation-bounds"],
      spacingSelections: [{ x: "compact", y: "compact" }],
      symmetries: ["identity"],
    });

    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") {
      throw new Error(`Expected stopped search, received ${result.status}.`);
    }
    expect(result.reason).toBe("cancelled");
    expect(result.drafts).toEqual([]);
    expect(result.work.retainedDraftCount).toBe(1);
    expect(result.work.cancellationObserved).toBe(true);
  });

  it("rejects a malformed step-spine witness without throwing", () => {
    const template = createStepSpineTopologyTemplate("x", "lengthwise");
    if (template.witness.kind !== "spine-tree") {
      throw new Error("Expected a step-spine witness.");
    }
    const malformed = {
      ...template,
      witness: {
        ...template.witness,
        orderedSpines: [],
      },
    } as unknown as RegionGraphTemplate;

    const result = searchRegionTopologies({
      input: input(4),
      catalog: catalog([single]),
      templates: [malformed],
      targetCountsDescending: [4],
      ledger: createRegionWorkLedger(generousBudget),
    });

    expect(result).toMatchObject({
      status: "invalid",
      reason: "A step-spine witness must define exactly one spine.",
      drafts: [],
    });
  });
});
