import {
  assertRectangleBounds,
  envelopePreservingSymmetries,
  rectangleBoundsLength,
  rectangleBoundsWidth,
  transformedEnvelopeBounds,
} from "~/domain/geometry";
import type { RectangleBoundsMm } from "~/domain/geometry";
import type { LayerSymmetry } from "~/domain/geometry/transforms";
import {
  normalizeGeneratedCoordinateMm,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import { stableRegionTopologyValue } from "~/domain/solver/region-topology/canonicalValue";
import type {
  GuillotineCutNode,
  OrthogonalEmbedding,
  OwnedStructuralRegionGraph,
  PinwheelCycleNode,
  RegionAxis,
  RegionFamilyWitness,
  RegionGraphTemplate,
  RegionRealizationKey,
  RegionRelation,
  RegionShape,
  RegionSide,
  RegionSlotDefinition,
  RegionTemplateAutomorphism,
  SpacedRegionGraph,
  StructuralRegionGraph,
  StructuralRegionNode,
  TopologyFingerprint,
  TopologyId,
} from "~/domain/solver/region-topology/model";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";

export type RegionShapeAssignment = Readonly<{
  slotId: string;
  shape: RegionShape;
}>;

export type RegionTopologyIdentityRequest = Readonly<{
  template: RegionGraphTemplate;
  assignments: readonly RegionShapeAssignment[];
  targetCount: number;
  frameBoundsMm: RectangleBoundsMm;
  symmetries?: readonly LayerSymmetry[];
}>;

export type RegionTopologyIdentityResult =
  | Readonly<{
      status: "completed";
      graph: OwnedStructuralRegionGraph;
      topologyId: TopologyId;
    }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>
  | Readonly<{ status: "invalid"; reason: string }>;

type AxisTransform = Readonly<{ axis: RegionAxis; sign: 1 | -1 }>;
type GuillotineCut = Extract<GuillotineCutNode, { kind: "cut" }>;
type PinwheelArmIndices = readonly [number, number, number, number];

type CanonicalCandidate = Readonly<{
  fingerprint: TopologyFingerprint;
  graph: StructuralRegionGraph;
}>;

const layerSymmetries = new Set<LayerSymmetry>([
  "identity",
  "rotate-90",
  "rotate-180",
  "rotate-270",
  "mirror-x",
  "mirror-y",
  "transpose-main",
  "transpose-anti",
]);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(reason: string): RegionTopologyIdentityResult {
  return Object.freeze({ status: "invalid", reason });
}

function stopped(reason: RegionSearchStopReason): RegionTopologyIdentityResult {
  return Object.freeze({ status: "stopped", reason });
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function axisTransform(
  symmetry: LayerSymmetry,
  axis: RegionAxis,
): AxisTransform {
  switch (symmetry) {
    case "identity":
      return { axis, sign: 1 };
    case "rotate-90":
      return axis === "x" ? { axis: "y", sign: 1 } : { axis: "x", sign: -1 };
    case "rotate-180":
      return { axis, sign: -1 };
    case "rotate-270":
      return axis === "x" ? { axis: "y", sign: -1 } : { axis: "x", sign: 1 };
    case "mirror-x":
      return { axis, sign: axis === "x" ? -1 : 1 };
    case "mirror-y":
      return { axis, sign: axis === "y" ? -1 : 1 };
    case "transpose-main":
      return { axis: axis === "x" ? "y" : "x", sign: 1 };
    case "transpose-anti":
      return { axis: axis === "x" ? "y" : "x", sign: -1 };
  }
}

function sideAxis(side: RegionSide): RegionAxis {
  return side.endsWith("x") ? "x" : "y";
}

function sideIsMinimum(side: RegionSide): boolean {
  return side.startsWith("min");
}

function transformedSide(
  symmetry: LayerSymmetry,
  side: RegionSide,
): RegionSide {
  const transformed = axisTransform(symmetry, sideAxis(side));
  const minimum =
    transformed.sign === 1 ? sideIsMinimum(side) : !sideIsMinimum(side);
  return `${minimum ? "min" : "max"}-${transformed.axis}` as RegionSide;
}

function transformedEdge(
  edge: "min" | "center" | "max",
  sign: 1 | -1,
): "min" | "center" | "max" {
  if (edge === "center" || sign === 1) return edge;
  return edge === "min" ? "max" : "min";
}

function symmetrySwapsAxes(symmetry: LayerSymmetry): boolean {
  return (
    symmetry === "rotate-90" ||
    symmetry === "rotate-270" ||
    symmetry === "transpose-main" ||
    symmetry === "transpose-anti"
  );
}

function symmetryReversesOrientation(symmetry: LayerSymmetry): boolean {
  return (
    symmetry === "mirror-x" ||
    symmetry === "mirror-y" ||
    symmetry === "transpose-main" ||
    symmetry === "transpose-anti"
  );
}

function transformedCutNode(
  node: GuillotineCutNode,
  symmetry: LayerSymmetry,
): GuillotineCutNode {
  if (node.kind === "slot") {
    return Object.freeze({ kind: "slot", slotId: node.slotId });
  }

  const transformedAxis = axisTransform(symmetry, node.axis);
  const children = node.children.map((child) =>
    transformedCutNode(child, symmetry),
  );
  if (transformedAxis.sign === -1) children.reverse();
  return Object.freeze({
    kind: "cut",
    axis: transformedAxis.axis,
    children: Object.freeze(children) as GuillotineCut["children"],
  });
}

const pinwheelArmIndicesBySymmetry: Readonly<
  Record<LayerSymmetry, PinwheelArmIndices>
> = {
  identity: [0, 1, 2, 3],
  "rotate-90": [3, 0, 1, 2],
  "rotate-180": [2, 3, 0, 1],
  "rotate-270": [1, 2, 3, 0],
  "mirror-x": [0, 3, 2, 1],
  "mirror-y": [2, 1, 0, 3],
  "transpose-main": [3, 2, 1, 0],
  "transpose-anti": [1, 0, 3, 2],
};

function transformedPinwheelCycle(
  cycle: PinwheelCycleNode,
  symmetry: LayerSymmetry,
): PinwheelCycleNode {
  const indices = pinwheelArmIndicesBySymmetry[symmetry];
  const armSlotIds = Object.freeze(
    indices.map((index) => cycle.armSlotIds[index]!),
  ) as PinwheelCycleNode["armSlotIds"];
  const chirality = symmetryReversesOrientation(symmetry)
    ? cycle.chirality === "clockwise"
      ? "counterclockwise"
      : "clockwise"
    : cycle.chirality;
  const core =
    cycle.core.kind === "empty"
      ? Object.freeze({ kind: "empty" as const })
      : cycle.core.kind === "grid"
        ? Object.freeze({
            kind: "grid" as const,
            slotId: cycle.core.slotId,
          })
        : Object.freeze({
            kind: "cycle" as const,
            cycle: transformedPinwheelCycle(cycle.core.cycle, symmetry),
          });
  return Object.freeze({
    armSlotIds,
    chirality,
    residualAnchorSlotId: cycle.residualAnchorSlotId,
    core,
  });
}

function transformedSpineTree(
  witness: Extract<RegionFamilyWitness, { kind: "spine-tree" }>,
  symmetry: LayerSymmetry,
): Extract<RegionFamilyWitness, { kind: "spine-tree" }> {
  const inline = axisTransform(symmetry, witness.axis);
  const sourceCrossAxis: RegionAxis = witness.axis === "x" ? "y" : "x";
  const cross = axisTransform(symmetry, sourceCrossAxis);
  return Object.freeze({
    ...witness,
    axis: inline.axis,
    inlineDirection: (witness.inlineDirection * inline.sign) as 1 | -1,
    crossDirection: (witness.crossDirection * cross.sign) as 1 | -1,
  });
}

function transformedWitness(
  witness: RegionFamilyWitness,
  symmetry: LayerSymmetry,
): RegionFamilyWitness {
  if (witness.kind === "guillotine-cut-tree") {
    return Object.freeze({
      kind: "guillotine-cut-tree",
      root: transformedCutNode(witness.root, symmetry),
    });
  }
  if (witness.kind === "four-arm-cycle") {
    return Object.freeze({
      kind: "four-arm-cycle",
      root: transformedPinwheelCycle(witness.root, symmetry),
    });
  }
  if (witness.kind === "embedded-bridge") {
    return Object.freeze({
      ...witness,
      rotationSystemRelationIds: Object.freeze(
        symmetryReversesOrientation(symmetry)
          ? [...witness.rotationSystemRelationIds].reverse()
          : [...witness.rotationSystemRelationIds],
      ),
    });
  }
  if (witness.kind === "spine-tree") {
    return transformedSpineTree(witness, symmetry);
  }
  return witness;
}

function cutLeafSlotIds(root: GuillotineCutNode): readonly string[] {
  const slotIds: string[] = [];
  function visit(node: GuillotineCutNode): void {
    if (node.kind === "slot") {
      slotIds.push(node.slotId);
      return;
    }
    node.children.forEach(visit);
  }
  visit(root);
  return Object.freeze(slotIds);
}

function pinwheelSlotIds(root: PinwheelCycleNode): readonly string[] {
  const slotIds = [...root.armSlotIds];
  if (root.core.kind === "grid") slotIds.push(root.core.slotId);
  if (root.core.kind === "cycle") {
    slotIds.push(...pinwheelSlotIds(root.core.cycle));
  }
  return Object.freeze(slotIds);
}

function witnessSlotIds(
  witness: RegionFamilyWitness,
  embedding: OrthogonalEmbedding,
): readonly string[] | null {
  if (witness.kind === "guillotine-cut-tree") {
    return cutLeafSlotIds(witness.root);
  }
  if (witness.kind === "four-arm-cycle") {
    return pinwheelSlotIds(witness.root);
  }
  if (witness.kind === "embedded-bridge") {
    return Object.freeze(embedding.rotationSystem.map(({ slotId }) => slotId));
  }
  if (witness.kind === "spine-tree") {
    const spine = witness.orderedSpines[0];
    return Object.freeze([
      witness.mainSlotId,
      spine.spineSlotId,
      ...spine.attachmentSlotIds,
    ]);
  }
  return null;
}

function remapCutNode(
  node: GuillotineCutNode,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
): GuillotineCutNode {
  if (node.kind === "slot") {
    return Object.freeze({
      kind: "slot",
      slotId: canonicalSlotIdByOriginal.get(node.slotId)!,
    });
  }
  return Object.freeze({
    kind: "cut",
    axis: node.axis,
    children: Object.freeze(
      node.children.map((child) =>
        remapCutNode(child, canonicalSlotIdByOriginal),
      ),
    ) as GuillotineCut["children"],
  });
}

function remapPinwheelCycle(
  cycle: PinwheelCycleNode,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
): PinwheelCycleNode {
  const armSlotIds = Object.freeze(
    cycle.armSlotIds.map((slotId) => canonicalSlotIdByOriginal.get(slotId)!),
  ) as PinwheelCycleNode["armSlotIds"];
  const core =
    cycle.core.kind === "empty"
      ? Object.freeze({ kind: "empty" as const })
      : cycle.core.kind === "grid"
        ? Object.freeze({
            kind: "grid" as const,
            slotId: canonicalSlotIdByOriginal.get(cycle.core.slotId)!,
          })
        : Object.freeze({
            kind: "cycle" as const,
            cycle: remapPinwheelCycle(
              cycle.core.cycle,
              canonicalSlotIdByOriginal,
            ),
          });
  return Object.freeze({
    armSlotIds,
    chirality: cycle.chirality,
    residualAnchorSlotId: canonicalSlotIdByOriginal.get(
      cycle.residualAnchorSlotId,
    )!,
    core,
  });
}

function remapWitness(
  witness: RegionFamilyWitness,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
  canonicalRelationIdByOriginal: ReadonlyMap<string, string>,
): RegionFamilyWitness {
  if (witness.kind === "guillotine-cut-tree") {
    return Object.freeze({
      kind: "guillotine-cut-tree",
      root: remapCutNode(witness.root, canonicalSlotIdByOriginal),
    });
  }
  if (witness.kind === "four-arm-cycle") {
    return Object.freeze({
      kind: "four-arm-cycle",
      root: remapPinwheelCycle(witness.root, canonicalSlotIdByOriginal),
    });
  }
  if (witness.kind === "embedded-bridge") {
    return Object.freeze({
      ...witness,
      rotationSystemRelationIds: Object.freeze(
        witness.rotationSystemRelationIds.map(
          (relationId) => canonicalRelationIdByOriginal.get(relationId)!,
        ),
      ),
    });
  }
  if (witness.kind === "spine-tree") {
    const spine = witness.orderedSpines[0];
    return Object.freeze({
      ...witness,
      mainSlotId: canonicalSlotIdByOriginal.get(witness.mainSlotId)!,
      orderedSpines: Object.freeze([
        Object.freeze({
          spineSlotId: canonicalSlotIdByOriginal.get(spine.spineSlotId)!,
          attachmentSlotIds: Object.freeze(
            spine.attachmentSlotIds.map(
              (slotId) => canonicalSlotIdByOriginal.get(slotId)!,
            ),
          ) as readonly [string, string],
        }),
      ] as const),
    });
  }
  return witness;
}

function transformedNode(
  shape: RegionShape,
  canonicalIndex: number,
  swapsAxes: boolean,
): StructuralRegionNode {
  const footprintClass = swapsAxes
    ? shape.footprintClass === "lengthwise"
      ? "crosswise"
      : shape.footprintClass === "crosswise"
        ? "lengthwise"
        : "square"
    : shape.footprintClass;
  return Object.freeze({
    canonicalIndex,
    footprintClass,
    columns: swapsAxes ? shape.rows : shape.columns,
    rows: swapsAxes ? shape.columns : shape.rows,
    packageCount: shape.packageCount,
  });
}

function transformedRelation(
  relation: RegionRelation,
  symmetry: LayerSymmetry,
): RegionRelation {
  switch (relation.kind) {
    case "contact":
      return Object.freeze({
        ...relation,
        first: Object.freeze({
          slotId: relation.first.slotId,
          side: transformedSide(symmetry, relation.first.side),
        }),
        second: Object.freeze({
          slotId: relation.second.slotId,
          side: transformedSide(symmetry, relation.second.side),
        }),
      });
    case "align": {
      const transformed = axisTransform(symmetry, relation.axis);
      return Object.freeze({
        ...relation,
        axis: transformed.axis,
        edge: transformedEdge(relation.edge, transformed.sign),
      });
    }
    case "span":
      return Object.freeze({
        ...relation,
        axis: axisTransform(symmetry, relation.axis).axis,
      });
    case "order": {
      const transformed = axisTransform(symmetry, relation.axis);
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
          slotId: relation.port.slotId,
          side: transformedSide(symmetry, relation.port.side),
        }),
        frameSide: transformedSide(symmetry, relation.frameSide),
      });
    case "containment":
      return relation;
  }
}

