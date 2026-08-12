import type { LayerSymmetry, RectangleBoundsMm } from "~/domain/geometry";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import type { GeneratorProvenance } from "~/domain/solver/types";
import type { Rotation, Side } from "~/domain/palletTypes";

export type MetricProvenanceStatus =
  | "verified"
  | "derived"
  | "unverified"
  | "unknown";

export type MetricProvenance = {
  status: MetricProvenanceStatus;
  source: string;
  detail: string;
};

export type StackPatternPlacement = {
  sourcePlacementId: string;
  sequence: number;
  positionMm: { x: number; y: number };
  rotation: Rotation;
  gripId: string | null;
  labelSide: CandidateLabelSide | null;
};

export type StackPatternGrip = {
  sourceGripId: string;
  /** Stable display number, independent from sequence/order. */
  groupNumber: number;
  sequence: number;
  pickX: number;
  pickY: number;
  pickRotation: Rotation;
  x: number;
  y: number;
  rotation: Rotation;
  numPackages: number;
  dx: number;
  dy: number;
};

export type StackPatternCycle = {
  sourceCycleId: string;
  sequence: number;
  gripId: string | null;
  placementIds: readonly string[];
  gripperId: string | null;
  pickPose: {
    x: number;
    y: number;
    z: number | null;
    rotation: Rotation;
  };
  placePose: {
    x: number;
    y: number;
    z: number | null;
    rotation: Rotation;
  };
  labelOffset: { x: number; y: number };
};

export type ProjectPatternProvenance = {
  kind: "project-pattern";
  projectSchemaVersion: number;
  projectId: string;
  solutionId: string;
  solutionOrigin: "imported" | "calculated" | "manual";
  patternId: string;
};

export type SolverCandidatePatternProvenance = {
  kind: "solver-candidate";
  candidateId: string;
  geometryId: string;
  identityFingerprint: string;
  geometryFingerprint: string;
  rank: number;
  generators: readonly GeneratorProvenance[];
};

export type StackPatternProvenance =
  | ProjectPatternProvenance
  | SolverCandidatePatternProvenance;

export type StackPatternOrderDependency = {
  beforeGripId: string;
  afterGripId: string;
};

export type StackPatternLabelOrientationPolicy = {
  unrotatedPackageLabelSide: Side;
  allowedRotations: readonly Rotation[];
};

export type StackPatternGeneratedGripPolicy = {
  maxReferenceGapMm: number;
};

export type StackPattern = {
  /** Stable reference used by editable stack layers. */
  ref: string;
  name: string;
  placements: readonly StackPatternPlacement[];
  grips: readonly StackPatternGrip[];
  /** Source grip ids in editable execution order. */
  groupOrder: readonly string[];
  orderDependencies: readonly StackPatternOrderDependency[];
  cycles: readonly StackPatternCycle[];
  cycleCount: number | null;
  cycleCountProvenance: MetricProvenance;
  transformFrameMm: RectangleBoundsMm | null;
  transformFrameProvenance: MetricProvenance;
  labelOrientationPolicy?: StackPatternLabelOrientationPolicy | null;
  generatedGripPolicy?: StackPatternGeneratedGripPolicy | null;
  provenance: StackPatternProvenance;
};

export const STACK_COMPOSITION_MODES = [
  "tower",
  "longitudinal-mirror",
  "transverse-mirror",
  "rotation",
] as const;

export type StackCompositionMode = (typeof STACK_COMPOSITION_MODES)[number];

export type StackLayerTransform = LayerSymmetry;

export type StackLayerProvenance =
  | {
      kind: "composition";
      mode: StackCompositionMode;
      role: "primary" | "secondary";
      sourcePatternRef: string;
    }
  | {
      kind: "project-stack";
      projectId: string;
      solutionId: string;
      sourceLayerId: string;
    }
  | {
      kind: "manual";
      reason: string;
    }
  | {
      kind: "special-top";
      replacedPatternRef: string;
      sourcePatternRef: string;
    };

export type EditableStackLayer = {
  id: string;
  patternRef: string;
  transform: StackLayerTransform;
  provenance: StackLayerProvenance;
};

export type SpecialTopLayer =
  | { enabled: false }
  | {
      enabled: true;
      patternRef: string;
      transform: StackLayerTransform;
    };

export type StackSheetSpecification = {
  thicknessMm: number;
  quantity?: number;
  weightKg?: number | null;
  resourceId?: string | null;
  provenance?: MetricProvenance;
};

export type StackInterlayerRules = {
  baseSheet?: StackSheetSpecification | null;
  deckSheet?: StackSheetSpecification | null;
} & (
  | {
      mode: "all";
      betweenLayers: StackSheetSpecification;
      overridesBeforeLayer?: Readonly<
        Record<string, StackSheetSpecification | undefined>
      >;
    }
  | {
      mode: "individual";
      beforeLayer: Readonly<
        Record<string, StackSheetSpecification | undefined>
      >;
    }
);

