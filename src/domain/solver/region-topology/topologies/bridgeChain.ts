import type {
  RegionAxis,
  RegionFamilyWitness,
  RegionFootprintClass,
  RegionGraphTemplate,
  RegionRelation,
  RegionSide,
  RegionSlotDefinition,
  RegionTemplateAutomorphism,
} from "~/domain/solver/region-topology/model";

export const BRIDGE_CHAIN_MOTIFS = [
  "path",
  "corner-chain",
  "offset-bridge",
  "k2,3",
] as const;

export type BridgeChainMotif = (typeof BRIDGE_CHAIN_MOTIFS)[number];
export type BridgeChainPhase = "lengthwise" | "crosswise";
export type BridgeChainChirality = "clockwise" | "counterclockwise";

const supportedSpacing = Object.freeze([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
] as const);
const framePolicies = Object.freeze([
  "center-occupied-bounds",
  "integer-center-occupied-bounds",
  "fill-generation-bounds",
] as const);

const PATH_SLOT_IDS = [
  "path-0",
  "path-1",
  "path-2",
  "path-3",
  "path-4",
] as const;
const CORNER_SLOT_IDS = [
  "corner-bottom-left",
  "corner-top-left",
  "corner-top-right",
  "corner-bottom-middle",
  "corner-bottom-right",
] as const;
const OFFSET_SLOT_IDS = [
  "offset-bottom-band",
  "offset-left-main",
  "offset-bridge",
  "offset-right-main",
  "offset-top-band",
] as const;
const K23_SLOT_IDS = [
  "support-first",
  "support-second",
  "bridge-first",
  "bridge-middle",
  "bridge-last",
] as const;

type EmbeddedBridgeSpec = Readonly<{
  motif: BridgeChainMotif;
  slotIds: readonly string[];
  primarySlotIds: readonly string[];
  relations: readonly RegionRelation[];
  rotationSystem: RegionGraphTemplate["embedding"]["rotationSystem"];
  rotationSystemRelationIds: readonly string[];
}>;

function oppositePhase(phase: BridgeChainPhase): BridgeChainPhase {
  return phase === "lengthwise" ? "crosswise" : "lengthwise";
}

function slot(id: string, phase: BridgeChainPhase): RegionSlotDefinition {
  return Object.freeze({
    id,
    optionalZero: false,
    footprintClasses: Object.freeze([
      phase,
      "square",
    ] as const satisfies readonly RegionFootprintClass[]),
    minimumColumns: 1,
    minimumRows: 1,
    spacingX: supportedSpacing,
    spacingY: supportedSpacing,
  });
}

function identityAutomorphism(
  slots: readonly RegionSlotDefinition[],
): RegionTemplateAutomorphism {
  return Object.freeze(
    Object.fromEntries(slots.map(({ id }) => [id, id])) as Record<
      string,
      string
    >,
  );
}

function contact(
  id: string,
  firstSlotId: string,
  firstSide: RegionSide,
  secondSlotId: string,
  secondSide: RegionSide,
): RegionRelation {
  return Object.freeze({
    id,
    kind: "contact",
    first: Object.freeze({ slotId: firstSlotId, side: firstSide }),
    second: Object.freeze({ slotId: secondSlotId, side: secondSide }),
    gap: "clearance",
    overlap: "positive",
  });
}

function align(
  id: string,
  axis: RegionAxis,
  edge: "min" | "center" | "max",
  firstSlotId: string,
  secondSlotId: string,
): RegionRelation {
  return Object.freeze({
    id,
    kind: "align",
    axis,
    edge,
    firstSlotId,
    secondSlotId,
  });
}

function order(
  id: string,
  axis: RegionAxis,
  beforeSlotId: string,
  afterSlotId: string,
): RegionRelation {
  return Object.freeze({
    id,
    kind: "order",
    axis,
    beforeSlotId,
    afterSlotId,
    minimumGap: "clearance",
    residualSink: "inter-region-seam",
  });
}

function frameAnchor(
  id: string,
  slotId: string,
  side: RegionSide,
): RegionRelation {
  return Object.freeze({
    id,
    kind: "frame-anchor",
    port: Object.freeze({ slotId, side }),
    frameSide: side,
  });
}