function remapRelation(
  relation: RegionRelation,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
): RegionRelation {
  const slotId = (value: string) => canonicalSlotIdByOriginal.get(value)!;
  switch (relation.kind) {
    case "contact": {
      let first = Object.freeze({
        slotId: slotId(relation.first.slotId),
        side: relation.first.side,
      });
      let second = Object.freeze({
        slotId: slotId(relation.second.slotId),
        side: relation.second.side,
      });
      let overlap = relation.overlap;
      if (
        compareStrings(
          stableRegionTopologyValue(first),
          stableRegionTopologyValue(second),
        ) > 0
      ) {
        [first, second] = [second, first];
        if (overlap === "covers-first") overlap = "covers-second";
        else if (overlap === "covers-second") overlap = "covers-first";
      }
      return Object.freeze({
        ...relation,
        first,
        second,
        overlap,
      });
    }
    case "align": {
      const slots = [
        slotId(relation.firstSlotId),
        slotId(relation.secondSlotId),
      ].sort(compareStrings);
      return Object.freeze({
        ...relation,
        firstSlotId: slots[0]!,
        secondSlotId: slots[1]!,
      });
    }
    case "span":
      return Object.freeze({
        ...relation,
        outerSlotId: slotId(relation.outerSlotId),
        innerSlotIds: Object.freeze(
          relation.innerSlotIds.map(slotId).sort(compareStrings),
        ),
      });
    case "order":
      return Object.freeze({
        ...relation,
        beforeSlotId: slotId(relation.beforeSlotId),
        afterSlotId: slotId(relation.afterSlotId),
      });
    case "frame-anchor":
      return Object.freeze({
        ...relation,
        port: Object.freeze({
          slotId: slotId(relation.port.slotId),
          side: relation.port.side,
        }),
      });
    case "containment":
      return Object.freeze({
        ...relation,
        containerSlotId: slotId(relation.containerSlotId),
        containedSlotId: slotId(relation.containedSlotId),
      });
  }
}

