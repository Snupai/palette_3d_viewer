import type { PlacementGeometry, RectangleBoundsMm } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";
import type {
  LayerSolverInput,
  SolverCandidate,
  SolverResult,
} from "~/domain/solver/types";
import type { PhysicalFootprintOrientationHistogram } from "~/lib/parity/physicalGeometry";

export const CORPUS_REPORT_SCHEMA_VERSION = 2 as const;

export const CORPUS_PARITY_STATUSES = [
  "PASS",
  "FAIL",
  "OBSERVED",
  "BLOCKED",
  "SKIPPED",
] as const;

export type CorpusParityStatus = (typeof CORPUS_PARITY_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CorpusMismatch = {
  path: string;
  expected?: JsonValue;
  actual?: JsonValue;
  detail?: string;
};

export type CorpusCheck = {
  id: string;
  status: CorpusParityStatus;
  summary: string;
  evidence: Record<string, JsonValue>;
  mismatches: CorpusMismatch[];
};

export type CorpusStatusCounts = Record<CorpusParityStatus, number>;

export const ROB_CORPUS_SCENARIO_IDS = [
  "nominal-strict-v1",
  "observed-envelope-v1",
] as const;

export type RobCorpusScenarioId = (typeof ROB_CORPUS_SCENARIO_IDS)[number];

export type OrientationHistogram = Record<`${Rotation}`, number>;

export type RobEncodedInputSummary = {
  packageDimensionsMm: {
    length: number;
    width: number;
    height: number;
  };
  palletDimensionsMm: {
    length: number;
    width: number;
    height: number;
  } | null;
  inputDirection: {
    value: 0 | 1;
    explicit: boolean;
  };
  sourceFeasiblePackageCount: number;
  sourceFeasibleCountRole: "feasible-reference-not-asserted-maximum";
  fieldsNotEncoded: readonly [
    "clearance",
    "allowed-overhang",
    "multipick-eligibility",
    "gripper",
    "station",
  ];
};

export type RobCorpusScenario = {
  id: RobCorpusScenarioId;
  basis: "strict-policy" | "source-observation";
  solverInput: LayerSolverInput | null;
  inputSummary: {
    clearanceMm: 0;
    allowedOverhangPolicyMm: {
      lengthPerSide: 0;
      widthPerSide: 0;
    } | null;
    envelopeMm: RectangleBoundsMm | null;
    envelopeSource: "encoded-pallet" | "observed-source-extents";
    observationOnly: boolean;
    sourcePackageCountConstraintApplied: false;
    allowedRotationsSource: "unconstrained-because-gripper-not-encoded";
  };
  skipReason: string | null;
};

export type SourcePatternCharacterization = {
  ordinal: number;
  sourceUniqueLayerId: number;
  packageCount: number;
  gripCount: number;
  placements: readonly PlacementGeometry[];
  geometryId: string;
  geometryFingerprint: string;
  boundsMm: RectangleBoundsMm | null;
  /** Directed package yaw after applying the encoded input-direction quarter-turn. */
  orientations: OrientationHistogram;
  /** Raw ROB place yaw, expanded by package count and retained for robotics evidence. */
  placeOrientations: OrientationHistogram;
  physicalFootprintOrientations: PhysicalFootprintOrientationHistogram;
};

export type SourcePhysicalLayerCharacterization = {
  physicalLayerIndex: number;
  sourceUniqueLayerId: number;
  sourcePatternOrdinal: number | null;
  patternEqualityId: string;
  geometryId: string;
  packageCount: number;
  cycleCount: number;
  interlayerBefore: number;
};

export type SourceFamily = {
  id: string;
  packageDimensionsMm: RobEncodedInputSummary["packageDimensionsMm"];
  palletDimensionsMm: RobEncodedInputSummary["palletDimensionsMm"];
  inputDirection: RobEncodedInputSummary["inputDirection"];
};

export type SourceCharacterization = {
  encodedInput: RobEncodedInputSummary;
  family: SourceFamily;
  patterns: SourcePatternCharacterization[];
  observedEnvelopeMm: RectangleBoundsMm | null;
  stack: {
    physicalLayerCount: number;
    sourcePatternIdentitySequence: number[];
    patternEqualitySequence: string[];
    physicalLayers: SourcePhysicalLayerCharacterization[];
    packagesPerPhysicalLayer: number[];
    cyclesPerPhysicalLayer: number[];
    interlayersBeforePhysicalLayers: number[];
    trailingInterlayer: number;
  };
  robotics: {
    sourceGripCountsByPattern: number[];
    sourceCyclesPerPhysicalLayer: number[];
    parityScope: "Open";
    generatedComparison: "blocked-until-group-planning";
  };
};

export type SourcePatternReport = Omit<
  SourcePatternCharacterization,
  "placements" | "geometryFingerprint"
>;

export type SourceCharacterizationReport = Omit<
  SourceCharacterization,
  "patterns"
> & {
  patterns: SourcePatternReport[];
};

export type CandidateGeometryMatch = {
  matched: boolean;
  candidateRank: number | null;
  candidateId: string | null;
  symmetry: string | null;
};

export type PatternGeneratedComparison = {
  sourcePatternOrdinal: number;
  sourceUniqueLayerId: number;
  sourcePackageCount: number;
  sourceCountRole: "feasible-reference-not-asserted-maximum";
  sourceBoundsMm: RectangleBoundsMm | null;
  sourceOrientations: OrientationHistogram;
  sourcePlaceOrientations: OrientationHistogram;
  sourcePhysicalFootprintOrientations: PhysicalFootprintOrientationHistogram;
  physicalFootprintExact: CandidateGeometryMatch;
  physicalFootprintRobIntegerCompatible: CandidateGeometryMatch;
  operationalDirectedYawExact: CandidateGeometryMatch;
  acceptedMatchKind:
    | "physical-footprint-exact"
    | "physical-footprint-rob-integer-compatible"
    | null;
  acceptedSymmetry: string | null;
  matchedCandidateRank: number | null;
  matchedCandidateBoundsMm: RectangleBoundsMm | null;
  matchedCandidateOrientations: OrientationHistogram | null;
  matchedCandidatePhysicalFootprintOrientations: PhysicalFootprintOrientationHistogram | null;
  maximumCenterDisplacementMm: number | null;
  maximumBoundsDifferenceMm: number | null;
  generatedMaximumPackageCount: number;
  generatedMaximumRelationToSource: "below" | "equal" | "above";
  checks: CorpusCheck[];
  status: CorpusParityStatus;
};

export type SolverRunSummary = {
  status: SolverResult["status"];
  candidateCount: number;
  generatedMaximumPackageCount: number;
  generationLimitReached: boolean;
  diagnostics: Array<{
    severity: "info" | "warning" | "error";
    phase: string;
    code: string;
    generator: string | null;
    count: number | null;
  }>;
};

export type ScenarioComparisonReport = {
  id: RobCorpusScenarioId;
  basis: RobCorpusScenario["basis"];
  input: RobCorpusScenario["inputSummary"];
  status: CorpusParityStatus;
  skipReason: string | null;
  solver: SolverRunSummary | null;
  patterns: PatternGeneratedComparison[];
  checks: CorpusCheck[];
};

export type CorpusDiscoveryIssueCode =
  | "symlink-rejected"
  | "out-of-root-rejected"
  | "not-regular-file"
  | "file-too-large"
  | "entry-unreadable";

export type CorpusDiscoveryIssue = {
  basename: string;
  code: CorpusDiscoveryIssueCode;
  status: "SKIPPED";
  summary: string;
};

export type DiscoveredRobFile = {
  absolutePath: string;
  basename: string;
  byteLength: number;
};

export type ResolvedCorpusRoot = {
  absolutePath: string;
  realPath: string;
};

export type LoadedRobFile = {
  basename: string;
  bytes: Uint8Array;
};

export type CorpusFileReport = {
  fileId: string;
  basename: string;
  byteLength: number;
  byteDigestSha256: string | null;
  semanticDigestSha256: string | null;
  familyId: string | null;
  status: CorpusParityStatus;
  checks: CorpusCheck[];
  source: SourceCharacterizationReport | null;
  scenarios: ScenarioComparisonReport[];
};

export type DuplicateDigestGroup = {
  digestSha256: string;
  fileIds: string[];
  count: number;
};

export type CorpusFamilyAggregate = {
  family: SourceFamily;
  fileIds: string[];
  status: CorpusParityStatus;
  fileStatusCounts: CorpusStatusCounts;
  checkStatusCounts: CorpusStatusCounts;
  scenarioStatusCounts: CorpusStatusCounts;
};

export type CorpusRunSummary = {
  discoveredFileCount: number;
  acceptedFileCount: number;
  rejectedEntryCount: number;
  familyCount: number;
  fileStatusCounts: CorpusStatusCounts;
  checkStatusCounts: CorpusStatusCounts;
  scenarioStatusCounts: CorpusStatusCounts;
};

export type RobCorpusReport = {
  schemaVersion: typeof CORPUS_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  harness: {
    maxFileBytes: number;
    maxCandidatesPerGenerator: number;
    generatedSymmetryVariants: boolean;
    sourceSymmetryOrbitCompared: true;
    scenarios: readonly RobCorpusScenarioId[];
    privacy: {
      sourceTextStored: false;
      absolutePathsStored: false;
      reportFileNamesAreBasenamesOnly: true;
    };
  };
  summary: CorpusRunSummary;
  discoveryIssues: CorpusDiscoveryIssue[];
  duplicateGroups: {
    byteIdentical: DuplicateDigestGroup[];
    semanticallyIdentical: DuplicateDigestGroup[];
  };
  files: CorpusFileReport[];
  families: CorpusFamilyAggregate[];
};

export type ComparableCandidate = Pick<
  SolverCandidate,
  "id" | "rank" | "placements" | "metrics"
>;
