import { applySpecialTopLayer } from "~/domain/stack/composition";
import {
  resolveBaseSheet,
  resolveBetweenLayerSheets,
  resolveDeckSheet,
  type NormalizedSheetSpecification,
} from "~/domain/stack/interlayers";
import { calculateStackMetrics } from "~/domain/stack/metrics";
import { transformStackPattern } from "~/domain/stack/patternTransforms";
import type {
  MaterializedPackageLayer,
  MaterializedPhysicalItem,
  MaterializedRobotCycle,
  MaterializedSheet,
  MaterializedSheetRole,
  MaterializedSheetRule,
  MaterializedStackGrip,
  MaterializedStackPlacement,
  MaterializedStackResult,
  MetricProvenance,
  SpecialTopLayer,
  StackMaterializationInput,
  StackPattern,
  StackWarning,
} from "~/domain/stack/types";
import { collectStackWarnings } from "~/domain/stack/warnings";

const missingCycleProvenance: MetricProvenance = {
  status: "unknown",
  source: "missing-stack-pattern",
  detail: "The physical layer's pattern could not be resolved.",
};

function invalidInputWarning(id: string, message: string): StackWarning {
  return {
    id: `invalid-stack-input:${id}`,
    code: "invalid-stack-input",
    severity: "error",
    scope: "stack",
    message,
  };
}

function assertPackageDimensions(input: StackMaterializationInput): void {
  for (const [name, value] of Object.entries(input.package.dimensionsMm)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `package.dimensionsMm.${name} must be positive and finite.`,
      );
    }
  }
  if (
    input.package.weightKg !== null &&
    (!Number.isFinite(input.package.weightKg) || input.package.weightKg < 0)
  ) {
    throw new Error("package.weightKg must be null or a non-negative number.");
  }
}

function copyPatternIdentity(pattern: StackPattern) {
  return transformStackPattern(
    pattern,
    "identity",
    pattern.transformFrameMm
      ? {
          length: pattern.transformFrameMm.maxX - pattern.transformFrameMm.minX,
          width: pattern.transformFrameMm.maxY - pattern.transformFrameMm.minY,
        }
      : { length: 1, width: 1 },
  );
}