function relationWithoutId(relation: RegionRelation): unknown {
  return Object.fromEntries(
    Object.entries(relation).filter(([key]) => key !== "id"),
  );
}

function canonicalRelations(
  relations: readonly RegionRelation[],
  symmetry: LayerSymmetry,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
): Readonly<{
  relations: readonly RegionRelation[];
  canonicalRelationIdByOriginal: ReadonlyMap<string, string>;
}> {
  const entries = relations.map((relation) => {
    const remapped = remapRelation(
      transformedRelation(relation, symmetry),
      canonicalSlotIdByOriginal,
    );
    return {
      originalId: relation.id,
      semanticKey: stableRegionTopologyValue(relationWithoutId(remapped)),
      remapped,
    };
  });
  entries.sort(
    (left, right) =>
      compareStrings(left.semanticKey, right.semanticKey) ||
      compareStrings(left.originalId, right.originalId),
  );

  const canonicalRelationIdByOriginal = new Map<string, string>();
  const canonicalBySemanticKey = new Map<string, RegionRelation>();
  for (const entry of entries) {
    const existing = canonicalBySemanticKey.get(entry.semanticKey);
    if (existing) {
      canonicalRelationIdByOriginal.set(entry.originalId, existing.id);
      continue;
    }
    const id = `relation-${canonicalBySemanticKey.size}`;
    const canonical = Object.freeze({
      ...entry.remapped,
      id,
    }) as RegionRelation;
    canonicalBySemanticKey.set(entry.semanticKey, canonical);
    canonicalRelationIdByOriginal.set(entry.originalId, id);
  }

  return Object.freeze({
    relations: Object.freeze([...canonicalBySemanticKey.values()]),
    canonicalRelationIdByOriginal,
  });
}