export type StackPackageContext = {
  shape: string;
  dimensionsMm: { length: number; width: number; height: number };
  weightKg: number | null;
  weightProvenance: MetricProvenance;
  inletOrientation: "lengthwise" | "crosswise";
};

export type StackPalletContext = {
  id: string;
  dimensionsMm: { length: number; width: number; height: number };
  allowedOverhangMm: { length: number; width: number };
  storageEnvelopeMm: {
    length: number;
    width: number;
    height: number;
  } | null;
  tareKg: number | null;
  maxGrossKg: number | null;
};

export type StackResourceContext = {
  selectedGripperId: string | null;
  selectedPalletStationId: string | null;
  /** Null means no material catalog was supplied, not that every material is missing. */
  availableMaterialResourceIds: readonly string[] | null;
};

export type StackMaterializationInput = {
  package: StackPackageContext;
  pallet: StackPalletContext | null;
  resources: StackResourceContext;
  patterns: readonly StackPattern[];
  layers: readonly EditableStackLayer[];
  interlayers: StackInterlayerRules;
  specialTopLayer?: SpecialTopLayer;
};

export type MaterializedStackPlacement = StackPatternPlacement & {
  id: string;
  physicalLayerId: string;
};

export type MaterializedStackGrip = Omit<StackPatternGrip, "sourceGripId"> & {
  id: string;
  sourceGripId: string;
  physicalLayerId: string;
};

export type MaterializedRobotCycle = Omit<
  StackPatternCycle,
  "sourceCycleId" | "placementIds"
> & {
  id: string;
  sourceCycleId: string;
  physicalLayerId: string;
  physicalLayerIndex: number;
  placementIds: readonly string[];
};

export type MaterializedTransformTrace = {
  transform: StackLayerTransform;
  frameMm: RectangleBoundsMm | null;
  frameProvenance: MetricProvenance;
};

export type MaterializedPackageLayer = {
  kind: "package-layer";
  id: string;
  physicalIndex: number;
  packageLayerIndex: number;
  patternRef: string;
  patternResolution: "resolved" | "missing";
  transform: StackLayerTransform;
  transformTrace: MaterializedTransformTrace;
  patternProvenance: StackPatternProvenance | null;
  layerProvenance: StackLayerProvenance;
  zBottomMm: number;
  zTopMm: number;
  heightMm: number;
  placements: readonly MaterializedStackPlacement[];
  grips: readonly MaterializedStackGrip[];
  groupOrder: readonly string[];
  orderDependencies: readonly StackPatternOrderDependency[];
  robotCycles: readonly MaterializedRobotCycle[];
  cycleCount: number | null;
  cycleCountProvenance: MetricProvenance;
  interlayerBeforeIds: readonly string[];
};

export type MaterializedSheetRole =
  | "base-sheet"
  | "between-layers"
  | "deck-sheet";

export type MaterializedSheetRule =
  | "base-sheet"
  | "deck-sheet"
  | "all-between-layers"
  | "all-between-layers-override"
  | "individual-between-layers";

export type MaterializedSheet = {
  kind: "sheet";
  id: string;
  physicalIndex: number;
  role: MaterializedSheetRole;
  rule: MaterializedSheetRule;
  beforeLayerId: string | null;
  afterLayerId: string | null;
  sheetIndex: number;
  thicknessMm: number;
  weightKg: number | null;
  resourceId: string | null;
  provenance: MetricProvenance;
  zBottomMm: number;
  zTopMm: number;
};

export type MaterializedPhysicalItem =
  | MaterializedPackageLayer
  | MaterializedSheet;

export type NamedMetricOperand = {
  name: string;
  value: number | null;
  unit: "mm" | "mm2" | "mm3" | "kg" | "packages" | "layers" | "cycles";
};

export type NamedUtilizationMetric = {
  numerator: NamedMetricOperand;
  denominator: NamedMetricOperand;
  ratio: number | null;
  percent: number | null;
  provenance: MetricProvenance;
};