export function materializeStack(
  input: StackMaterializationInput,
): MaterializedStackResult {
  assertPackageDimensions(input);
  const specialTopLayer: SpecialTopLayer = input.specialTopLayer ?? {
    enabled: false,
  };
  const resolvedLayers = applySpecialTopLayer(input.layers, specialTopLayer);
  const warnings: StackWarning[] = [];
  const layerIds = new Set<string>();
  for (const layer of resolvedLayers) {
    if (layerIds.has(layer.id)) {
      throw new Error(`Duplicate editable stack layer id "${layer.id}".`);
    }
    layerIds.add(layer.id);
  }

  const patternsByRef = new Map<string, StackPattern>();
  for (const pattern of input.patterns) {
    if (patternsByRef.has(pattern.ref)) {
      warnings.push(
        invalidInputWarning(
          `duplicate-pattern:${pattern.ref}`,
          `Duplicate stack pattern reference "${pattern.ref}"; the first definition is used.`,
        ),
      );
      continue;
    }
    patternsByRef.set(pattern.ref, pattern);
  }

  const physicalSequence: MaterializedPhysicalItem[] = [];
  const packageLayers: MaterializedPackageLayer[] = [];
  const sheets: MaterializedSheet[] = [];
  let zMm = 0;

  const appendSheetGroup = (
    specification: NormalizedSheetSpecification,
    role: MaterializedSheetRole,
    rule: MaterializedSheetRule,
    beforeLayerId: string | null,
    afterLayerId: string | null,
  ): MaterializedSheet[] => {
    const appended: MaterializedSheet[] = [];
    const boundary = beforeLayerId ?? afterLayerId ?? "empty-stack";
    for (
      let sheetIndex = 0;
      sheetIndex < specification.quantity;
      sheetIndex += 1
    ) {
      const sheet: MaterializedSheet = {
        kind: "sheet",
        id: `${role}:${boundary}:${sheetIndex + 1}`,
        physicalIndex: physicalSequence.length,
        role,
        rule,
        beforeLayerId,
        afterLayerId,
        sheetIndex,
        thicknessMm: specification.thicknessMm,
        weightKg: specification.weightKg,
        resourceId: specification.resourceId,
        provenance: specification.provenance,
        zBottomMm: zMm,
        zTopMm: zMm + specification.thicknessMm,
      };
      zMm = sheet.zTopMm;
      physicalSequence.push(sheet);
      sheets.push(sheet);
      appended.push(sheet);
    }
    return appended;
  };

  const appendConfiguredSheet = (
    resolve: () => NormalizedSheetSpecification | null,
    role: Extract<MaterializedSheetRole, "base-sheet" | "deck-sheet">,
    beforeLayerId: string | null,
    afterLayerId: string | null,
  ): MaterializedSheet[] => {
    try {
      const specification = resolve();
      return specification
        ? appendSheetGroup(
            specification,
            role,
            role,
            beforeLayerId,
            afterLayerId,
          )
        : [];
    } catch (cause) {
      warnings.push(
        invalidInputWarning(
          role,
          cause instanceof Error ? cause.message : `Invalid ${role} rule.`,
        ),
      );
      return [];
    }
  };

  let sheetsBeforeNextLayer = appendConfiguredSheet(
    () => resolveBaseSheet(input.interlayers),
    "base-sheet",
    resolvedLayers[0]?.id ?? null,
    null,
  );

  for (
    let layerIndex = 0;
    layerIndex < resolvedLayers.length;
    layerIndex += 1
  ) {
    const layer = resolvedLayers[layerIndex]!;
    if (layerIndex > 0) {
      try {
        const resolved = resolveBetweenLayerSheets(input.interlayers, layer);
        sheetsBeforeNextLayer = resolved
          ? appendSheetGroup(
              resolved.specification,
              "between-layers",
              resolved.rule,
              layer.id,
              resolvedLayers[layerIndex - 1]!.id,
            )
          : [];
      } catch (cause) {
        warnings.push(
          invalidInputWarning(
            `between:${layer.id}`,
            cause instanceof Error
              ? cause.message
              : `Invalid interlayer rule before layer "${layer.id}".`,
          ),
        );
        sheetsBeforeNextLayer = [];
      }
    }

    const pattern = patternsByRef.get(layer.patternRef) ?? null;
    const zBottomMm = zMm;
    const zTopMm = zBottomMm + input.package.dimensionsMm.height;
    let placements: MaterializedStackPlacement[] = [];
    let grips: MaterializedStackGrip[] = [];
    let groupOrder: string[] = [];
    let orderDependencies: StackPattern["orderDependencies"] = [];
    let robotCycles: MaterializedRobotCycle[] = [];
    let transformFrameMm = pattern?.transformFrameMm ?? null;
    let transformFrameProvenance: MetricProvenance =
      pattern?.transformFrameProvenance ?? missingCycleProvenance;

    if (!pattern) {
      warnings.push({
        id: `missing-resource:pattern:${layer.id}`,
        code: "missing-resource",
        severity: "error",
        scope: "resource",
        layerId: layer.id,
        resourceKind: "pattern",
        resourceId: layer.patternRef,
        message: `Physical layer "${layer.id}" references missing pattern "${layer.patternRef}".`,
      });
    } else {
      let transformed;
      try {
        transformed = transformStackPattern(
          pattern,
          layer.transform,
          input.package.dimensionsMm,
        );
      } catch (cause) {
        warnings.push(
          invalidInputWarning(
            `transform:${layer.id}`,
            cause instanceof Error
              ? cause.message
              : `Unable to transform layer "${layer.id}".`,
          ),
        );
        transformed = copyPatternIdentity(pattern);
      }
      transformFrameMm = transformed.frameMm;
      transformFrameProvenance = transformed.frameProvenance;
      if (transformed.usedFallbackFrame) {
        warnings.push({
          id: `transform-frame-fallback:${layer.id}`,
          code: "transform-frame-fallback",
          severity: "warning",
          scope: "layer",
          layerId: layer.id,
          provenance: transformed.frameProvenance,
          message: `Layer "${layer.id}" used package bounds rather than a verified pallet/source transform frame.`,
        });
      }
      if (!transformed.transformResolved) {
        warnings.push(
          invalidInputWarning(
            `missing-transform-frame:${layer.id}`,
            `Layer "${layer.id}" could not apply ${layer.transform} because no transform frame was available.`,
          ),
        );
      }

      const gripIdBySource = new Map<string, string>();
      grips = transformed.grips.map((grip, gripIndex) => {
        const id = `${layer.id}:grip:${gripIndex + 1}`;
        gripIdBySource.set(grip.sourceGripId, id);
        return {
          ...grip,
          id,
          physicalLayerId: layer.id,
        };
      });
      const placementIdBySource = new Map<string, string>();
      placements = transformed.placements.map((placement, placementIndex) => {
        const id = `${layer.id}:placement:${placementIndex + 1}`;
        placementIdBySource.set(placement.sourcePlacementId, id);
        return {
          ...placement,
          id,
          physicalLayerId: layer.id,
          gripId:
            placement.gripId === null
              ? null
              : (gripIdBySource.get(placement.gripId) ?? null),
        };
      });
      groupOrder = [...transformed.groupOrder];
      orderDependencies = transformed.orderDependencies.map((dependency) => ({
        ...dependency,
      }));
      robotCycles = transformed.cycles.map((cycle, cycleIndex) => {
        const unresolvedPlacementIds = cycle.placementIds.filter(
          (placementId) => !placementIdBySource.has(placementId),
        );
        if (unresolvedPlacementIds.length > 0) {
          warnings.push(
            invalidInputWarning(
              `cycle-placement:${layer.id}:${cycle.sourceCycleId}`,
              `Cycle "${cycle.sourceCycleId}" references missing source placements: ${unresolvedPlacementIds.join(", ")}.`,
            ),
          );
        }
        return {
          ...cycle,
          id: `${layer.id}:cycle:${cycleIndex + 1}`,
          sourceCycleId: cycle.sourceCycleId,
          physicalLayerId: layer.id,
          physicalLayerIndex: layerIndex,
          gripId:
            cycle.gripId === null
              ? null
              : (gripIdBySource.get(cycle.gripId) ?? null),
          placementIds: cycle.placementIds.flatMap((placementId) => {
            const physicalPlacementId = placementIdBySource.get(placementId);
            return physicalPlacementId ? [physicalPlacementId] : [];
          }),
          pickPose: { ...cycle.pickPose },
          placePose: { ...cycle.placePose, z: zTopMm },
          labelOffset: { ...cycle.labelOffset },
        };
      });
    }

    const materializedLayer: MaterializedPackageLayer = {
      kind: "package-layer",
      id: layer.id,
      physicalIndex: physicalSequence.length,
      packageLayerIndex: layerIndex,
      patternRef: layer.patternRef,
      patternResolution: pattern ? "resolved" : "missing",
      transform: layer.transform,
      transformTrace: {
        transform: layer.transform,
        frameMm: transformFrameMm,
        frameProvenance: transformFrameProvenance,
      },
      patternProvenance: pattern?.provenance ?? null,
      layerProvenance: layer.provenance,
      zBottomMm,
      zTopMm,
      heightMm: input.package.dimensionsMm.height,
      placements,
      grips,
      groupOrder,
      orderDependencies,
      robotCycles,
      cycleCount: pattern?.cycleCount ?? null,
      cycleCountProvenance:
        pattern?.cycleCountProvenance ?? missingCycleProvenance,
      interlayerBeforeIds: sheetsBeforeNextLayer.map(({ id }) => id),
    };
    zMm = zTopMm;
    physicalSequence.push(materializedLayer);
    packageLayers.push(materializedLayer);
  }

  appendConfiguredSheet(
    () => resolveDeckSheet(input.interlayers),
    "deck-sheet",
    null,
    resolvedLayers.at(-1)?.id ?? null,
  );

  const metrics = calculateStackMetrics({
    package: input.package,
    pallet: input.pallet,
    packageLayers,
    sheets,
  });
  const collectedWarnings = collectStackWarnings({
    package: input.package,
    pallet: input.pallet,
    resources: input.resources,
    packageLayers,
    sheets,
    metrics,
    existingWarnings: warnings,
  });

  return {
    package: input.package,
    pallet: input.pallet,
    resources: input.resources,
    patterns: input.patterns,
    sourceLayers: input.layers,
    resolvedLayers,
    interlayerRules: input.interlayers,
    specialTopLayer,
    physicalSequence,
    packageLayers,
    sheets,
    robotCycles: packageLayers.flatMap(({ robotCycles: cycles }) => cycles),
    metrics,
    warnings: collectedWarnings,
  };
}