function canonicalEmbedding(
  embedding: OrthogonalEmbedding,
  symmetry: LayerSymmetry,
  canonicalSlotIdByOriginal: ReadonlyMap<string, string>,
  canonicalRelationIdByOriginal: ReadonlyMap<string, string>,
): OrthogonalEmbedding {
  const reverseOrientation = symmetryReversesOrientation(symmetry);
  const rotationSystem = embedding.rotationSystem
    .map(({ slotId, relationIdsClockwise }) => {
      const relationIds = relationIdsClockwise.map(
        (relationId) => canonicalRelationIdByOriginal.get(relationId)!,
      );
      if (reverseOrientation) relationIds.reverse();
      return Object.freeze({
        slotId: canonicalSlotIdByOriginal.get(slotId)!,
        relationIdsClockwise: Object.freeze(relationIds),
      });
    })
    .sort((left, right) => compareStrings(left.slotId, right.slotId));

  if (!embedding.directedBoundary) {
    return Object.freeze({ rotationSystem: Object.freeze(rotationSystem) });
  }

  const relationIds = embedding.directedBoundary.relationIds.map(
    (relationId) => canonicalRelationIdByOriginal.get(relationId)!,
  );
  if (reverseOrientation) relationIds.reverse();
  return Object.freeze({
    rotationSystem: Object.freeze(rotationSystem),
    directedBoundary: Object.freeze({
      relationIds: Object.freeze(relationIds),
      closed: embedding.directedBoundary.closed,
      interior: reverseOrientation
        ? embedding.directedBoundary.interior === "left"
          ? "right"
          : "left"
        : embedding.directedBoundary.interior,
    }),
  });
}

