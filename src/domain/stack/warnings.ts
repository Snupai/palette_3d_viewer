import {
  createEffectivePalletEnvelope,
  placementWithinBounds,
  symmetricSideAllowance,
} from "~/domain/geometry";
import type {
  MaterializedPackageLayer,
  MaterializedSheet,
  MetricProvenance,
  StackMetrics,
  StackPackageContext,
  StackPalletContext,
  StackResourceContext,
  StackWarning,
} from "~/domain/stack/types";

export type CollectStackWarningsInput = {
  package: StackPackageContext;
  pallet: StackPalletContext | null;
  resources: StackResourceContext;
  packageLayers: readonly MaterializedPackageLayer[];
  sheets: readonly MaterializedSheet[];
  metrics: StackMetrics;
  existingWarnings?: readonly StackWarning[];
};

function warningId(code: StackWarning["code"], suffix: string): string {
  return `${code}:${suffix}`;
}

function provenanceWarning(
  metricName: string,
  provenance: MetricProvenance,
): StackWarning | null {
  if (provenance.status !== "unknown" && provenance.status !== "unverified") {
    return null;
  }
  return {
    id: warningId(
      provenance.status === "unknown"
        ? "metric-provenance-unknown"
        : "metric-provenance-unverified",
      metricName,
    ),
    code:
      provenance.status === "unknown"
        ? "metric-provenance-unknown"
        : "metric-provenance-unverified",
    severity: "warning",
    scope: "metric",
    metricName,
    provenance,
    message: `${metricName} has ${provenance.status} provenance: ${provenance.detail}`,
  };
}

export function collectStackWarnings(
  input: CollectStackWarningsInput,
): StackWarning[] {
  const warnings = [...(input.existingWarnings ?? [])];
  const hasPhysicalPackages = input.packageLayers.length > 0;

  if (!input.pallet) {
    warnings.push({
      id: warningId("missing-resource", "pallet"),
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "pallet",
      resourceId: null,
      message:
        "No pallet is selected; footprint, storage envelope, tare, and gross limits cannot be fully evaluated.",
    });
  }
  if (hasPhysicalPackages && input.resources.selectedGripperId === null) {
    warnings.push({
      id: warningId("missing-resource", "gripper"),
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "gripper",
      resourceId: null,
      message: "No gripper is selected for the materialized robot cycles.",
    });
  }
  if (hasPhysicalPackages && input.resources.selectedPalletStationId === null) {
    warnings.push({
      id: warningId("missing-resource", "pallet-station"),
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "pallet-station",
      resourceId: null,
      message: "No pallet station is selected for robotics validation.",
    });
  }
  if (hasPhysicalPackages && input.package.weightKg === null) {
    warnings.push({
      id: warningId("missing-resource", "package-weight"),
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "package-weight",
      resourceId: null,
      message:
        "Package weight is missing; payload and gross weight are unknown.",
    });
  }
  if (input.pallet && input.pallet.tareKg === null) {
    warnings.push({
      id: warningId("missing-resource", "pallet-tare"),
      code: "missing-resource",
      severity: "warning",
      scope: "resource",
      resourceKind: "pallet-tare",
      resourceId: input.pallet.id,
      message: "Pallet tare weight is missing; gross weight is unknown.",
    });
  }

  if (input.resources.availableMaterialResourceIds !== null) {
    const available = new Set(input.resources.availableMaterialResourceIds);
    for (const sheet of input.sheets) {
      if (sheet.resourceId !== null && !available.has(sheet.resourceId)) {
        warnings.push({
          id: warningId("missing-resource", `material:${sheet.id}`),
          code: "missing-resource",
          severity: "warning",
          scope: "resource",
          resourceKind: "material",
          resourceId: sheet.resourceId,
          message: `Sheet ${sheet.id} references missing material resource "${sheet.resourceId}".`,
        });
      }
    }
  }

  if (input.pallet) {
    const availableBounds = createEffectivePalletEnvelope(
      input.pallet.dimensionsMm,
      symmetricSideAllowance(input.pallet.allowedOverhangMm),
    );
    for (const layer of input.packageLayers) {
      if (
        layer.placements.some(
          (placement) =>
            !placementWithinBounds(
              placement,
              input.package.dimensionsMm,
              availableBounds,
            ),
        )
      ) {
        warnings.push({
          id: warningId("footprint-exceeded", layer.id),
          code: "footprint-exceeded",
          severity: "warning",
          scope: "layer",
          layerId: layer.id,
          message: `Physical layer "${layer.id}" extends beyond the allowed pallet load footprint.`,
        });
      }
    }

    const storage = input.pallet.storageEnvelopeMm;
    if (storage) {
      if (input.metrics.block.lengthMm > storage.length) {
        warnings.push({
          id: warningId("storage-envelope-exceeded", "length"),
          code: "storage-envelope-exceeded",
          severity: "warning",
          scope: "stack",
          axis: "length",
          actual: { value: input.metrics.block.lengthMm, unit: "mm" },
          limit: { value: storage.length, unit: "mm" },
          message: `Block length ${input.metrics.block.lengthMm} mm exceeds storage envelope length ${storage.length} mm.`,
        });
      }
      if (input.metrics.block.widthMm > storage.width) {
        warnings.push({
          id: warningId("storage-envelope-exceeded", "width"),
          code: "storage-envelope-exceeded",
          severity: "warning",
          scope: "stack",
          axis: "width",
          actual: { value: input.metrics.block.widthMm, unit: "mm" },
          limit: { value: storage.width, unit: "mm" },
          message: `Block width ${input.metrics.block.widthMm} mm exceeds storage envelope width ${storage.width} mm.`,
        });
      }
      if (input.metrics.height.loadStackHeightMm > storage.height) {
        warnings.push({
          id: warningId("height-exceeded", "load-stack"),
          code: "height-exceeded",
          severity: "warning",
          scope: "stack",
          axis: "height",
          actual: {
            value: input.metrics.height.loadStackHeightMm,
            unit: "mm",
          },
          limit: { value: storage.height, unit: "mm" },
          message: `Load stack height ${input.metrics.height.loadStackHeightMm} mm exceeds storage height ${storage.height} mm.`,
        });
      }
    }

    if (
      input.metrics.weight.grossWeightKg !== null &&
      input.pallet.maxGrossKg !== null &&
      input.metrics.weight.grossWeightKg > input.pallet.maxGrossKg
    ) {
      warnings.push({
        id: warningId("gross-weight-exceeded", "gross"),
        code: "gross-weight-exceeded",
        severity: "warning",
        scope: "stack",
        actual: { value: input.metrics.weight.grossWeightKg, unit: "kg" },
        limit: { value: input.pallet.maxGrossKg, unit: "kg" },
        message: `Gross weight ${input.metrics.weight.grossWeightKg} kg exceeds pallet limit ${input.pallet.maxGrossKg} kg.`,
      });
    }
  }

  const metricProvenances: Array<[string, MetricProvenance]> = [
    ["area utilization", input.metrics.area.utilization.provenance],
    ["volume utilization", input.metrics.volume.utilization.provenance],
    ["storage height utilization", input.metrics.height.utilization.provenance],
    ["gross weight", input.metrics.weight.provenance],
    ["cycle count", input.metrics.cycles.provenance],
  ];
  for (const [metricName, provenance] of metricProvenances) {
    const warning = provenanceWarning(metricName, provenance);
    if (warning) warnings.push(warning);
  }

  const unique = new Map(warnings.map((warning) => [warning.id, warning]));
  return [...unique.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}
