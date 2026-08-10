import { describe, expect, it } from "vitest";
import {
  boundingRectangleForPlacements,
  createCenteredEffectivePalletEnvelope,
  rectangleBoundsCenter,
} from "~/domain/geometry";
import { solveLayer } from "~/domain/solver/solve";
import {
  calculateStackCapacity,
  calculateUniformStackCapacity,
  createCompositionSequence,
  materializeStack,
  stackPatternFromSolverCandidate,
  type StackPattern,
} from "~/domain/stack";
import observedAp5006 from "~/lib/__fixtures__/parity/ap5006-1329-00004.observed.parity.json";
import { materializedStackToPalletData } from "~/lib/projectAdapters";

const derived = {
  status: "derived" as const,
  source: "golden-test",
  detail: "Repository-authored executable golden value.",
};

function syntheticPattern(ref: string, packageCount = 1): StackPattern {
  return {
    ref,
    name: ref,
    placements: Array.from({ length: packageCount }, (_, index) => ({
      sourcePlacementId: `${ref}-placement-${index + 1}`,
      sequence: index,
      positionMm: { x: 50 + index * 100, y: 50 },
      rotation: 0 as const,
      gripId: null,
      labelSide: null,
    })),
    grips: [],
    groupOrder: [],
    orderDependencies: [],
    cycles: [],
    cycleCount: packageCount,
    cycleCountProvenance: derived,
    transformFrameMm: { minX: 0, minY: 0, maxX: 300, maxY: 100 },
    transformFrameProvenance: derived,
    provenance: {
      kind: "project-pattern",
      projectSchemaVersion: 3,
      projectId: "golden",
      solutionId: "golden",
      solutionOrigin: "manual",
      patternId: ref,
    },
  };
}

