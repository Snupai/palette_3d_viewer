import {
  boundingRectangleForPlacements,
  createEffectivePalletEnvelope,
  rectangleBoundsArea,
  rectangleBoundsLength,
  rectangleBoundsWidth,
  symmetricSideAllowance,
  type RectangleBoundsMm,
} from "~/domain/geometry";
import type {
  MaterializedPackageLayer,
  MaterializedSheet,
  MetricProvenance,
  MetricProvenanceStatus,
  NamedMetricOperand,
  NamedUtilizationMetric,
  StackMetrics,
  StackPackageContext,
  StackPalletContext,
} from "~/domain/stack/types";

export type CalculateStackMetricsInput = {
  package: StackPackageContext;
  pallet: StackPalletContext | null;
  packageLayers: readonly MaterializedPackageLayer[];
  sheets: readonly MaterializedSheet[];
};

const derivedArithmetic: MetricProvenance = {
  status: "derived",
  source: "materialized-stack-arithmetic",
  detail:
    "The value is calculated directly from the exact materialized physical sequence.",
};

function unknownProvenance(detail: string): MetricProvenance {
  return { status: "unknown", source: "missing-metric-input", detail };
}

function combinedProvenance(
  values: readonly MetricProvenance[],
  source: string,
  detail: string,
): MetricProvenance {
  const priority: Record<MetricProvenanceStatus, number> = {
    verified: 0,
    derived: 1,
    unverified: 2,
    unknown: 3,
  };
  const status = values.reduce<MetricProvenanceStatus>(
    (current, value) =>
      priority[value.status] > priority[current] ? value.status : current,
    "verified",
  );
  return { status, source, detail };
}

function ratioMetric(
  numerator: NamedMetricOperand,
  denominator: NamedMetricOperand,
  provenance: MetricProvenance,
): NamedUtilizationMetric {
  const ratio =
    numerator.value === null ||
    denominator.value === null ||
    denominator.value <= 0
      ? null
      : numerator.value / denominator.value;
  return {
    numerator,
    denominator,
    ratio,
    percent: ratio === null ? null : ratio * 100,
    provenance,
  };
}

function unionBounds(
  bounds: readonly RectangleBoundsMm[],
): RectangleBoundsMm | null {
  const first = bounds[0];
  if (!first) return null;
  const union = { ...first };
  for (let index = 1; index < bounds.length; index += 1) {
    const current = bounds[index]!;
    union.minX = Math.min(union.minX, current.minX);
    union.minY = Math.min(union.minY, current.minY);
    union.maxX = Math.max(union.maxX, current.maxX);
    union.maxY = Math.max(union.maxY, current.maxY);
  }
  return union;
}

function effectivePalletBounds(
  pallet: StackPalletContext | null,
): RectangleBoundsMm | null {
  if (!pallet) return null;
  return createEffectivePalletEnvelope(
    pallet.dimensionsMm,
    symmetricSideAllowance(pallet.allowedOverhangMm),
  );
}

