import { resolveMultipackGripperPackageLimits } from "~/domain/project/equipmentProfiles";
import { safeMigrateProject } from "~/domain/project/projectMigration";
import type {
  PalletizingDirection,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import { validateCycleMotionBoundaries } from "~/domain/robotics/checks";
import { validateSuctionCompatibility } from "~/domain/robotics/compatibility";
import {
  createCalculatedRobotConveyorModel,
  robotConveyorObstacle,
} from "~/domain/robotics/conveyor";
import {
  groupPlacementsForSuction,
  groupsFromExplicitCycles,
  groupsFromPatternGrips,
} from "~/domain/robotics/grouping";
import { suggestRobotOrder } from "~/domain/robotics/ordering";
import {
  calculateProjectCyclePoses,
  posesFromExplicitProjectCycle,
  unresolvedProjectCyclePoses,
} from "~/domain/robotics/poses";
import {
  resolveSelectedRoboticsResources,
  validateCycleGripperAssignments,
} from "~/domain/robotics/resources";
import type {
  PickReference,
  RobotCycle,
  RobotCycleLayer,
  RobotCycleMaterialization,
  RobotCycleMaterializationOptions,
  RobotCycleProvenance,
  RobotDiagnostic,
  RobotGripGroup,
} from "~/domain/robotics/types";
import { materializeProjectSolutionStack } from "~/domain/stack/project";
import type {
  MaterializedPackageLayer,
  MaterializedRobotCycle,
  MaterializedStackResult,
} from "~/domain/stack/types";

const fallbackDirection: PalletizingDirection = "x-positive-y-positive";
const fallbackPickReference: PickReference = {
  originMm: { x: 0, y: 0, z: 0 },
  provenance: {
    status: "unverified",
    source: "missing-pick-reference-placeholder",
  },
};

function emptyMaterialization(
  diagnostics: readonly RobotDiagnostic[],
  project: Project | null = null,
  solutionId: string | null = null,
): RobotCycleMaterialization {
  return {
    kind: "robot-cycle-materialization",
    project,
    projectId: project?.id ?? null,
    solutionId,
    gripper: null,
    station: null,
    direction: null,
    stack: null,
    conveyor: null,
    layers: [],
    cycles: [],
    diagnostics,
    valid: false,
  };
}

function sourceCycleForGroup(
  layer: MaterializedPackageLayer,
  group: RobotGripGroup,
): MaterializedRobotCycle | null {
  if (group.sourceCycleId === null) return null;
  return (
    layer.robotCycles.find(
      ({ sourceCycleId }) => sourceCycleId === group.sourceCycleId,
    ) ?? null
  );
}

function orderSource(
  source: ReturnType<typeof suggestRobotOrder>["source"],
  solution: PlanningSolution,
): RobotCycleProvenance["orderSource"] {
  if (
    source === "explicit-project-sequence" &&
    solution.origin === "imported"
  ) {
    return "imported-sequence";
  }
  return source;
}

function explicitCycleProvenance(
  solution: PlanningSolution,
  group: RobotGripGroup,
  orderingSource: RobotCycleProvenance["orderSource"],
  pickReferenceProvenance: RobotCycleProvenance["pickReferenceProvenance"],
): RobotCycleProvenance {
  const imported = solution.origin === "imported";
  return {
    cycleSource: imported ? "imported-project-cycle" : "explicit-project-cycle",
    groupingSource: "explicit-project-cycle",
    orderSource: orderingSource,
    poseSource: imported ? "imported-legacy-rob-pose" : "explicit-project-pose",
    sourceSolutionOrigin: solution.origin,
    sourceCycleId: group.sourceCycleId,
    sourceGripId: group.sourceGripId,
    pickReferenceProvenance: pickReferenceProvenance
      ? { ...pickReferenceProvenance }
      : null,
    coordinateConvention: imported
      ? "legacy-rob-fields-preserved-unverified"
      : "project-explicit-pose-preserved",
    tcpOffsetConvention: "already-encoded",
    signConventionStatus: imported ? "unverified" : "repository-behavior",
  };
}

function calculatedCycleProvenance(
  solution: PlanningSolution,
  group: RobotGripGroup,
  orderingSource: RobotCycleProvenance["orderSource"],
  pickReference: PickReference,
  fullyResolved: boolean,
): RobotCycleProvenance {
  return {
    cycleSource: "calculated-suction-cycle",
    groupingSource: group.groupingSource,
    orderSource: orderingSource,
    poseSource: "calculated-project-resources",
    sourceSolutionOrigin: solution.origin,
    sourceCycleId: null,
    sourceGripId: null,
    pickReferenceProvenance: { ...pickReference.provenance },
    coordinateConvention: fullyResolved
      ? "project-pallet-to-station-frame-v1"
      : "unresolved-pallet-frame-placeholder",
    tcpOffsetConvention: "tcp-to-grasp-vector-subtracted",
    signConventionStatus: fullyResolved ? "project-defined" : "unverified",
  };
}

function stackDiagnostics(stack: MaterializedStackResult): RobotDiagnostic[] {
  return stack.warnings.flatMap((warning) => {
    if (warning.severity !== "error") return [];
    return [
      {
        severity: "error" as const,
        phase: "project" as const,
        code: "materialization-invalid" as const,
        message: warning.message,
        layerId: warning.layerId,
        resourceId: warning.resourceId,
      },
    ];
  });
}

function finitePoseDiagnostics(
  cycles: readonly RobotCycle[],
): RobotDiagnostic[] {
  const diagnostics: RobotDiagnostic[] = [];
  for (const cycle of cycles) {
    for (const [phase, pose] of [
      ["pick", cycle.pickPose],
      ["transfer", cycle.transferPose],
      ["place", cycle.placePose],
    ] as const) {
      const values = [
        pose.positionMm.x,
        pose.positionMm.y,
        pose.positionMm.z,
        pose.yawDeg,
      ];
      if (values.every(Number.isFinite)) continue;
      diagnostics.push({
        severity: "error",
        phase: "pose",
        code: "non-finite-pose",
        message: `Cycle "${cycle.id}" ${phase} pose contains a non-finite value.`,
        cycleId: cycle.id,
        layerId: cycle.physicalLayerId,
        details: { phase },
      });
    }
  }
  return diagnostics;
}

function duplicateCycleIdDiagnostics(
  cycles: readonly RobotCycle[],
): RobotDiagnostic[] {
  const firstCycleById = new Map<string, RobotCycle>();
  const reportedIds = new Set<string>();
  const diagnostics: RobotDiagnostic[] = [];
  for (const cycle of cycles) {
    const firstCycle = firstCycleById.get(cycle.id);
    if (!firstCycle) {
      firstCycleById.set(cycle.id, cycle);
      continue;
    }
    if (reportedIds.has(cycle.id)) continue;
    reportedIds.add(cycle.id);
    diagnostics.push({
      severity: "error",
      phase: "project",
      code: "duplicate-cycle-id",
      message: `Robot cycle id "${cycle.id}" is not unique; materialization and export references would be ambiguous.`,
      cycleId: cycle.id,
      layerId: cycle.physicalLayerId,
      details: {
        firstSequence: firstCycle.sequence,
        duplicateSequence: cycle.sequence,
      },
    });
  }
  return diagnostics;
}

/**
 * Single robotics materialization boundary. Export, editor-flow helpers,
 * simulation timelines, and reports consume the returned `cycles` verbatim.
 */
export function materializeRobotCycles(
  projectInput: unknown,
  options: RobotCycleMaterializationOptions = {},
): RobotCycleMaterialization {
  const migrated = safeMigrateProject(projectInput);
  if (!migrated.success) {
    return emptyMaterialization(
      migrated.diagnostics.map((diagnostic) => ({
        severity: "error",
        phase: "project",
        code: "invalid-project",
        message: diagnostic.message,
        path: diagnostic.path,
        details: { schemaVersion: diagnostic.schemaVersion },
      })),
    );
  }

  const project = migrated.project;
  const solutionId = options.solutionId ?? project.activeSolutionId;
  const solution =
    project.solutions.find(({ id }) => id === solutionId) ?? null;
  if (!solution) {
    return emptyMaterialization(
      [
        {
          severity: "error",
          phase: "project",
          code: "missing-solution",
          message: solutionId
            ? `Project solution "${solutionId}" does not exist.`
            : "Project has no active solution.",
          path: ["activeSolutionId"],
        },
      ],
      project,
      solutionId,
    );
  }

  const diagnostics: RobotDiagnostic[] = [];
  if (!project.pallet) {
    diagnostics.push({
      severity: "error",
      phase: "project",
      code: "missing-pallet",
      message: "A pallet is required for robot cycle calculation and export.",
      path: ["pallet"],
    });
  }

  const resources = resolveSelectedRoboticsResources(
    project,
    options.direction,
  );
  diagnostics.push(...resources.diagnostics);
  diagnostics.push(
    ...validateCycleGripperAssignments(solution, project.selectedGripperId),
  );

  let stack: MaterializedStackResult;
  try {
    stack = materializeProjectSolutionStack(project, solution.id);
  } catch (cause) {
    diagnostics.push({
      severity: "error",
      phase: "project",
      code: "materialization-invalid",
      message:
        cause instanceof Error
          ? cause.message
          : "Unable to materialize the project stack.",
    });
    return {
      ...emptyMaterialization(diagnostics, project, solution.id),
      gripper: resources.gripper,
      station: resources.station,
      direction: resources.direction,
    };
  }
  diagnostics.push(...stackDiagnostics(stack));

  const preserveExplicitCycles = options.preserveExplicitCycles ?? true;
  const transferClearanceMm = options.transferClearanceMm ?? 200;
  const pickReference = options.pickReference ?? fallbackPickReference;
  const trustedPickReference =
    options.pickReference?.provenance.status === "verified" ||
    options.pickReference?.provenance.status === "derived";
  const orderingDirection = resources.direction ?? fallbackDirection;
  const cycles: RobotCycle[] = [];
  const layers: RobotCycleLayer[] = [];
  let missingPickReferenceReported = false;
  let unverifiedPickReferenceReported = false;
  let legacyFrameReported = false;

  for (const layer of stack.packageLayers) {
    const useExplicit = preserveExplicitCycles && layer.robotCycles.length > 0;
    const usePatternGrips = !useExplicit && layer.grips.length > 0;
    const grouped = useExplicit
      ? groupsFromExplicitCycles(layer)
      : usePatternGrips
        ? groupsFromPatternGrips(layer)
        : {
            groups: groupPlacementsForSuction(layer, project.package, {
              maxPackagesPerPick: options.maxPackagesPerPick,
              toleranceMm: options.groupingToleranceMm,
              maxPickupLengthMm: resources.gripper?.maxPickupLengthMm,
            }),
            diagnostics: [] as RobotDiagnostic[],
          };
    diagnostics.push(...grouped.diagnostics);

    if (
      !useExplicit &&
      !options.pickReference &&
      !missingPickReferenceReported
    ) {
      missingPickReferenceReported = true;
      diagnostics.push({
        severity: "error",
        phase: "pose",
        code: "missing-pick-reference",
        message:
          "Calculated cycles require an explicit conveyor/pick reference; a zero placeholder was retained only for inspection.",
        path: ["robotics", "pickReference"],
      });
    } else if (
      !useExplicit &&
      options.pickReference?.provenance.status === "unverified" &&
      !unverifiedPickReferenceReported
    ) {
      unverifiedPickReferenceReported = true;
      diagnostics.push({
        severity: "error",
        phase: "pose",
        code: "unverified-pick-reference",
        message:
          "Calculated cycles require verified or derived pick-reference provenance; unverified coordinates are retained only for inspection and remain blocked from export.",
        path: ["robotics", "pickReference", "provenance"],
        details: { source: options.pickReference.provenance.source },
      });
    }

    const groupIdBySourceGrip = new Map(
      grouped.groups.flatMap((group) =>
        group.sourceGripId === null
          ? []
          : [[group.sourceGripId, group.id] as const],
      ),
    );
    const persistedDependencies = layer.orderDependencies.map(
      (dependency) => ({
        beforeGroupId:
          groupIdBySourceGrip.get(dependency.beforeGripId) ??
          dependency.beforeGripId,
        afterGroupId:
          groupIdBySourceGrip.get(dependency.afterGripId) ??
          dependency.afterGripId,
        source: "explicit" as const,
      }),
    );
    const persistedOrder = layer.groupOrder.map(
      (sourceGripId) => groupIdBySourceGrip.get(sourceGripId) ?? sourceGripId,
    );
    const suggestion = suggestRobotOrder(
      grouped.groups,
      options.dependenciesByLayer?.[layer.id] ?? persistedDependencies,
      orderingDirection,
      options.editedOrderByLayer?.[layer.id] ??
        (persistedOrder.length > 0 ? persistedOrder : undefined),
    );
    diagnostics.push(...suggestion.diagnostics);
    const resolvedOrderSource = orderSource(suggestion.source, solution);
    const layerCycles: RobotCycle[] = [];

    for (
      let sequenceInLayer = 0;
      sequenceInLayer < suggestion.groups.length;
      sequenceInLayer += 1
    ) {
      const group = suggestion.groups[sequenceInLayer]!;
      const sourceCycle = sourceCycleForGroup(layer, group);
      const explicit = sourceCycle !== null;
      let poses;
      let provenance: RobotCycleProvenance;
      if (sourceCycle) {
        if (sourceCycle.pickPose.z === null && !options.pickReference) {
          diagnostics.push({
            severity: "error",
            phase: "pose",
            code: "missing-pick-height",
            message: `Explicit cycle "${sourceCycle.sourceCycleId}" has no pick Z and no pick reference supplied; Z=0 is an inspection placeholder.`,
            cycleId: sourceCycle.sourceCycleId,
            layerId: layer.id,
          });
        }
        if (!legacyFrameReported) {
          legacyFrameReported = true;
          diagnostics.push({
            severity: "warning",
            phase: "pose",
            code: "legacy-pose-frame-unverified",
            message:
              "Explicit .rob pick/place coordinates are preserved in the legacy frame; their external station/TCP sign semantics remain unverified.",
          });
        }
        poses = posesFromExplicitProjectCycle(
          {
            pick: sourceCycle.pickPose,
            place: sourceCycle.placePose,
          },
          options.pickReference?.originMm.z ?? 0,
          layer.zTopMm,
          transferClearanceMm,
        );
        provenance = explicitCycleProvenance(
          solution,
          group,
          resolvedOrderSource,
          sourceCycle.pickPose.z === null ? pickReference.provenance : null,
        );
      } else {
        const fullyResolved =
          project.pallet !== null &&
          resources.gripper !== null &&
          resources.station !== null &&
          resources.direction !== null &&
          trustedPickReference;
        poses = fullyResolved
          ? calculateProjectCyclePoses(
              group,
              project.package,
              project.pallet!,
              resources.gripper!,
              resources.station!,
              resources.direction!,
              pickReference,
              transferClearanceMm,
            )
          : unresolvedProjectCyclePoses(
              group,
              project.package,
              pickReference,
              transferClearanceMm,
            );
        provenance = calculatedCycleProvenance(
          solution,
          group,
          resolvedOrderSource,
          pickReference,
          fullyResolved,
        );
      }

      const stableGroupKey =
        group.sourceCycleId ?? group.sourceGripId ?? group.id;
      const id = `${layer.id}:robot-cycle:${encodeURIComponent(stableGroupKey)}`;
      const cycle: RobotCycle = {
        id,
        sequence: cycles.length,
        sequenceInLayer,
        physicalLayerId: layer.id,
        physicalLayerIndex: layer.packageLayerIndex,
        patternRef: layer.patternRef,
        groupId: group.id,
        groupNumber: group.groupNumber,
        placementIds: [...group.placementIds],
        packageCount: group.packageCount,
        gripperId: explicit
          ? (sourceCycle.gripperId ?? resources.gripper?.id ?? null)
          : (resources.gripper?.id ?? null),
        stationId: resources.station?.id ?? null,
        ...poses,
        legacyUnknownFields: sourceCycle
          ? {
              field8: sourceCycle.labelOffset.x,
              field9: sourceCycle.labelOffset.y,
              semantics: "repository-dx-dy-unverified",
              source:
                solution.origin === "imported"
                  ? "imported-project-cycle"
                  : "explicit-project-cycle",
            }
          : null,
        provenance,
      };
      cycles.push(cycle);
      layerCycles.push(cycle);
    }

    if (resources.gripper) {
      diagnostics.push(
        ...validateSuctionCompatibility(
          project.package,
          resources.gripper,
          suggestion.groups,
          resolveMultipackGripperPackageLimits(
            resources.gripper,
            project.package.inletOrientation,
          ) ?? resources.gripper.packageLimits,
        ),
      );
    }
    layers.push({
      physicalLayerId: layer.id,
      physicalLayerIndex: layer.packageLayerIndex,
      patternRef: layer.patternRef,
      cycleIds: layerCycles.map(({ id }) => id),
      placementIds: layer.placements.map(({ id }) => id),
      interlayerBeforeCount: layer.interlayerBeforeIds.length,
    });
  }

  diagnostics.push(...duplicateCycleIdDiagnostics(cycles));
  diagnostics.push(...finitePoseDiagnostics(cycles));
  const conveyor = resources.gripper
    ? createCalculatedRobotConveyorModel({
        projectSourceKind: project.source.kind,
        inletOrientation: project.package.inletOrientation,
        gripperTcpMm: resources.gripper.tcpMm,
        cycles,
        stack,
      })
    : null;
  const collisionObstacles = [
    ...(options.obstacles ?? []),
    ...(conveyor ? [robotConveyorObstacle(conveyor)] : []),
  ];
  if (resources.station && resources.gripper) {
    diagnostics.push(
      ...validateCycleMotionBoundaries(
        cycles.filter(({ pickPose }) => pickPose.frame === "station"),
        resources.station,
        resources.gripper.envelopeMm,
        collisionObstacles,
        options.collisionToleranceMm ?? 0,
      ),
    );
  }

  return {
    kind: "robot-cycle-materialization",
    project,
    projectId: project.id,
    solutionId: solution.id,
    gripper: resources.gripper,
    station: resources.station,
    direction: resources.direction,
    stack,
    conveyor,
    layers,
    cycles,
    diagnostics,
    valid: !diagnostics.some(({ severity }) => severity === "error"),
  };
}