function pathSpec(): EmbeddedBridgeSpec {
  const [bottomLeft, topLeftFirst, topLeftSecond, topRight, bottomRight] =
    PATH_SLOT_IDS;
  const edges = [
    contact("path-edge-0", bottomLeft, "max-y", topLeftFirst, "min-y"),
    contact("path-edge-1", topLeftFirst, "max-x", topLeftSecond, "min-x"),
    contact("path-edge-2", topLeftSecond, "max-x", topRight, "min-x"),
    contact("path-edge-3", bottomRight, "max-y", topRight, "min-y"),
  ];
  return Object.freeze({
    motif: "path",
    slotIds: PATH_SLOT_IDS,
    primarySlotIds: Object.freeze([topLeftFirst, topLeftSecond, bottomRight]),
    relations: Object.freeze([
      ...edges,
      order("path-order-0", "y", bottomLeft, topLeftFirst),
      order("path-order-1", "x", topLeftFirst, topLeftSecond),
      order("path-order-2", "x", topLeftSecond, topRight),
      order("path-order-3", "y", bottomRight, topRight),
      order("path-order-bottom", "x", bottomLeft, bottomRight),
      align("path-align-left", "x", "min", bottomLeft, topLeftFirst),
      align("path-align-merged-min", "y", "min", topLeftFirst, topLeftSecond),
      align("path-align-merged-max", "y", "max", topLeftFirst, topLeftSecond),
      align("path-align-top", "y", "max", topLeftSecond, topRight),
      align("path-align-right", "x", "max", topRight, bottomRight),
      align("path-align-bottom", "y", "min", bottomLeft, bottomRight),
      frameAnchor("path-anchor-min-x", bottomLeft, "min-x"),
      frameAnchor("path-anchor-max-x", bottomRight, "max-x"),
      frameAnchor("path-anchor-min-y", bottomLeft, "min-y"),
      frameAnchor("path-anchor-max-y", topLeftFirst, "max-y"),
    ]),
    rotationSystem: Object.freeze([
      Object.freeze({
        slotId: bottomLeft,
        relationIdsClockwise: Object.freeze(["path-edge-0"]),
      }),
      Object.freeze({
        slotId: topLeftFirst,
        relationIdsClockwise: Object.freeze(["path-edge-1", "path-edge-0"]),
      }),
      Object.freeze({
        slotId: topLeftSecond,
        relationIdsClockwise: Object.freeze(["path-edge-2", "path-edge-1"]),
      }),
      Object.freeze({
        slotId: topRight,
        relationIdsClockwise: Object.freeze(["path-edge-3", "path-edge-2"]),
      }),
      Object.freeze({
        slotId: bottomRight,
        relationIdsClockwise: Object.freeze(["path-edge-3"]),
      }),
    ]),
    rotationSystemRelationIds: Object.freeze([
      "path-edge-0",
      "path-edge-1",
      "path-edge-2",
      "path-edge-3",
    ]),
  });
}

function cornerChainSpec(): EmbeddedBridgeSpec {
  const [bottomLeft, topLeft, topRight, bottomMiddle, bottomRight] =
    CORNER_SLOT_IDS;
  const edges = [
    contact("corner-edge-left", bottomLeft, "max-y", topLeft, "min-y"),
    contact("corner-edge-top", topLeft, "max-x", topRight, "min-x"),
    contact("corner-edge-middle-top", bottomMiddle, "max-y", topRight, "min-y"),
    contact(
      "corner-edge-bottom-left",
      bottomLeft,
      "max-x",
      bottomMiddle,
      "min-x",
    ),
    contact(
      "corner-edge-bottom-right",
      bottomMiddle,
      "max-x",
      bottomRight,
      "min-x",
    ),
  ];
  return Object.freeze({
    motif: "corner-chain",
    slotIds: CORNER_SLOT_IDS,
    primarySlotIds: Object.freeze([bottomLeft, topRight, bottomRight]),
    relations: Object.freeze([
      ...edges,
      order("corner-order-left", "y", bottomLeft, topLeft),
      order("corner-order-top", "x", topLeft, topRight),
      order("corner-order-middle-top", "y", bottomMiddle, topRight),
      order("corner-order-bottom-left", "x", bottomLeft, bottomMiddle),
      order("corner-order-bottom-right", "x", bottomMiddle, bottomRight),
      align("corner-align-left", "x", "min", bottomLeft, topLeft),
      align("corner-align-bottom-middle", "y", "min", bottomLeft, bottomMiddle),
      align("corner-align-bottom-right", "y", "min", bottomMiddle, bottomRight),
      align("corner-align-top", "y", "max", topLeft, topRight),
      align("corner-align-right", "x", "max", topRight, bottomRight),
      frameAnchor("corner-anchor-min-x", bottomLeft, "min-x"),
      frameAnchor("corner-anchor-max-x", bottomRight, "max-x"),
      frameAnchor("corner-anchor-min-y", bottomLeft, "min-y"),
      frameAnchor("corner-anchor-max-y", topLeft, "max-y"),
    ]),
    rotationSystem: Object.freeze([
      Object.freeze({
        slotId: bottomLeft,
        relationIdsClockwise: Object.freeze([
          "corner-edge-left",
          "corner-edge-bottom-left",
        ]),
      }),
      Object.freeze({
        slotId: topLeft,
        relationIdsClockwise: Object.freeze([
          "corner-edge-top",
          "corner-edge-left",
        ]),
      }),
      Object.freeze({
        slotId: topRight,
        relationIdsClockwise: Object.freeze([
          "corner-edge-middle-top",
          "corner-edge-top",
        ]),
      }),
      Object.freeze({
        slotId: bottomMiddle,
        relationIdsClockwise: Object.freeze([
          "corner-edge-middle-top",
          "corner-edge-bottom-right",
          "corner-edge-bottom-left",
        ]),
      }),
      Object.freeze({
        slotId: bottomRight,
        relationIdsClockwise: Object.freeze(["corner-edge-bottom-right"]),
      }),
    ]),
    rotationSystemRelationIds: Object.freeze([
      "corner-edge-left",
      "corner-edge-top",
      "corner-edge-middle-top",
      "corner-edge-bottom-right",
      "corner-edge-bottom-left",
    ]),
  });
}

