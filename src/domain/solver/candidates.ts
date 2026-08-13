import {
  canonicalizePlacementOrder,
  canonicalPlacementGeometryKey,
} from "~/domain/geometry";
import {
  candidateGeometryFingerprint,
  candidateIdentityFingerprint,
  createCandidateGeometryId,
  createCandidateId,
} from "~/domain/solver/candidateIdentity";
import {
  buildGripVerticalOverlapDependencies,
  deriveGripDeltasForPlacementOrder,
  mergeGripOrderDependencies,
  orderGripsByDependencies,
} from "~/domain/gripDependencies";
import { partitionPlacementsForSuction } from "~/domain/robotics/grouping";
import { selectNearestEdgeLabelYaw } from "~/domain/solver/labelOrientation";
import {
  calculateCandidateMetrics,
  compareSolverCandidates,
  scoreCandidateMetrics,
} from "~/domain/solver/metrics";
import type {
  GeneratedCandidateDraft,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
  SolverCandidate,
  SolverDiagnostic,
  SolverExclusion,
  SolverIssue,
  SolverPhase,
} from "~/domain/solver/types";
import { validateCandidatePlacements } from "~/domain/solver/validation";

export type CandidateFinalizationHooks = {
  checkpoint?: (
    phase: Extract<
      SolverPhase,
      "candidate-validation" | "deduplication" | "metrics" | "ranking"
    >,
    completed: number,
    total: number,
  ) => boolean;
};

export type CandidateFinalizationResult = {
  candidates: SolverCandidate[];
  diagnostics: SolverDiagnostic[];
  exclusions: SolverExclusion[];
  validDraftCount: number;
  invalidDraftCount: number;
  geometricDuplicateCount: number;
  cancelled: boolean;
};

type CandidateAggregate = {
  placements: SolverCandidate["placements"];
  grips: SolverCandidate["grips"];
  orderDependencies: SolverCandidate["orderDependencies"];
  validation: SolverCandidate["validation"];
  provenanceByKey: Map<string, GeneratorProvenance>;
  geometryFingerprint: string;
};

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueProvenance(
  values: readonly GeneratorProvenance[],
): GeneratorProvenance[] {
  const byKey = new Map<string, GeneratorProvenance>();
  for (const value of values) byKey.set(stableValue(value), value);
  return [...byKey.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, value]) => value);
}

type UngroupedCandidatePlacement = Omit<
  SolverCandidate["placements"][number],
  "gripId"
> & { gripId: null };

type CanonicalCandidatePlacementResult =
  | { placements: readonly UngroupedCandidatePlacement[]; issues: readonly [] }
  | { placements: null; issues: readonly SolverIssue[] };

type LabeledGeneratedPlacement =
  GeneratedCandidateDraft["placements"][number] & {
    labelSide: SolverCandidate["placements"][number]["labelSide"];
  };

function canonicalCandidatePlacements(
  input: NormalizedLayerSolverInput,
  draft: GeneratedCandidateDraft,
): CanonicalCandidatePlacementResult {
  const unrotatedPackageLabelSide = input.constraints.unrotatedPackageLabelSide;
  const infeasiblePlacementIndices: number[] = [];
  const placements = draft.placements.flatMap<LabeledGeneratedPlacement>(
    (placement, placementIndex) => {
      if (unrotatedPackageLabelSide === null) {
        return [{ ...placement, labelSide: null }];
      }
      const oriented = selectNearestEdgeLabelYaw(
        placement.positionMm,
        placement.rotation,
        unrotatedPackageLabelSide,
        input.package.dimensionsMm,
        input.physicalPalletBoundsMm!,
        input.constraints.allowedRotations,
      );
      if (oriented.status === "infeasible") {
        infeasiblePlacementIndices.push(placementIndex);
        return [];
      }
      return [
        {
          ...placement,
          rotation: oriented.rotation,
          labelSide: oriented.labelSide,
        },
      ];
    },
  );

  if (infeasiblePlacementIndices.length > 0) {
    return {
      placements: null,
      issues: [
        {
          code: "outward-label-yaw-unavailable",
          placementIndices: infeasiblePlacementIndices,
          message: `Candidate has no allowed yaw in the existing footprint orientation at placement${infeasiblePlacementIndices.length === 1 ? "" : "s"} ${infeasiblePlacementIndices.map((index) => index + 1).join(", ")}.`,
        },
      ],
    };
  }

  return {
    placements: canonicalizePlacementOrder(placements).map(
      (placement, sequence) => ({
        sequence,
        positionMm: { ...placement.positionMm },
        rotation: placement.rotation,
        labelSide: placement.labelSide,
        gripId: null,
      }),
    ),
    issues: [],
  };
}

