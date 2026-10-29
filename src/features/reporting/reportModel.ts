import type { Translate } from "~/i18n";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import type { PalletData } from "~/domain/palletTypes";
import type { Project } from "~/domain/project/projectSchema";
import {
  createRobotCycleReport,
  type RobotCycleMaterialization,
  type RobotDiagnostic,
} from "~/domain/robotics";
import type {
  MaterializedStackResult,
  MetricProvenance,
  StackWarning,
} from "~/domain/stack";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type PlanningReportCapture =
  | {
      status: "captured";
      dataUrl: string;
      width: number;
      height: number;
      cameraPreset: "right-top";
      provenance: string;
    }
  | {
      status: "fallback";
      reason: string;
      message: string;
      fallbackLayerIndex: number;
    };

export type PlanningReportMetric = {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  provenance: MetricProvenance;
  numeratorName?: string;
  denominatorName?: string;
};

export type PlanningReportWarning = {
  id: string;
  severity: "warning" | "error";
  source: "stack" | "robotics" | "report";
  code: string;
  message: string;
  provenance: MetricProvenance | null;
};

export type PlanningReportLayerRow = {
  id: string;
  layerNumber: number;
  patternRef: string;
  packageCount: number;
  cycleCount: number | null;
  interlayerBeforeCount: number;
  zBottomMm: number;
  zTopMm: number;
  source: string;
};

export type PlanningReportModel = {
  kind: "planning-report";
  project: {
    id: string;
    projectNumber: string;
    productNumber: string;
    schemaVersion: number;
    updatedAt: number;
    source: string;
  };
  product: {
    shape: string;
    dimensionsMm: { length: number; width: number; height: number };
    weightKg: number | null;
    clearanceMm: number;
    inletOrientation: string;
    multiPickAllowed: boolean;
  };
  pallet: Project["pallet"];
  selectedResources: {
    gripperId: string | null;
    gripperName: string | null;
    stationId: string | null;
    stationName: string | null;
  };
  twoDimensional: {
    deterministic: true;
    renderer: "layer-pattern-svg";
    layers: readonly LayerPatternPreview[];
  };
  fixedView3d: PlanningReportCapture;
  metrics: readonly PlanningReportMetric[];
  warnings: readonly PlanningReportWarning[];
  layerSequence: readonly PlanningReportLayerRow[];
  robotCycles: ReturnType<typeof createRobotCycleReport>;
  provenanceNotes: readonly string[];
};

function reportMetrics(
  stack: MaterializedStackResult | null,
  cycleCount: number,
  t: Translate,
) {
  if (!stack) return [];
  const derivedStackProvenance: MetricProvenance = {
    status: "derived",
    source: "materialized-stack-arithmetic",
    detail: t("reporting.model.derivedDetail"),
  };
  const canonicalCycleProvenance: MetricProvenance = {
    status: "derived",
    source: "canonical-robot-cycle-array",
    detail: t("reporting.model.cycleDetail"),
  };
  const metrics = stack.metrics;
  return [
    {
      id: "packages",
      label: t("reporting.model.packages"),
      value: metrics.packages.totalPackageCount,
      unit: t("reporting.model.packagesUnit"),
      provenance: derivedStackProvenance,
    },
    {
      id: "cycles",
      label: t("reporting.model.cycles"),
      value: cycleCount,
      unit: t("reporting.model.cyclesUnit"),
      provenance: canonicalCycleProvenance,
    },
    {
      id: "load-height",
      label: t("reporting.model.loadHeight"),
      value: metrics.height.loadStackHeightMm,
      unit: "mm",
      provenance: derivedStackProvenance,
      numeratorName: "materialized-load-stack-height",
      denominatorName: metrics.height.denominatorName,
    },
    {
      id: "palletized-height",
      label: t("reporting.model.palletizedHeight"),
      value: metrics.height.palletizedStackHeightMm,
      unit: "mm",
      provenance:
        metrics.height.palletizedStackHeightMm === null
          ? {
              status: "unknown" as const,
              source: "missing-pallet-height",
              detail: t("reporting.model.missingPalletHeightDetail"),
            }
          : derivedStackProvenance,
    },
    {
      id: "area-utilization",
      label: t("reporting.model.areaUtilization"),
      value: metrics.area.utilization.percent,
      unit: "%",
      provenance: metrics.area.utilization.provenance,
      numeratorName: metrics.area.utilization.numerator.name,
      denominatorName: metrics.area.utilization.denominator.name,
    },
    {
      id: "volume-utilization",
      label: t("reporting.model.volumeUtilization"),
      value: metrics.volume.utilization.percent,
      unit: "%",
      provenance: metrics.volume.utilization.provenance,
      numeratorName: metrics.volume.utilization.numerator.name,
      denominatorName: metrics.volume.utilization.denominator.name,
    },
    {
      id: "gross-weight",
      label: t("reporting.model.grossWeight"),
      value: metrics.weight.grossWeightKg,
      unit: "kg",
      provenance: metrics.weight.provenance,
      numeratorName: metrics.weight.grossUtilization.numerator.name,
      denominatorName: metrics.weight.grossUtilization.denominator.name,
    },
    {
      id: "block-length",
      label: t("reporting.model.blockLength"),
      value: metrics.block.lengthMm,
      unit: "mm",
      provenance: metrics.block.lengthUtilization.provenance,
      denominatorName: metrics.block.lengthDenominatorName,
    },
    {
      id: "block-width",
      label: t("reporting.model.blockWidth"),
      value: metrics.block.widthMm,
      unit: "mm",
      provenance: metrics.block.widthUtilization.provenance,
      denominatorName: metrics.block.widthDenominatorName,
    },
  ] satisfies PlanningReportMetric[];
}

