import type {
  Gripper,
  PalletStation,
  PalletizingDirection,
  Project,
} from "~/domain/project/projectSchema";
import type { MaterializedStackResult } from "~/domain/stack/types";

export type RobotDiagnosticSeverity = "info" | "warning" | "error";

export type RobotDiagnosticPhase =
  | "project"
  | "resources"
  | "compatibility"
  | "grouping"
  | "ordering"
  | "pose"
  | "reach"
  | "envelope"
  | "collision"
  | "timeline"
  | "export"
  | "legacy-import";

export type RobotDiagnosticCode =
  | "invalid-project"
  | "missing-solution"
  | "missing-pallet"
  | "missing-gripper-selection"
  | "missing-gripper"
  | "missing-station-selection"
  | "missing-station"
  | "cycle-gripper-mismatch"
  | "station-direction-not-allowed"
  | "unsupported-gripper-type"
  | "package-length-out-of-range"
  | "package-width-out-of-range"
  | "package-height-out-of-range"
  | "inlet-orientation-incompatible"
  | "place-rotation-incompatible"
  | "multipick-not-allowed"
  | "multipick-single-place-unverified"
  | "pickup-length-exceeded"
  | "placement-unassigned"
  | "placement-assigned-more-than-once"
  | "missing-placement-reference"
  | "missing-order-group"
  | "duplicate-order-group"
  | "dependency-missing-group"
  | "dependency-cycle"
  | "order-dependency-violation"
  | "missing-pick-reference"
  | "unverified-pick-reference"
  | "missing-pick-height"
  | "legacy-pose-frame-unverified"
  | "non-finite-pose"
  | "duplicate-cycle-id"
  | "reach-below-minimum"
  | "reach-above-maximum"
  | "reach-not-checked-zero-radius-sentinel"
  | "tcp-envelope-exceeded"
  | "tool-envelope-exceeded"
  | "obstacle-collision"
  | "invalid-timeline-config"
  | "timeline-frame-mismatch"
  | "empty-robot-plan"
  | "materialization-invalid"
  | "missing-quantization-policy"
  | "non-integer-value"
  | "invalid-orthogonal-yaw"
  | "missing-sign-convention"
  | "mixed-coordinate-frames"
  | "unknown-legacy-field-semantics"
  | "missing-explicit-legacy-fields"
  | "nonstandard-interlayer-thickness"
  | "parser-roundtrip-failed"
  | "input-too-large"
  | "unrecognized-mpb-envelope"
  | "unsupported-mpb-version"
  | "truncated-mpb-envelope"
  | "malformed-mpb-payload"
  | "unknown-mpb-field"
  | "mpb-trailing-bytes";

