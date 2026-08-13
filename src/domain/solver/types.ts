import type { PlacementGeometry, RectangleBoundsMm } from "~/domain/geometry";
import type { LayerSymmetry } from "~/domain/geometry/transforms";
import type {
  CandidateIdentityGrip,
  CandidateIdentityPlacement,
} from "~/domain/solver/candidateIdentity";
import type { Rotation, Side } from "~/domain/palletTypes";

export const BASE_GENERATOR_FAMILIES = [
  "row",
  "block",
  "justified-grid",
  "pinwheel",
  "nested-side",
  "edge-ring",
  "mixed-orientation",
] as const;

export type BaseGeneratorFamily = (typeof BASE_GENERATOR_FAMILIES)[number];
export type GeneratorFamily = BaseGeneratorFamily | "symmetry";

export type SolverPackageInput = {
  shape: string;
  dimensionsMm: {
    length: number;
    width: number;
  };
  clearanceMm: number;
};

export type RequiredCandidateShape = "any" | "rectangular-block";

export type RectangularBlockFootprintPolicy =
  | "fill-generation-bounds"
  | "compact-centered";

export type SolverInputConstraints = {
  allowedRotations?: readonly Rotation[];
  edgeClearanceMm?: number;
  minimumPackageCount?: number;
  maximumPackageCount?: number;
  maxPlacements?: number;
  maxBands?: number;
  maxCandidatesPerGenerator?: number;
  provisionalPackagesPerCycle?: number;
  allowMixedPackageOrientations?: boolean;
  /** Physical side carrying the label when package yaw is 0; null disables nearest-edge yaw preference. */
  unrotatedPackageLabelSide?: Side | null;
  requiredShape?: RequiredCandidateShape;
  rectangularBlockFootprintPolicy?: RectangularBlockFootprintPolicy;
};

export type LayerSolverInput = {
  package: SolverPackageInput;
  /** Physical pallet deck, independent of overhang, underhang, and generation bounds. */
  physicalPalletBoundsMm?: RectangleBoundsMm;
  envelopeMm: RectangleBoundsMm;
  generationBoundsMm?: RectangleBoundsMm;
  constraints?: SolverInputConstraints;
};

export type NormalizedSolverConstraints = {
  allowedRotations: readonly Rotation[];
  edgeClearanceMm: number;
  minimumPackageCount: number;
  maximumPackageCount: number;
  maxPlacements: number;
  maxBands: number;
  maxCandidatesPerGenerator: number;
  provisionalPackagesPerCycle: number;
  allowMixedPackageOrientations: boolean;
  unrotatedPackageLabelSide: Side | null;
  requiredShape: RequiredCandidateShape;
  rectangularBlockFootprintPolicy: RectangularBlockFootprintPolicy;
};

export type NormalizedLayerSolverInput = Omit<
  LayerSolverInput,
  "constraints" | "generationBoundsMm" | "physicalPalletBoundsMm"
> & {
  constraints: NormalizedSolverConstraints;
  physicalPalletBoundsMm: RectangleBoundsMm | null;
  usableEnvelopeMm: RectangleBoundsMm;
  generationBoundsMm: RectangleBoundsMm;
};

export type GeneratorParameter = string | number | boolean | null;

export type GeneratorProvenance = {
  family: GeneratorFamily;
  variant: string;
  symmetry?: LayerSymmetry;
  sourceGeometryKey?: string;
  parameters?: Readonly<Record<string, GeneratorParameter>>;
};

export type GeneratedPlacement = PlacementGeometry & {
  /** Deliberately excluded from canonical geometry and candidate identity. */
  transientId?: string;
};

export type GeneratedCandidateDraft = {
  placements: readonly GeneratedPlacement[];
  provenance: readonly GeneratorProvenance[];
};