function offsetBridgeSpec(): EmbeddedBridgeSpec {
  const [bottomBand, leftMain, bridge, rightMain, topBand] = OFFSET_SLOT_IDS;
  const edges = [
    contact("offset-edge-left", bottomBand, "max-y", leftMain, "min-y"),
    contact("offset-edge-bridge-left", leftMain, "max-x", bridge, "min-x"),
    contact("offset-edge-bridge-right", bridge, "max-x", rightMain, "min-x"),
    contact("offset-edge-right", rightMain, "max-y", topBand, "min-y"),
  ];
  return Object.freeze({
    motif: "offset-bridge",
    slotIds: OFFSET_SLOT_IDS,
    primarySlotIds: Object.freeze([bottomBand, bridge, topBand]),
    relations: Object.freeze([
      ...edges,
      order("offset-order-left", "y", bottomBand, leftMain),
      order("offset-order-bridge-left", "x", leftMain, bridge),
      order("offset-order-bridge-right", "x", bridge, rightMain),
      order("offset-order-right", "y", rightMain, topBand),
      align("offset-align-left", "x", "min", bottomBand, leftMain),
      align("offset-align-bottom", "y", "min", bottomBand, rightMain),
      align("offset-align-top", "y", "max", leftMain, topBand),
      align("offset-align-right", "x", "max", rightMain, topBand),
      align("offset-align-bridge-min", "y", "min", bridge, leftMain),
      align("offset-align-bridge-max", "y", "max", bridge, rightMain),
      frameAnchor("offset-anchor-min-x", bottomBand, "min-x"),
      frameAnchor("offset-anchor-max-x", topBand, "max-x"),
      frameAnchor("offset-anchor-min-y", bottomBand, "min-y"),
      frameAnchor("offset-anchor-max-y", topBand, "max-y"),
    ]),
    rotationSystem: Object.freeze([
      Object.freeze({
        slotId: bottomBand,
        relationIdsClockwise: Object.freeze(["offset-edge-left"]),
      }),
      Object.freeze({
        slotId: leftMain,
        relationIdsClockwise: Object.freeze([
          "offset-edge-bridge-left",
          "offset-edge-left",
        ]),
      }),
      Object.freeze({
        slotId: bridge,
        relationIdsClockwise: Object.freeze([
          "offset-edge-bridge-right",
          "offset-edge-bridge-left",
        ]),
      }),
      Object.freeze({
        slotId: rightMain,
        relationIdsClockwise: Object.freeze([
          "offset-edge-right",
          "offset-edge-bridge-right",
        ]),
      }),
      Object.freeze({
        slotId: topBand,
        relationIdsClockwise: Object.freeze(["offset-edge-right"]),
      }),
    ]),
    rotationSystemRelationIds: Object.freeze([
      "offset-edge-left",
      "offset-edge-bridge-left",
      "offset-edge-bridge-right",
      "offset-edge-right",
    ]),
  });
}