export type RobotDiagnostic = {
  severity: RobotDiagnosticSeverity;
  phase: RobotDiagnosticPhase;
  code: RobotDiagnosticCode;
  message: string;
  path?: readonly (string | number)[];
  cycleId?: string;
  layerId?: string;
  groupId?: string;
  placementId?: string;
  resourceId?: string | null;
  details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type Vector2Mm = { x: number; y: number };
export type Vector3Mm = { x: number; y: number; z: number };

export type RobotPoseFrame = "station" | "pallet" | "legacy-rob";

/** Plain pose data; no Three.js classes or mutable scene objects are used. */
export type RobotPose = {
  positionMm: Vector3Mm;
  yawDeg: number;
  frame: RobotPoseFrame;
};

export type HorizontalEnvelopeMm = {
  negativeX: number;
  positiveX: number;
  negativeY: number;
  positiveY: number;
};

export type HorizontalBoundsMm = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type RobotObstacle = {
  id: string;
  name?: string;
  boundsMm: HorizontalBoundsMm;
  minZMm?: number;
  maxZMm?: number;
};

export type RobotConveyorModel = {
  id: "calculated-feed-conveyor";
  frame: "station";
  centerMm: Vector3Mm;
  dimensionsMm: { length: number; width: number; height: number };
  travelAxis: "x" | "y";
  provenance: {
    status: "derived";
    source: "calculated-cycle-feed-reference-v1";
    detail: string;
  };
};

export type RobotOrderDependency = {
  beforeGroupId: string;
  afterGroupId: string;
  source: "explicit" | "legacy-repository-delta-v1";
};

export type RobotGripGroup = {
  id: string;
  /** Stable editor-visible number, independent from execution sequence. */
  groupNumber: number;
  physicalLayerId: string;
  physicalLayerIndex: number;
  placementIds: readonly string[];
  packageCount: number;
  centerPalletMm: Vector3Mm;
  placeRotationDeg: number;
  sourceGripId: string | null;
  sourceCycleId: string | null;
  sourceSequence: number | null;
  groupingSource:
    | "explicit-project-cycle"
    | "explicit-pattern-grip"
    | "suction-adjacency-v1";
};

export type LegacyRobUnknownFields = {
  field8: number;
  field9: number;
  /** Repository interpretation only; external MultiPack semantics remain unverified. */
  semantics: "repository-dx-dy-unverified";
  source:
    | "imported-project-cycle"
    | "explicit-project-cycle"
    | "calculated-pattern-grip";
};

export type PickReferenceProvenance = {
  status: "verified" | "derived" | "unverified";
  source: string;
};

export type RobotCycleProvenance = {
  cycleSource:
    | "imported-project-cycle"
    | "explicit-project-cycle"
    | "calculated-suction-cycle";
  groupingSource: RobotGripGroup["groupingSource"];
  orderSource:
    | "imported-sequence"
    | "explicit-project-sequence"
    | "explicit-edit"
    | "suggested-topological";
  poseSource:
    | "imported-legacy-rob-pose"
    | "explicit-project-pose"
    | "calculated-project-resources";
  sourceSolutionOrigin: "imported" | "calculated" | "manual";
  sourceCycleId: string | null;
  sourceGripId: string | null;
  pickReferenceProvenance: PickReferenceProvenance | null;
  coordinateConvention: string;
  tcpOffsetConvention: "tcp-to-grasp-vector-subtracted" | "already-encoded";
  signConventionStatus:
    | "repository-behavior"
    | "project-defined"
    | "unverified";
};

/**
 * Canonical robot-cycle DTO shared by export, editor flow, simulation, and reports.
 * Pick/transfer/place are always carried together so consumers cannot recompute them
 * with divergent assumptions.
 */
export type RobotCycle = {
  id: string;
  sequence: number;
  sequenceInLayer: number;
  physicalLayerId: string;
  physicalLayerIndex: number;
  patternRef: string;
  groupId: string;
  groupNumber: number;
  placementIds: readonly string[];
  packageCount: number;
  gripperId: string | null;
  stationId: string | null;
  pickPose: RobotPose;
  transferPose: RobotPose;
  placePose: RobotPose;
  legacyUnknownFields: LegacyRobUnknownFields | null;
  provenance: RobotCycleProvenance;
};

export type RobotCycleLayer = {
  physicalLayerId: string;
  physicalLayerIndex: number;
  patternRef: string;
  cycleIds: readonly string[];
  placementIds: readonly string[];
  interlayerBeforeCount: number;
};

export type PickReference = {
  originMm: Vector3Mm;
  yawDeg?: number;
  provenance: PickReferenceProvenance;
};

export type RobotCycleMaterializationOptions = {
  solutionId?: string | null;
  preserveExplicitCycles?: boolean;
  maxPackagesPerPick?: number;
  groupingToleranceMm?: number;
  transferClearanceMm?: number;
  pickReference?: PickReference;
  direction?: PalletizingDirection;
  dependenciesByLayer?: Readonly<
    Record<string, readonly RobotOrderDependency[] | undefined>
  >;
  editedOrderByLayer?: Readonly<Record<string, readonly string[] | undefined>>;
  obstacles?: readonly RobotObstacle[];
  collisionToleranceMm?: number;
};

export type ResolvedRoboticsResources = {
  gripper: Gripper | null;
  station: PalletStation | null;
  direction: PalletizingDirection | null;
  diagnostics: readonly RobotDiagnostic[];
};

export type RobotCycleMaterialization = {
  kind: "robot-cycle-materialization";
  project: Project | null;
  projectId: string | null;
  solutionId: string | null;
  gripper: Gripper | null;
  station: PalletStation | null;
  direction: PalletizingDirection | null;
  stack: MaterializedStackResult | null;
  conveyor: RobotConveyorModel | null;
  layers: readonly RobotCycleLayer[];
  cycles: readonly RobotCycle[];
  diagnostics: readonly RobotDiagnostic[];
  valid: boolean;
};