describe("M4 stack golden calculations", () => {
  it("preserves centered solver coordinates through identity stack materialization", () => {
    const envelopeMm = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    const generationBoundsMm = {
      minX: 100,
      minY: 100,
      maxX: 300,
      maxY: 200,
    };
    const packageDimensionsMm = { length: 100, width: 50 };
    const solved = solveLayer(
      {
        package: {
          shape: "cuboid",
          dimensionsMm: packageDimensionsMm,
          clearanceMm: 0,
        },
        envelopeMm,
        generationBoundsMm,
        constraints: {
          minimumPackageCount: 3,
          maximumPackageCount: 3,
          maxCandidatesPerGenerator: 100,
        },
      },
      { includeSymmetryVariants: false },
    );
    const candidate = solved.candidates[0]!;
    const pattern = stackPatternFromSolverCandidate(candidate, {
      transformFrameMm: envelopeMm,
    });
    const result = materializeStack({
      package: {
        shape: "cuboid",
        dimensionsMm: { ...packageDimensionsMm, height: 40 },
        weightKg: 1,
        weightProvenance: derived,
        inletOrientation: "lengthwise",
      },
      pallet: {
        id: "centered-pallet",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        allowedOverhangMm: { length: 0, width: 0 },
        storageEnvelopeMm: { length: 400, width: 300, height: 100 },
        tareKg: 10,
        maxGrossKg: 100,
      },
      resources: {
        selectedGripperId: "gripper",
        selectedPalletStationId: "station",
        availableMaterialResourceIds: [],
      },
      patterns: [pattern],
      layers: createCompositionSequence({
        mode: "tower",
        layerCount: 1,
        primaryPatternRef: pattern.ref,
      }),
      interlayers: { mode: "individual", beforeLayer: {} },
    });
    const candidatePositions = candidate.placements.map(
      ({ positionMm }) => positionMm,
    );

    expect(pattern.placements.map(({ positionMm }) => positionMm)).toEqual(
      candidatePositions,
    );
    expect(
      result.packageLayers[0]?.placements.map(({ positionMm }) => positionMm),
    ).toEqual(candidatePositions);
    expect(
      rectangleBoundsCenter(
        boundingRectangleForPlacements(
          candidate.placements,
          packageDimensionsMm,
        )!,
      ),
    ).toEqual(rectangleBoundsCenter(generationBoundsMm));
  });

  it("materializes the observed 55 package candidate over 10 layers as 550", () => {
    const values = observedAp5006.input.values;
    const solverEnvelope = createCenteredEffectivePalletEnvelope(
      {
        length: values.pallet.lengthMm,
        width: values.pallet.widthMm,
      },
      {
        length: values.pallet.underhangLengthMm,
        width: values.pallet.underhangWidthMm,
      },
    );
    const solved = solveLayer({
      package: {
        shape: values.package.shape,
        dimensionsMm: {
          length: values.package.lengthMm,
          width: values.package.widthMm,
        },
        clearanceMm: values.package.clearanceMm,
      },
      envelopeMm: solverEnvelope,
      constraints: { maxCandidatesPerGenerator: 200 },
    });
    const candidate = solved.candidates.find(
      ({ metrics }) => metrics.packageCount === 55,
    )!;
    const stackPattern = stackPatternFromSolverCandidate(candidate, {
      transformFrameMm: solverEnvelope,
    });
    const result = materializeStack({
      package: {
        shape: "cuboid",
        dimensionsMm: {
          length: values.package.lengthMm,
          width: values.package.widthMm,
          height: values.package.heightMm,
        },
        weightKg: 1,
        weightProvenance: derived,
        inletOrientation: "lengthwise",
      },
      pallet: {
        id: "euro",
        dimensionsMm: {
          length: values.pallet.lengthMm,
          width: values.pallet.widthMm,
          height: 144,
        },
        allowedOverhangMm: { length: 0, width: 0 },
        storageEnvelopeMm: {
          length: values.pallet.lengthMm,
          width: values.pallet.widthMm,
          height: 1500,
        },
        tareKg: 25,
        maxGrossKg: 1000,
      },
      resources: {
        selectedGripperId: "gripper",
        selectedPalletStationId: "station",
        availableMaterialResourceIds: [],
      },
      patterns: [stackPattern],
      layers: createCompositionSequence({
        mode: "tower",
        layerCount: 10,
        primaryPatternRef: stackPattern.ref,
      }),
      interlayers: { mode: "individual", beforeLayer: {} },
    });

    expect(result.metrics.packages.perPhysicalLayer).toEqual(
      Array(10).fill(55),
    );
    expect(result.metrics.packages.totalPackageCount).toBe(550);
    expect(result.metrics.packages.denominatorPhysicalPackageLayerCount).toBe(
      10,
    );
    expect(result.metrics.height.loadStackHeightMm).toBe(1500);
    expect(result.metrics.height.denominatorStorageHeightMm).toBe(1500);
    expect(result.metrics.area.packageFootprintAreaAcrossLayersMm2).toBe(
      550 * 157 * 106,
    );
    expect(
      result.metrics.area.denominatorAvailableFootprintAreaAcrossLayersMm2,
    ).toBe(1200 * 800 * 10);
    expect(result.metrics.area.utilization.ratio).toBeCloseTo(
      (550 * 157 * 106) / (1200 * 800 * 10),
      12,
    );
    expect(result.metrics.volume.packageVolumeMm3).toBe(550 * 157 * 106 * 150);
    expect(result.metrics.volume.denominatorLoadEnvelopeVolumeMm3).toBe(
      1200 * 800 * 1500,
    );
    expect(result.metrics.volume.utilization.ratio).toBeCloseTo(
      (550 * 157 * 106 * 150) / (1200 * 800 * 1500),
      12,
    );
    expect(result.metrics.weight.payloadWeightKg).toBe(550);
    expect(result.metrics.weight.grossWeightKg).toBe(575);
    expect(result.warnings.map(({ code }) => code)).toContain(
      "metric-provenance-unverified",
    );
  });

  it("uses variable all-rule interlayers plus base/deck sheets in exact height and weight", () => {
    const layers = createCompositionSequence({
      mode: "tower",
      layerCount: 3,
      primaryPatternRef: "single",
    });
    const interlayers = {
      mode: "all" as const,
      baseSheet: { thicknessMm: 5, weightKg: 1 },
      betweenLayers: { thicknessMm: 2, weightKg: 0.5 },
      overridesBeforeLayer: {
        "composed-layer-3": {
          thicknessMm: 7,
          quantity: 2,
          weightKg: 0.25,
        },
      },
      deckSheet: { thicknessMm: 4, weightKg: 1.5 },
    };
    const result = materializeStack({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100, height: 100 },
        weightKg: 2,
        weightProvenance: derived,
        inletOrientation: "lengthwise",
      },
      pallet: {
        id: "pallet",
        dimensionsMm: { length: 200, width: 100, height: 10 },
        allowedOverhangMm: { length: 0, width: 0 },
        storageEnvelopeMm: { length: 200, width: 100, height: 325 },
        tareKg: 10,
        maxGrossKg: 19.5,
      },
      resources: {
        selectedGripperId: "gripper",
        selectedPalletStationId: "station",
        availableMaterialResourceIds: [],
      },
      patterns: [syntheticPattern("single")],
      layers,
      interlayers,
    });

    expect(result.physicalSequence.map(({ kind }) => kind)).toEqual([
      "sheet",
      "package-layer",
      "sheet",
      "package-layer",
      "sheet",
      "sheet",
      "package-layer",
      "sheet",
    ]);
    expect(result.sheets.map(({ thicknessMm }) => thicknessMm)).toEqual([
      5, 2, 7, 7, 4,
    ]);
    const preview = materializedStackToPalletData(result);
    expect(
      preview.layers.map(
        ({ interlayerThicknessesMm }) => interlayerThicknessesMm,
      ),
    ).toEqual([[5], [2], [7, 7]]);
    expect(preview.trailingInterlayerThicknessesMm).toEqual([4]);
    expect(
      result.packageLayers.map(({ zBottomMm, zTopMm }) => [zBottomMm, zTopMm]),
    ).toEqual([
      [5, 105],
      [107, 207],
      [221, 321],
    ]);
    expect(result.metrics.height).toMatchObject({
      packageLayersHeightMm: 300,
      sheetsHeightMm: 25,
      loadStackHeightMm: 325,
      denominatorStorageHeightMm: 325,
    });
    expect(result.metrics.area.utilization.ratio).toBe(0.5);
    expect(result.metrics.volume.utilization.ratio).toBeCloseTo(6 / 13, 12);
    expect(result.metrics.weight).toMatchObject({
      packagePayloadWeightKg: 6,
      sheetPayloadWeightKg: 3.5,
      payloadWeightKg: 9.5,
      palletTareWeightKg: 10,
      grossWeightKg: 19.5,
      denominatorMaxGrossWeightKg: 19.5,
    });
    expect(
      result.warnings.some(({ code }) => code === "gross-weight-exceeded"),
    ).toBe(false);

    expect(
      calculateStackCapacity({
        storageHeightMm: 324,
        packageHeightMm: 100,
        layers,
        interlayers,
      }),
    ).toMatchObject({
      status: "calculated",
      capacityLayers: 2,
      heightAtCapacityMm: 211,
      requiredHeightForNextLayerMm: 325,
    });
    expect(
      calculateStackCapacity({
        storageHeightMm: 325,
        packageHeightMm: 100,
        layers,
        interlayers,
      }).capacityLayers,
    ).toBe(3);
  });

  it("supports individual interlayers and safe zero/impossible capacities", () => {
    const layers = createCompositionSequence({
      mode: "tower",
      layerCount: 3,
      primaryPatternRef: "single",
    });
    const individual = {
      mode: "individual" as const,
      baseSheet: { thicknessMm: 3 },
      beforeLayer: {
        "composed-layer-3": { thicknessMm: 8 },
      },
      deckSheet: { thicknessMm: 4 },
    };

    expect(
      calculateStackCapacity({
        storageHeightMm: 315,
        packageHeightMm: 100,
        layers,
        interlayers: individual,
      }),
    ).toMatchObject({
      capacityLayers: 3,
      heightAtCapacityMm: 315,
    });
    expect(
      calculateUniformStackCapacity({
        storageHeightMm: 0,
        packageHeightMm: 100,
      }),
    ).toMatchObject({ status: "impossible", capacityLayers: 0 });
    expect(
      calculateUniformStackCapacity({
        storageHeightMm: 100,
        packageHeightMm: 0,
      }),
    ).toMatchObject({ status: "invalid-input", capacityLayers: 0 });
    expect(
      calculateUniformStackCapacity({
        storageHeightMm: 99,
        packageHeightMm: 100,
      }),
    ).toMatchObject({
      status: "impossible",
      capacityLayers: 0,
      requiredHeightForNextLayerMm: 100,
    });
  });

  it("replaces only the physical top occurrence with a special top pattern", () => {
    const sourceLayers = createCompositionSequence({
      mode: "tower",
      layerCount: 3,
      primaryPatternRef: "regular",
    });
    const result = materializeStack({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 100, height: 50 },
        weightKg: 1,
        weightProvenance: derived,
        inletOrientation: "lengthwise",
      },
      pallet: {
        id: "pallet",
        dimensionsMm: { length: 300, width: 100, height: 10 },
        allowedOverhangMm: { length: 0, width: 0 },
        storageEnvelopeMm: { length: 300, width: 100, height: 150 },
        tareKg: 1,
        maxGrossKg: 100,
      },
      resources: {
        selectedGripperId: "gripper",
        selectedPalletStationId: "station",
        availableMaterialResourceIds: [],
      },
      patterns: [syntheticPattern("regular", 2), syntheticPattern("top", 1)],
      layers: sourceLayers,
      interlayers: { mode: "individual", beforeLayer: {} },
      specialTopLayer: {
        enabled: true,
        patternRef: "top",
        transform: "identity",
      },
    });

    expect(sourceLayers.map(({ patternRef }) => patternRef)).toEqual([
      "regular",
      "regular",
      "regular",
    ]);
    expect(result.packageLayers.map(({ patternRef }) => patternRef)).toEqual([
      "regular",
      "regular",
      "top",
    ]);
    expect(result.metrics.packages.perPhysicalLayer).toEqual([2, 2, 1]);
    expect(result.metrics.packages.totalPackageCount).toBe(5);
    expect(result.packageLayers[2]?.layerProvenance).toEqual({
      kind: "special-top",
      replacedPatternRef: "regular",
      sourcePatternRef: "top",
    });
  });
});
