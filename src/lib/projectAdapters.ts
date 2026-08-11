import { migrateProject } from "~/domain/project/projectMigration";
import {
  PROJECT_SCHEMA_VERSION,
  projectV2Schema,
  type Project,
  type ProjectV2,
} from "~/domain/project/projectSchema";
import { gripsToBoxes } from "~/domain/palletGeometry";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import { materializeProjectSolutionStack } from "~/domain/stack/project";
import type { MaterializedStackResult } from "~/domain/stack/types";
import type { Grip, PalletData, PlanarDimensions } from "~/domain/palletTypes";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText, serializeRobText } from "~/lib/robParser";

function resolvedPalletData(
  entry: Pick<SavedPallet, "data" | "rawText">,
): PalletData {
  if (entry.rawText) {
    try {
      return parseRobText(entry.rawText);
    } catch {
      // Preserve the recoverable stored DTO when source text is damaged.
    }
  }
  try {
    return parseRobText(serializeRobText(entry.data));
  } catch {
    return entry.data;
  }
}

function productNumberFromName(name: string): string {
  return name.toLowerCase().endsWith(".rob") ? name.slice(0, -4) : name;
}

function projectGrip(grip: Grip, id: string, groupNumber: number) {
  return {
    id,
    groupNumber,
    pickX: grip.pickX,
    pickY: grip.pickY,
    pickRotation: grip.pickRotation,
    x: grip.x,
    y: grip.y,
    rotation: grip.rotation,
    numPackages: grip.numPackages,
    dx: grip.dx,
    dy: grip.dy,
  };
}

export function savedPalletToProjectV2(entry: SavedPallet): ProjectV2 {
  const data = resolvedPalletData(entry);
  const patternEntries = Object.entries(data.uniqueLayers)
    .map(([uniqueLayerId, grips]) => ({
      uniqueLayerId: Number(uniqueLayerId),
      grips,
    }))
    .filter(({ uniqueLayerId }) => Number.isInteger(uniqueLayerId))
    .sort((a, b) => a.uniqueLayerId - b.uniqueLayerId);
  const patternIdByUniqueLayer = new Map(
    patternEntries.map(({ uniqueLayerId }) => [
      uniqueLayerId,
      `imported-pattern-${uniqueLayerId}`,
    ]),
  );
  const solutionId = "imported-solution";

  return projectV2Schema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: entry.id,
    projectNumber: "",
    productNumber: productNumberFromName(entry.name),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    source: {
      kind: "rob-import",
      fileName: entry.name,
      ...(entry.rawText ? { rawRobText: entry.rawText } : {}),
      ...(entry.originalRawText
        ? { originalRawText: entry.originalRawText }
        : {}),
    },
    package: {
      shape: "cuboid",
      dimensionsMm: {
        length: data.package.width,
        width: data.package.length,
        height: data.package.height,
      },
      weightKg: null,
      clearanceMm: 0,
      multiPickAllowed: false,
      inletOrientation: data.inputDirection === 1 ? "crosswise" : "lengthwise",
      palletizingDirection: null,
      labelSidesAtPickup: [],
    },
    pallet: data.pallet
      ? {
          id: "imported-pallet",
          name: "Imported pallet",
          kind: "custom",
          dimensionsMm: {
            length: data.pallet.width,
            width: data.pallet.length,
            height: data.pallet.height,
          },
          storageEnvelopeMm: null,
          allowedOverhangMm: { length: 0, width: 0 },
          tareKg: null,
          maxGrossKg: null,
          subPalletPattern: "none",
        }
      : null,
    grippers: [],
    palletStations: [],
    selectedGripperId: null,
    selectedPalletStationId: null,
    solutions: [
      {
        id: solutionId,
        name: "Imported .rob plan",
        origin: "imported",
        patterns: patternEntries.map(({ uniqueLayerId, grips }) => ({
          id: patternIdByUniqueLayer.get(uniqueLayerId),
          name: `Layer pattern ${uniqueLayerId}`,
          grips: grips.map((grip, gripIndex) =>
            projectGrip(
              grip,
              `imported-grip-${uniqueLayerId}-${gripIndex + 1}`,
              gripIndex + 1,
            ),
          ),
        })),
        stack: {
          interlayerThicknessMm: 3,
          layers: data.layers.map((layer, layerIndex) => ({
            id: `imported-layer-${layerIndex + 1}`,
            patternId:
              patternIdByUniqueLayer.get(layer.unique_layer_id) ??
              `imported-pattern-${layer.unique_layer_id}`,
            interlayerBefore: layer.zwischenlage,
          })),
          trailingInterlayer: data.trailingZwischenlage ?? 0,
        },
      },
    ],
    activeSolutionId: solutionId,
  });
}

export function savedPalletToProject(entry: SavedPallet): Project {
  return migrateProject(savedPalletToProjectV2(entry));
}