function fingerprintValue(graph: StructuralRegionGraph): unknown {
  return {
    targetCount: graph.targetCount,
    nodes: graph.nodes,
    relations: graph.relations,
    embedding: graph.embedding,
    witness: graph.witness,
  };
}

function topologyFingerprint(
  graph: StructuralRegionGraph,
): TopologyFingerprint {
  return `topology-v1:${stableRegionTopologyValue(fingerprintValue(graph))}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function createRegionTopologyId(
  fingerprint: TopologyFingerprint,
): TopologyId {
  if (!fingerprint.startsWith("topology-v1:")) {
    throw new Error("Topology fingerprint must use topology-v1.");
  }
  return `topology-v1-${fnv1a64(fingerprint)}`;
}

function normalizedSymmetries(
  requested: readonly LayerSymmetry[] | undefined,
  frameBoundsMm: RectangleBoundsMm,
): readonly LayerSymmetry[] | string {
  const candidates =
    requested ?? envelopePreservingSymmetries(frameBoundsMm, true);
  if (candidates.length === 0) {
    return "At least one topology symmetry is required.";
  }

  const sourceLength = rectangleBoundsLength(frameBoundsMm);
  const sourceWidth = rectangleBoundsWidth(frameBoundsMm);
  const seen = new Set<LayerSymmetry>();
  const normalized: LayerSymmetry[] = [];
  for (const symmetry of candidates) {
    if (!layerSymmetries.has(symmetry)) {
      return `Unknown topology symmetry ${String(symmetry)}.`;
    }
    if (seen.has(symmetry)) continue;
    const transformed = transformedEnvelopeBounds(frameBoundsMm, symmetry);
    if (
      Math.abs(rectangleBoundsLength(transformed) - sourceLength) >
        SOLVER_GEOMETRY_EPSILON_MM ||
      Math.abs(rectangleBoundsWidth(transformed) - sourceWidth) >
        SOLVER_GEOMETRY_EPSILON_MM
    ) {
      return `Topology symmetry ${symmetry} swaps unequal frame axes.`;
    }
    seen.add(symmetry);
    normalized.push(symmetry);
  }
  normalized.sort(compareStrings);
  return Object.freeze(normalized);
}

function validateShapeForSlot(
  shape: RegionShape,
  slot: RegionSlotDefinition,
): string | null {
  if (!slot.footprintClasses.includes(shape.footprintClass)) {
    return `Shape ${shape.key} is not allowed in slot ${slot.id}.`;
  }
  if (
    !isPositiveSafeInteger(shape.columns) ||
    !isPositiveSafeInteger(shape.rows) ||
    !isPositiveSafeInteger(shape.packageCount) ||
    shape.packageCount !== shape.columns * shape.rows
  ) {
    return `Shape ${shape.key} has invalid grid counts.`;
  }
  if (
    shape.columns < slot.minimumColumns ||
    shape.rows < slot.minimumRows ||
    (slot.maximumColumns !== undefined &&
      shape.columns > slot.maximumColumns) ||
    (slot.maximumRows !== undefined && shape.rows > slot.maximumRows) ||
    (slot.packageCounts !== undefined &&
      !slot.packageCounts.includes(shape.packageCount))
  ) {
    return `Shape ${shape.key} violates slot ${slot.id} grid bounds.`;
  }
  return null;
}

function normalizedAutomorphisms(
  template: RegionGraphTemplate,
  slotIds: readonly string[],
): readonly RegionTemplateAutomorphism[] | string {
  const identity = Object.freeze(
    Object.fromEntries(slotIds.map((slotId) => [slotId, slotId])) as Record<
      string,
      string
    >,
  );
  const requested = [identity, ...template.automorphisms];
  const unique = new Map<string, RegionTemplateAutomorphism>();
  const expected = [...slotIds].sort(compareStrings);

  for (const automorphism of requested) {
    if (typeof automorphism !== "object" || automorphism === null) {
      return "Every template automorphism must be an object.";
    }
    const keys = Object.keys(automorphism).sort(compareStrings);
    const values = Object.values(automorphism).sort(compareStrings);
    if (
      stableRegionTopologyValue(keys) !== stableRegionTopologyValue(expected) ||
      stableRegionTopologyValue(values) !== stableRegionTopologyValue(expected)
    ) {
      return "Every template automorphism must be a bijection over all slots.";
    }
    unique.set(
      stableRegionTopologyValue(automorphism),
      Object.freeze({ ...automorphism }),
    );
  }
  return Object.freeze(
    [...unique.values()].sort((left, right) =>
      compareStrings(
        stableRegionTopologyValue(left),
        stableRegionTopologyValue(right),
      ),
    ),
  );
}

function assignedShapesAfterAutomorphism(
  shapeBySlot: ReadonlyMap<string, RegionShape>,
  automorphism: RegionTemplateAutomorphism,
): ReadonlyMap<string, RegionShape> {
  const transformed = new Map<string, RegionShape>();
  for (const [sourceSlotId, shape] of shapeBySlot) {
    transformed.set(automorphism[sourceSlotId]!, shape);
  }
  return transformed;
}

function createCanonicalCandidate(
  template: RegionGraphTemplate,
  targetCount: number,
  shapeBySlot: ReadonlyMap<string, RegionShape>,
  automorphism: RegionTemplateAutomorphism,
  symmetry: LayerSymmetry,
): CanonicalCandidate {
  const witness = transformedWitness(template.witness, symmetry);
  const slotIds = witnessSlotIds(witness, template.embedding);
  if (!slotIds) {
    throw new Error("Unsupported region topology witness.");
  }
  const canonicalSlotIdByOriginal = new Map<string, string>();
  slotIds.forEach((slotId, index) => {
    canonicalSlotIdByOriginal.set(slotId, `region-${index}`);
  });

  const transformedShapeBySlot = assignedShapesAfterAutomorphism(
    shapeBySlot,
    automorphism,
  );
  const nodes = Object.freeze(
    slotIds.map((slotId, canonicalIndex) =>
      transformedNode(
        transformedShapeBySlot.get(slotId)!,
        canonicalIndex,
        symmetrySwapsAxes(symmetry),
      ),
    ),
  );
  const canonicalRelationSet = canonicalRelations(
    template.relations,
    symmetry,
    canonicalSlotIdByOriginal,
  );
  const embedding = canonicalEmbedding(
    template.embedding,
    symmetry,
    canonicalSlotIdByOriginal,
    canonicalRelationSet.canonicalRelationIdByOriginal,
  );
  const graph: StructuralRegionGraph = Object.freeze({
    targetCount,
    nodes,
    relations: canonicalRelationSet.relations,
    embedding,
    witness: remapWitness(
      witness,
      canonicalSlotIdByOriginal,
      canonicalRelationSet.canonicalRelationIdByOriginal,
    ),
  });
  return Object.freeze({ fingerprint: topologyFingerprint(graph), graph });
}

export function createRegionTopologyIdentity(
  request: RegionTopologyIdentityRequest,
  ledger: RegionWorkLedger,
): RegionTopologyIdentityResult {
  if (typeof request !== "object" || request === null) {
    return invalid("Region topology identity request must be an object.");
  }
  const { template, assignments, targetCount } = request;
  if (typeof template !== "object" || template === null) {
    return invalid("Region graph template must be an object.");
  }
  const supportedWitness =
    (template.claimedFamily === "guillotine" &&
      template.witness.kind === "guillotine-cut-tree") ||
    (template.claimedFamily === "pinwheel" &&
      template.witness.kind === "four-arm-cycle") ||
    (template.claimedFamily === "bridge-chain" &&
      template.witness.kind === "embedded-bridge") ||
    (template.claimedFamily === "spine-corridor" &&
      template.witness.kind === "spine-tree");
  if (!supportedWitness) {
    return invalid(
      "The claimed topology family does not match a supported witness.",
    );
  }
  if (!isNonNegativeSafeInteger(targetCount)) {
    return invalid("Target count must be a non-negative safe integer.");
  }

  let frameBoundsMm: RectangleBoundsMm;
  try {
    frameBoundsMm = assertRectangleBounds(
      request.frameBoundsMm,
      "frameBoundsMm",
    );
  } catch (cause) {
    return invalid(
      cause instanceof Error ? cause.message : "Frame bounds are invalid.",
    );
  }

  if (template.slots.length === 0) {
    return invalid("Region topology template must contain at least one slot.");
  }

  const slotById = new Map<string, RegionSlotDefinition>();
  for (const slot of template.slots) {
    if (typeof slot.id !== "string" || slot.id.length === 0) {
      return invalid("Every region slot must have a non-empty id.");
    }
    if (slotById.has(slot.id)) {
      return invalid(`Duplicate region slot id ${slot.id}.`);
    }
    slotById.set(slot.id, slot);
  }

  const structuralSlotIds = witnessSlotIds(
    template.witness,
    template.embedding,
  );
  if (!structuralSlotIds) {
    return invalid("Unsupported region topology witness.");
  }
  if (
    new Set(structuralSlotIds).size !== structuralSlotIds.length ||
    [...slotById.keys()].some(
      (slotId) => !structuralSlotIds.includes(slotId),
    ) ||
    structuralSlotIds.some((slotId) => !slotById.has(slotId))
  ) {
    return invalid("Topology witness slots must match template slots exactly.");
  }

  const shapeBySlot = new Map<string, RegionShape>();
  for (const assignment of assignments) {
    if (!slotById.has(assignment.slotId)) {
      return invalid(`Unknown assigned region slot ${assignment.slotId}.`);
    }
    if (shapeBySlot.has(assignment.slotId)) {
      return invalid(
        `Duplicate shape assignment for slot ${assignment.slotId}.`,
      );
    }
    const shapeIssue = validateShapeForSlot(
      assignment.shape,
      slotById.get(assignment.slotId)!,
    );
    if (shapeIssue) return invalid(shapeIssue);
    shapeBySlot.set(assignment.slotId, assignment.shape);
  }
  if (shapeBySlot.size !== slotById.size) {
    return invalid(
      "Every topology slot requires one non-zero shape assignment in this slice.",
    );
  }
  const assignedCount = [...shapeBySlot.values()].reduce(
    (sum, shape) => sum + shape.packageCount,
    0,
  );
  if (assignedCount !== targetCount) {
    return invalid(
      "Assigned shape counts must sum exactly to the target count.",
    );
  }

  const symmetries = normalizedSymmetries(request.symmetries, frameBoundsMm);
  if (typeof symmetries === "string") return invalid(symmetries);
  const automorphisms = normalizedAutomorphisms(template, [...slotById.keys()]);
  if (typeof automorphisms === "string") return invalid(automorphisms);

  let canonical: CanonicalCandidate | null = null;
  for (const automorphism of automorphisms) {
    for (const symmetry of symmetries) {
      const decision = ledger.debit("canonical-transform");
      if (decision !== "continue") return stopped(decision);
      const candidate = createCanonicalCandidate(
        template,
        targetCount,
        shapeBySlot,
        automorphism,
        symmetry,
      );
      if (
        canonical === null ||
        compareStrings(candidate.fingerprint, canonical.fingerprint) < 0
      ) {
        canonical = candidate;
      }
    }
  }
  if (!canonical)
    return invalid("No canonical topology transform was available.");

  const graph: OwnedStructuralRegionGraph = Object.freeze({
    ...canonical.graph,
    ownerFamily: template.claimedFamily,
    topologyFingerprint: canonical.fingerprint,
  });
  return Object.freeze({
    status: "completed",
    graph,
    topologyId: createRegionTopologyId(canonical.fingerprint),
  });
}

function normalizedBounds(bounds: RectangleBoundsMm, field: string) {
  return {
    minX: normalizeGeneratedCoordinateMm(bounds.minX, `${field}.minX`),
    minY: normalizeGeneratedCoordinateMm(bounds.minY, `${field}.minY`),
    maxX: normalizeGeneratedCoordinateMm(bounds.maxX, `${field}.maxX`),
    maxY: normalizeGeneratedCoordinateMm(bounds.maxY, `${field}.maxY`),
  };
}

export function createRegionRealizationKey(
  graph: SpacedRegionGraph,
): RegionRealizationKey {
  const nodeCount = graph.topology.nodes.length;
  if (
    graph.regionBoundsMm.length !== nodeCount ||
    graph.spacingByRegion.length !== nodeCount
  ) {
    throw new Error(
      "Realization bounds and spacing must match the structural node count.",
    );
  }

  const mergeGroups = graph.physicalMergeGroups
    .map((group) => [...group].sort((left, right) => left - right))
    .sort((left, right) =>
      compareStrings(
        stableRegionTopologyValue(left),
        stableRegionTopologyValue(right),
      ),
    );
  const residualAssignments = graph.residualAssignments
    .map(({ sinkKey, amountMm }) => ({
      sinkKey,
      amountMm: normalizeGeneratedCoordinateMm(
        amountMm,
        `residualAssignments.${sinkKey}`,
      ),
    }))
    .sort((left, right) => compareStrings(left.sinkKey, right.sinkKey));
  const value = {
    topologyFingerprint: graph.topology.topologyFingerprint,
    framePolicy: graph.framePolicy,
    regionBoundsMm: graph.regionBoundsMm.map((bounds, index) =>
      normalizedBounds(bounds, `regionBoundsMm[${index}]`),
    ),
    residualAssignments,
    spacingByRegion: graph.spacingByRegion,
    physicalMergeGroups: mergeGroups,
  };
  return `realization-v1:${stableRegionTopologyValue(value)}`;
}