function planarK23Spec(): EmbeddedBridgeSpec {
  const [firstSupport, secondSupport, firstBridge, middleBridge, lastBridge] =
    K23_SLOT_IDS;
  const bridges = [firstBridge, middleBridge, lastBridge] as const;
  const supportEdges = bridges.flatMap((bridgeSlotId, index) => [
    contact(
      `k23-edge-first-${index}`,
      firstSupport,
      "max-x",
      bridgeSlotId,
      "min-x",
    ),
    contact(
      `k23-edge-second-${index}`,
      bridgeSlotId,
      "max-x",
      secondSupport,
      "min-x",
    ),
  ]);
  return Object.freeze({
    motif: "k2,3",
    slotIds: K23_SLOT_IDS,
    primarySlotIds: Object.freeze([firstSupport, secondSupport]),
    relations: Object.freeze([
      ...supportEdges,
      order("k23-order-first-middle", "y", firstBridge, middleBridge),
      order("k23-order-middle-last", "y", middleBridge, lastBridge),
      align(
        "k23-align-first-support-min",
        "y",
        "min",
        firstSupport,
        firstBridge,
      ),
      align(
        "k23-align-first-support-max",
        "y",
        "max",
        firstSupport,
        lastBridge,
      ),
      align(
        "k23-align-second-support-min",
        "y",
        "min",
        secondSupport,
        firstBridge,
      ),
      align(
        "k23-align-second-support-max",
        "y",
        "max",
        secondSupport,
        lastBridge,
      ),
      frameAnchor("k23-anchor-min-x", firstSupport, "min-x"),
      frameAnchor("k23-anchor-max-x", secondSupport, "max-x"),
      frameAnchor("k23-anchor-min-y", firstBridge, "min-y"),
      frameAnchor("k23-anchor-max-y", lastBridge, "max-y"),
    ]),
    rotationSystem: Object.freeze([
      Object.freeze({
        slotId: firstSupport,
        relationIdsClockwise: Object.freeze([
          "k23-edge-first-2",
          "k23-edge-first-1",
          "k23-edge-first-0",
        ]),
      }),
      Object.freeze({
        slotId: secondSupport,
        relationIdsClockwise: Object.freeze([
          "k23-edge-second-0",
          "k23-edge-second-1",
          "k23-edge-second-2",
        ]),
      }),
      ...bridges.map((bridgeSlotId, index) =>
        Object.freeze({
          slotId: bridgeSlotId,
          relationIdsClockwise: Object.freeze([
            `k23-edge-second-${index}`,
            `k23-edge-first-${index}`,
          ]),
        }),
      ),
    ]),
    rotationSystemRelationIds: Object.freeze([
      "k23-edge-first-0",
      "k23-edge-second-0",
      "k23-edge-second-1",
      "k23-edge-first-1",
      "k23-edge-first-2",
      "k23-edge-second-2",
    ]),
  });
}

const canonicalSpecs: Readonly<Record<BridgeChainMotif, EmbeddedBridgeSpec>> =
  Object.freeze({
    path: pathSpec(),
    "corner-chain": cornerChainSpec(),
    "offset-bridge": offsetBridgeSpec(),
    "k2,3": planarK23Spec(),
  });

type AxisTransform = Readonly<{ axis: RegionAxis; sign: 1 | -1 }>;

function axisTransform(
  axis: RegionAxis,
  chirality: BridgeChainChirality,
  sourceAxis: RegionAxis,
): AxisTransform {
  let transformed: AxisTransform = { axis: sourceAxis, sign: 1 };
  if (chirality === "counterclockwise" && sourceAxis === "y") {
    transformed = { axis: "y", sign: -1 };
  }
  if (axis === "y") {
    transformed = {
      axis: transformed.axis === "x" ? "y" : "x",
      sign: transformed.sign,
    };
  }
  return transformed;
}

function transformedSide(
  axis: RegionAxis,
  chirality: BridgeChainChirality,
  side: RegionSide,
): RegionSide {
  const sourceAxis: RegionAxis = side.endsWith("x") ? "x" : "y";
  const transformed = axisTransform(axis, chirality, sourceAxis);
  const sourceMinimum = side.startsWith("min");
  const minimum = transformed.sign === 1 ? sourceMinimum : !sourceMinimum;
  return `${minimum ? "min" : "max"}-${transformed.axis}` as RegionSide;
}

function transformedEdge(
  edge: "min" | "center" | "max",
  sign: 1 | -1,
): "min" | "center" | "max" {
  if (edge === "center" || sign === 1) return edge;
  return edge === "min" ? "max" : "min";
}

