import {
  canonicalizePlacementOrder,
  canonicalPlacementGeometryKey,
  envelopePreservingSymmetries,
  transformPlacements,
  type LayerSymmetry,
  type RectangleBoundsMm,
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
import {
  BASE_GENERATOR_FAMILIES,
  type GeneratedCandidateDraft,
  type GeneratorProvenance,
  type NormalizedLayerSolverInput,
  type SolverCandidate,
  type SolverDiagnostic,
  type SolverExclusion,
  type SolverIssue,
  type SolverPhase,
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
  representative: Omit<SolverCandidate, "rank">;
  provenanceByKey: Map<string, GeneratorProvenance>;
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

type CandidateLabelSide = NonNullable<
  SolverCandidate["placements"][number]["labelSide"]
>;

const labelSideVector: Record<CandidateLabelSide, { x: number; y: number }> = {
  top: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
};

const labelSideForVector = new Map(
  Object.entries(labelSideVector).map(([labelSide, vector]) => [
    `${vector.x},${vector.y}`,
    labelSide as CandidateLabelSide,
  ]),
);

function transformLabelSide(
  labelSide: CandidateLabelSide | null,
  symmetry: LayerSymmetry,
): CandidateLabelSide | null {
  if (labelSide === null || symmetry === "identity") return labelSide;
  const vector = labelSideVector[labelSide];
  const transformed = (() => {
    switch (symmetry) {
      case "rotate-90":
        return { x: -vector.y, y: vector.x };
      case "rotate-180":
        return { x: -vector.x, y: -vector.y };
      case "rotate-270":
        return { x: vector.y, y: -vector.x };
      case "mirror-x":
        return { x: -vector.x, y: vector.y };
      case "mirror-y":
        return { x: vector.x, y: -vector.y };
      case "transpose-main":
        return { x: vector.y, y: vector.x };
      case "transpose-anti":
        return { x: -vector.y, y: -vector.x };
    }
  })();
  return (
    labelSideForVector.get(`${transformed.x},${transformed.y}`) ?? labelSide
  );
}

function candidateSymmetryClassKey(
  placements: readonly UngroupedCandidatePlacement[],
  frame: RectangleBoundsMm,
): string {
  const keys = envelopePreservingSymmetries(frame, true).map((symmetry) =>
    stableValue(
      canonicalizePlacementOrder(
        transformPlacements(placements, frame, symmetry).map((placement) => ({
          ...placement,
          labelSide: transformLabelSide(placement.labelSide, symmetry),
        })),
      ).map(({ positionMm, rotation, labelSide }) => ({
        x: positionMm.x,
        y: positionMm.y,
        footprintRotation: rotation % 180,
        labelSide,
      })),
    ),
  );
  keys.sort(compareStrings);
  return `pallet-symmetry-v1:${keys[0] ?? "[]"}`;
}

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

function createUnrankedCandidate(
  input: NormalizedLayerSolverInput,
  grouped: Pick<SolverCandidate, "placements" | "grips" | "orderDependencies">,
  validation: SolverCandidate["validation"],
  geometryFingerprint: string,
): Omit<SolverCandidate, "rank"> {
  const identityInput = {
    placements: grouped.placements,
    grips: grouped.grips,
  };
  const metrics = calculateCandidateMetrics(
    input,
    grouped.placements,
    grouped.grips.length,
  );
  return {
    id: createCandidateId(identityInput),
    geometryId: createCandidateGeometryId(identityInput),
    identityFingerprint: candidateIdentityFingerprint(identityInput),
    geometryFingerprint,
    placements: grouped.placements,
    grips: grouped.grips,
    orderDependencies: grouped.orderDependencies,
    provenance: [],
    validation,
    metrics,
    score: scoreCandidateMetrics(metrics),
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

const representativeFamilyRank = new Map(
  [...BASE_GENERATOR_FAMILIES, "symmetry"].map((family, index) => [
    family,
    index,
  ]),
);

function compareDraftsForRepresentative(
  left: GeneratedCandidateDraft,
  right: GeneratedCandidateDraft,
): number {
  const leftIsGeneratedSymmetry = left.provenance.some(
    ({ family }) => family === "symmetry",
  );
  const rightIsGeneratedSymmetry = right.provenance.some(
    ({ family }) => family === "symmetry",
  );
  const leftPriority = left.representativePriority;
  const rightPriority = right.representativePriority;
  return (
    Number(leftIsGeneratedSymmetry) - Number(rightIsGeneratedSymmetry) ||
    (leftPriority
      ? representativeFamilyRank.get(leftPriority.family)!
      : Number.MAX_SAFE_INTEGER) -
      (rightPriority
        ? representativeFamilyRank.get(rightPriority.family)!
        : Number.MAX_SAFE_INTEGER) ||
    (leftPriority?.index ?? Number.MAX_SAFE_INTEGER) -
      (rightPriority?.index ?? Number.MAX_SAFE_INTEGER) ||
    compareStrings(deterministicDraftKey(left), deterministicDraftKey(right))
  );
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
  const drafts = [...draftsInput].sort(compareDraftsForRepresentative);
  const diagnostics: SolverDiagnostic[] = [];
  const exclusions: SolverExclusion[] = [];
  const aggregateBySymmetryClass = new Map<string, CandidateAggregate>();
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
        const symmetryClassKey = candidateSymmetryClassKey(
          placements,
          input.generationBoundsMm,
        );
        const grouped = groupCandidatePlacements(input, placements);
        const candidate = createUnrankedCandidate(
          input,
          grouped,
          validation,
          geometryFingerprint,
        );
        const draftProvenance = sortedUniqueProvenance(draft.provenance);
        const existing = aggregateBySymmetryClass.get(symmetryClassKey);
        if (existing) {
          geometricDuplicateCount += 1;
          for (const provenance of draft.provenance) {
            existing.provenanceByKey.set(stableValue(provenance), provenance);
          }
          exclusions.push({
            reason: "geometric-duplicate",
            geometryFingerprint: candidate.geometryFingerprint,
            duplicateOfGeometryFingerprint:
              existing.representative.geometryFingerprint,
            provenance: draftProvenance,
            issues: [],
            message:
              "Draft is a pallet mirror or rotation of an existing base layout and was merged into its provenance.",
          });
        } else {
          aggregateBySymmetryClass.set(symmetryClassKey, {
            representative: candidate,
            provenanceByKey: new Map(
              draftProvenance.map((provenance) => [
                stableValue(provenance),
                provenance,
              ]),
            ),
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

  const aggregates = [...aggregateBySymmetryClass.values()].sort(
    (left, right) =>
      compareStrings(
        left.representative.geometryFingerprint,
        right.representative.geometryFingerprint,
      ),
  );
  const unranked: Array<Omit<SolverCandidate, "rank">> = [];
  const identityByCompactId = new Map<string, string>();
  const geometryByCompactId = new Map<string, string>();

  for (let index = 0; index < aggregates.length; index += 1) {
    const aggregate = aggregates[index]!;
    const representative = aggregate.representative;
    const previousIdentity = identityByCompactId.get(representative.id);
    if (
      previousIdentity &&
      previousIdentity !== representative.identityFingerprint
    ) {
      diagnostics.push({
        severity: "error",
        phase: "metrics",
        code: "candidate-id-hash-collision",
        message: `Compact candidate id ${representative.id} maps to multiple full fingerprints; both candidates were retained.`,
      });
    }
    identityByCompactId.set(
      representative.id,
      representative.identityFingerprint,
    );
    const previousGeometry = geometryByCompactId.get(representative.geometryId);
    if (
      previousGeometry &&
      previousGeometry !== representative.geometryFingerprint
    ) {
      diagnostics.push({
        severity: "error",
        phase: "metrics",
        code: "geometry-id-hash-collision",
        message: `Compact geometry id ${representative.geometryId} maps to multiple full fingerprints; both geometries were retained.`,
      });
    }
    geometryByCompactId.set(
      representative.geometryId,
      representative.geometryFingerprint,
    );

    unranked.push({
      ...representative,
      provenance: [...aggregate.provenanceByKey.entries()]
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([, provenance]) => provenance),
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