function stackReportWarning(warning: StackWarning): PlanningReportWarning {
  return {
    id: `stack:${warning.id}`,
    severity: warning.severity,
    source: "stack",
    code: warning.code,
    message: warning.message,
    provenance: warning.provenance ?? null,
  };
}

function robotReportWarning(
  diagnostic: RobotDiagnostic,
  index: number,
): PlanningReportWarning {
  return {
    id: `robotics:${diagnostic.code}:${diagnostic.cycleId ?? "none"}:${index}`,
    severity: diagnostic.severity === "error" ? "error" : "warning",
    source: "robotics",
    code: diagnostic.code,
    message: diagnostic.message,
    provenance: null,
  };
}

function reportWarnings(
  materialization: RobotCycleMaterialization,
  t: Translate,
): PlanningReportWarning[] {
  const warnings = [
    ...(materialization.stack?.warnings.map(stackReportWarning) ?? []),
    ...materialization.diagnostics.map(robotReportWarning),
  ];
  if (
    materialization.cycles.some(
      ({ provenance }) => provenance.signConventionStatus === "unverified",
    )
  ) {
    warnings.push({
      id: "report:unverified-sign-convention",
      severity: "warning",
      source: "report",
      code: "unverified-sign-convention",
      message: t("reporting.model.signMessage"),
      provenance: {
        status: "unverified",
        source: "robot-cycle-provenance",
        detail: t("reporting.model.signDetail"),
      },
    });
  }
  if (
    materialization.cycles.some(
      ({ legacyUnknownFields }) => legacyUnknownFields,
    )
  ) {
    warnings.push({
      id: "report:unknown-legacy-fields",
      severity: "warning",
      source: "report",
      code: "unknown-legacy-fields",
      message: t("reporting.model.legacyMessage"),
      provenance: {
        status: "unverified",
        source: "retained-legacy-rob-fields",
        detail: t("reporting.model.legacyDetail"),
      },
    });
  }
  return [
    ...new Map(warnings.map((warning) => [warning.id, warning])).values(),
  ];
}

function layerSequence(
  materialization: RobotCycleMaterialization,
): PlanningReportLayerRow[] {
  const stack = materialization.stack;
  if (!stack) return [];
  const cycleCountByLayer = new Map<string, number>();
  for (const cycle of materialization.cycles) {
    cycleCountByLayer.set(
      cycle.physicalLayerId,
      (cycleCountByLayer.get(cycle.physicalLayerId) ?? 0) + 1,
    );
  }
  return stack.packageLayers.map((layer) => ({
    id: layer.id,
    layerNumber: layer.packageLayerIndex + 1,
    patternRef: layer.patternRef,
    packageCount: layer.placements.length,
    cycleCount: cycleCountByLayer.get(layer.id) ?? 0,
    interlayerBeforeCount: layer.interlayerBeforeIds.length,
    zBottomMm: layer.zBottomMm,
    zTopMm: layer.zTopMm,
    source: layer.layerProvenance.kind,
  }));
}

function layerPreviews(previewData: PalletData | null): LayerPatternPreview[] {
  if (!previewData) return [];
  return previewData.layers.map((_, index) =>
    palletLayerToPatternPreview(previewData, index),
  );
}

export function createPlanningReportModel(input: {
  project: Project;
  materialization: RobotCycleMaterialization;
  previewData: PalletData | null;
  capture?: PlanningReportCapture;
  t: Translate;
}): PlanningReportModel {
  const { project, materialization, previewData, t } = input;
  const robotCycles = createRobotCycleReport(materialization);
  const selectedGripper = materialization.gripper;
  const selectedStation = materialization.station;
  const fallbackLayerIndex = Math.max(0, (previewData?.layer_count ?? 1) - 1);
  return {
    kind: "planning-report",
    project: {
      id: project.id,
      projectNumber: project.projectNumber,
      productNumber: project.productNumber,
      schemaVersion: project.schemaVersion,
      updatedAt: project.updatedAt,
      source:
        project.source.kind === "rob-import"
          ? t("reporting.header.sourceRob", { name: project.source.fileName })
          : t("reporting.header.sourceNative"),
    },
    product: {
      shape: project.package.shape,
      dimensionsMm: { ...project.package.dimensionsMm },
      weightKg: project.package.weightKg,
      clearanceMm: project.package.clearanceMm,
      inletOrientation: project.package.inletOrientation,
      multiPickAllowed: project.package.multiPickAllowed,
    },
    pallet: project.pallet,
    selectedResources: {
      gripperId: selectedGripper?.id ?? project.selectedGripperId,
      gripperName: selectedGripper?.name ?? null,
      stationId: selectedStation?.id ?? project.selectedPalletStationId,
      stationName: selectedStation?.name ?? null,
    },
    twoDimensional: {
      deterministic: true,
      renderer: "layer-pattern-svg",
      layers: layerPreviews(previewData),
    },
    fixedView3d: input.capture ?? {
      status: "fallback",
      reason: "capture-not-attempted",
      message: t("reporting.capture.notAttempted"),
      fallbackLayerIndex,
    },
    metrics: reportMetrics(materialization.stack, robotCycles.cycleCount, t),
    warnings: reportWarnings(materialization, t),
    layerSequence: layerSequence(materialization),
    robotCycles,
    provenanceNotes: [
      t("reporting.model.note.svg"),
      t("reporting.model.note.capture"),
      t("reporting.model.note.cycles"),
      t("reporting.model.note.unknown"),
    ],
  };
}
