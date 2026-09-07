import type { RectangleBoundsMm, RectangleSizeMm } from "~/domain/geometry";
import type { Rotation } from "~/domain/palletTypes";

export const REGION_TOPOLOGY_FAMILIES = [
  "guillotine",
  "pinwheel",
  "bridge-chain",
  "spine-corridor",
  "boundary-walk",
] as const;

export type RegionTopologyFamily = (typeof REGION_TOPOLOGY_FAMILIES)[number];

export type TopologyFingerprint = `topology-v1:${string}`;
export type TopologyId = `topology-v1-${string}`;
export type RegionRealizationKey = `realization-v1:${string}`;

export type RegionSearchBudget = Readonly<{
  maxWorkUnits: number;
  maxFrontierStates: number;
  maxRetainedDrafts: number;
}>;

export const REGION_FOOTPRINT_CLASSES = [
  "lengthwise",
  "crosswise",
  "square",
] as const;

export type RegionFootprintClass = (typeof REGION_FOOTPRINT_CLASSES)[number];

export type RegionSlotId = string;
export type RegionAxis = "x" | "y";
export type RegionSide = "min-x" | "max-x" | "min-y" | "max-y";

export const REGION_SPACING_POLICIES = [
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "suction-group-aware",
  "inter-region-seam",
] as const;

export type RegionSpacingPolicy = (typeof REGION_SPACING_POLICIES)[number];

export const REGION_QUANTIZATIONS = [
  "continuous",
  "integer-center",
  "half-mm-center",
] as const;

export type RegionQuantization = (typeof REGION_QUANTIZATIONS)[number];
export type RegionFramePolicy =
  | "center-occupied-bounds"
  | "integer-center-occupied-bounds"
  | "fill-generation-bounds";

export type RegionSlotDefinition = Readonly<{
  id: RegionSlotId;
  optionalZero: boolean;
  footprintClasses: readonly RegionFootprintClass[];
  minimumColumns: number;
  minimumRows: number;
  maximumColumns?: number;
  maximumRows?: number;
  packageCounts?: readonly number[];
  spacingX: readonly RegionSpacingPolicy[];
  spacingY: readonly RegionSpacingPolicy[];
}>;

export type RegionPort = Readonly<{
  slotId: RegionSlotId;
  side: RegionSide;
}>;

export type RegionRelation =
  | Readonly<{
      id: string;
      kind: "contact";
      first: RegionPort;
      second: RegionPort;
      gap: "clearance" | "residual-seam";
      overlap: "positive" | "equal-span" | "covers-first" | "covers-second";
    }>
  | Readonly<{
      id: string;
      kind: "align";
      axis: RegionAxis;
      edge: "min" | "center" | "max";
      firstSlotId: RegionSlotId;
      secondSlotId: RegionSlotId;
    }>
  | Readonly<{
      id: string;
      kind: "span";
      axis: RegionAxis;
      outerSlotId: RegionSlotId;
      innerSlotIds: readonly RegionSlotId[];
    }>
  | Readonly<{
      id: string;
      kind: "order";
      axis: RegionAxis;
      beforeSlotId: RegionSlotId;
      afterSlotId: RegionSlotId;
      minimumGap: "zero" | "clearance";
      residualSink?: "inter-region-seam";
    }>
  | Readonly<{
      id: string;
      kind: "frame-anchor";
      port: RegionPort;
      frameSide: RegionSide;
    }>
  | Readonly<{
      id: string;
      kind: "containment";
      containerSlotId: RegionSlotId;
      containedSlotId: RegionSlotId;
    }>;

export type OrthogonalEmbedding = Readonly<{
  rotationSystem: readonly Readonly<{
    slotId: RegionSlotId;
    relationIdsClockwise: readonly string[];
  }>[];
  directedBoundary?: Readonly<{
    relationIds: readonly string[];
    closed: boolean;
    interior: "left" | "right";
  }>;
}>;

export type RegionTemplateAutomorphism = Readonly<
  Record<RegionSlotId, RegionSlotId>
>;

export type GuillotineCutNode =
  | Readonly<{ kind: "slot"; slotId: RegionSlotId }>
  | Readonly<{
      kind: "cut";
      axis: RegionAxis;
      children: readonly [
        GuillotineCutNode,
        GuillotineCutNode,
        ...GuillotineCutNode[],
      ];
    }>;

export const PINWHEEL_CHIRALITIES = ["clockwise", "counterclockwise"] as const;

export type PinwheelChirality = (typeof PINWHEEL_CHIRALITIES)[number];

