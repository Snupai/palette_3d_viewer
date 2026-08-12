import type { RectangleBoundsMm } from "~/domain/geometry";
import { migrateProject } from "~/domain/project/projectMigration";
import type { Project, ProjectV2 } from "~/domain/project/projectSchema";
import type { SolverCandidate } from "~/domain/solver/types";
import type {
  MetricProvenance,
  StackPattern,
  StackPatternLabelOrientationPolicy,
} from "~/domain/stack/types";

function encodedReferencePart(value: string): string {
  return encodeURIComponent(value);
}

export function projectPatternReference(
  projectId: string,
  solutionId: string,
  patternId: string,
): string {
  return `project-pattern:${encodedReferencePart(projectId)}:${encodedReferencePart(solutionId)}:${encodedReferencePart(patternId)}`;
}

export function solverCandidatePatternReference(candidateId: string): string {
  return `solver-candidate:${encodedReferencePart(candidateId)}`;
}

function projectTransformFrameProvenance(
  frame: RectangleBoundsMm | null,
): MetricProvenance {
  return frame === null
    ? {
        status: "unknown",
        source: "missing-project-pallet",
        detail:
          "No project pallet load envelope is available as transform frame.",
      }
    : {
        status: "derived",
        source: "project-pallet-load-envelope",
        detail:
          "The frame is the pallet dimensions adjusted by the configured per-side overhang/underhang.",
      };
}

export function stackPatternsFromProjectSolution(
  projectInput: Project | ProjectV2,
  solutionId: string | null = projectInput.activeSolutionId,
  transformFrameMm: RectangleBoundsMm | null = null,
): StackPattern[] {
  const project = migrateProject(projectInput);
  const solution = project.solutions.find(({ id }) => id === solutionId);
  if (!solution) {
    throw new Error(
      solutionId
        ? `Project solution "${solutionId}" does not exist.`
        : "Project has no active solution.",
    );
  }

  return solution.patterns.map((pattern) => {
    const cycles = solution.robotCycles
      .filter(({ patternId }) => patternId === pattern.id)
      .sort((left, right) => left.sequence - right.sequence)
      .map((cycle) => ({
        sourceCycleId: cycle.id,
        sequence: cycle.sequence,
        gripId: cycle.gripId,
        placementIds: [...cycle.placementIds],
        gripperId: cycle.gripperId,
        pickPose: { ...cycle.pickPose },
        placePose: { ...cycle.placePose },
        labelOffset: { ...cycle.labelOffset },
      }));
    const cycleCount =
      cycles.length > 0 || pattern.placements.length === 0
        ? cycles.length
        : null;

    return {
      ref: projectPatternReference(project.id, solution.id, pattern.id),
      name: pattern.name,
      placements: pattern.placements
        .slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map((placement) => ({
          sourcePlacementId: placement.id,
          sequence: placement.sequence,
          positionMm: { ...placement.positionMm },
          rotation: placement.rotation,
          gripId: placement.gripId,
          labelSide: placement.labelSide,
        })),
      grips: pattern.grips.map((grip, sequence) => ({
        sourceGripId: grip.id,
        groupNumber: grip.groupNumber ?? sequence + 1,
        sequence,
        pickX: grip.pickX,
        pickY: grip.pickY,
        pickRotation: grip.pickRotation,
        x: grip.x,
        y: grip.y,
        rotation: grip.rotation,
        numPackages: grip.numPackages,
        dx: grip.dx,
        dy: grip.dy,
      })),
      groupOrder: [...(pattern.groupOrder ?? [])],
      orderDependencies: (pattern.orderDependencies ?? []).map(
        (dependency) => ({
          ...dependency,
        }),
      ),
      cycles,
      cycleCount,
      cycleCountProvenance:
        cycleCount === null
          ? {
              status: "unknown",
              source: "project-pattern-without-cycles",
              detail:
                "The project pattern has placements but no explicit robot cycles.",
            }
          : {
              status: "derived",
              source: "project-robot-cycles",
              detail:
                "Cycle count is the number of canonical project cycles for this pattern.",
            },
      transformFrameMm,
      transformFrameProvenance:
        projectTransformFrameProvenance(transformFrameMm),
      provenance: {
        kind: "project-pattern",
        projectSchemaVersion: project.schemaVersion,
        projectId: project.id,
        solutionId: solution.id,
        solutionOrigin: solution.origin,
        patternId: pattern.id,
      },
    } satisfies StackPattern;
  });
}

export type SolverCandidateStackPatternOptions = {
  ref?: string;
  name?: string;
  transformFrameMm?: RectangleBoundsMm | null;
  transformFrameProvenance?: MetricProvenance;
  labelOrientationPolicy?: StackPatternLabelOrientationPolicy | null;
  maxReferenceGapMm?: number;
};

export function stackPatternFromSolverCandidate(
  candidate: SolverCandidate,
  options: SolverCandidateStackPatternOptions = {},
): StackPattern {
  const transformFrameMm = options.transformFrameMm ?? null;
  return {
    ref: options.ref ?? solverCandidatePatternReference(candidate.id),
    name: options.name ?? `Candidate ${candidate.rank}`,
    placements: candidate.placements.map((placement, index) => ({
      sourcePlacementId: `${candidate.id}-placement-${index + 1}`,
      sequence: placement.sequence,
      positionMm: { ...placement.positionMm },
      rotation: placement.rotation,
      gripId: placement.gripId,
      labelSide: placement.labelSide,
    })),
    grips: candidate.grips.map((grip) => ({
      sourceGripId: grip.id,
      groupNumber: grip.groupNumber,
      sequence: grip.sequence,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickRotation: grip.pickRotation,
      x: grip.x,
      y: grip.y,
      rotation: grip.rotation,
      numPackages: grip.numPackages,
      dx: grip.dx,
      dy: grip.dy,
    })),
    groupOrder: [...candidate.grips]
      .sort(
        (left, right) =>
          left.sequence - right.sequence || left.id.localeCompare(right.id),
      )
      .map(({ id }) => id),
    orderDependencies: candidate.orderDependencies.map((dependency) => ({
      ...dependency,
    })),
    cycles: [],
    cycleCount: candidate.metrics.provisionalCycleCount,
    cycleCountProvenance: {
      status: "unverified",
      source: `solver-candidate:${candidate.metrics.provisionalCycleBasis}`,
      detail:
        "The count equals the generated grip assignments; no explicit robot cycles or production timing are implied.",
    },
    transformFrameMm,
    transformFrameProvenance:
      options.transformFrameProvenance ??
      (transformFrameMm === null
        ? {
            status: "unknown",
            source: "missing-solver-transform-frame",
            detail:
              "No solver envelope was supplied; non-identity transforms will use pattern bounds.",
          }
        : {
            status: "derived",
            source: "solver-envelope",
            detail:
              "The caller supplied the solver/pallet envelope as transform frame.",
          }),
    labelOrientationPolicy: options.labelOrientationPolicy
      ? {
          unrotatedPackageLabelSide:
            options.labelOrientationPolicy.unrotatedPackageLabelSide,
          allowedRotations: [
            ...options.labelOrientationPolicy.allowedRotations,
          ],
        }
      : null,
    generatedGripPolicy: {
      maxReferenceGapMm: options.maxReferenceGapMm ?? 0,
    },
    provenance: {
      kind: "solver-candidate",
      candidateId: candidate.id,
      geometryId: candidate.geometryId,
      identityFingerprint: candidate.identityFingerprint,
      geometryFingerprint: candidate.geometryFingerprint,
      rank: candidate.rank,
      generators: candidate.provenance.map((provenance) => ({ ...provenance })),
    },
  };
}