function transformedRelation(
  relation: RegionRelation,
  axis: RegionAxis,
  chirality: BridgeChainChirality,
): RegionRelation {
  switch (relation.kind) {
    case "contact":
      return Object.freeze({
        ...relation,
        first: Object.freeze({
          ...relation.first,
          side: transformedSide(axis, chirality, relation.first.side),
        }),
        second: Object.freeze({
          ...relation.second,
          side: transformedSide(axis, chirality, relation.second.side),
        }),
      });
    case "align": {
      const transformed = axisTransform(axis, chirality, relation.axis);
      return Object.freeze({
        ...relation,
        axis: transformed.axis,
        edge: transformedEdge(relation.edge, transformed.sign),
      });
    }
    case "span":
      return Object.freeze({
        ...relation,
        axis: axisTransform(axis, chirality, relation.axis).axis,
      });
    case "order": {
      const transformed = axisTransform(axis, chirality, relation.axis);
      return Object.freeze({
        ...relation,
        axis: transformed.axis,
        beforeSlotId:
          transformed.sign === 1 ? relation.beforeSlotId : relation.afterSlotId,
        afterSlotId:
          transformed.sign === 1 ? relation.afterSlotId : relation.beforeSlotId,
      });
    }
    case "frame-anchor":
      return Object.freeze({
        ...relation,
        port: Object.freeze({
          ...relation.port,
          side: transformedSide(axis, chirality, relation.port.side),
        }),
        frameSide: transformedSide(axis, chirality, relation.frameSide),
      });
    case "containment":
      return relation;
  }
}

function orientationReverses(
  axis: RegionAxis,
  chirality: BridgeChainChirality,
): boolean {
  return (axis === "y") !== (chirality === "counterclockwise");
}

export function createBridgeChainTopologyTemplate(
  motif: BridgeChainMotif,
  axis: RegionAxis,
  primaryPhase: BridgeChainPhase,
  chirality: BridgeChainChirality,
): RegionGraphTemplate {
  if (!BRIDGE_CHAIN_MOTIFS.includes(motif)) {
    throw new RangeError("Unknown bridge-chain motif.");
  }
  if (axis !== "x" && axis !== "y") {
    throw new RangeError('axis must be "x" or "y".');
  }
  if (primaryPhase !== "lengthwise" && primaryPhase !== "crosswise") {
    throw new RangeError("primaryPhase must be a non-square footprint class.");
  }
  if (chirality !== "clockwise" && chirality !== "counterclockwise") {
    throw new RangeError("Unknown bridge-chain chirality.");
  }

  const spec = canonicalSpecs[motif];
  const primarySlotIds = new Set(spec.primarySlotIds);
  const secondaryPhase = oppositePhase(primaryPhase);
  const slots = Object.freeze(
    spec.slotIds.map((id) =>
      slot(id, primarySlotIds.has(id) ? primaryPhase : secondaryPhase),
    ),
  );
  const reverseOrientation = orientationReverses(axis, chirality);
  const rotationSystem = Object.freeze(
    spec.rotationSystem.map(({ slotId, relationIdsClockwise }) =>
      Object.freeze({
        slotId,
        relationIdsClockwise: Object.freeze(
          reverseOrientation
            ? [...relationIdsClockwise].reverse()
            : [...relationIdsClockwise],
        ),
      }),
    ),
  );
  const witness: Extract<RegionFamilyWitness, { kind: "embedded-bridge" }> =
    Object.freeze({
      kind: "embedded-bridge",
      graph: motif,
      rotationSystemRelationIds: Object.freeze(
        reverseOrientation
          ? [...spec.rotationSystemRelationIds].reverse()
          : [...spec.rotationSystemRelationIds],
      ),
    });

  return Object.freeze({
    templateKey: `bridge-chain-v1:${motif}:${axis}:${primaryPhase}:${chirality}`,
    claimedFamily: "bridge-chain",
    definitionVersion: 1,
    slots,
    relations: Object.freeze(
      spec.relations.map((relation) =>
        transformedRelation(relation, axis, chirality),
      ),
    ),
    embedding: Object.freeze({ rotationSystem }),
    automorphisms: Object.freeze([identityAutomorphism(slots)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness,
  });
}

export function buildBridgeChainTopologyTemplates(): readonly RegionGraphTemplate[] {
  return Object.freeze(
    BRIDGE_CHAIN_MOTIFS.flatMap((motif) =>
      (["x", "y"] as const).flatMap((axis) =>
        (["lengthwise", "crosswise"] as const).flatMap((phase) =>
          (["clockwise", "counterclockwise"] as const).map((chirality) =>
            createBridgeChainTopologyTemplate(motif, axis, phase, chirality),
          ),
        ),
      ),
    ),
  );
}