export const migrateSavedPalletToProject = savedPalletToProject;

const labelOffsetBySide: Record<
  CandidateLabelSide,
  { dx: number; dy: number }
> = {
  top: { dx: 0, dy: -1 },
  right: { dx: -1, dy: 0 },
  bottom: { dx: 0, dy: 1 },
  left: { dx: 1, dy: 0 },
  top_right: { dx: 1, dy: -1 },
  bottom_right: { dx: -1, dy: 1 },
  bottom_left: { dx: 1, dy: 1 },
  top_left: { dx: -1, dy: -1 },
};

function previewGripsForPattern(
  pattern: MaterializedStackResult["patterns"][number],
): Grip[] {
  if (pattern.grips.length > 0) {
    return pattern.grips.map((grip) => ({
      id: grip.sourceGripId,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickRotation: grip.pickRotation,
      x: grip.x,
      y: grip.y,
      rotation: grip.rotation,
      numPackages: grip.numPackages,
      dx: grip.dx,
      dy: grip.dy,
    }));
  }

  return pattern.placements.map((placement, index) => {
    const labelOffset = placement.labelSide
      ? labelOffsetBySide[placement.labelSide]
      : { dx: 0, dy: 0 };
    return {
      id: `${pattern.ref}-preview-grip-${index + 1}`,
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: placement.positionMm.x,
      y: placement.positionMm.y,
      rotation: placement.rotation,
      numPackages: 1,
      ...labelOffset,
    } satisfies Grip;
  });
}

function previewGripsForLayer(
  layer: MaterializedStackResult["packageLayers"][number],
): Grip[] {
  if (layer.grips.length > 0) {
    return layer.grips.map((grip) => ({
      id: grip.id,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickRotation: grip.pickRotation,
      x: grip.x,
      y: grip.y,
      rotation: grip.rotation,
      numPackages: grip.numPackages,
      dx: grip.dx,
      dy: grip.dy,
    }));
  }

  return layer.placements.map((placement, index) => {
    const labelOffset = placement.labelSide
      ? labelOffsetBySide[placement.labelSide]
      : { dx: 0, dy: 0 };
    return {
      id: `${layer.id}-preview-grip-${index + 1}`,
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: placement.positionMm.x,
      y: placement.positionMm.y,
      rotation: placement.rotation,
      numPackages: 1,
      ...labelOffset,
    } satisfies Grip;
  });
}

export type PalletPreviewAdapterOptions = {
  projectId?: string | null;
  solutionId?: string | null;
  /** Sheet footprint can differ from the pallet without changing stack calculations. */
  interlayerDimensions?: PlanarDimensions | null;
};

function inferredProjectMetadata(stack: MaterializedStackResult): {
  projectId: string | null;
  solutionId: string | null;
} {
  for (const pattern of stack.patterns) {
    if (pattern.provenance.kind !== "project-pattern") continue;
    return {
      projectId: pattern.provenance.projectId,
      solutionId: pattern.provenance.solutionId,
    };
  }
  return { projectId: null, solutionId: null };
}

