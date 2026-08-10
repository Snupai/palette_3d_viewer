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

const derivedStackProvenance: MetricProvenance = {
  status: "derived",
  source: "materialized-stack-arithmetic",
  detail: "Calculated from the exact materialized physical stack sequence.",
};

const canonicalCycleProvenance: MetricProvenance = {
  status: "derived",
  source: "canonical-robot-cycle-array",
  detail:
    "Counted from the same canonical RobotCycle array consumed by simulation and project-derived export.",
};

function reportMetrics(
  stack: MaterializedStackResult | null,
  cycleCount: number,
) {
  if (!stack) return [];
  const metrics = stack.metrics;
  return [
    {
      id: "packages",
      label: "Packages",
      value: metrics.packages.totalPackageCount,
      unit: "packages",
      provenance: derivedStackProvenance,
    },
    {
      id: "cycles",
      label: "Robot cycles",
      value: cycleCount,
      unit: "cycles",
      provenance: canonicalCycleProvenance,
    },
    {
      id: "load-height",
      label: "Load stack height",
      value: metrics.height.loadStackHeightMm,
      unit: "mm",
      provenance: derivedStackProvenance,
      numeratorName: "materialized-load-stack-height",
      denominatorName: metrics.height.denominatorName,
    },
    {
      id: "palletized-height",
      label: "Palletized height",
      value: metrics.height.palletizedStackHeightMm,
      unit: "mm",
      provenance:
        metrics.height.palletizedStackHeightMm === null
          ? {
              status: "unknown" as const,
              source: "missing-pallet-height",
              detail: "A pallet height is required for palletized height.",
            }
          : derivedStackProvenance,
    },
    {
      id: "area-utilization",
      label: "Area utilization",
      value: metrics.area.utilization.percent,
      unit: "%",
      provenance: metrics.area.utilization.provenance,
      numeratorName: metrics.area.utilization.numerator.name,
      denominatorName: metrics.area.utilization.denominator.name,
    },
    {
      id: "volume-utilization",
      label: "Volume utilization",
      value: metrics.volume.utilization.percent,
      unit: "%",
      provenance: metrics.volume.utilization.provenance,
      numeratorName: metrics.volume.utilization.numerator.name,
      denominatorName: metrics.volume.utilization.denominator.name,
    },
    {
      id: "gross-weight",
      label: "Gross weight",
      value: metrics.weight.grossWeightKg,
      unit: "kg",
      provenance: metrics.weight.provenance,
      numeratorName: metrics.weight.grossUtilization.numerator.name,
      denominatorName: metrics.weight.grossUtilization.denominator.name,
    },
    {
      id: "block-length",
      label: "Block length",
      value: metrics.block.lengthMm,
      unit: "mm",
      provenance: metrics.block.lengthUtilization.provenance,
      denominatorName: metrics.block.lengthDenominatorName,
    },
    {
      id: "block-width",
      label: "Block width",
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
      message:
        "At least one robot cycle retains an unverified coordinate/sign convention; the report does not claim external robot compatibility.",
      provenance: {
        status: "unverified",
        source: "robot-cycle-provenance",
        detail: "Cycle signConventionStatus is unverified.",
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
      message:
        "Imported final .rob fields are retained, but their external semantics remain explicitly unknown/unverified.",
      provenance: {
        status: "unverified",
        source: "retained-legacy-rob-fields",
        detail:
          "Repository dx/dy interpretation is not an external format claim.",
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
}): PlanningReportModel {
  const { project, materialization, previewData } = input;
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
          ? `retained .rob import: ${project.source.fileName}`
          : "native project",
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
      message:
        "A fixed right-top 3D frame has not been captured; the deterministic 2D SVG remains the report fallback.",
      fallbackLayerIndex,
    },
    metrics: reportMetrics(materialization.stack, robotCycles.cycleCount),
    warnings: reportWarnings(materialization),
    layerSequence: layerSequence(materialization),
    robotCycles,
    provenanceNotes: [
      "2D drawings are deterministic SVG projections from the report PalletData adapter.",
      "3D images use the viewer's fixed right-top preset when canvas capture is available; otherwise the 2D SVG fallback is printed.",
      "Robot cycles are the canonical materialized RobotCycle rows shared with simulation and project-derived export.",
      "Unknown formulas, proprietary fields, sign conventions, and kinematics remain labelled unknown, internal, or unverified.",
    ],
  };
}