/** Arm order is the physical frame order: bottom, right, top, left. */
export type PinwheelCycleNode = Readonly<{
  armSlotIds: readonly [RegionSlotId, RegionSlotId, RegionSlotId, RegionSlotId];
  chirality: PinwheelChirality;
  /** Stable local phase anchor; transformed identities retain this slot reference. */
  residualAnchorSlotId: RegionSlotId;
  core:
    | Readonly<{ kind: "empty" }>
    | Readonly<{ kind: "grid"; slotId: RegionSlotId }>
    | Readonly<{ kind: "cycle"; cycle: PinwheelCycleNode }>;
}>;

export type RegionFamilyWitness =
  | Readonly<{ kind: "guillotine-cut-tree"; root: GuillotineCutNode }>
  | Readonly<{ kind: "four-arm-cycle"; root: PinwheelCycleNode }>
  | Readonly<{
      kind: "embedded-bridge";
      graph: "path" | "corner-chain" | "offset-bridge" | "k2,3";
      rotationSystemRelationIds: readonly string[];
    }>
  | Readonly<{
      kind: "spine-tree";
      /** Axis followed by both offset region chains. */
      axis: RegionAxis;
      /** Direction from each chain's first role to its second role. */
      inlineDirection: 1 | -1;
      /** Direction from the main lane to the long-band lane. */
      crossDirection: 1 | -1;
      mainSlotId: RegionSlotId;
      /**
       * A four-region step has one long spine. Its attachments are ordered as
       * side strip, then singleton corner.
       */
      orderedSpines: readonly [
        Readonly<{
          spineSlotId: RegionSlotId;
          attachmentSlotIds: readonly [RegionSlotId, RegionSlotId];
        }>,
      ];
    }>
  | Readonly<{
      kind: "directed-boundary-walk";
      relationIds: readonly string[];
      closed: boolean;
      interior: "left" | "right";
    }>;

export type RegionCollapseRule = Readonly<{
  kind: "remove-zero-slot";
  slotId: RegionSlotId;
  transparentRelationIds: readonly string[];
}>;

export type RegionGraphTemplate = Readonly<{
  templateKey: string;
  claimedFamily: RegionTopologyFamily;
  definitionVersion: number;
  slots: readonly RegionSlotDefinition[];
  relations: readonly RegionRelation[];
  embedding: OrthogonalEmbedding;
  automorphisms: readonly RegionTemplateAutomorphism[];
  collapseRules: readonly RegionCollapseRule[];
  framePolicies: readonly RegionFramePolicy[];
  witness: RegionFamilyWitness;
}>;

export type RegionShape = Readonly<{
  key: string;
  footprintClass: RegionFootprintClass;
  representativeRotation: Rotation;
  columns: number;
  rows: number;
  packageCount: number;
  naturalSizeMm: RectangleSizeMm;
}>;

export type RegionShapeCatalog = Readonly<{
  maximumPackageCount: number;
  orderedShapes: readonly RegionShape[];
  countsAscending: readonly number[];
  shapesByCount: ReadonlyMap<number, readonly RegionShape[]>;
  shapesByFootprintClass: ReadonlyMap<
    RegionFootprintClass,
    readonly RegionShape[]
  >;
}>;

export type StructuralRegionNode = Readonly<{
  canonicalIndex: number;
  footprintClass: RegionFootprintClass;
  columns: number;
  rows: number;
  packageCount: number;
}>;

export type StructuralRegionGraph = Readonly<{
  targetCount: number;
  nodes: readonly StructuralRegionNode[];
  relations: readonly RegionRelation[];
  embedding: OrthogonalEmbedding;
  witness: RegionFamilyWitness;
}>;

export type OwnedStructuralRegionGraph = StructuralRegionGraph &
  Readonly<{
    ownerFamily: RegionTopologyFamily;
    topologyFingerprint: TopologyFingerprint;
  }>;

export type MetricRegionGraph = Readonly<{
  topology: OwnedStructuralRegionGraph;
  regionBoundsMm: readonly RectangleBoundsMm[];
  residualAssignments: readonly Readonly<{
    sinkKey: string;
    amountMm: number;
  }>[];
  framePolicy: RegionFramePolicy;
}>;

export type SpacedRegionGraph = MetricRegionGraph &
  Readonly<{
    spacingByRegion: readonly Readonly<{
      x: RegionSpacingPolicy;
      y: RegionSpacingPolicy;
      quantization: RegionQuantization;
      xCentersMm: readonly number[];
      yCentersMm: readonly number[];
    }>[];
    physicalMergeGroups: readonly (readonly number[])[];
  }>;