export type StackMetrics = {
  area: {
    packageFootprintAreaAcrossLayersMm2: number | null;
    denominatorAvailableFootprintAreaAcrossLayersMm2: number | null;
    denominatorName: "available-pallet-load-footprint-area-across-package-layers";
    utilization: NamedUtilizationMetric;
  };
  volume: {
    packageVolumeMm3: number | null;
    denominatorLoadEnvelopeVolumeMm3: number | null;
    denominatorFootprintAreaMm2: number | null;
    denominatorLoadStackHeightMm: number;
    denominatorName: "available-pallet-load-footprint-area-times-materialized-load-stack-height";
    utilization: NamedUtilizationMetric;
  };
  height: {
    packageLayersHeightMm: number;
    sheetsHeightMm: number;
    loadStackHeightMm: number;
    palletHeightMm: number | null;
    palletizedStackHeightMm: number | null;
    denominatorStorageHeightMm: number | null;
    denominatorName: "pallet-storage-envelope-height";
    utilization: NamedUtilizationMetric;
  };
  weight: {
    packagePayloadWeightKg: number | null;
    sheetPayloadWeightKg: number | null;
    payloadWeightKg: number | null;
    denominatorTotalPackageCount: number;
    payloadDenominatorName: "total-package-count";
    averagePayloadWeightPerPackageKg: number | null;
    palletTareWeightKg: number | null;
    grossWeightKg: number | null;
    denominatorMaxGrossWeightKg: number | null;
    grossDenominatorName: "pallet-maximum-gross-weight";
    grossUtilization: NamedUtilizationMetric;
    provenance: MetricProvenance;
  };
  block: {
    boundsMm: RectangleBoundsMm | null;
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    denominatorAvailableFootprintLengthMm: number | null;
    denominatorAvailableFootprintWidthMm: number | null;
    denominatorStorageHeightMm: number | null;
    lengthDenominatorName: "available-pallet-load-footprint-length";
    widthDenominatorName: "available-pallet-load-footprint-width";
    heightDenominatorName: "pallet-storage-envelope-height";
    lengthUtilization: NamedUtilizationMetric;
    widthUtilization: NamedUtilizationMetric;
  };
  packages: {
    perPhysicalLayer: readonly number[];
    totalPackageCount: number;
    denominatorPhysicalPackageLayerCount: number;
    denominatorName: "physical-package-layer-count";
    averagePackagesPerLayer: number | null;
  };
  cycles: {
    perPhysicalLayer: readonly (number | null)[];
    totalCycleCount: number | null;
    denominatorTotalPackageCount: number;
    denominatorName: "total-package-count";
    packagesPerCycle: number | null;
    provenance: MetricProvenance;
  };
  utilization: {
    area: NamedUtilizationMetric;
    volume: NamedUtilizationMetric;
    storageHeight: NamedUtilizationMetric;
    grossWeight: NamedUtilizationMetric;
    blockLength: NamedUtilizationMetric;
    blockWidth: NamedUtilizationMetric;
  };
};

export type StackWarningCode =
  | "storage-envelope-exceeded"
  | "footprint-exceeded"
  | "height-exceeded"
  | "gross-weight-exceeded"
  | "missing-resource"
  | "metric-provenance-unknown"
  | "metric-provenance-unverified"
  | "transform-frame-fallback"
  | "invalid-stack-input";

export type StackWarning = {
  id: string;
  code: StackWarningCode;
  severity: "warning" | "error";
  scope: "stack" | "layer" | "resource" | "metric";
  message: string;
  layerId?: string;
  axis?: "length" | "width" | "height";
  resourceKind?:
    | "pallet"
    | "gripper"
    | "pallet-station"
    | "pattern"
    | "material"
    | "package-weight"
    | "pallet-tare";
  resourceId?: string | null;
  metricName?: string;
  actual?: { value: number; unit: "mm" | "kg" };
  limit?: { value: number; unit: "mm" | "kg" };
  provenance?: MetricProvenance;
};

export type MaterializedStackResult = {
  package: StackPackageContext;
  pallet: StackPalletContext | null;
  resources: StackResourceContext;
  patterns: readonly StackPattern[];
  sourceLayers: readonly EditableStackLayer[];
  resolvedLayers: readonly EditableStackLayer[];
  interlayerRules: StackInterlayerRules;
  specialTopLayer: SpecialTopLayer;
  physicalSequence: readonly MaterializedPhysicalItem[];
  packageLayers: readonly MaterializedPackageLayer[];
  sheets: readonly MaterializedSheet[];
  robotCycles: readonly MaterializedRobotCycle[];
  metrics: StackMetrics;
  warnings: readonly StackWarning[];
};

export type StackCapacityStatus =
  | "calculated"
  | "empty-sequence"
  | "impossible"
  | "invalid-input";

export type StackCapacityResult = {
  status: StackCapacityStatus;
  capacityLayers: number;
  requestedLayerCount: number;
  heightAtCapacityMm: number;
  requiredHeightForNextLayerMm: number | null;
  baseSheetHeightMm: number;
  deckSheetHeightMm: number;
  message: string;
};

export type UniformStackCapacityInput = {
  storageHeightMm: number;
  packageHeightMm: number;
  betweenLayerThicknessMm?: number;
  baseSheetThicknessMm?: number;
  deckSheetThicknessMm?: number;
};