/** Legacy preview adapter over the same materialized result used by metrics and robotics. */
export function materializedStackToPalletData(
  stack: MaterializedStackResult,
  options: PalletPreviewAdapterOptions = {},
): PalletData {
  const packageWidth = stack.package.dimensionsMm.length;
  const packageLength = stack.package.dimensionsMm.width;
  const packageHeight = stack.package.dimensionsMm.height;
  const inputDirection = stack.package.inletOrientation === "crosswise" ? 1 : 0;
  const uniqueLayerIdByVariant = new Map<string, number>();
  const uniqueLayers: Record<number, Grip[]> = {};
  const sheetById = new Map(stack.sheets.map((sheet) => [sheet.id, sheet]));

  for (const pattern of stack.patterns) {
    const variantKey = JSON.stringify([pattern.ref, "identity"]);
    if (uniqueLayerIdByVariant.has(variantKey)) continue;
    const uniqueLayerId = uniqueLayerIdByVariant.size + 1;
    uniqueLayerIdByVariant.set(variantKey, uniqueLayerId);
    uniqueLayers[uniqueLayerId] = previewGripsForPattern(pattern);
  }

  const layers = stack.packageLayers.map((layer) => {
    const variantKey = JSON.stringify([layer.patternRef, layer.transform]);
    let uniqueLayerId = uniqueLayerIdByVariant.get(variantKey);
    const grips = previewGripsForLayer(layer);
    if (uniqueLayerId === undefined) {
      uniqueLayerId = uniqueLayerIdByVariant.size + 1;
      uniqueLayerIdByVariant.set(variantKey, uniqueLayerId);
      uniqueLayers[uniqueLayerId] = grips;
    }
    return {
      unique_layer_id: uniqueLayerId,
      boxes: gripsToBoxes(
        grips,
        packageWidth,
        packageLength,
        packageHeight,
        inputDirection,
      ),
      zwischenlage: layer.interlayerBeforeIds.length,
      interlayerThicknessesMm: layer.interlayerBeforeIds.flatMap((sheetId) => {
        const sheet = sheetById.get(sheetId);
        return sheet ? [sheet.thicknessMm] : [];
      }),
      ...(options.interlayerDimensions
        ? { interlayerDimensions: { ...options.interlayerDimensions } }
        : {}),
    };
  });
  const inferred = inferredProjectMetadata(stack);
  const projectId = options.projectId ?? inferred.projectId;
  const solutionId = options.solutionId ?? inferred.solutionId;
  const patternsByRef = new Map(
    stack.patterns.map((pattern) => [pattern.ref, pattern]),
  );
  const warningCodes = [
    ...new Set(stack.warnings.map(({ code }) => code)),
  ].sort();
  const defaultInterlayerDimensions = stack.pallet
    ? {
        width: stack.pallet.dimensionsMm.length,
        length: stack.pallet.dimensionsMm.width,
      }
    : null;
  const interlayerDimensions =
    options.interlayerDimensions === undefined
      ? defaultInterlayerDimensions
      : options.interlayerDimensions;

  return {
    layers,
    uniqueLayers,
    layer_count: layers.length,
    total_boxes: layers.reduce((total, layer) => total + layer.boxes.length, 0),
    package: {
      width: packageWidth,
      length: packageLength,
      height: packageHeight,
    },
    pallet: stack.pallet
      ? {
          width: stack.pallet.dimensionsMm.length,
          length: stack.pallet.dimensionsMm.width,
          height: stack.pallet.dimensionsMm.height,
        }
      : null,
    interlayer: interlayerDimensions
      ? { ...interlayerDimensions }
      : interlayerDimensions,
    planner: {
      projectId,
      solutionId,
      layers: stack.packageLayers.map((layer, index) => {
        const pattern = patternsByRef.get(layer.patternRef);
        return {
          id: layer.id,
          label: `Layer ${index + 1}`,
          patternRef: layer.patternRef,
          candidateId:
            pattern?.provenance.kind === "solver-candidate"
              ? pattern.provenance.candidateId
              : null,
          isSpecialTop: layer.layerProvenance.kind === "special-top",
        };
      }),
      metrics: {
        packageCount: stack.metrics.packages.totalPackageCount,
        cycleCount: stack.metrics.cycles.totalCycleCount,
        loadStackHeightMm: stack.metrics.height.loadStackHeightMm,
        areaUtilizationPercent: stack.metrics.area.utilization.percent,
        volumeUtilizationPercent: stack.metrics.volume.utilization.percent,
        grossWeightKg: stack.metrics.weight.grossWeightKg,
      },
      warningCodes,
    },
    inputDirection,
    inputDirectionExplicit: true,
    trailingZwischenlage: stack.sheets.filter(
      ({ role }) => role === "deck-sheet",
    ).length,
    trailingInterlayerThicknessesMm: stack.sheets
      .filter(({ role }) => role === "deck-sheet")
      .map(({ thicknessMm }) => thicknessMm),
    ...(interlayerDimensions
      ? { trailingInterlayerDimensions: { ...interlayerDimensions } }
      : {}),
  };
}

/**
 * Preview projection over the canonical stack and RobotCycle array shared by the
 * editor flow, export, simulation, and reporting workspaces.
 */
export function robotCycleMaterializationToPalletData(
  materialization: RobotCycleMaterialization,
  options: Omit<PalletPreviewAdapterOptions, "projectId" | "solutionId"> = {},
): PalletData | null {
  if (!materialization.stack) return null;
  const preview = materializedStackToPalletData(materialization.stack, {
    ...options,
    projectId: materialization.projectId,
    solutionId: materialization.solutionId,
  });
  if (!preview.planner) return preview;
  return {
    ...preview,
    planner: {
      ...preview.planner,
      metrics: {
        ...preview.planner.metrics,
        cycleCount: materialization.cycles.length,
      },
      warningCodes: [
        ...new Set([
          ...preview.planner.warningCodes,
          ...materialization.diagnostics.map(({ code }) => code),
        ]),
      ].sort(),
    },
  };
}

export function projectSolutionToPalletData(
  input: ProjectV2 | Project,
  solutionId: string | null = input.activeSolutionId,
  options: Omit<PalletPreviewAdapterOptions, "projectId" | "solutionId"> = {},
): PalletData {
  const project = migrateProject(input);
  const resolvedSolutionId = solutionId ?? project.activeSolutionId;
  return materializedStackToPalletData(
    materializeProjectSolutionStack(project, resolvedSolutionId),
    {
      ...options,
      projectId: project.id,
      solutionId: resolvedSolutionId,
    },
  );
}