export type SolverIssueCode =
  | "unsupported-package-shape"
  | "invalid-package-dimensions"
  | "invalid-clearance"
  | "invalid-envelope"
  | "invalid-physical-pallet-bounds"
  | "invalid-input-constraint"
  | "duplicate-allowed-rotation"
  | "package-does-not-fit"
  | "empty-candidate"
  | "non-finite-placement"
  | "unsupported-rotation"
  | "placement-out-of-bounds"
  | "placement-overlap"
  | "mixed-package-orientations-disallowed"
  | "outward-label-yaw-unavailable"
  | "non-rectangular-block"
  | "package-count-below-minimum"
  | "package-count-above-maximum";

export type SolverIssue = {
  code: SolverIssueCode;
  message: string;
  placementIndices?: readonly number[];
};

export type CandidateValidation = {
  valid: boolean;
  issues: readonly SolverIssue[];
};

export type CandidateMetrics = {
  packageCount: number;
  occupiedAreaMm2: number;
  utilization: number;
  utilizationPercent: number;
  boundingBlockLengthMm: number;
  boundingBlockWidthMm: number;
  boundingBlockAreaMm2: number;
  provisionalCycleCount: number;
  provisionalCycleBasis: "generated-grip-groups";
  /** Unknown legacy MultiPack value: never inferred or used for ranking. */
  multiPackBlocks: null;
  multiPackBlocksVerification: "unverified";
};

export type CandidateScore = {
  value: number;
  packageCount: number;
  utilizationMillionths: number;
  provisionalCycleCount: number;
  boundingBlockAreaMm2: number;
  boundingBlockPerimeterMm: number;
  /** Explicitly absent from the score contract. */
  multiPackBlocks: null;
};

export type SolverCandidatePlacement = CandidateIdentityPlacement & {
  sequence: number;
  labelSide: Side | null;
  gripId: string;
};

export type SolverCandidateGrip = CandidateIdentityGrip & {
  groupNumber: number;
  sequence: number;
};

/** Hard ordering implied by vertical overlap geometry or derived dx/dy references. */
export type SolverCandidateOrderDependency = {
  beforeGripId: string;
  afterGripId: string;
};

export type SolverCandidate = {
  rank: number;
  id: string;
  geometryId: string;
  identityFingerprint: string;
  geometryFingerprint: string;
  placements: readonly SolverCandidatePlacement[];
  grips: readonly SolverCandidateGrip[];
  orderDependencies: readonly SolverCandidateOrderDependency[];
  provenance: readonly GeneratorProvenance[];
  validation: CandidateValidation;
  metrics: CandidateMetrics;
  score: CandidateScore;
};

export type SolverExclusionReason =
  | "candidate-invalid"
  | "geometric-duplicate"
  | "generation-limit";

export type SolverExclusion = {
  reason: SolverExclusionReason;
  geometryFingerprint?: string;
  duplicateOfGeometryFingerprint?: string;
  provenance: readonly GeneratorProvenance[];
  issues: readonly SolverIssue[];
  message: string;
};

export type SolverPhase =
  | "input-validation"
  | "generation"
  | "symmetry"
  | "candidate-validation"
  | "deduplication"
  | "metrics"
  | "ranking"
  | "complete"
  | "cancelled";

export type SolverProgress = {
  phase: SolverPhase;
  completed: number;
  total: number | null;
  generator?: GeneratorFamily;
  message: string;
};

export type SolverDiagnostic = {
  severity: "info" | "warning" | "error";
  phase: SolverPhase;
  code: string;
  message: string;
  generator?: GeneratorFamily;
  count?: number;
};

export type SolverStatistics = {
  generatedDraftCount: number;
  validDraftCount: number;
  invalidDraftCount: number;
  geometricDuplicateCount: number;
  candidateCount: number;
  generatedByFamily: Record<GeneratorFamily, number>;
};

export type SolverResult = {
  status: "completed" | "cancelled";
  candidates: readonly SolverCandidate[];
  diagnostics: readonly SolverDiagnostic[];
  exclusions: readonly SolverExclusion[];
  statistics: SolverStatistics;
};

export type SolverOptions = {
  generatorOrder?: readonly BaseGeneratorFamily[];
  includeSymmetryVariants?: boolean;
  progressBatchSize?: number;
  onProgress?: (progress: SolverProgress) => void;
  shouldCancel?: () => boolean;
};
