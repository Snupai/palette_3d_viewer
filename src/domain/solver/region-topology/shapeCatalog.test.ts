import { describe, expect, it } from "vitest";
import type { Rotation } from "~/domain/palletTypes";
import type { RegionSearchBudget } from "~/domain/solver/region-topology/model";
import {
  buildRegionShapeCatalog,
  type RegionShapeCatalogBuildResult,
} from "~/domain/solver/region-topology/shapeCatalog";
import {
  createRegionWorkLedger,
  REGION_SEARCH_WORK_MODEL_VERSION,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

const generousBudget: RegionSearchBudget = {
  maxWorkUnits: 100,
  maxFrontierStates: 10,
  maxRetainedDrafts: 10,
};

function normalizedInput(
  options: Readonly<{
    rotations?: readonly Rotation[];
    packageLength?: number;
    packageWidth?: number;
    clearance?: number;
    frameLength?: number;
    frameWidth?: number;
    maxBands?: number;
    maxPlacements?: number;
  }> = {},
): NormalizedLayerSolverInput {
  const frameLength = options.frameLength ?? 12;
  const frameWidth = options.frameWidth ?? 8;
  const maxPlacements = options.maxPlacements ?? 6;
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: {
        length: options.packageLength ?? 4,
        width: options.packageWidth ?? 2,
      },
      clearanceMm: options.clearance ?? 0,
      inletOrientation: "lengthwise",
    },
    envelopeMm: { minX: 0, minY: 0, maxX: frameLength, maxY: frameWidth },
    physicalPalletBoundsMm: null,
    usableEnvelopeMm: {
      minX: 0,
      minY: 0,
      maxX: frameLength,
      maxY: frameWidth,
    },
    generationBoundsMm: {
      minX: 0,
      minY: 0,
      maxX: frameLength,
      maxY: frameWidth,
    },
    constraints: {
      allowedRotations: options.rotations ?? [0, 90],
      edgeClearanceMm: 0,
      minimumPackageCount: 1,
      maximumPackageCount: maxPlacements,
      maxPlacements,
      maxBands: options.maxBands ?? 3,
      maxCandidatesPerGenerator: 20,
      provisionalPackagesPerCycle: 1,
      suctionRemainderPolicy: "centered-singleton",
      allowMixedPackageOrientations: true,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "fill-generation-bounds",
    },
  };
}

function completed(result: RegionShapeCatalogBuildResult) {
  expect(result.status).toBe("completed");
  if (result.status !== "completed") {
    throw new Error(`Expected completed catalog, received ${result.status}.`);
  }
  return result.catalog;
}

function emptyWorkCounts() {
  return {
    "catalog-shape": 0,
    "root-state": 0,
    "frontier-pop": 0,
    "template-expansion": 0,
    "count-dp-word": 0,
    "domain-revision": 0,
    "canonical-transform": 0,
    "line-constraint": 0,
    "independent-spacing-axis": 0,
    "spacing-realization": 0,
    normalization: 0,
    "materialize-placement": 0,
  };
}

