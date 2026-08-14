import type { PackageSpec } from "~/domain/project/projectSchema";
import type {
  MaterializedPackageLayer,
  MaterializedRobotCycle,
  MaterializedStackPlacement,
} from "~/domain/stack/types";
import type { RobotDiagnostic, RobotGripGroup } from "~/domain/robotics/types";

export type SuctionGroupingOptions = {
  maxPackagesPerPick?: number;
  toleranceMm?: number;
  maxPickupLengthMm?: number | null;
};

export type SuctionGroupingPlacement = Pick<
  MaterializedStackPlacement,
  "id" | "sequence" | "positionMm" | "rotation"
>;

export type SuctionPlacementPartitionOptions = {
  packageLengthMm: number;
  maxPackagesPerPick?: number;
  toleranceMm?: number;
};

function finitePositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be positive and finite.`);
  }
  return value;
}

function placementAxis(placement: SuctionGroupingPlacement): {
  axis: number;
  perpendicular: number;
} {
  return placement.rotation === 0 || placement.rotation === 180
    ? { axis: placement.positionMm.x, perpendicular: placement.positionMm.y }
    : { axis: placement.positionMm.y, perpendicular: placement.positionMm.x };
}

function partitionContiguousSuctionRun<
  Placement extends SuctionGroupingPlacement,
>(run: readonly Placement[], maxPackagesPerPick: number): Placement[][] {
  const first = run[0];
  const vertical = first?.rotation === 90 || first?.rotation === 270;
  const fullGroupCount = Math.floor(run.length / maxPackagesPerPick);
  const remainder = run.length % maxPackagesPerPick;
  const centersSingleton =
    vertical &&
    remainder === 1 &&
    fullGroupCount >= 2 &&
    fullGroupCount % 2 === 0;
  const singletonIndex = centersSingleton
    ? (fullGroupCount / 2) * maxPackagesPerPick
    : null;
  const groups: Placement[][] = [];

  for (let start = 0; start < run.length; ) {
    const groupSize = start === singletonIndex ? 1 : maxPackagesPerPick;
    groups.push(run.slice(start, start + groupSize));
    start += groupSize;
  }

  return groups;
}

/**
 * Pure deterministic partitioning shared by generated candidates and Robotics.
 * Geometry is never changed: incompatible placements remain singleton groups.
 */
export function partitionPlacementsForSuction<
  Placement extends SuctionGroupingPlacement,
>(
  placements: readonly Placement[],
  options: SuctionPlacementPartitionOptions,
): Placement[][] {
  const tolerance = options.toleranceMm ?? 0.001;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("toleranceMm must be finite and non-negative.");
  }
  const packageSpan = finitePositive(
    options.packageLengthMm,
    "packageLengthMm",
  );
  const maxPackagesPerPick = Math.max(
    1,
    Math.trunc(options.maxPackagesPerPick ?? 2),
  );
  const sorted = [...placements].sort((left, right) => {
    if (left.rotation !== right.rotation) return left.rotation - right.rotation;
    const leftAxis = placementAxis(left);
    const rightAxis = placementAxis(right);
    if (leftAxis.perpendicular !== rightAxis.perpendicular) {
      return leftAxis.perpendicular - rightAxis.perpendicular;
    }
    if (leftAxis.axis !== rightAxis.axis) return leftAxis.axis - rightAxis.axis;
    if (left.sequence !== right.sequence) return left.sequence - right.sequence;
    return left.id.localeCompare(right.id);
  });

  const rows: Placement[][] = [];
  for (const placement of sorted) {
    const coordinate = placementAxis(placement).perpendicular;
    const row = rows.find((candidate) => {
      const first = candidate[0];
      return (
        first !== undefined &&
        first.rotation === placement.rotation &&
        Math.abs(placementAxis(first).perpendicular - coordinate) <= tolerance
      );
    });
    if (row) row.push(placement);
    else rows.push([placement]);
  }

  const groups: Placement[][] = [];
  for (const row of rows) {
    row.sort((left, right) => {
      const difference = placementAxis(left).axis - placementAxis(right).axis;
      return difference !== 0 ? difference : left.id.localeCompare(right.id);
    });
    let runStart = 0;
    for (let index = 1; index <= row.length; index += 1) {
      const previous = row[index - 1];
      const current = row[index];
      const continues =
        previous !== undefined &&
        current !== undefined &&
        Math.abs(
          placementAxis(current).axis -
            placementAxis(previous).axis -
            packageSpan,
        ) <= tolerance;
      if (continues) continue;

      const run = row.slice(runStart, index);
      groups.push(...partitionContiguousSuctionRun(run, maxPackagesPerPick));
      runStart = index;
    }
  }

  return groups;
}

function groupFromPlacements(
  layer: MaterializedPackageLayer,
  placements: readonly MaterializedStackPlacement[],
  groupNumber: number,
): RobotGripGroup {
  const first = placements[0]!;
  const center = placements.reduce(
    (total, placement) => ({
      x: total.x + placement.positionMm.x,
      y: total.y + placement.positionMm.y,
    }),
    { x: 0, y: 0 },
  );
  const placementIds = placements.map(({ id }) => id);
  return {
    id: `${layer.id}:group:${placementIds.map(encodeURIComponent).join("+")}`,
    groupNumber,
    physicalLayerId: layer.id,
    physicalLayerIndex: layer.packageLayerIndex,
    placementIds,
    packageCount: placementIds.length,
    centerPalletMm: {
      x: center.x / placements.length,
      y: center.y / placements.length,
      z: layer.zTopMm,
    },
    placeRotationDeg: first.rotation,
    sourceGripId: null,
    sourceCycleId: null,
    sourceSequence: null,
    groupingSource: "suction-adjacency-v1",
  };
}

/**
 * Deterministically groups collinear, face-adjacent packages along their local
 * package-length axis. The current suction-first policy defaults to doubles.
 */
export function groupPlacementsForSuction(
  layer: MaterializedPackageLayer,
  packageSpec: PackageSpec,
  options: SuctionGroupingOptions = {},
): RobotGripGroup[] {
  const requestedMax = Math.max(1, Math.trunc(options.maxPackagesPerPick ?? 2));
  const pickupPackageSpan =
    packageSpec.inletOrientation === "lengthwise"
      ? packageSpec.dimensionsMm.length
      : packageSpec.dimensionsMm.width;
  const lengthLimitedMax =
    options.maxPickupLengthMm === null ||
    options.maxPickupLengthMm === undefined
      ? requestedMax
      : Math.max(
          1,
          Math.floor(
            finitePositive(options.maxPickupLengthMm, "maxPickupLengthMm") /
              finitePositive(pickupPackageSpan, "pickupPackageSpan"),
          ),
        );
  const maxPackagesPerPick = packageSpec.multiPickAllowed
    ? Math.min(requestedMax, lengthLimitedMax)
    : 1;
  return partitionPlacementsForSuction(layer.placements, {
    packageLengthMm: packageSpec.dimensionsMm.length,
    maxPackagesPerPick,
    toleranceMm: options.toleranceMm,
  }).map((placements, index) =>
    groupFromPlacements(layer, placements, index + 1),
  );
}

/** Uses persisted pattern-grip assignments without turning them into legacy poses. */
export function groupsFromPatternGrips(layer: MaterializedPackageLayer): {
  groups: RobotGripGroup[];
  diagnostics: RobotDiagnostic[];
} {
  const diagnostics: RobotDiagnostic[] = [];
  const assigned = new Set<string>();
  const groups = [...layer.grips]
    .sort(
      (left, right) =>
        left.groupNumber - right.groupNumber ||
        left.sequence - right.sequence ||
        left.sourceGripId.localeCompare(right.sourceGripId),
    )
    .flatMap((grip) => {
      const placements = layer.placements.filter(
        (placement) => placement.gripId === grip.id,
      );
      if (placements.length === 0) {
        diagnostics.push({
          severity: "error",
          phase: "grouping",
          code: "materialization-invalid",
          message: `Pattern grip "${grip.sourceGripId}" has no assigned package placements.`,
          layerId: layer.id,
          groupId: grip.sourceGripId,
        });
        return [];
      }
      placements.forEach(({ id }) => assigned.add(id));
      const center = placements.reduce(
        (total, placement) => ({
          x: total.x + placement.positionMm.x,
          y: total.y + placement.positionMm.y,
        }),
        { x: 0, y: 0 },
      );
      return [
        {
          id: `${layer.id}:group:${encodeURIComponent(grip.sourceGripId)}`,
          groupNumber: grip.groupNumber,
          physicalLayerId: layer.id,
          physicalLayerIndex: layer.packageLayerIndex,
          placementIds: placements.map(({ id }) => id),
          packageCount: placements.length,
          centerPalletMm: {
            x: center.x / placements.length,
            y: center.y / placements.length,
            z: layer.zTopMm,
          },
          placeRotationDeg: grip.rotation,
          sourceGripId: grip.sourceGripId,
          sourceCycleId: null,
          sourceSequence: null,
          groupingSource: "explicit-pattern-grip",
        } satisfies RobotGripGroup,
      ];
    });

  for (const placement of layer.placements) {
    if (assigned.has(placement.id)) continue;
    diagnostics.push({
      severity: "error",
      phase: "grouping",
      code: "placement-unassigned",
      message: `Placement "${placement.id}" is not assigned to a persisted pattern grip.`,
      layerId: layer.id,
      placementId: placement.id,
    });
  }

  return { groups, diagnostics };
}

function explicitGroup(
  layer: MaterializedPackageLayer,
  cycle: MaterializedRobotCycle,
  cycleIndex: number,
  placementsById: ReadonlyMap<string, MaterializedStackPlacement>,
): RobotGripGroup {
  const placements = cycle.placementIds.flatMap((placementId) => {
    const placement = placementsById.get(placementId);
    return placement ? [placement] : [];
  });
  const center = placements.reduce(
    (total, placement) => ({
      x: total.x + placement.positionMm.x,
      y: total.y + placement.positionMm.y,
    }),
    { x: 0, y: 0 },
  );
  const sourceGrip = cycle.gripId
    ? (layer.grips.find(({ id }) => id === cycle.gripId) ?? null)
    : null;
  return {
    id: `${layer.id}:group:${encodeURIComponent(cycle.sourceCycleId || String(cycleIndex + 1))}`,
    groupNumber: sourceGrip?.groupNumber ?? cycleIndex + 1,
    physicalLayerId: layer.id,
    physicalLayerIndex: layer.packageLayerIndex,
    placementIds: [...cycle.placementIds],
    packageCount: cycle.placementIds.length,
    centerPalletMm:
      placements.length > 0
        ? {
            x: center.x / placements.length,
            y: center.y / placements.length,
            z: layer.zTopMm,
          }
        : {
            x: cycle.placePose.x,
            y: cycle.placePose.y,
            z: layer.zTopMm,
          },
    placeRotationDeg: cycle.placePose.rotation,
    sourceGripId: cycle.gripId,
    sourceCycleId: cycle.sourceCycleId,
    sourceSequence: cycle.sequence,
    groupingSource: "explicit-project-cycle",
  };
}

export function groupsFromExplicitCycles(layer: MaterializedPackageLayer): {
  groups: RobotGripGroup[];
  diagnostics: RobotDiagnostic[];
} {
  const diagnostics: RobotDiagnostic[] = [];
  const placementsById = new Map(
    layer.placements.map((placement) => [placement.id, placement]),
  );
  const assigned = new Set<string>();
  const groups = [...layer.robotCycles]
    .sort((left, right) =>
      left.sequence !== right.sequence
        ? left.sequence - right.sequence
        : left.sourceCycleId.localeCompare(right.sourceCycleId),
    )
    .map((cycle, cycleIndex) => {
      for (const placementId of cycle.placementIds) {
        if (!placementsById.has(placementId)) {
          diagnostics.push({
            severity: "error",
            phase: "grouping",
            code: "missing-placement-reference",
            message: `Cycle "${cycle.sourceCycleId}" references missing physical placement "${placementId}".`,
            cycleId: cycle.sourceCycleId,
            layerId: layer.id,
            placementId,
          });
        } else if (assigned.has(placementId)) {
          diagnostics.push({
            severity: "error",
            phase: "grouping",
            code: "placement-assigned-more-than-once",
            message: `Placement "${placementId}" is assigned to more than one explicit robot cycle.`,
            cycleId: cycle.sourceCycleId,
            layerId: layer.id,
            placementId,
          });
        }
        assigned.add(placementId);
      }
      return explicitGroup(layer, cycle, cycleIndex, placementsById);
    });

  for (const placement of layer.placements) {
    if (assigned.has(placement.id)) continue;
    diagnostics.push({
      severity: "error",
      phase: "grouping",
      code: "placement-unassigned",
      message: `Placement "${placement.id}" is not assigned to an explicit robot cycle.`,
      layerId: layer.id,
      placementId: placement.id,
    });
  }

  return { groups, diagnostics };
}