function groupCandidatePlacements(
  input: NormalizedLayerSolverInput,
  placements: readonly UngroupedCandidatePlacement[],
): Pick<SolverCandidate, "placements" | "grips" | "orderDependencies"> {
  const groupable = placements.map((placement) => ({
    ...placement,
    id: `placement-${placement.sequence + 1}`,
  }));
  const partitions = partitionPlacementsForSuction(groupable, {
    packageLengthMm: input.package.dimensionsMm.length,
    maxPackagesPerPick: input.constraints.provisionalPackagesPerCycle,
  });
  const gripIdByPlacementSequence = new Map<number, string>();
  const rawGrips = partitions.map((members) => {
    const id = `generated-grip:${members
      .map(({ sequence: placementSequence }) => placementSequence + 1)
      .join("+")}`;
    const center = members.reduce(
      (total, placement) => ({
        x: total.x + placement.positionMm.x,
        y: total.y + placement.positionMm.y,
      }),
      { x: 0, y: 0 },
    );
    members.forEach((placement) =>
      gripIdByPlacementSequence.set(placement.sequence, id),
    );
    return {
      id,
      groupNumber: 0,
      sequence: 0,
      pickX: 0,
      pickY: 0,
      pickRotation: 0 as const,
      x: center.x / members.length,
      y: center.y / members.length,
      rotation: members[0]!.rotation,
      numPackages: members.length,
      dx: 0,
      dy: 0,
    };
  });
  const placementsWithGripIds = placements.map((placement) => ({
    ...placement,
    gripId: gripIdByPlacementSequence.get(placement.sequence)!,
  }));
  const verticalDependencies = buildGripVerticalOverlapDependencies(
    rawGrips.map(({ id }) => id),
    placementsWithGripIds,
    input.package.dimensionsMm,
  );
  const ungrippedGrips = orderGripsByDependencies(
    rawGrips,
    verticalDependencies,
  ).map((grip, sequence) => ({
    ...grip,
    groupNumber: sequence + 1,
    sequence,
  }));

  // Grips are placed in array order, so a blue line may only reference a grip
  // that is already on the pallet. `deriveGripDeltasForPlacementOrder` enforces
  // that and therefore leaves the first grip at 0/0.
  const derived = deriveGripDeltasForPlacementOrder(
    ungrippedGrips,
    input.package.dimensionsMm.length,
    input.package.dimensionsMm.width,
    input.package.inletOrientation === "crosswise" ? 1 : 0,
    { maxReferenceGapMm: input.package.clearanceMm },
  );
  const grips = ungrippedGrips.map((grip, index) => ({
    ...grip,
    dx: derived.deltas[index]?.dx ?? 0,
    dy: derived.deltas[index]?.dy ?? 0,
  }));
  const deltaDependencies = derived.dependencies.flatMap(
    ({ prerequisiteIndex, dependentIndex }) => {
      const beforeGripId = grips[prerequisiteIndex]?.id;
      const afterGripId = grips[dependentIndex]?.id;
      return beforeGripId && afterGripId ? [{ beforeGripId, afterGripId }] : [];
    },
  );
  const orderDependencies = mergeGripOrderDependencies(
    verticalDependencies,
    deltaDependencies,
  );

  return {
    placements: placementsWithGripIds,
    grips,
    orderDependencies,
  };
}