describe("region shape catalog", () => {
  it("enumerates exact bounded shapes in a deterministic total order", () => {
    const ledger = createRegionWorkLedger(generousBudget);
    const catalog = completed(
      buildRegionShapeCatalog(normalizedInput(), 6, ledger),
    );

    expect(catalog.orderedShapes).toHaveLength(17);
    expect(catalog.countsAscending).toEqual([1, 2, 3, 4, 5, 6]);
    expect(catalog.orderedShapes.map(({ key }) => key)).toEqual([
      "region-shape-v1:lengthwise:1x1",
      "region-shape-v1:crosswise:1x1",
      "region-shape-v1:lengthwise:1x2",
      "region-shape-v1:lengthwise:2x1",
      "region-shape-v1:crosswise:1x2",
      "region-shape-v1:crosswise:2x1",
      "region-shape-v1:lengthwise:1x3",
      "region-shape-v1:lengthwise:3x1",
      "region-shape-v1:crosswise:3x1",
      "region-shape-v1:lengthwise:2x2",
      "region-shape-v1:crosswise:2x2",
      "region-shape-v1:crosswise:4x1",
      "region-shape-v1:crosswise:5x1",
      "region-shape-v1:lengthwise:2x3",
      "region-shape-v1:lengthwise:3x2",
      "region-shape-v1:crosswise:3x2",
      "region-shape-v1:crosswise:6x1",
    ]);
    expect(ledger.snapshot()).toEqual({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget: generousBudget,
      totalUsed: 17,
      usedByKind: {
        ...emptyWorkCounts(),
        "catalog-shape": 17,
      },
      frontierPeak: 0,
      discoveredDraftCount: 0,
      retainedDraftCount: 0,
      storageReplacementOccurred: false,
      stopReason: null,
      cancellationObserved: false,
    });
  });

  it("normalizes yaw permutations to the same physical shape catalog", () => {
    const first = completed(
      buildRegionShapeCatalog(
        normalizedInput({ rotations: [270, 0, 180, 90] }),
        6,
        createRegionWorkLedger(generousBudget),
      ),
    );
    const second = completed(
      buildRegionShapeCatalog(
        normalizedInput({ rotations: [90, 180, 270, 0] }),
        6,
        createRegionWorkLedger(generousBudget),
      ),
    );

    expect(first).toEqual(second);
    expect(
      first.shapesByFootprintClass
        .get("lengthwise")
        ?.every(({ representativeRotation }) => representativeRotation === 0),
    ).toBe(true);
    expect(
      first.shapesByFootprintClass
        .get("crosswise")
        ?.every(({ representativeRotation }) => representativeRotation === 90),
    ).toBe(true);
  });

  it("collapses every allowed square yaw into one square footprint class", () => {
    const ledger = createRegionWorkLedger(generousBudget);
    const catalog = completed(
      buildRegionShapeCatalog(
        normalizedInput({
          rotations: [270, 0, 180, 90],
          packageLength: 3,
          packageWidth: 3,
          frameLength: 9,
          frameWidth: 6,
          maxBands: 2,
        }),
        6,
        ledger,
      ),
    );

    expect(catalog.orderedShapes).toHaveLength(6);
    expect(
      catalog.orderedShapes.map(
        ({ footprintClass, representativeRotation }) => ({
          footprintClass,
          representativeRotation,
        }),
      ),
    ).toEqual(
      Array.from({ length: 6 }, () => ({
        footprintClass: "square",
        representativeRotation: 0,
      })),
    );
    expect(catalog.shapesByFootprintClass.has("lengthwise")).toBe(false);
    expect(catalog.shapesByFootprintClass.has("crosswise")).toBe(false);
    expect(ledger.snapshot().totalUsed).toBe(6);
  });

  it("applies clearance, maxBands, and maxPlacements as hard bounds", () => {
    const withClearance = completed(
      buildRegionShapeCatalog(
        normalizedInput({ clearance: 1 }),
        6,
        createRegionWorkLedger(generousBudget),
      ),
    );
    expect(withClearance.orderedShapes).toHaveLength(10);
    expect(
      withClearance.orderedShapes.find(
        ({ footprintClass, columns, rows }) =>
          footprintClass === "lengthwise" && columns === 2 && rows === 3,
      )?.naturalSizeMm,
    ).toEqual({ length: 9, width: 8 });

    const tightlyBounded = completed(
      buildRegionShapeCatalog(
        normalizedInput({ maxBands: 1, maxPlacements: 4 }),
        10,
        createRegionWorkLedger(generousBudget),
      ),
    );
    expect(tightlyBounded.maximumPackageCount).toBe(4);
    expect(tightlyBounded.orderedShapes).toHaveLength(7);
    expect(
      tightlyBounded.orderedShapes.every(
        ({ rows, packageCount }) => rows === 1 && packageCount <= 4,
      ),
    ).toBe(true);
  });

  it("uses the solver epsilon at exact floating-point frame boundaries", () => {
    const catalog = completed(
      buildRegionShapeCatalog(
        normalizedInput({
          rotations: [0],
          packageLength: 0.1 + 0.2,
          packageWidth: 0.2,
          frameLength: 0.3,
          frameWidth: 0.4,
          maxBands: 2,
          maxPlacements: 2,
        }),
        2,
        createRegionWorkLedger(generousBudget),
      ),
    );

    expect(catalog.orderedShapes).toHaveLength(2);
    expect(
      catalog.orderedShapes.map(({ naturalSizeMm }) => naturalSizeMm),
    ).toEqual([
      { length: 0.3, width: 0.2 },
      { length: 0.3, width: 0.4 },
    ]);
  });

  it("returns no partial catalog when cancellation precedes a shape debit", () => {
    let checks = 0;
    const ledger = createRegionWorkLedger(generousBudget, () => {
      checks += 1;
      return checks === 4;
    });

    expect(buildRegionShapeCatalog(normalizedInput(), 6, ledger)).toEqual({
      status: "stopped",
      reason: "cancelled",
    });
    expect(ledger.snapshot()).toEqual({
      workModelVersion: REGION_SEARCH_WORK_MODEL_VERSION,
      budget: generousBudget,
      totalUsed: 2,
      usedByKind: {
        ...emptyWorkCounts(),
        "catalog-shape": 2,
      },
      frontierPeak: 0,
      discoveredDraftCount: 0,
      retainedDraftCount: 0,
      storageReplacementOccurred: false,
      stopReason: "cancelled",
      cancellationObserved: true,
    });
  });

  it("fails closed before work for invalid normalized bounds", () => {
    const duplicateYawLedger = createRegionWorkLedger(generousBudget);
    expect(
      buildRegionShapeCatalog(
        normalizedInput({ rotations: [0, 0] }),
        6,
        duplicateYawLedger,
      ),
    ).toEqual({
      status: "invalid",
      reason: "Allowed rotations must not contain duplicates.",
    });
    expect(duplicateYawLedger.snapshot().totalUsed).toBe(0);

    const clearanceLedger = createRegionWorkLedger(generousBudget);
    expect(
      buildRegionShapeCatalog(
        normalizedInput({ clearance: -1 }),
        6,
        clearanceLedger,
      ),
    ).toEqual({
      status: "invalid",
      reason: "Package clearance must be a finite non-negative number.",
    });
    expect(clearanceLedger.snapshot().totalUsed).toBe(0);

    const bandLedger = createRegionWorkLedger(generousBudget);
    expect(
      buildRegionShapeCatalog(normalizedInput({ maxBands: 0 }), 6, bandLedger),
    ).toEqual({
      status: "invalid",
      reason: "constraints.maxBands must be a positive safe integer.",
    });
    expect(bandLedger.snapshot().totalUsed).toBe(0);
  });
});