export function calculateStackMetrics(
  input: CalculateStackMetricsInput,
): StackMetrics {
  const packageLayerCount = input.packageLayers.length;
  const packagesPerLayer = input.packageLayers.map(
    ({ placements }) => placements.length,
  );
  const totalPackageCount = packagesPerLayer.reduce(
    (total, value) => total + value,
    0,
  );
  const cuboid = input.package.shape === "cuboid";
  const packageFootprintAreaMm2 = cuboid
    ? input.package.dimensionsMm.length * input.package.dimensionsMm.width
    : null;
  const packageFootprintAreaAcrossLayersMm2 =
    packageFootprintAreaMm2 === null
      ? null
      : packageFootprintAreaMm2 * totalPackageCount;
  const packageVolumeMm3 =
    packageFootprintAreaAcrossLayersMm2 === null
      ? null
      : packageFootprintAreaAcrossLayersMm2 * input.package.dimensionsMm.height;
  const palletBounds = effectivePalletBounds(input.pallet);
  const availableFootprintAreaPerLayerMm2 = palletBounds
    ? rectangleBoundsArea(palletBounds)
    : null;
  const denominatorAvailableFootprintAreaAcrossLayersMm2 =
    availableFootprintAreaPerLayerMm2 === null
      ? null
      : availableFootprintAreaPerLayerMm2 * packageLayerCount;
  const stackTopMm = Math.max(
    0,
    ...input.packageLayers.map(({ zTopMm }) => zTopMm),
    ...input.sheets.map(({ zTopMm }) => zTopMm),
  );
  const packageLayersHeightMm =
    packageLayerCount * input.package.dimensionsMm.height;
  const sheetsHeightMm = input.sheets.reduce(
    (total, sheet) => total + sheet.thicknessMm,
    0,
  );
  const denominatorLoadEnvelopeVolumeMm3 =
    availableFootprintAreaPerLayerMm2 === null
      ? null
      : availableFootprintAreaPerLayerMm2 * stackTopMm;
  const geometryBounds = input.packageLayers
    .map((layer) =>
      boundingRectangleForPlacements(
        layer.placements,
        input.package.dimensionsMm,
      ),
    )
    .filter((bounds): bounds is RectangleBoundsMm => bounds !== null);
  const blockBounds = unionBounds(geometryBounds);
  const blockLengthMm = blockBounds ? rectangleBoundsLength(blockBounds) : 0;
  const blockWidthMm = blockBounds ? rectangleBoundsWidth(blockBounds) : 0;
  const storageHeightMm = input.pallet?.storageEnvelopeMm?.height ?? null;
  const maxGrossWeightKg = input.pallet?.maxGrossKg ?? null;

  const packagePayloadWeightKg =
    input.package.weightKg === null
      ? null
      : input.package.weightKg * totalPackageCount;
  const allSheetWeightsKnown = input.sheets.every(
    ({ weightKg }) => weightKg !== null,
  );
  const sheetPayloadWeightKg = allSheetWeightsKnown
    ? input.sheets.reduce((total, sheet) => total + sheet.weightKg!, 0)
    : null;
  const payloadWeightKg =
    packagePayloadWeightKg === null || sheetPayloadWeightKg === null
      ? null
      : packagePayloadWeightKg + sheetPayloadWeightKg;
  const palletTareWeightKg = input.pallet?.tareKg ?? null;
  const grossWeightKg =
    payloadWeightKg === null || palletTareWeightKg === null
      ? null
      : payloadWeightKg + palletTareWeightKg;
  const weightProvenance = combinedProvenance(
    [
      input.package.weightProvenance,
      allSheetWeightsKnown
        ? derivedArithmetic
        : unknownProvenance(
            "At least one configured base, interlayer, or deck sheet has unknown weight.",
          ),
      palletTareWeightKg === null
        ? unknownProvenance("Pallet tare weight is not configured.")
        : derivedArithmetic,
    ],
    "materialized-stack-weight",
    "Payload and gross weight combine package, physical sheet, and pallet values.",
  );

  const cycleValues = input.packageLayers.map(({ cycleCount }) => cycleCount);
  const cycleProvenances = input.packageLayers.map(
    ({ cycleCountProvenance }) => cycleCountProvenance,
  );
  const allCycleCountsKnown = cycleValues.every(
    (value): value is number => value !== null,
  );
  const totalCycleCount = allCycleCountsKnown
    ? cycleValues.reduce((total, value) => total + value, 0)
    : null;
  const cycleProvenance =
    cycleProvenances.length === 0
      ? derivedArithmetic
      : combinedProvenance(
          cycleProvenances,
          "materialized-pattern-cycle-counts",
          "Total cycles are the sum of each physical layer's source-pattern cycle metric.",
        );

  const areaUtilization = ratioMetric(
    {
      name: "package-footprint-area-across-physical-package-layers",
      value: packageFootprintAreaAcrossLayersMm2,
      unit: "mm2",
    },
    {
      name: "available-pallet-load-footprint-area-across-package-layers",
      value: denominatorAvailableFootprintAreaAcrossLayersMm2,
      unit: "mm2",
    },
    packageFootprintAreaAcrossLayersMm2 === null
      ? unknownProvenance(
          `Package footprint formula is not verified for shape "${input.package.shape}".`,
        )
      : derivedArithmetic,
  );
  const volumeUtilization = ratioMetric(
    {
      name: "physical-package-volume",
      value: packageVolumeMm3,
      unit: "mm3",
    },
    {
      name: "available-pallet-load-footprint-area-times-materialized-load-stack-height",
      value: denominatorLoadEnvelopeVolumeMm3,
      unit: "mm3",
    },
    packageVolumeMm3 === null
      ? unknownProvenance(
          `Package volume formula is not verified for shape "${input.package.shape}".`,
        )
      : derivedArithmetic,
  );
  const heightUtilization = ratioMetric(
    {
      name: "materialized-load-stack-height",
      value: stackTopMm,
      unit: "mm",
    },
    {
      name: "pallet-storage-envelope-height",
      value: storageHeightMm,
      unit: "mm",
    },
    storageHeightMm === null
      ? unknownProvenance("Pallet storage height is not configured.")
      : derivedArithmetic,
  );
  const grossWeightUtilization = ratioMetric(
    {
      name: "materialized-gross-weight",
      value: grossWeightKg,
      unit: "kg",
    },
    {
      name: "pallet-maximum-gross-weight",
      value: maxGrossWeightKg,
      unit: "kg",
    },
    weightProvenance,
  );
  const blockLengthUtilization = ratioMetric(
    {
      name: "materialized-package-block-length",
      value: blockLengthMm,
      unit: "mm",
    },
    {
      name: "available-pallet-load-footprint-length",
      value: palletBounds ? rectangleBoundsLength(palletBounds) : null,
      unit: "mm",
    },
    palletBounds
      ? derivedArithmetic
      : unknownProvenance("Pallet load footprint is not configured."),
  );
  const blockWidthUtilization = ratioMetric(
    {
      name: "materialized-package-block-width",
      value: blockWidthMm,
      unit: "mm",
    },
    {
      name: "available-pallet-load-footprint-width",
      value: palletBounds ? rectangleBoundsWidth(palletBounds) : null,
      unit: "mm",
    },
    palletBounds
      ? derivedArithmetic
      : unknownProvenance("Pallet load footprint is not configured."),
  );

  return {
    area: {
      packageFootprintAreaAcrossLayersMm2,
      denominatorAvailableFootprintAreaAcrossLayersMm2,
      denominatorName:
        "available-pallet-load-footprint-area-across-package-layers",
      utilization: areaUtilization,
    },
    volume: {
      packageVolumeMm3,
      denominatorLoadEnvelopeVolumeMm3,
      denominatorFootprintAreaMm2: availableFootprintAreaPerLayerMm2,
      denominatorLoadStackHeightMm: stackTopMm,
      denominatorName:
        "available-pallet-load-footprint-area-times-materialized-load-stack-height",
      utilization: volumeUtilization,
    },
    height: {
      packageLayersHeightMm,
      sheetsHeightMm,
      loadStackHeightMm: stackTopMm,
      palletHeightMm: input.pallet?.dimensionsMm.height ?? null,
      palletizedStackHeightMm: input.pallet
        ? input.pallet.dimensionsMm.height + stackTopMm
        : null,
      denominatorStorageHeightMm: storageHeightMm,
      denominatorName: "pallet-storage-envelope-height",
      utilization: heightUtilization,
    },
    weight: {
      packagePayloadWeightKg,
      sheetPayloadWeightKg,
      payloadWeightKg,
      denominatorTotalPackageCount: totalPackageCount,
      payloadDenominatorName: "total-package-count",
      averagePayloadWeightPerPackageKg:
        payloadWeightKg === null || totalPackageCount === 0
          ? null
          : payloadWeightKg / totalPackageCount,
      palletTareWeightKg,
      grossWeightKg,
      denominatorMaxGrossWeightKg: maxGrossWeightKg,
      grossDenominatorName: "pallet-maximum-gross-weight",
      grossUtilization: grossWeightUtilization,
      provenance: weightProvenance,
    },
    block: {
      boundsMm: blockBounds,
      lengthMm: blockLengthMm,
      widthMm: blockWidthMm,
      heightMm: stackTopMm,
      denominatorAvailableFootprintLengthMm: palletBounds
        ? rectangleBoundsLength(palletBounds)
        : null,
      denominatorAvailableFootprintWidthMm: palletBounds
        ? rectangleBoundsWidth(palletBounds)
        : null,
      denominatorStorageHeightMm: storageHeightMm,
      lengthDenominatorName: "available-pallet-load-footprint-length",
      widthDenominatorName: "available-pallet-load-footprint-width",
      heightDenominatorName: "pallet-storage-envelope-height",
      lengthUtilization: blockLengthUtilization,
      widthUtilization: blockWidthUtilization,
    },
    packages: {
      perPhysicalLayer: packagesPerLayer,
      totalPackageCount,
      denominatorPhysicalPackageLayerCount: packageLayerCount,
      denominatorName: "physical-package-layer-count",
      averagePackagesPerLayer:
        packageLayerCount === 0 ? null : totalPackageCount / packageLayerCount,
    },
    cycles: {
      perPhysicalLayer: cycleValues,
      totalCycleCount,
      denominatorTotalPackageCount: totalPackageCount,
      denominatorName: "total-package-count",
      packagesPerCycle:
        totalCycleCount === null || totalCycleCount <= 0
          ? null
          : totalPackageCount / totalCycleCount,
      provenance: cycleProvenance,
    },
    utilization: {
      area: areaUtilization,
      volume: volumeUtilization,
      storageHeight: heightUtilization,
      grossWeight: grossWeightUtilization,
      blockLength: blockLengthUtilization,
      blockWidth: blockWidthUtilization,
    },
  };
}