function deterministicDraftKey(draft: GeneratedCandidateDraft): string {
  let geometryKey: string;
  try {
    geometryKey = canonicalPlacementGeometryKey(draft.placements);
  } catch {
    geometryKey = stableValue(draft.placements);
  }
  return `${geometryKey}:${stableValue(sortedUniqueProvenance(draft.provenance))}`;
}

function sortExclusions(exclusions: SolverExclusion[]): SolverExclusion[] {
  return exclusions.sort((left, right) =>
    compareStrings(
      `${left.reason}:${left.geometryFingerprint ?? ""}:${left.message}:${stableValue(left.provenance)}`,
      `${right.reason}:${right.geometryFingerprint ?? ""}:${right.message}:${stableValue(right.provenance)}`,
    ),
  );
}

function sortDiagnostics(diagnostics: SolverDiagnostic[]): SolverDiagnostic[] {
  return diagnostics.sort((left, right) =>
    compareStrings(
      `${left.phase}:${left.code}:${left.generator ?? ""}:${left.message}`,
      `${right.phase}:${right.code}:${right.generator ?? ""}:${right.message}`,
    ),
  );
}

export function finalizeGeneratedCandidates(
  input: NormalizedLayerSolverInput,
  draftsInput: readonly GeneratedCandidateDraft[],
  hooks: CandidateFinalizationHooks = {},
): CandidateFinalizationResult {
  const drafts = [...draftsInput].sort((left, right) =>
    compareStrings(deterministicDraftKey(left), deterministicDraftKey(right)),
  );
  const diagnostics: SolverDiagnostic[] = [];
  const exclusions: SolverExclusion[] = [];
  const aggregateByGeometry = new Map<string, CandidateAggregate>();
  let validDraftCount = 0;
  let invalidDraftCount = 0;
  let geometricDuplicateCount = 0;
  let labelYawRejectedDraftCount = 0;

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    const canonical = canonicalCandidatePlacements(input, draft);
    if (canonical.placements === null) {
      invalidDraftCount += 1;
      labelYawRejectedDraftCount += 1;
      exclusions.push({
        reason: "candidate-invalid",
        provenance: sortedUniqueProvenance(draft.provenance),
        issues: canonical.issues,
        message: canonical.issues.map(({ message }) => message).join(" "),
      });
    } else {
      const placements = canonical.placements;
      const validation = validateCandidatePlacements(input, placements);
      if (!validation.valid) {
        invalidDraftCount += 1;
        exclusions.push({
          reason: "candidate-invalid",
          provenance: sortedUniqueProvenance(draft.provenance),
          issues: validation.issues,
          message: validation.issues.map(({ message }) => message).join(" "),
        });
      } else {
        validDraftCount += 1;
        const geometryFingerprint = candidateGeometryFingerprint({
          placements,
        });
        const existing = aggregateByGeometry.get(geometryFingerprint);
        if (existing) {
          geometricDuplicateCount += 1;
          for (const provenance of draft.provenance) {
            existing.provenanceByKey.set(stableValue(provenance), provenance);
          }
          exclusions.push({
            reason: "geometric-duplicate",
            geometryFingerprint,
            duplicateOfGeometryFingerprint: geometryFingerprint,
            provenance: sortedUniqueProvenance(draft.provenance),
            issues: [],
            message:
              "Draft matches an existing exact placement geometry and was merged into its provenance.",
          });
        } else {
          const grouped = groupCandidatePlacements(input, placements);
          aggregateByGeometry.set(geometryFingerprint, {
            placements: grouped.placements,
            grips: grouped.grips,
            orderDependencies: grouped.orderDependencies,
            validation,
            provenanceByKey: new Map(
              sortedUniqueProvenance(draft.provenance).map((provenance) => [
                stableValue(provenance),
                provenance,
              ]),
            ),
            geometryFingerprint,
          });
        }
      }
    }

    if (
      hooks.checkpoint?.("candidate-validation", index + 1, drafts.length) ===
      false
    ) {
      return {
        candidates: [],
        diagnostics: sortDiagnostics(diagnostics),
        exclusions: sortExclusions(exclusions),
        validDraftCount,
        invalidDraftCount,
        geometricDuplicateCount,
        cancelled: true,
      };
    }
  }

  if (labelYawRejectedDraftCount > 0) {
    diagnostics.push({
      severity: "warning",
      phase: "candidate-validation",
      code: "outward-label-yaw-unavailable",
      count: labelYawRejectedDraftCount,
      message: `${labelYawRejectedDraftCount} generated candidate${labelYawRejectedDraftCount === 1 ? " was" : "s were"} rejected because at least one placement had no allowed yaw in its existing footprint orientation.`,
    });
  }

  if (
    hooks.checkpoint?.("deduplication", drafts.length, drafts.length) === false
  ) {
    return {
      candidates: [],
      diagnostics: sortDiagnostics(diagnostics),
      exclusions: sortExclusions(exclusions),
      validDraftCount,
      invalidDraftCount,
      geometricDuplicateCount,
      cancelled: true,
    };
  }

  const aggregates = [...aggregateByGeometry.values()].sort((left, right) =>
    compareStrings(left.geometryFingerprint, right.geometryFingerprint),
  );
  const unranked: Array<Omit<SolverCandidate, "rank">> = [];
  const identityByCompactId = new Map<string, string>();
  const geometryByCompactId = new Map<string, string>();

  for (let index = 0; index < aggregates.length; index += 1) {
    const aggregate = aggregates[index]!;
    const identityInput = {
      placements: aggregate.placements,
      grips: aggregate.grips,
    };
    const identityFingerprint = candidateIdentityFingerprint(identityInput);
    const id = createCandidateId(identityInput);
    const geometryId = createCandidateGeometryId(identityInput);
    const previousIdentity = identityByCompactId.get(id);
    if (previousIdentity && previousIdentity !== identityFingerprint) {
      diagnostics.push({
        severity: "error",
        phase: "metrics",
        code: "candidate-id-hash-collision",
        message: `Compact candidate id ${id} maps to multiple full fingerprints; both candidates were retained.`,
      });
    }
    identityByCompactId.set(id, identityFingerprint);
    const previousGeometry = geometryByCompactId.get(geometryId);
    if (
      previousGeometry &&
      previousGeometry !== aggregate.geometryFingerprint
    ) {
      diagnostics.push({
        severity: "error",
        phase: "metrics",
        code: "geometry-id-hash-collision",
        message: `Compact geometry id ${geometryId} maps to multiple full fingerprints; both geometries were retained.`,
      });
    }
    geometryByCompactId.set(geometryId, aggregate.geometryFingerprint);

    const metrics = calculateCandidateMetrics(
      input,
      aggregate.placements,
      aggregate.grips.length,
    );
    unranked.push({
      id,
      geometryId,
      identityFingerprint,
      geometryFingerprint: aggregate.geometryFingerprint,
      placements: aggregate.placements,
      grips: aggregate.grips,
      orderDependencies: aggregate.orderDependencies,
      provenance: [...aggregate.provenanceByKey.entries()]
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([, provenance]) => provenance),
      validation: aggregate.validation,
      metrics,
      score: scoreCandidateMetrics(metrics),
    });

    if (hooks.checkpoint?.("metrics", index + 1, aggregates.length) === false) {
      return {
        candidates: [],
        diagnostics: sortDiagnostics(diagnostics),
        exclusions: sortExclusions(exclusions),
        validDraftCount,
        invalidDraftCount,
        geometricDuplicateCount,
        cancelled: true,
      };
    }
  }

  unranked.sort(compareSolverCandidates);
  const candidates = unranked.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
  const rankingContinues =
    hooks.checkpoint?.("ranking", candidates.length, candidates.length) ?? true;

  return {
    candidates: rankingContinues ? candidates : [],
    diagnostics: sortDiagnostics(diagnostics),
    exclusions: sortExclusions(exclusions),
    validDraftCount,
    invalidDraftCount,
    geometricDuplicateCount,
    cancelled: !rankingContinues,
  };
}
