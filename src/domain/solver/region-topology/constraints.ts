import {
  rectangleBoundsContain,
  rectangleBoundsLength,
  rectangleBoundsWidth,
} from "~/domain/geometry";
import type { RectangleBoundsMm, RectangleSizeMm } from "~/domain/geometry";
import {
  normalizeGeneratedCoordinateMm,
  normalizeGeneratedGeometryMetric,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import type {
  GuillotineCutNode,
  MetricRegionGraph,
  OwnedStructuralRegionGraph,
  PinwheelCycleNode,
  RegionAxis,
  RegionFramePolicy,
  RegionGraphTemplate,
  RegionRelation,
  RegionShape,
  RegionSide,
  RegionSpacingPolicy,
  StructuralRegionNode,
} from "~/domain/solver/region-topology/model";
import {
  PINWHEEL_RESIDUAL_PLACEMENTS,
  REGION_RECURSIVE_CORE_ALIGNMENTS,
  type PinwheelResidualPlacement,
  type RegionRecursiveCoreAlignment,
  type RegionSpacingSelection,
} from "~/domain/solver/region-topology/spacing";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

export type RegionConstraintResult =
  | Readonly<{ status: "completed"; graph: MetricRegionGraph }>
  | Readonly<{ status: "infeasible"; reason: string }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>;

export type GuillotineConstraintResult = RegionConstraintResult;

type NaturalCutNode = Readonly<{
  source: GuillotineCutNode;
  sizeMm: RectangleSizeMm;
  children: readonly NaturalCutNode[];
}>;

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= SOLVER_GEOMETRY_EPSILON_MM;
}

function sideAxis(side: RegionSide): RegionAxis {
  return side.endsWith("x") ? "x" : "y";
}

function sideValue(bounds: RectangleBoundsMm, side: RegionSide): number {
  switch (side) {
    case "min-x":
      return bounds.minX;
    case "max-x":
      return bounds.maxX;
    case "min-y":
      return bounds.minY;
    case "max-y":
      return bounds.maxY;
  }
}

function axisMinimum(bounds: RectangleBoundsMm, axis: RegionAxis): number {
  return axis === "x" ? bounds.minX : bounds.minY;
}

function axisMaximum(bounds: RectangleBoundsMm, axis: RegionAxis): number {
  return axis === "x" ? bounds.maxX : bounds.maxY;
}

function axisCenter(bounds: RectangleBoundsMm, axis: RegionAxis): number {
  return (axisMinimum(bounds, axis) + axisMaximum(bounds, axis)) / 2;
}

function axisSpan(bounds: RectangleBoundsMm, axis: RegionAxis): number {
  return axisMaximum(bounds, axis) - axisMinimum(bounds, axis);
}

function normalizedBounds(
  bounds: RectangleBoundsMm,
  field: string,
): RectangleBoundsMm {
  return Object.freeze({
    minX: normalizeGeneratedCoordinateMm(bounds.minX, `${field}.minX`),
    minY: normalizeGeneratedCoordinateMm(bounds.minY, `${field}.minY`),
    maxX: normalizeGeneratedCoordinateMm(bounds.maxX, `${field}.maxX`),
    maxY: normalizeGeneratedCoordinateMm(bounds.maxY, `${field}.maxY`),
  });
}

function footprintSize(
  input: NormalizedLayerSolverInput,
  node: StructuralRegionNode,
): RectangleSizeMm | null {
  const dimensions = input.package.dimensionsMm;
  if (node.footprintClass === "square") {
    if (!approximatelyEqual(dimensions.length, dimensions.width)) return null;
    return { length: dimensions.length, width: dimensions.width };
  }
  return node.footprintClass === "lengthwise"
    ? { length: dimensions.length, width: dimensions.width }
    : { length: dimensions.width, width: dimensions.length };
}

function naturalNodeSize(
  input: NormalizedLayerSolverInput,
  node: StructuralRegionNode,
): RectangleSizeMm | null {
  const footprint = footprintSize(input, node);
  if (!footprint) return null;
  const clearance = input.package.clearanceMm;
  return Object.freeze({
    length: normalizeGeneratedGeometryMetric(
      node.columns * footprint.length + (node.columns - 1) * clearance,
      `region-${node.canonicalIndex}.naturalLengthMm`,
    ),
    width: normalizeGeneratedGeometryMetric(
      node.rows * footprint.width + (node.rows - 1) * clearance,
      `region-${node.canonicalIndex}.naturalWidthMm`,
    ),
  });
}

function naturalCutTree(
  input: NormalizedLayerSolverInput,
  node: GuillotineCutNode,
  structuralNodeBySlotId: ReadonlyMap<string, StructuralRegionNode>,
): NaturalCutNode | string {
  if (node.kind === "slot") {
    const structuralNode = structuralNodeBySlotId.get(node.slotId);
    if (!structuralNode) return `Unknown guillotine slot ${node.slotId}.`;
    const sizeMm = naturalNodeSize(input, structuralNode);
    if (!sizeMm) {
      return `Region ${structuralNode.canonicalIndex} has an invalid footprint class for the package.`;
    }
    return Object.freeze({ source: node, sizeMm, children: Object.freeze([]) });
  }
  if (node.children.length < 2) {
    return "Every guillotine cut requires at least two children.";
  }

  const children: NaturalCutNode[] = [];
  for (const child of node.children) {
    const naturalChild = naturalCutTree(input, child, structuralNodeBySlotId);
    if (typeof naturalChild === "string") return naturalChild;
    children.push(naturalChild);
  }

  const clearance = input.package.clearanceMm;
  const sizeMm =
    node.axis === "x"
      ? {
          length: normalizeGeneratedGeometryMetric(
            children.reduce((sum, child) => sum + child.sizeMm.length, 0) +
              (children.length - 1) * clearance,
            "guillotineCut.naturalLengthMm",
          ),
          width: normalizeGeneratedGeometryMetric(
            Math.max(...children.map((child) => child.sizeMm.width)),
            "guillotineCut.naturalWidthMm",
          ),
        }
      : {
          length: normalizeGeneratedGeometryMetric(
            Math.max(...children.map((child) => child.sizeMm.length)),
            "guillotineCut.naturalLengthMm",
          ),
          width: normalizeGeneratedGeometryMetric(
            children.reduce((sum, child) => sum + child.sizeMm.width, 0) +
              (children.length - 1) * clearance,
            "guillotineCut.naturalWidthMm",
          ),
        };
  return Object.freeze({
    source: node,
    sizeMm: Object.freeze(sizeMm),
    children: Object.freeze(children),
  });
}

function centeredRootBounds(
  frame: RectangleBoundsMm,
  naturalSize: RectangleSizeMm,
): RectangleBoundsMm {
  const centerX = frame.minX + rectangleBoundsLength(frame) / 2;
  const centerY = frame.minY + rectangleBoundsWidth(frame) / 2;
  return normalizedBounds(
    {
      minX: centerX - naturalSize.length / 2,
      minY: centerY - naturalSize.width / 2,
      maxX: centerX + naturalSize.length / 2,
      maxY: centerY + naturalSize.width / 2,
    },
    "guillotineRootBoundsMm",
  );
}

function firstGuillotineSlotId(node: GuillotineCutNode): string {
  return node.kind === "slot"
    ? node.slotId
    : firstGuillotineSlotId(node.children[0]);
}

function containedIntegerCenterPhase(
  minimum: number,
  maximum: number,
  frameMinimum: number,
  frameMaximum: number,
  firstItemSpan: number,
): number {
  const firstCenter = minimum + firstItemSpan / 2;
  const preferred = Math.trunc(firstCenter) - firstCenter;
  const alternatives =
    preferred < 0
      ? [preferred, preferred + 1]
      : preferred > 0
        ? [preferred, preferred - 1]
        : [0];
  return (
    alternatives.find(
      (offset) =>
        minimum + offset >= frameMinimum - SOLVER_GEOMETRY_EPSILON_MM &&
        maximum + offset <= frameMaximum + SOLVER_GEOMETRY_EPSILON_MM,
    ) ?? 0
  );
}

function integerCenterPhasedRootBounds(
  frame: RectangleBoundsMm,
  centeredBounds: RectangleBoundsMm,
  firstFootprint: RectangleSizeMm,
): RectangleBoundsMm {
  const offsetX = containedIntegerCenterPhase(
    centeredBounds.minX,
    centeredBounds.maxX,
    frame.minX,
    frame.maxX,
    firstFootprint.length,
  );
  const offsetY = containedIntegerCenterPhase(
    centeredBounds.minY,
    centeredBounds.maxY,
    frame.minY,
    frame.maxY,
    firstFootprint.width,
  );
  return normalizedBounds(
    {
      minX: centeredBounds.minX + offsetX,
      minY: centeredBounds.minY + offsetY,
      maxX: centeredBounds.maxX + offsetX,
      maxY: centeredBounds.maxY + offsetY,
    },
    "integerCenterGuillotineRootBoundsMm",
  );
}

function cutSubtreeUsesSeamResidual(
  node: GuillotineCutNode,
  axis: RegionAxis,
  selectionBySlotId: ReadonlyMap<string, RegionSpacingSelection>,
): boolean {
  if (node.kind === "slot") {
    return selectionBySlotId.get(node.slotId)?.[axis] === "inter-region-seam";
  }
  return node.children.every((child) =>
    cutSubtreeUsesSeamResidual(child, axis, selectionBySlotId),
  );
}

function allocateCutTree(
  node: NaturalCutNode,
  bounds: RectangleBoundsMm,
  clearanceMm: number,
  regionBoundsBySlotId: Map<string, RectangleBoundsMm>,
  selectionBySlotId: ReadonlyMap<string, RegionSpacingSelection>,
  residualAssignments: Array<{ sinkKey: string; amountMm: number }>,
  path: string,
): string | null {
  if (node.source.kind === "slot") {
    if (regionBoundsBySlotId.has(node.source.slotId)) {
      return `Guillotine slot ${node.source.slotId} occurs more than once.`;
    }
    regionBoundsBySlotId.set(node.source.slotId, bounds);
    return null;
  }

  const axis = node.source.axis;
  const availableInline =
    axisSpan(bounds, axis) - (node.children.length - 1) * clearanceMm;
  const naturalInline = node.children.reduce(
    (sum, child) =>
      sum + (axis === "x" ? child.sizeMm.length : child.sizeMm.width),
    0,
  );
  const residual = availableInline - naturalInline;
  if (residual < -SOLVER_GEOMETRY_EPSILON_MM) {
    return "Guillotine children do not fit their allocated cut span.";
  }

  const normalizedResidual = Math.max(0, residual);
  const usesSeamResidual = cutSubtreeUsesSeamResidual(
    node.source,
    axis,
    selectionBySlotId,
  );
  const residualPerChild = usesSeamResidual
    ? 0
    : normalizedResidual / node.children.length;
  const residualPerSeam = usesSeamResidual
    ? normalizedResidual / (node.children.length - 1)
    : 0;
  let cursor = axisMinimum(bounds, axis);
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]!;
    const naturalChildInline =
      axis === "x" ? child.sizeMm.length : child.sizeMm.width;
    const childMaximum =
      !usesSeamResidual && index === node.children.length - 1
        ? axisMaximum(bounds, axis)
        : cursor + naturalChildInline + residualPerChild;
    const childBounds = normalizedBounds(
      axis === "x"
        ? {
            minX: cursor,
            minY: bounds.minY,
            maxX: childMaximum,
            maxY: bounds.maxY,
          }
        : {
            minX: bounds.minX,
            minY: cursor,
            maxX: bounds.maxX,
            maxY: childMaximum,
          },
      `guillotineChildBoundsMm[${index}]`,
    );
    const issue = allocateCutTree(
      child,
      childBounds,
      clearanceMm,
      regionBoundsBySlotId,
      selectionBySlotId,
      residualAssignments,
      `${path}.${index}`,
    );
    if (issue) return issue;
    if (
      index < node.children.length - 1 &&
      residualPerSeam > SOLVER_GEOMETRY_EPSILON_MM
    ) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${path}:${axis}:seam-${index}`,
          amountMm: normalizeGeneratedGeometryMetric(
            residualPerSeam,
            `${path}.${axis}.seam[${index}].residualMm`,
          ),
        }),
      );
    }
    cursor = childMaximum + clearanceMm + residualPerSeam;
  }
  return null;
}

function projectedSpan(
  bounds: RectangleBoundsMm,
  axis: RegionAxis,
): Readonly<{ minimum: number; maximum: number }> {
  return {
    minimum: axisMinimum(bounds, axis),
    maximum: axisMaximum(bounds, axis),
  };
}

function contactRelationHolds(
  relation: Extract<RegionRelation, { kind: "contact" }>,
  first: RectangleBoundsMm,
  second: RectangleBoundsMm,
  clearanceMm: number,
): boolean {
  const axis = sideAxis(relation.first.side);
  if (axis !== sideAxis(relation.second.side)) return false;
  const firstMinimum = relation.first.side.startsWith("min");
  const secondMinimum = relation.second.side.startsWith("min");
  if (firstMinimum === secondMinimum) return false;

  const firstCoordinate = sideValue(first, relation.first.side);
  const secondCoordinate = sideValue(second, relation.second.side);
  const gap = firstMinimum
    ? firstCoordinate - secondCoordinate
    : secondCoordinate - firstCoordinate;
  if (
    relation.gap === "clearance"
      ? !approximatelyEqual(gap, clearanceMm)
      : gap < clearanceMm - SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return false;
  }

  const crossAxis: RegionAxis = axis === "x" ? "y" : "x";
  const firstSpan = projectedSpan(first, crossAxis);
  const secondSpan = projectedSpan(second, crossAxis);
  const overlap =
    Math.min(firstSpan.maximum, secondSpan.maximum) -
    Math.max(firstSpan.minimum, secondSpan.minimum);
  switch (relation.overlap) {
    case "positive":
      return overlap > SOLVER_GEOMETRY_EPSILON_MM;
    case "equal-span":
      return (
        approximatelyEqual(firstSpan.minimum, secondSpan.minimum) &&
        approximatelyEqual(firstSpan.maximum, secondSpan.maximum)
      );
    case "covers-first":
      return (
        secondSpan.minimum <= firstSpan.minimum + SOLVER_GEOMETRY_EPSILON_MM &&
        secondSpan.maximum >= firstSpan.maximum - SOLVER_GEOMETRY_EPSILON_MM
      );
    case "covers-second":
      return (
        firstSpan.minimum <= secondSpan.minimum + SOLVER_GEOMETRY_EPSILON_MM &&
        firstSpan.maximum >= secondSpan.maximum - SOLVER_GEOMETRY_EPSILON_MM
      );
  }
}

function alignedCoordinate(
  bounds: RectangleBoundsMm,
  axis: RegionAxis,
  edge: "min" | "center" | "max",
): number {
  return edge === "min"
    ? axisMinimum(bounds, axis)
    : edge === "max"
      ? axisMaximum(bounds, axis)
      : axisCenter(bounds, axis);
}

function relationHolds(
  relation: RegionRelation,
  boundsBySlotId: ReadonlyMap<string, RectangleBoundsMm>,
  frameBoundsMm: RectangleBoundsMm,
  clearanceMm: number,
): boolean {
  const bounds = (slotId: string) => boundsBySlotId.get(slotId);
  switch (relation.kind) {
    case "contact": {
      const first = bounds(relation.first.slotId);
      const second = bounds(relation.second.slotId);
      return Boolean(
        first &&
          second &&
          contactRelationHolds(relation, first, second, clearanceMm),
      );
    }
    case "align": {
      const first = bounds(relation.firstSlotId);
      const second = bounds(relation.secondSlotId);
      return Boolean(
        first &&
          second &&
          approximatelyEqual(
            alignedCoordinate(first, relation.axis, relation.edge),
            alignedCoordinate(second, relation.axis, relation.edge),
          ),
      );
    }
    case "span": {
      const outer = bounds(relation.outerSlotId);
      const inner = relation.innerSlotIds.map(bounds);
      if (!outer || inner.length === 0 || inner.some((entry) => !entry)) {
        return false;
      }
      const typedInner = inner as RectangleBoundsMm[];
      return (
        approximatelyEqual(
          axisMinimum(outer, relation.axis),
          Math.min(
            ...typedInner.map((entry) => axisMinimum(entry, relation.axis)),
          ),
        ) &&
        approximatelyEqual(
          axisMaximum(outer, relation.axis),
          Math.max(
            ...typedInner.map((entry) => axisMaximum(entry, relation.axis)),
          ),
        )
      );
    }
    case "order": {
      const before = bounds(relation.beforeSlotId);
      const after = bounds(relation.afterSlotId);
      if (!before || !after) return false;
      const minimumGap = relation.minimumGap === "clearance" ? clearanceMm : 0;
      return (
        axisMinimum(after, relation.axis) -
          axisMaximum(before, relation.axis) >=
        minimumGap - SOLVER_GEOMETRY_EPSILON_MM
      );
    }
    case "frame-anchor": {
      const region = bounds(relation.port.slotId);
      return Boolean(
        region &&
          sideAxis(relation.port.side) === sideAxis(relation.frameSide) &&
          approximatelyEqual(
            sideValue(region, relation.port.side),
            sideValue(frameBoundsMm, relation.frameSide),
          ),
      );
    }
    case "containment": {
      const container = bounds(relation.containerSlotId);
      const contained = bounds(relation.containedSlotId);
      return Boolean(
        container &&
          contained &&
          rectangleBoundsContain(
            container,
            contained,
            SOLVER_GEOMETRY_EPSILON_MM,
          ),
      );
    }
  }
}

function guillotineRelationHolds(
  relation: RegionRelation,
  boundsBySlotId: ReadonlyMap<string, RectangleBoundsMm>,
  frameBoundsMm: RectangleBoundsMm,
  clearanceMm: number,
  selectionBySlotId: ReadonlyMap<string, RegionSpacingSelection>,
): boolean {
  if (relationHolds(relation, boundsBySlotId, frameBoundsMm, clearanceMm)) {
    return true;
  }
  if (relation.kind !== "contact") return false;
  const axis = sideAxis(relation.first.side);
  if (
    selectionBySlotId.get(relation.first.slotId)?.[axis] !==
      "inter-region-seam" ||
    selectionBySlotId.get(relation.second.slotId)?.[axis] !==
      "inter-region-seam"
  ) {
    return false;
  }
  const first = boundsBySlotId.get(relation.first.slotId);
  const second = boundsBySlotId.get(relation.second.slotId);
  return Boolean(
    first &&
      second &&
      contactRelationHolds(
        Object.freeze({ ...relation, gap: "residual-seam" }),
        first,
        second,
        clearanceMm,
      ),
  );
}

function structuralNodeMap(
  topology: OwnedStructuralRegionGraph,
): ReadonlyMap<string, StructuralRegionNode> | string {
  const nodesBySlotId = new Map<string, StructuralRegionNode>();
  const seenIndices = new Set<number>();
  for (const node of topology.nodes) {
    if (
      !Number.isSafeInteger(node.canonicalIndex) ||
      node.canonicalIndex < 0 ||
      node.canonicalIndex >= topology.nodes.length ||
      seenIndices.has(node.canonicalIndex)
    ) {
      return "Structural region canonical indices must be unique and contiguous.";
    }
    seenIndices.add(node.canonicalIndex);
    nodesBySlotId.set(`region-${node.canonicalIndex}`, node);
  }
  return nodesBySlotId;
}

type PinwheelArmIndex = 0 | 1 | 2 | 3;
type PinwheelResidualMode =
  | "regions-balanced"
  | "first-region"
  | "second-region"
  | "seam";
type PinwheelAxisResidualAllocation = Readonly<{
  firstExtraMm: number;
  secondExtraMm: number;
}>;
type PinwheelChainResidualPlacement = "leading" | "between" | "trailing";

type NaturalPinwheelRegion = Readonly<{
  slotId: string;
  node: StructuralRegionNode;
  sizeMm: RectangleSizeMm;
}>;

type NaturalPinwheelCore =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "grid"; region: NaturalPinwheelRegion }>
  | Readonly<{ kind: "cycle"; cycle: NaturalPinwheelCycle }>;

type NaturalPinwheelCycle = Readonly<{
  source: PinwheelCycleNode;
  arms: readonly [
    NaturalPinwheelRegion,
    NaturalPinwheelRegion,
    NaturalPinwheelRegion,
    NaturalPinwheelRegion,
  ];
  core: NaturalPinwheelCore;
  sizeMm: RectangleSizeMm;
}>;

type PinwheelAxisChain = Readonly<{
  axis: RegionAxis;
  name: string;
  firstArmIndex: PinwheelArmIndex;
  secondArmIndex: PinwheelArmIndex;
}>;

type AxisInterval = Readonly<{ minimum: number; maximum: number }>;

type AxisChainAllocation = Readonly<{
  first: AxisInterval;
  second: AxisInterval;
  residualAssignments: readonly Readonly<{
    sinkKey: string;
    amountMm: number;
  }>[];
}>;

type PinwheelBoundaryResiduals = Map<string, number>;

type MutableRegionBounds = {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
};

function pinwheelChains(
  cycle: PinwheelCycleNode,
): readonly PinwheelAxisChain[] {
  return cycle.chirality === "clockwise"
    ? Object.freeze([
        Object.freeze({
          axis: "x" as const,
          name: "left-bottom",
          firstArmIndex: 3 as const,
          secondArmIndex: 0 as const,
        }),
        Object.freeze({
          axis: "x" as const,
          name: "top-right",
          firstArmIndex: 2 as const,
          secondArmIndex: 1 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          name: "left-top",
          firstArmIndex: 3 as const,
          secondArmIndex: 2 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          name: "bottom-right",
          firstArmIndex: 0 as const,
          secondArmIndex: 1 as const,
        }),
      ])
    : Object.freeze([
        Object.freeze({
          axis: "x" as const,
          name: "bottom-right",
          firstArmIndex: 0 as const,
          secondArmIndex: 1 as const,
        }),
        Object.freeze({
          axis: "x" as const,
          name: "left-top",
          firstArmIndex: 3 as const,
          secondArmIndex: 2 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          name: "bottom-left",
          firstArmIndex: 0 as const,
          secondArmIndex: 3 as const,
        }),
        Object.freeze({
          axis: "y" as const,
          name: "right-top",
          firstArmIndex: 1 as const,
          secondArmIndex: 2 as const,
        }),
      ]);
}

type PinwheelResidualRule = Readonly<{
  armIndices: readonly [PinwheelArmIndex, PinwheelArmIndex];
  frameSide: RegionSide;
}>;

function rotatedPinwheelArmIndex(
  index: PinwheelArmIndex,
  quarterTurns: PinwheelArmIndex,
): PinwheelArmIndex {
  return ((index + quarterTurns) % 4) as PinwheelArmIndex;
}

function rotatedPinwheelSide(
  side: RegionSide,
  quarterTurns: PinwheelArmIndex,
): RegionSide {
  let rotated = side;
  for (let turn = 0; turn < quarterTurns; turn += 1) {
    switch (rotated) {
      case "min-x":
        rotated = "min-y";
        break;
      case "max-x":
        rotated = "max-y";
        break;
      case "min-y":
        rotated = "max-x";
        break;
      case "max-y":
        rotated = "min-x";
        break;
    }
  }
  return rotated;
}

function canonicalPinwheelResidualRules(
  chirality: PinwheelCycleNode["chirality"],
): readonly PinwheelResidualRule[] {
  return chirality === "clockwise"
    ? Object.freeze([
        Object.freeze({
          armIndices: Object.freeze([3, 0] as const),
          frameSide: "max-x" as const,
        }),
        Object.freeze({
          armIndices: Object.freeze([3, 2] as const),
          frameSide: "min-y" as const,
        }),
      ])
    : Object.freeze([
        Object.freeze({
          armIndices: Object.freeze([0, 1] as const),
          frameSide: "min-x" as const,
        }),
        Object.freeze({
          armIndices: Object.freeze([1, 2] as const),
          frameSide: "min-y" as const,
        }),
      ]);
}

function pinwheelChainResidualPlacement(
  cycle: PinwheelCycleNode,
  chain: PinwheelAxisChain,
  placement: PinwheelResidualPlacement,
): PinwheelChainResidualPlacement {
  if (placement === "between") return "between";
  const anchorPosition = cycle.armSlotIds.indexOf(cycle.residualAnchorSlotId);
  if (anchorPosition < 0) return "between";
  const anchorIndex = anchorPosition as PinwheelArmIndex;

  for (const rule of canonicalPinwheelResidualRules(cycle.chirality)) {
    const firstIndex = rotatedPinwheelArmIndex(rule.armIndices[0], anchorIndex);
    const secondIndex = rotatedPinwheelArmIndex(
      rule.armIndices[1],
      anchorIndex,
    );
    const matchesChain =
      (chain.firstArmIndex === firstIndex &&
        chain.secondArmIndex === secondIndex) ||
      (chain.firstArmIndex === secondIndex &&
        chain.secondArmIndex === firstIndex);
    if (!matchesChain) continue;

    const frameSide = rotatedPinwheelSide(rule.frameSide, anchorIndex);
    if (sideAxis(frameSide) !== chain.axis) return "between";
    return frameSide.startsWith("min") ? "leading" : "trailing";
  }
  return "between";
}

export type PartialRegionShapeAssignment = Readonly<{
  slotId: string;
  shape: RegionShape;
}>;

function partialPinwheelCycleFits(
  cycle: PinwheelCycleNode,
  shapeBySlotId: ReadonlyMap<string, RegionShape>,
  availableLengthMm: number,
  availableWidthMm: number,
  clearanceMm: number,
): boolean {
  const shapes = cycle.armSlotIds.map((slotId) => shapeBySlotId.get(slotId));
  for (const shape of shapes) {
    if (
      shape &&
      (shape.naturalSizeMm.length >
        availableLengthMm + SOLVER_GEOMETRY_EPSILON_MM ||
        shape.naturalSizeMm.width >
          availableWidthMm + SOLVER_GEOMETRY_EPSILON_MM)
    ) {
      return false;
    }
  }

  for (const chain of pinwheelChains(cycle)) {
    const first = shapes[chain.firstArmIndex];
    const second = shapes[chain.secondArmIndex];
    if (!first || !second) continue;
    const required =
      (chain.axis === "x"
        ? first.naturalSizeMm.length + second.naturalSizeMm.length
        : first.naturalSizeMm.width + second.naturalSizeMm.width) + clearanceMm;
    const available = chain.axis === "x" ? availableLengthMm : availableWidthMm;
    if (required > available + SOLVER_GEOMETRY_EPSILON_MM) return false;
  }

  const [bottom, right, top, left] = shapes;
  if (cycle.core.kind === "empty") return true;
  if (
    left &&
    right &&
    left.naturalSizeMm.length + right.naturalSizeMm.length + 2 * clearanceMm >
      availableLengthMm + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return false;
  }
  if (
    bottom &&
    top &&
    bottom.naturalSizeMm.width + top.naturalSizeMm.width + 2 * clearanceMm >
      availableWidthMm + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return false;
  }

  const core = cycle.core;
  const coreFits = (
    availableLength: number,
    availableWidth: number,
  ): boolean => {
    if (core.kind === "grid") {
      const shape = shapeBySlotId.get(core.slotId);
      return (
        !shape ||
        (shape.naturalSizeMm.length <=
          availableLength + SOLVER_GEOMETRY_EPSILON_MM &&
          shape.naturalSizeMm.width <=
            availableWidth + SOLVER_GEOMETRY_EPSILON_MM)
      );
    }
    return partialPinwheelCycleFits(
      core.cycle,
      shapeBySlotId,
      availableLength,
      availableWidth,
      clearanceMm,
    );
  };

  if (!bottom || !right || !top || !left) {
    return coreFits(availableLengthMm, availableWidthMm);
  }
  const coreLength =
    availableLengthMm -
    left.naturalSizeMm.length -
    right.naturalSizeMm.length -
    2 * clearanceMm;
  const coreWidth =
    availableWidthMm -
    bottom.naturalSizeMm.width -
    top.naturalSizeMm.width -
    2 * clearanceMm;
  if (
    coreLength <= SOLVER_GEOMETRY_EPSILON_MM ||
    coreWidth <= SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return false;
  }
  return coreFits(coreLength, coreWidth);
}

type EmbeddedAxisEdge = Readonly<{
  from: string;
  to: string;
  minimumDeltaMm: number;
}>;

type EmbeddedAxisSolution = Readonly<{
  frameSpanMm: number;
  intervalsBySlotId: ReadonlyMap<string, AxisInterval>;
}>;

function embeddedEndpointKey(slotId: string, edge: "min" | "max"): string {
  return `${slotId}:${edge}`;
}

function embeddedSideEndpointKey(slotId: string, side: RegionSide): string {
  return embeddedEndpointKey(slotId, side.startsWith("min") ? "min" : "max");
}

function addEmbeddedLowerBound(
  edges: EmbeddedAxisEdge[],
  vertices: Set<string>,
  from: string,
  to: string,
  minimumDeltaMm: number,
): void {
  vertices.add(from);
  vertices.add(to);
  edges.push(Object.freeze({ from, to, minimumDeltaMm }));
}

function addEmbeddedEquality(
  edges: EmbeddedAxisEdge[],
  vertices: Set<string>,
  first: string,
  second: string,
  secondMinusFirstMm: number,
): void {
  addEmbeddedLowerBound(edges, vertices, first, second, secondMinusFirstMm);
  addEmbeddedLowerBound(edges, vertices, second, first, -secondMinusFirstMm);
}

function solveEmbeddedAxis(
  slotIds: readonly string[],
  relations: readonly RegionRelation[],
  naturalSpanBySlotId: ReadonlyMap<string, number>,
  axis: RegionAxis,
  clearanceMm: number,
  spacingPolicyBySlotId: ReadonlyMap<string, RegionSpacingPolicy> | null,
  fixedFrameSpanMm: number | null,
): EmbeddedAxisSolution | string {
  const frameMinimumKey = "frame:min";
  const frameMaximumKey = "frame:max";
  const vertices = new Set<string>([frameMinimumKey, frameMaximumKey]);
  const edges: EmbeddedAxisEdge[] = [];

  for (const slotId of slotIds) {
    const minimumKey = embeddedEndpointKey(slotId, "min");
    const maximumKey = embeddedEndpointKey(slotId, "max");
    const naturalSpan = naturalSpanBySlotId.get(slotId) ?? 0;
    if (!Number.isFinite(naturalSpan) || naturalSpan < 0) {
      return `Embedded bridge slot ${slotId} has an invalid natural ${axis}-span.`;
    }
    addEmbeddedLowerBound(edges, vertices, frameMinimumKey, minimumKey, 0);
    addEmbeddedLowerBound(edges, vertices, maximumKey, frameMaximumKey, 0);
    const policy = spacingPolicyBySlotId?.get(slotId);
    if (policy === "compact" || policy === "inter-region-seam") {
      addEmbeddedEquality(edges, vertices, minimumKey, maximumKey, naturalSpan);
    } else {
      addEmbeddedLowerBound(
        edges,
        vertices,
        minimumKey,
        maximumKey,
        naturalSpan,
      );
    }
  }

  if (fixedFrameSpanMm !== null) {
    if (!Number.isFinite(fixedFrameSpanMm) || fixedFrameSpanMm <= 0) {
      return `Embedded bridge ${axis}-frame span must be finite and positive.`;
    }
    addEmbeddedEquality(
      edges,
      vertices,
      frameMinimumKey,
      frameMaximumKey,
      fixedFrameSpanMm,
    );
  }

  for (const relation of relations) {
    if (relation.kind === "contact") {
      if (
        sideAxis(relation.first.side) !== axis ||
        sideAxis(relation.second.side) !== axis
      ) {
        continue;
      }
      const firstMinimum = relation.first.side.startsWith("min");
      const secondMinimum = relation.second.side.startsWith("min");
      if (firstMinimum === secondMinimum) {
        return `Embedded bridge contact ${relation.id} must join opposite sides.`;
      }
      const firstKey = embeddedSideEndpointKey(
        relation.first.slotId,
        relation.first.side,
      );
      const secondKey = embeddedSideEndpointKey(
        relation.second.slotId,
        relation.second.side,
      );
      const firstPolicy = spacingPolicyBySlotId?.get(relation.first.slotId);
      const secondPolicy = spacingPolicyBySlotId?.get(relation.second.slotId);
      const usesResidualSeam =
        relation.gap === "residual-seam" ||
        firstPolicy === "inter-region-seam" ||
        secondPolicy === "inter-region-seam";
      const beforeKey = firstMinimum ? secondKey : firstKey;
      const afterKey = firstMinimum ? firstKey : secondKey;
      if (usesResidualSeam) {
        addEmbeddedLowerBound(
          edges,
          vertices,
          beforeKey,
          afterKey,
          clearanceMm,
        );
      } else {
        addEmbeddedEquality(edges, vertices, beforeKey, afterKey, clearanceMm);
      }
      continue;
    }
    if (relation.kind === "align") {
      if (relation.axis !== axis) continue;
      if (relation.edge === "center") {
        return `Embedded bridge alignment ${relation.id} uses an unsupported center equation.`;
      }
      addEmbeddedEquality(
        edges,
        vertices,
        embeddedEndpointKey(relation.firstSlotId, relation.edge),
        embeddedEndpointKey(relation.secondSlotId, relation.edge),
        0,
      );
      continue;
    }
    if (relation.kind === "order") {
      if (relation.axis !== axis) continue;
      addEmbeddedLowerBound(
        edges,
        vertices,
        embeddedEndpointKey(relation.beforeSlotId, "max"),
        embeddedEndpointKey(relation.afterSlotId, "min"),
        relation.minimumGap === "clearance" ? clearanceMm : 0,
      );
      continue;
    }
    if (relation.kind === "frame-anchor") {
      if (
        sideAxis(relation.port.side) !== axis ||
        sideAxis(relation.frameSide) !== axis
      ) {
        continue;
      }
      addEmbeddedEquality(
        edges,
        vertices,
        relation.frameSide.startsWith("min")
          ? frameMinimumKey
          : frameMaximumKey,
        embeddedSideEndpointKey(relation.port.slotId, relation.port.side),
        0,
      );
      continue;
    }
    if (relation.kind === "span") {
      if (relation.axis !== axis) continue;
      for (const innerSlotId of relation.innerSlotIds) {
        addEmbeddedLowerBound(
          edges,
          vertices,
          embeddedEndpointKey(relation.outerSlotId, "min"),
          embeddedEndpointKey(innerSlotId, "min"),
          0,
        );
        addEmbeddedLowerBound(
          edges,
          vertices,
          embeddedEndpointKey(innerSlotId, "max"),
          embeddedEndpointKey(relation.outerSlotId, "max"),
          0,
        );
      }
      continue;
    }
    if (relation.kind === "containment") {
      addEmbeddedLowerBound(
        edges,
        vertices,
        embeddedEndpointKey(relation.containerSlotId, "min"),
        embeddedEndpointKey(relation.containedSlotId, "min"),
        0,
      );
      addEmbeddedLowerBound(
        edges,
        vertices,
        embeddedEndpointKey(relation.containedSlotId, "max"),
        embeddedEndpointKey(relation.containerSlotId, "max"),
        0,
      );
    }
  }

  const distances = new Map([...vertices].map((vertex) => [vertex, 0]));
  const vertexCount = vertices.size;
  for (let iteration = 0; iteration < vertexCount; iteration += 1) {
    let changed = false;
    for (const edge of edges) {
      const candidate = distances.get(edge.from)! + edge.minimumDeltaMm;
      if (candidate <= distances.get(edge.to)! + SOLVER_GEOMETRY_EPSILON_MM) {
        continue;
      }
      distances.set(edge.to, candidate);
      changed = true;
    }
    if (!changed) break;
    if (iteration === vertexCount - 1) {
      return `Embedded bridge ${axis}-axis constraints contain an inconsistent positive cycle.`;
    }
  }

  const frameMinimum = distances.get(frameMinimumKey)!;
  const frameMaximum = distances.get(frameMaximumKey)!;
  const frameSpanMm = frameMaximum - frameMinimum;
  if (frameSpanMm <= SOLVER_GEOMETRY_EPSILON_MM) {
    return `Embedded bridge ${axis}-axis frame has no positive span.`;
  }

  const intervalsBySlotId = new Map<string, AxisInterval>();
  for (const slotId of slotIds) {
    const minimum =
      distances.get(embeddedEndpointKey(slotId, "min"))! - frameMinimum;
    const maximum =
      distances.get(embeddedEndpointKey(slotId, "max"))! - frameMinimum;
    if (maximum <= minimum + SOLVER_GEOMETRY_EPSILON_MM) {
      return `Embedded bridge slot ${slotId} has no positive ${axis}-axis span.`;
    }
    intervalsBySlotId.set(
      slotId,
      axisInterval(minimum, maximum, `embeddedBridge.${slotId}.${axis}`),
    );
  }
  return Object.freeze({
    frameSpanMm: normalizeGeneratedGeometryMetric(
      frameSpanMm,
      `embeddedBridge.frame.${axis}`,
    ),
    intervalsBySlotId,
  });
}

function embeddedBridgeNaturalSpansFromAssignments(
  template: RegionGraphTemplate,
  assignments: readonly PartialRegionShapeAssignment[],
  axis: RegionAxis,
): ReadonlyMap<string, number> {
  const shapeBySlotId = new Map(
    assignments.map(({ slotId, shape }) => [slotId, shape]),
  );
  return new Map(
    template.slots.map(({ id }) => [
      id,
      axis === "x"
        ? (shapeBySlotId.get(id)?.naturalSizeMm.length ?? 0)
        : (shapeBySlotId.get(id)?.naturalSizeMm.width ?? 0),
    ]),
  );
}

function partialEmbeddedBridgeFits(
  input: NormalizedLayerSolverInput,
  template: RegionGraphTemplate,
  assignments: readonly PartialRegionShapeAssignment[],
): boolean {
  if (template.witness.kind !== "embedded-bridge") return false;
  const availableLength = rectangleBoundsLength(input.generationBoundsMm);
  const availableWidth = rectangleBoundsWidth(input.generationBoundsMm);
  if (
    assignments.some(
      ({ shape }) =>
        shape.naturalSizeMm.length >
          availableLength + SOLVER_GEOMETRY_EPSILON_MM ||
        shape.naturalSizeMm.width > availableWidth + SOLVER_GEOMETRY_EPSILON_MM,
    )
  ) {
    return false;
  }
  if (assignments.length < template.slots.length) return true;
  const slotIds = template.embedding.rotationSystem.map(({ slotId }) => slotId);
  const x = solveEmbeddedAxis(
    slotIds,
    template.relations,
    embeddedBridgeNaturalSpansFromAssignments(template, assignments, "x"),
    "x",
    input.package.clearanceMm,
    null,
    null,
  );
  const y = solveEmbeddedAxis(
    slotIds,
    template.relations,
    embeddedBridgeNaturalSpansFromAssignments(template, assignments, "y"),
    "y",
    input.package.clearanceMm,
    null,
    null,
  );
  return (
    typeof x !== "string" &&
    typeof y !== "string" &&
    x.frameSpanMm <=
      rectangleBoundsLength(input.generationBoundsMm) +
        SOLVER_GEOMETRY_EPSILON_MM &&
    y.frameSpanMm <=
      rectangleBoundsWidth(input.generationBoundsMm) +
        SOLVER_GEOMETRY_EPSILON_MM
  );
}

function embeddedBridgeSlotIds(
  topology: OwnedStructuralRegionGraph,
): readonly string[] | string {
  if (topology.witness.kind !== "embedded-bridge") {
    return "Embedded bridge constraints require an embedded-bridge witness.";
  }
  const slotIds = topology.embedding.rotationSystem.map(({ slotId }) => slotId);
  if (
    slotIds.length !== topology.nodes.length ||
    new Set(slotIds).size !== slotIds.length ||
    slotIds.some((slotId) => !/^region-\d+$/.test(slotId))
  ) {
    return "Embedded bridge rotation-system slots must map bijectively to canonical regions.";
  }
  return Object.freeze(slotIds);
}

function embeddedBridgeRelationHolds(
  relation: RegionRelation,
  boundsBySlotId: ReadonlyMap<string, RectangleBoundsMm>,
  frameBoundsMm: RectangleBoundsMm,
  clearanceMm: number,
  selectionBySlotId: ReadonlyMap<string, RegionSpacingSelection>,
): boolean {
  if (relationHolds(relation, boundsBySlotId, frameBoundsMm, clearanceMm)) {
    return true;
  }
  if (relation.kind !== "contact") return false;
  const axis = sideAxis(relation.first.side);
  if (
    selectionBySlotId.get(relation.first.slotId)?.[axis] !==
      "inter-region-seam" &&
    selectionBySlotId.get(relation.second.slotId)?.[axis] !==
      "inter-region-seam"
  ) {
    return false;
  }
  const first = boundsBySlotId.get(relation.first.slotId);
  const second = boundsBySlotId.get(relation.second.slotId);
  return Boolean(
    first &&
      second &&
      contactRelationHolds(
        Object.freeze({ ...relation, gap: "residual-seam" }),
        first,
        second,
        clearanceMm,
      ),
  );
}

function realizeEmbeddedBridgeConstraints(
  input: NormalizedLayerSolverInput,
  topology: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  selections: readonly RegionSpacingSelection[],
  ledger: RegionWorkLedger,
): RegionConstraintResult {
  if (
    topology.ownerFamily !== "bridge-chain" ||
    topology.witness.kind !== "embedded-bridge"
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "This constraint solver accepts embedded bridge witnesses only.",
    });
  }
  if (selections.length !== topology.nodes.length) {
    return Object.freeze({
      status: "invalid",
      reason: "Embedded bridge spacing selections must match the region count.",
    });
  }
  const initialDecision = ledger.checkpoint();
  if (initialDecision !== "continue") {
    return Object.freeze({ status: "stopped", reason: initialDecision });
  }
  const slotIds = embeddedBridgeSlotIds(topology);
  if (typeof slotIds === "string") {
    return Object.freeze({ status: "invalid", reason: slotIds });
  }
  const nodesBySlotId = structuralNodeMap(topology);
  if (typeof nodesBySlotId === "string") {
    return Object.freeze({ status: "invalid", reason: nodesBySlotId });
  }

  const naturalSizesBySlotId = new Map<string, RectangleSizeMm>();
  for (const slotId of slotIds) {
    const node = nodesBySlotId.get(slotId);
    const sizeMm = node ? naturalNodeSize(input, node) : null;
    if (!node || !sizeMm) {
      return Object.freeze({
        status: "invalid",
        reason: `Embedded bridge slot ${slotId} has no valid natural size.`,
      });
    }
    naturalSizesBySlotId.set(slotId, sizeMm);
  }

  const generationBounds = input.generationBoundsMm;
  const fixedLength =
    framePolicy === "fill-generation-bounds"
      ? rectangleBoundsLength(generationBounds)
      : null;
  const fixedWidth =
    framePolicy === "fill-generation-bounds"
      ? rectangleBoundsWidth(generationBounds)
      : null;
  const spacingPolicies = (axis: RegionAxis) =>
    new Map<string, RegionSpacingPolicy>(
      topology.nodes.map((node) => [
        `region-${node.canonicalIndex}`,
        selections[node.canonicalIndex]![axis],
      ]),
    );
  const x = solveEmbeddedAxis(
    slotIds,
    topology.relations,
    new Map(
      [...naturalSizesBySlotId].map(([slotId, size]) => [slotId, size.length]),
    ),
    "x",
    input.package.clearanceMm,
    spacingPolicies("x"),
    fixedLength,
  );
  if (typeof x === "string") {
    return Object.freeze({ status: "infeasible", reason: x });
  }
  const y = solveEmbeddedAxis(
    slotIds,
    topology.relations,
    new Map(
      [...naturalSizesBySlotId].map(([slotId, size]) => [slotId, size.width]),
    ),
    "y",
    input.package.clearanceMm,
    spacingPolicies("y"),
    fixedWidth,
  );
  if (typeof y === "string") {
    return Object.freeze({ status: "infeasible", reason: y });
  }
  if (
    x.frameSpanMm >
      rectangleBoundsLength(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM ||
    y.frameSpanMm >
      rectangleBoundsWidth(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason:
        "The natural embedded bridge topology does not fit generation bounds.",
    });
  }

  const naturalFrameSize = Object.freeze({
    length: x.frameSpanMm,
    width: y.frameSpanMm,
  });
  const centeredFrameBounds = centeredRootBounds(
    generationBounds,
    naturalFrameSize,
  );
  let frameBoundsMm =
    framePolicy === "fill-generation-bounds"
      ? normalizedBounds(generationBounds, "embeddedBridge.frameBoundsMm")
      : centeredFrameBounds;
  if (framePolicy === "integer-center-occupied-bounds") {
    const firstNode = nodesBySlotId.get(slotIds[0]!);
    const firstFootprint = firstNode ? footprintSize(input, firstNode) : null;
    if (!firstFootprint) {
      return Object.freeze({
        status: "invalid",
        reason:
          "The first embedded bridge slot has no valid package footprint.",
      });
    }
    frameBoundsMm = integerCenterPhasedRootBounds(
      generationBounds,
      centeredFrameBounds,
      firstFootprint,
    );
  }
  const offsetX = frameBoundsMm.minX;
  const offsetY = frameBoundsMm.minY;
  const boundsBySlotId = new Map<string, RectangleBoundsMm>();
  for (const slotId of slotIds) {
    const xInterval = x.intervalsBySlotId.get(slotId)!;
    const yInterval = y.intervalsBySlotId.get(slotId)!;
    boundsBySlotId.set(
      slotId,
      normalizedBounds(
        {
          minX: offsetX + xInterval.minimum,
          maxX: offsetX + xInterval.maximum,
          minY: offsetY + yInterval.minimum,
          maxY: offsetY + yInterval.maximum,
        },
        `embeddedBridge.${slotId}.boundsMm`,
      ),
    );
  }

  const selectionBySlotId = new Map<string, RegionSpacingSelection>(
    topology.nodes.map((node) => [
      `region-${node.canonicalIndex}`,
      selections[node.canonicalIndex]!,
    ]),
  );
  for (const relation of topology.relations) {
    const decision = ledger.debit("line-constraint");
    if (decision !== "continue") {
      return Object.freeze({ status: "stopped", reason: decision });
    }
    if (
      !embeddedBridgeRelationHolds(
        relation,
        boundsBySlotId,
        frameBoundsMm,
        input.package.clearanceMm,
        selectionBySlotId,
      )
    ) {
      return Object.freeze({
        status: "infeasible",
        reason: `Embedded bridge relation ${relation.id} is not satisfied.`,
      });
    }
  }

  const regionBoundsMm: RectangleBoundsMm[] = [];
  const residualAssignments: Array<{ sinkKey: string; amountMm: number }> = [];
  for (const node of [...topology.nodes].sort(
    (left, right) => left.canonicalIndex - right.canonicalIndex,
  )) {
    const slotId = `region-${node.canonicalIndex}`;
    const bounds = boundsBySlotId.get(slotId);
    const naturalSize = naturalSizesBySlotId.get(slotId);
    if (!bounds || !naturalSize) {
      return Object.freeze({
        status: "invalid",
        reason: `Embedded bridge region ${node.canonicalIndex} has no metric bounds.`,
      });
    }
    regionBoundsMm.push(bounds);
    const residualX = rectangleBoundsLength(bounds) - naturalSize.length;
    const residualY = rectangleBoundsWidth(bounds) - naturalSize.width;
    if (residualX > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${slotId}:x`,
          amountMm: normalizeGeneratedGeometryMetric(
            residualX,
            `${slotId}.embeddedResidualXMm`,
          ),
        }),
      );
    }
    if (residualY > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${slotId}:y`,
          amountMm: normalizeGeneratedGeometryMetric(
            residualY,
            `${slotId}.embeddedResidualYMm`,
          ),
        }),
      );
    }
  }
  residualAssignments.sort((left, right) =>
    left.sinkKey < right.sinkKey ? -1 : left.sinkKey > right.sinkKey ? 1 : 0,
  );
  return Object.freeze({
    status: "completed",
    graph: Object.freeze({
      topology,
      regionBoundsMm: Object.freeze(regionBoundsMm),
      residualAssignments: Object.freeze(residualAssignments),
      framePolicy,
    }),
  });
}

type StepSpineWitness = Extract<
  RegionGraphTemplate["witness"],
  { kind: "spine-tree" }
>;

type StepSpineRoles = Readonly<{
  mainSlotId: string;
  longBandSlotId: string;
  sideStripSlotId: string;
  cornerSlotId: string;
}>;

function stepSpineRoles(witness: StepSpineWitness): StepSpineRoles | string {
  if (
    (witness.axis !== "x" && witness.axis !== "y") ||
    (witness.inlineDirection !== 1 && witness.inlineDirection !== -1) ||
    (witness.crossDirection !== 1 && witness.crossDirection !== -1) ||
    witness.orderedSpines.length !== 1
  ) {
    return "A step-spine witness must define one directed orthogonal spine.";
  }
  const spine = witness.orderedSpines[0];
  if (spine.attachmentSlotIds.length !== 2) {
    return "A step-spine witness requires side-strip and corner attachments.";
  }
  const roles = Object.freeze({
    mainSlotId: witness.mainSlotId,
    longBandSlotId: spine.spineSlotId,
    sideStripSlotId: spine.attachmentSlotIds[0],
    cornerSlotId: spine.attachmentSlotIds[1],
  });
  if (new Set(Object.values(roles)).size !== 4) {
    return "Every step-spine role must reference a distinct slot.";
  }
  return roles;
}

function shapeSpan(shape: RegionShape, axis: RegionAxis): number {
  return axis === "x" ? shape.naturalSizeMm.length : shape.naturalSizeMm.width;
}

function partialStepSpineFits(
  input: NormalizedLayerSolverInput,
  witness: StepSpineWitness,
  assignments: readonly PartialRegionShapeAssignment[],
): boolean {
  const roles = stepSpineRoles(witness);
  if (typeof roles === "string") return false;
  const shapeBySlotId = new Map(
    assignments.map(({ slotId, shape }) => [slotId, shape]),
  );
  const inlineAxis = witness.axis;
  const crossAxis: RegionAxis = inlineAxis === "x" ? "y" : "x";
  const main = shapeBySlotId.get(roles.mainSlotId);
  const longBand = shapeBySlotId.get(roles.longBandSlotId);
  const sideStrip = shapeBySlotId.get(roles.sideStripSlotId);
  const corner = shapeBySlotId.get(roles.cornerSlotId);
  const clearance = input.package.clearanceMm;
  if (main && main.packageCount <= 1) return false;
  if (
    longBand &&
    (longBand.packageCount <= 1 ||
      shapeSpan(longBand, inlineAxis) <=
        shapeSpan(longBand, crossAxis) + SOLVER_GEOMETRY_EPSILON_MM)
  ) {
    return false;
  }
  if (
    sideStrip &&
    (sideStrip.packageCount <= 1 ||
      shapeSpan(sideStrip, crossAxis) <=
        shapeSpan(sideStrip, inlineAxis) + SOLVER_GEOMETRY_EPSILON_MM)
  ) {
    return false;
  }

  const sideMainInline =
    (sideStrip ? shapeSpan(sideStrip, inlineAxis) : 0) +
    clearance +
    (main ? shapeSpan(main, inlineAxis) : 0);
  const cornerBandInline =
    (corner ? shapeSpan(corner, inlineAxis) : 0) +
    clearance +
    (longBand ? shapeSpan(longBand, inlineAxis) : 0);
  const sideCornerCross =
    (sideStrip ? shapeSpan(sideStrip, crossAxis) : 0) +
    clearance +
    (corner ? shapeSpan(corner, crossAxis) : 0);
  const mainBandCross =
    (main ? shapeSpan(main, crossAxis) : 0) +
    clearance +
    (longBand ? shapeSpan(longBand, crossAxis) : 0);
  const requiredInline = Math.max(sideMainInline, cornerBandInline);
  const requiredCross = Math.max(sideCornerCross, mainBandCross);
  const availableInline =
    inlineAxis === "x"
      ? rectangleBoundsLength(input.generationBoundsMm)
      : rectangleBoundsWidth(input.generationBoundsMm);
  const availableCross =
    crossAxis === "x"
      ? rectangleBoundsLength(input.generationBoundsMm)
      : rectangleBoundsWidth(input.generationBoundsMm);
  return (
    requiredInline <= availableInline + SOLVER_GEOMETRY_EPSILON_MM &&
    requiredCross <= availableCross + SOLVER_GEOMETRY_EPSILON_MM
  );
}

export function partialRegionTopologyFitsFrame(
  input: NormalizedLayerSolverInput,
  template: RegionGraphTemplate,
  assignments: readonly PartialRegionShapeAssignment[],
): boolean {
  const shapeBySlotId = new Map(
    assignments.map(({ slotId, shape }) => [slotId, shape]),
  );
  if (template.witness.kind === "four-arm-cycle") {
    return partialPinwheelCycleFits(
      template.witness.root,
      shapeBySlotId,
      rectangleBoundsLength(input.generationBoundsMm),
      rectangleBoundsWidth(input.generationBoundsMm),
      input.package.clearanceMm,
    );
  }
  if (template.witness.kind === "embedded-bridge") {
    return partialEmbeddedBridgeFits(input, template, assignments);
  }
  if (template.witness.kind === "spine-tree") {
    return partialStepSpineFits(input, template.witness, assignments);
  }
  return true;
}

function pinwheelNaturalCycle(
  input: NormalizedLayerSolverInput,
  cycle: PinwheelCycleNode,
  structuralNodeBySlotId: ReadonlyMap<string, StructuralRegionNode>,
): NaturalPinwheelCycle | string {
  if (!cycle.armSlotIds.includes(cycle.residualAnchorSlotId)) {
    return "Every pinwheel residual anchor must reference a local arm slot.";
  }
  const naturalRegion = (slotId: string): NaturalPinwheelRegion | string => {
    const node = structuralNodeBySlotId.get(slotId);
    if (!node) return `Unknown pinwheel slot ${slotId}.`;
    const sizeMm = naturalNodeSize(input, node);
    if (!sizeMm) {
      return `Region ${node.canonicalIndex} has an invalid footprint class for the package.`;
    }
    return Object.freeze({ slotId, node, sizeMm });
  };
  const arms: NaturalPinwheelRegion[] = [];
  for (const slotId of cycle.armSlotIds) {
    const arm = naturalRegion(slotId);
    if (typeof arm === "string") return arm;
    arms.push(arm);
  }
  const typedArms = Object.freeze(arms) as NaturalPinwheelCycle["arms"];
  let core: NaturalPinwheelCore;
  if (cycle.core.kind === "empty") {
    core = Object.freeze({ kind: "empty" });
  } else if (cycle.core.kind === "grid") {
    const region = naturalRegion(cycle.core.slotId);
    if (typeof region === "string") return region;
    core = Object.freeze({ kind: "grid", region });
  } else {
    const coreCycle = pinwheelNaturalCycle(
      input,
      cycle.core.cycle,
      structuralNodeBySlotId,
    );
    if (typeof coreCycle === "string") return coreCycle;
    core = Object.freeze({ kind: "cycle", cycle: coreCycle });
  }

  const clearance = input.package.clearanceMm;
  let requiredLength = 0;
  let requiredWidth = 0;
  for (const chain of pinwheelChains(cycle)) {
    const first = typedArms[chain.firstArmIndex].sizeMm;
    const second = typedArms[chain.secondArmIndex].sizeMm;
    const span =
      (chain.axis === "x"
        ? first.length + second.length
        : first.width + second.width) + clearance;
    if (chain.axis === "x") requiredLength = Math.max(requiredLength, span);
    else requiredWidth = Math.max(requiredWidth, span);
  }

  if (core.kind !== "empty") {
    const bottom = typedArms[0].sizeMm;
    const right = typedArms[1].sizeMm;
    const top = typedArms[2].sizeMm;
    const left = typedArms[3].sizeMm;
    const coreSize =
      core.kind === "grid" ? core.region.sizeMm : core.cycle.sizeMm;
    requiredLength = Math.max(
      requiredLength,
      left.length + coreSize.length + right.length + 2 * clearance,
    );
    requiredWidth = Math.max(
      requiredWidth,
      bottom.width + coreSize.width + top.width + 2 * clearance,
    );
  }

  return Object.freeze({
    source: cycle,
    arms: typedArms,
    core,
    sizeMm: Object.freeze({
      length: normalizeGeneratedGeometryMetric(
        requiredLength,
        "pinwheel.naturalLengthMm",
      ),
      width: normalizeGeneratedGeometryMetric(
        requiredWidth,
        "pinwheel.naturalWidthMm",
      ),
    }),
  });
}

function axisInterval(
  minimum: number,
  maximum: number,
  field: string,
): AxisInterval {
  return Object.freeze({
    minimum: normalizeGeneratedCoordinateMm(minimum, `${field}.minimum`),
    maximum: normalizeGeneratedCoordinateMm(maximum, `${field}.maximum`),
  });
}

function boundarySide(
  axis: RegionAxis,
  boundary: "minimum" | "maximum",
): RegionSide {
  return `${boundary === "minimum" ? "min" : "max"}-${axis}` as RegionSide;
}

function pinwheelBoundaryResidualKey(slotId: string, side: RegionSide): string {
  return `${slotId}:${side}`;
}

function recordPinwheelBoundaryResidual(
  residuals: PinwheelBoundaryResiduals,
  slotId: string,
  side: RegionSide,
  amountMm: number,
): void {
  if (amountMm <= SOLVER_GEOMETRY_EPSILON_MM) return;
  residuals.set(
    pinwheelBoundaryResidualKey(slotId, side),
    normalizeGeneratedGeometryMetric(
      amountMm,
      `pinwheelBoundaryResidual.${slotId}.${side}`,
    ),
  );
}

function allocateAxisChain(
  minimum: number,
  maximum: number,
  firstSpan: number,
  secondSpan: number,
  clearanceMm: number,
  mode: PinwheelResidualMode,
  seamPlacement: PinwheelChainResidualPlacement,
  seamKey: string,
  firstRegionKey: string,
  secondRegionKey: string,
  explicitResidual: PinwheelAxisResidualAllocation | null,
): AxisChainAllocation | string {
  const residual = maximum - minimum - firstSpan - secondSpan - clearanceMm;
  if (residual < -SOLVER_GEOMETRY_EPSILON_MM) {
    return `Pinwheel chain ${seamKey} does not fit its frame span.`;
  }
  const normalizedResidual = Math.max(0, residual);
  const residualAssignments: Array<{ sinkKey: string; amountMm: number }> = [];
  let firstExtra = 0;
  let secondExtra = 0;
  let seamExtra = 0;
  let leadingOffset = 0;
  let trailingOffset = 0;
  if (explicitResidual !== null) {
    if (mode === "seam") {
      return `Pinwheel chain ${seamKey} cannot combine seam and arm residual allocation.`;
    }
    const { firstExtraMm, secondExtraMm } = explicitResidual;
    if (
      !Number.isFinite(firstExtraMm) ||
      !Number.isFinite(secondExtraMm) ||
      firstExtraMm < 0 ||
      secondExtraMm < 0 ||
      firstExtraMm + secondExtraMm >
        normalizedResidual + SOLVER_GEOMETRY_EPSILON_MM
    ) {
      return `Pinwheel chain ${seamKey} has an invalid explicit residual allocation.`;
    }
    firstExtra = firstExtraMm;
    secondExtra = secondExtraMm;
    seamExtra = Math.max(0, normalizedResidual - firstExtraMm - secondExtraMm);
  } else if (mode === "seam") {
    if (seamPlacement === "leading") leadingOffset = normalizedResidual;
    else if (seamPlacement === "trailing") {
      trailingOffset = normalizedResidual;
    }
    if (normalizedResidual > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${seamKey}:${
            seamPlacement === "between" ? "seam" : `${seamPlacement}-seam`
          }`,
          amountMm: normalizeGeneratedGeometryMetric(
            normalizedResidual,
            `${seamKey}.residualMm`,
          ),
        }),
      );
    }
  } else {
    if (mode === "first-region") {
      firstExtra = normalizedResidual;
    } else if (mode === "second-region") {
      secondExtra = normalizedResidual;
    } else {
      firstExtra = normalizedResidual / 2;
      secondExtra = normalizedResidual - firstExtra;
    }
  }
  if (mode !== "seam") {
    if (firstExtra > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: firstRegionKey,
          amountMm: normalizeGeneratedGeometryMetric(
            firstExtra,
            `${firstRegionKey}.residualMm`,
          ),
        }),
      );
    }
    if (secondExtra > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: secondRegionKey,
          amountMm: normalizeGeneratedGeometryMetric(
            secondExtra,
            `${secondRegionKey}.residualMm`,
          ),
        }),
      );
    }
    if (seamExtra > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${seamKey}:seam`,
          amountMm: normalizeGeneratedGeometryMetric(
            seamExtra,
            `${seamKey}.seamResidualMm`,
          ),
        }),
      );
    }
    if (leadingOffset > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${firstRegionKey}:leading-boundary`,
          amountMm: normalizeGeneratedGeometryMetric(
            leadingOffset,
            `${firstRegionKey}.leadingBoundaryResidualMm`,
          ),
        }),
      );
    }
    if (trailingOffset > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${secondRegionKey}:trailing-boundary`,
          amountMm: normalizeGeneratedGeometryMetric(
            trailingOffset,
            `${secondRegionKey}.trailingBoundaryResidualMm`,
          ),
        }),
      );
    }
  }

  const firstMinimum = minimum + leadingOffset;
  const firstMaximum = firstMinimum + firstSpan + firstExtra;
  const secondMinimum =
    mode === "seam" && seamPlacement !== "between"
      ? firstMaximum + clearanceMm
      : maximum - trailingOffset - secondSpan - secondExtra;
  const secondMaximum = secondMinimum + secondSpan + secondExtra;
  return Object.freeze({
    first: axisInterval(firstMinimum, firstMaximum, `${seamKey}.first`),
    second: axisInterval(secondMinimum, secondMaximum, `${seamKey}.second`),
    residualAssignments: Object.freeze(residualAssignments),
  });
}

function pinwheelResidualMode(
  selections: readonly RegionSpacingSelection[],
  firstRegionIndex: number,
  secondRegionIndex: number,
  axis: RegionAxis,
):
  | Readonly<{
      status: "completed";
      mode: PinwheelResidualMode;
      explicitResidual: PinwheelAxisResidualAllocation | null;
    }>
  | Readonly<{ status: "invalid"; reason: string }> {
  const firstSelection = selections[firstRegionIndex];
  const secondSelection = selections[secondRegionIndex];
  const first = firstSelection?.[axis];
  const second = secondSelection?.[axis];
  if (!first || !second) {
    return Object.freeze({
      status: "invalid",
      reason: "Every pinwheel region requires an axis spacing selection.",
    });
  }
  const firstExplicit = firstSelection.pinwheelArmResidualMm?.[axis];
  const secondExplicit = secondSelection.pinwheelArmResidualMm?.[axis];
  if ((firstExplicit === undefined) !== (secondExplicit === undefined)) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Both regions of a pinwheel chain must provide an explicit residual allocation.",
    });
  }
  if (
    (firstExplicit !== undefined &&
      (!Number.isFinite(firstExplicit) || firstExplicit < 0)) ||
    (secondExplicit !== undefined &&
      (!Number.isFinite(secondExplicit) || secondExplicit < 0))
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Explicit pinwheel arm residuals must be finite and non-negative.",
    });
  }
  const explicitResidual =
    firstExplicit === undefined || secondExplicit === undefined
      ? null
      : Object.freeze({
          firstExtraMm: firstExplicit,
          secondExtraMm: secondExplicit,
        });
  const firstUsesSeam = first === "inter-region-seam";
  const secondUsesSeam = second === "inter-region-seam";
  if (firstUsesSeam !== secondUsesSeam) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Both regions of a pinwheel chain must agree on seam residual assignment.",
    });
  }
  const firstPolicy = firstSelection.pinwheelArmResidualPolicy ?? "balanced";
  const secondPolicy = secondSelection.pinwheelArmResidualPolicy ?? "balanced";
  if (firstPolicy !== secondPolicy) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Both regions of a pinwheel chain must agree on arm residual assignment.",
    });
  }
  const spacingDirectedMode = (): PinwheelResidualMode => {
    const firstExpands =
      first === "continuous-space-between" ||
      first === "integer-balanced" ||
      first === "suction-group-aware";
    const secondExpands =
      second === "continuous-space-between" ||
      second === "integer-balanced" ||
      second === "suction-group-aware";
    return firstExpands === secondExpands
      ? "regions-balanced"
      : firstExpands
        ? "first-region"
        : "second-region";
  };
  return Object.freeze({
    status: "completed",
    mode: firstUsesSeam
      ? "seam"
      : firstPolicy === "spacing-directed"
        ? spacingDirectedMode()
        : firstPolicy === "first-region"
          ? "first-region"
          : firstPolicy === "second-region"
            ? "second-region"
            : "regions-balanced",
    explicitResidual,
  });
}

function setArmAxisBounds(
  mutableBounds: Map<number, MutableRegionBounds>,
  regionIndex: number,
  axis: RegionAxis,
  interval: AxisInterval,
): string | null {
  const bounds = mutableBounds.get(regionIndex) ?? {};
  const minimumKey = axis === "x" ? "minX" : "minY";
  const maximumKey = axis === "x" ? "maxX" : "maxY";
  if (bounds[minimumKey] !== undefined || bounds[maximumKey] !== undefined) {
    return `Pinwheel region ${regionIndex} received duplicate ${axis}-axis bounds.`;
  }
  bounds[minimumKey] = interval.minimum;
  bounds[maximumKey] = interval.maximum;
  mutableBounds.set(regionIndex, bounds);
  return null;
}

function completeRegionBounds(
  value: MutableRegionBounds | undefined,
  regionIndex: number,
): RectangleBoundsMm | string {
  if (
    value?.minX === undefined ||
    value.minY === undefined ||
    value.maxX === undefined ||
    value.maxY === undefined
  ) {
    return `Pinwheel region ${regionIndex} has incomplete metric bounds.`;
  }
  if (
    value.maxX <= value.minX + SOLVER_GEOMETRY_EPSILON_MM ||
    value.maxY <= value.minY + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return `Pinwheel region ${regionIndex} has non-positive metric bounds.`;
  }
  return normalizedBounds(
    {
      minX: value.minX,
      minY: value.minY,
      maxX: value.maxX,
      maxY: value.maxY,
    },
    `pinwheel.regionBoundsMm[${regionIndex}]`,
  );
}

function alignedRecursiveCoreBounds(
  cavityBoundsMm: RectangleBoundsMm,
  naturalSizeMm: RectangleSizeMm,
  alignment: RegionRecursiveCoreAlignment,
  residualAssignments: Array<{ sinkKey: string; amountMm: number }>,
  path: string,
): RectangleBoundsMm | string {
  const availableLength = rectangleBoundsLength(cavityBoundsMm);
  const availableWidth = rectangleBoundsWidth(cavityBoundsMm);
  const residualX = availableLength - naturalSizeMm.length;
  const residualY = availableWidth - naturalSizeMm.width;
  if (
    residualX < -SOLVER_GEOMETRY_EPSILON_MM ||
    residualY < -SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return `Pinwheel cycle ${path} does not fit its recursive core cavity.`;
  }
  if (alignment === "fill-parent") return cavityBoundsMm;

  const normalizedResidualX = Math.max(0, residualX);
  const normalizedResidualY = Math.max(0, residualY);
  const xAnchor =
    alignment === "center"
      ? "center"
      : alignment.split("-")[0] === "min"
        ? "min"
        : "max";
  const yAnchor =
    alignment === "center"
      ? "center"
      : alignment.endsWith("min-y")
        ? "min"
        : "max";
  const minX =
    xAnchor === "min"
      ? cavityBoundsMm.minX
      : xAnchor === "max"
        ? cavityBoundsMm.maxX - naturalSizeMm.length
        : cavityBoundsMm.minX + normalizedResidualX / 2;
  const minY =
    yAnchor === "min"
      ? cavityBoundsMm.minY
      : yAnchor === "max"
        ? cavityBoundsMm.maxY - naturalSizeMm.width
        : cavityBoundsMm.minY + normalizedResidualY / 2;

  const addResidual = (
    axis: RegionAxis,
    side: "min" | "max",
    amountMm: number,
  ) => {
    if (amountMm <= SOLVER_GEOMETRY_EPSILON_MM) return;
    residualAssignments.push(
      Object.freeze({
        sinkKey: `${path}:core-frame:${axis}:${side}`,
        amountMm: normalizeGeneratedGeometryMetric(
          amountMm,
          `${path}.coreFrame.${axis}.${side}.residualMm`,
        ),
      }),
    );
  };
  if (xAnchor === "min") addResidual("x", "max", normalizedResidualX);
  else if (xAnchor === "max") addResidual("x", "min", normalizedResidualX);
  else {
    addResidual("x", "min", normalizedResidualX / 2);
    addResidual("x", "max", normalizedResidualX / 2);
  }
  if (yAnchor === "min") addResidual("y", "max", normalizedResidualY);
  else if (yAnchor === "max") addResidual("y", "min", normalizedResidualY);
  else {
    addResidual("y", "min", normalizedResidualY / 2);
    addResidual("y", "max", normalizedResidualY / 2);
  }

  return normalizedBounds(
    {
      minX,
      minY,
      maxX: minX + naturalSizeMm.length,
      maxY: minY + naturalSizeMm.width,
    },
    `${path}.alignedCoreBoundsMm`,
  );
}

function allocatePinwheelCycle(
  cycle: NaturalPinwheelCycle,
  frameBoundsMm: RectangleBoundsMm,
  selections: readonly RegionSpacingSelection[],
  mutableBounds: Map<number, MutableRegionBounds>,
  residualAssignments: Array<{ sinkKey: string; amountMm: number }>,
  boundaryResiduals: PinwheelBoundaryResiduals,
  clearanceMm: number,
  path: string,
  recursiveCoreAlignment: RegionRecursiveCoreAlignment,
  residualPlacement: PinwheelResidualPlacement,
): string | null {
  if (
    cycle.sizeMm.length >
      rectangleBoundsLength(frameBoundsMm) + SOLVER_GEOMETRY_EPSILON_MM ||
    cycle.sizeMm.width >
      rectangleBoundsWidth(frameBoundsMm) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return `Pinwheel cycle ${path} does not fit its frame bounds.`;
  }

  for (const chain of pinwheelChains(cycle.source)) {
    const first = cycle.arms[chain.firstArmIndex];
    const second = cycle.arms[chain.secondArmIndex];
    const mode = pinwheelResidualMode(
      selections,
      first.node.canonicalIndex,
      second.node.canonicalIndex,
      chain.axis,
    );
    if (mode.status === "invalid") return mode.reason;
    const axisMinimumValue = axisMinimum(frameBoundsMm, chain.axis);
    const axisMaximumValue = axisMaximum(frameBoundsMm, chain.axis);
    const firstSpan =
      chain.axis === "x" ? first.sizeMm.length : first.sizeMm.width;
    const secondSpan =
      chain.axis === "x" ? second.sizeMm.length : second.sizeMm.width;
    const allocation = allocateAxisChain(
      axisMinimumValue,
      axisMaximumValue,
      firstSpan,
      secondSpan,
      clearanceMm,
      mode.mode,
      pinwheelChainResidualPlacement(cycle.source, chain, residualPlacement),
      `${path}:${chain.axis}:${chain.name}`,
      `region-${first.node.canonicalIndex}:${chain.axis}`,
      `region-${second.node.canonicalIndex}:${chain.axis}`,
      mode.explicitResidual,
    );
    if (typeof allocation === "string") return allocation;
    recordPinwheelBoundaryResidual(
      boundaryResiduals,
      first.slotId,
      boundarySide(chain.axis, "minimum"),
      allocation.first.minimum - axisMinimumValue,
    );
    recordPinwheelBoundaryResidual(
      boundaryResiduals,
      second.slotId,
      boundarySide(chain.axis, "maximum"),
      axisMaximumValue - allocation.second.maximum,
    );
    const firstIssue = setArmAxisBounds(
      mutableBounds,
      first.node.canonicalIndex,
      chain.axis,
      allocation.first,
    );
    if (firstIssue) return firstIssue;
    const secondIssue = setArmAxisBounds(
      mutableBounds,
      second.node.canonicalIndex,
      chain.axis,
      allocation.second,
    );
    if (secondIssue) return secondIssue;
    residualAssignments.push(...allocation.residualAssignments);
  }

  const armBounds: RectangleBoundsMm[] = [];
  for (const arm of cycle.arms) {
    const bounds = completeRegionBounds(
      mutableBounds.get(arm.node.canonicalIndex),
      arm.node.canonicalIndex,
    );
    if (typeof bounds === "string") return bounds;
    armBounds.push(bounds);
  }

  if (cycle.core.kind === "empty") return null;

  const cavityBounds = normalizedBounds(
    {
      minX: armBounds[3]!.maxX + clearanceMm,
      maxX: armBounds[1]!.minX - clearanceMm,
      minY: armBounds[0]!.maxY + clearanceMm,
      maxY: armBounds[2]!.minY - clearanceMm,
    },
    `${path}.coreBoundsMm`,
  );
  if (
    cavityBounds.maxX <= cavityBounds.minX + SOLVER_GEOMETRY_EPSILON_MM ||
    cavityBounds.maxY <= cavityBounds.minY + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return `Pinwheel cycle ${path} leaves no positive core frame.`;
  }
  const coreSize =
    cycle.core.kind === "grid"
      ? cycle.core.region.sizeMm
      : cycle.core.cycle.sizeMm;
  const coreBounds = alignedRecursiveCoreBounds(
    cavityBounds,
    coreSize,
    recursiveCoreAlignment,
    residualAssignments,
    path,
  );
  if (typeof coreBounds === "string") return coreBounds;
  if (cycle.core.kind === "grid") {
    const xIssue = setArmAxisBounds(
      mutableBounds,
      cycle.core.region.node.canonicalIndex,
      "x",
      axisInterval(coreBounds.minX, coreBounds.maxX, `${path}.gridCore.x`),
    );
    if (xIssue) return xIssue;
    return setArmAxisBounds(
      mutableBounds,
      cycle.core.region.node.canonicalIndex,
      "y",
      axisInterval(coreBounds.minY, coreBounds.maxY, `${path}.gridCore.y`),
    );
  }
  return allocatePinwheelCycle(
    cycle.core.cycle,
    coreBounds,
    selections,
    mutableBounds,
    residualAssignments,
    boundaryResiduals,
    clearanceMm,
    `${path}-core`,
    recursiveCoreAlignment,
    residualPlacement,
  );
}

function pinwheelRelationHolds(
  relation: RegionRelation,
  boundsBySlotId: ReadonlyMap<string, RectangleBoundsMm>,
  frameBoundsMm: RectangleBoundsMm,
  clearanceMm: number,
  boundaryResiduals: ReadonlyMap<string, number>,
): boolean {
  if (relationHolds(relation, boundsBySlotId, frameBoundsMm, clearanceMm)) {
    return true;
  }
  if (
    relation.kind !== "frame-anchor" ||
    sideAxis(relation.port.side) !== sideAxis(relation.frameSide) ||
    relation.port.side.startsWith("min") !==
      relation.frameSide.startsWith("min")
  ) {
    return false;
  }

  const residual = boundaryResiduals.get(
    pinwheelBoundaryResidualKey(relation.port.slotId, relation.port.side),
  );
  const regionBounds = boundsBySlotId.get(relation.port.slotId);
  if (residual === undefined || !regionBounds) return false;
  const regionCoordinate = sideValue(regionBounds, relation.port.side);
  const frameCoordinate = sideValue(frameBoundsMm, relation.frameSide);
  const inwardGap = relation.frameSide.startsWith("min")
    ? regionCoordinate - frameCoordinate
    : frameCoordinate - regionCoordinate;
  return (
    inwardGap >= -SOLVER_GEOMETRY_EPSILON_MM &&
    approximatelyEqual(inwardGap, residual)
  );
}

function realizePinwheelConstraints(
  input: NormalizedLayerSolverInput,
  topology: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  selections: readonly RegionSpacingSelection[],
  ledger: RegionWorkLedger,
): RegionConstraintResult {
  if (
    topology.ownerFamily !== "pinwheel" ||
    topology.witness.kind !== "four-arm-cycle"
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "This constraint solver accepts pinwheel topology witnesses only.",
    });
  }
  if (selections.length !== topology.nodes.length) {
    return Object.freeze({
      status: "invalid",
      reason: "Pinwheel spacing selections must match the region count.",
    });
  }
  const allowedCoreAlignments = new Set<string>(
    REGION_RECURSIVE_CORE_ALIGNMENTS,
  );
  const requestedCoreAlignments = new Set<RegionRecursiveCoreAlignment>();
  for (const selection of selections) {
    const alignment = selection.recursiveCoreAlignment ?? "fill-parent";
    if (!allowedCoreAlignments.has(alignment)) {
      return Object.freeze({
        status: "invalid",
        reason: "Unknown recursive pinwheel core alignment.",
      });
    }
    requestedCoreAlignments.add(alignment);
  }
  if (requestedCoreAlignments.size !== 1) {
    return Object.freeze({
      status: "invalid",
      reason:
        "All regions in a recursive pinwheel realization must share one core alignment.",
    });
  }
  const recursiveCoreAlignment = [...requestedCoreAlignments][0]!;
  const allowedResidualPlacements = new Set<string>(
    PINWHEEL_RESIDUAL_PLACEMENTS,
  );
  const requestedResidualPlacements = new Set<PinwheelResidualPlacement>();
  for (const selection of selections) {
    const placement = selection.pinwheelResidualPlacement ?? "between";
    if (!allowedResidualPlacements.has(placement)) {
      return Object.freeze({
        status: "invalid",
        reason: "Unknown pinwheel residual placement.",
      });
    }
    requestedResidualPlacements.add(placement);
  }
  if (requestedResidualPlacements.size !== 1) {
    return Object.freeze({
      status: "invalid",
      reason:
        "All regions in a pinwheel realization must share one residual placement.",
    });
  }
  const residualPlacement = [...requestedResidualPlacements][0]!;

  const initialDecision = ledger.checkpoint();
  if (initialDecision !== "continue") {
    return Object.freeze({ status: "stopped", reason: initialDecision });
  }
  const structuralNodes = structuralNodeMap(topology);
  if (typeof structuralNodes === "string") {
    return Object.freeze({ status: "invalid", reason: structuralNodes });
  }
  const naturalRoot = pinwheelNaturalCycle(
    input,
    topology.witness.root,
    structuralNodes,
  );
  if (typeof naturalRoot === "string") {
    return Object.freeze({ status: "invalid", reason: naturalRoot });
  }
  const generationBounds = input.generationBoundsMm;
  if (
    naturalRoot.sizeMm.length >
      rectangleBoundsLength(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM ||
    naturalRoot.sizeMm.width >
      rectangleBoundsWidth(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "The natural pinwheel topology does not fit generation bounds.",
    });
  }

  const frameBoundsMm =
    framePolicy === "fill-generation-bounds"
      ? normalizedBounds(generationBounds, "generationBoundsMm")
      : centeredRootBounds(generationBounds, naturalRoot.sizeMm);
  const mutableBounds = new Map<number, MutableRegionBounds>();
  const residualAssignments: Array<{ sinkKey: string; amountMm: number }> = [];
  const boundaryResiduals: PinwheelBoundaryResiduals = new Map();
  const allocationIssue = allocatePinwheelCycle(
    naturalRoot,
    frameBoundsMm,
    selections,
    mutableBounds,
    residualAssignments,
    boundaryResiduals,
    input.package.clearanceMm,
    "root",
    recursiveCoreAlignment,
    residualPlacement,
  );
  if (allocationIssue) {
    return Object.freeze({ status: "infeasible", reason: allocationIssue });
  }

  const boundsBySlotId = new Map<string, RectangleBoundsMm>();
  const regionBoundsMm: RectangleBoundsMm[] = [];
  for (const node of [...topology.nodes].sort(
    (left, right) => left.canonicalIndex - right.canonicalIndex,
  )) {
    const bounds = completeRegionBounds(
      mutableBounds.get(node.canonicalIndex),
      node.canonicalIndex,
    );
    if (typeof bounds === "string") {
      return Object.freeze({ status: "invalid", reason: bounds });
    }
    regionBoundsMm.push(bounds);
    boundsBySlotId.set(`region-${node.canonicalIndex}`, bounds);
  }

  for (const relation of topology.relations) {
    const decision = ledger.debit("line-constraint");
    if (decision !== "continue") {
      return Object.freeze({ status: "stopped", reason: decision });
    }
    if (
      !pinwheelRelationHolds(
        relation,
        boundsBySlotId,
        frameBoundsMm,
        input.package.clearanceMm,
        boundaryResiduals,
      )
    ) {
      return Object.freeze({
        status: "infeasible",
        reason: `Pinwheel relation ${relation.id} is not satisfied.`,
      });
    }
  }

  residualAssignments.sort((left, right) =>
    left.sinkKey < right.sinkKey ? -1 : left.sinkKey > right.sinkKey ? 1 : 0,
  );
  return Object.freeze({
    status: "completed",
    graph: Object.freeze({
      topology,
      regionBoundsMm: Object.freeze(regionBoundsMm),
      residualAssignments: Object.freeze(residualAssignments),
      framePolicy,
    }),
  });
}

type StepSpacingPolicy = Exclude<
  RegionSpacingSelection["x"],
  "suction-group-aware"
>;

const stepSpacingPolicySet = new Set<RegionSpacingSelection["x"]>([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
]);

function isStepSpacingPolicy(
  value: RegionSpacingSelection["x"] | undefined,
): value is StepSpacingPolicy {
  return value !== undefined && stepSpacingPolicySet.has(value);
}

type NaturalStepRegion = Readonly<{
  node: StructuralRegionNode;
  sizeMm: RectangleSizeMm;
}>;

type StepChainAllocation = Readonly<{
  first: AxisInterval;
  second: AxisInterval;
  residualAssignments: readonly Readonly<{
    sinkKey: string;
    amountMm: number;
  }>[];
}>;

function naturalStepRegion(
  input: NormalizedLayerSolverInput,
  nodesBySlotId: ReadonlyMap<string, StructuralRegionNode>,
  slotId: string,
): NaturalStepRegion | string {
  const node = nodesBySlotId.get(slotId);
  if (!node) return `Unknown step-spine slot ${slotId}.`;
  const sizeMm = naturalNodeSize(input, node);
  if (!sizeMm) {
    return `Region ${node.canonicalIndex} has an invalid footprint class for the package.`;
  }
  return Object.freeze({ node, sizeMm });
}

function sizeSpan(size: RectangleSizeMm, axis: RegionAxis): number {
  return axis === "x" ? size.length : size.width;
}

function stepPolicyExpandsRegion(policy: StepSpacingPolicy): boolean {
  return policy === "continuous-space-between" || policy === "integer-balanced";
}

function allocateStepChain(
  minimum: number,
  maximum: number,
  firstSpan: number,
  secondSpan: number,
  clearanceMm: number,
  firstPolicy: StepSpacingPolicy,
  secondPolicy: StepSpacingPolicy,
  direction: 1 | -1,
  chainKey: string,
  firstRegionKey: string,
  secondRegionKey: string,
): StepChainAllocation | string {
  const residual = maximum - minimum - firstSpan - secondSpan - clearanceMm;
  if (residual < -SOLVER_GEOMETRY_EPSILON_MM) {
    return `Step-spine chain ${chainKey} does not fit its frame span.`;
  }
  const normalizedResidual = Math.max(0, residual);
  let firstExtra = 0;
  let secondExtra = 0;
  let seamExtra = 0;
  if (
    firstPolicy === "inter-region-seam" ||
    secondPolicy === "inter-region-seam"
  ) {
    seamExtra = normalizedResidual;
  } else {
    const firstExpands = stepPolicyExpandsRegion(firstPolicy);
    const secondExpands = stepPolicyExpandsRegion(secondPolicy);
    if (firstExpands && secondExpands) {
      firstExtra = normalizedResidual / 2;
      secondExtra = normalizedResidual - firstExtra;
    } else if (firstExpands) {
      firstExtra = normalizedResidual;
    } else if (secondExpands) {
      secondExtra = normalizedResidual;
    } else {
      seamExtra = normalizedResidual;
    }
  }

  const firstAllocatedSpan = firstSpan + firstExtra;
  const secondAllocatedSpan = secondSpan + secondExtra;
  const first =
    direction === 1
      ? axisInterval(minimum, minimum + firstAllocatedSpan, `${chainKey}.first`)
      : axisInterval(
          maximum - firstAllocatedSpan,
          maximum,
          `${chainKey}.first`,
        );
  const second =
    direction === 1
      ? axisInterval(
          maximum - secondAllocatedSpan,
          maximum,
          `${chainKey}.second`,
        )
      : axisInterval(
          minimum,
          minimum + secondAllocatedSpan,
          `${chainKey}.second`,
        );
  const residualAssignments: Array<{ sinkKey: string; amountMm: number }> = [];
  const addResidual = (sinkKey: string, amountMm: number) => {
    if (amountMm <= SOLVER_GEOMETRY_EPSILON_MM) return;
    residualAssignments.push(
      Object.freeze({
        sinkKey,
        amountMm: normalizeGeneratedGeometryMetric(
          amountMm,
          `${chainKey}.${sinkKey}.residualMm`,
        ),
      }),
    );
  };
  addResidual(firstRegionKey, firstExtra);
  addResidual(secondRegionKey, secondExtra);
  addResidual(`${chainKey}:seam`, seamExtra);
  return Object.freeze({
    first,
    second,
    residualAssignments: Object.freeze(residualAssignments),
  });
}

function boundsFromStepIntervals(
  inlineAxis: RegionAxis,
  inline: AxisInterval,
  cross: AxisInterval,
  field: string,
): RectangleBoundsMm {
  return normalizedBounds(
    inlineAxis === "x"
      ? {
          minX: inline.minimum,
          maxX: inline.maximum,
          minY: cross.minimum,
          maxY: cross.maximum,
        }
      : {
          minX: cross.minimum,
          maxX: cross.maximum,
          minY: inline.minimum,
          maxY: inline.maximum,
        },
    field,
  );
}

function realizeStepSpineConstraints(
  input: NormalizedLayerSolverInput,
  topology: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  selections: readonly RegionSpacingSelection[],
  ledger: RegionWorkLedger,
): RegionConstraintResult {
  if (
    topology.ownerFamily !== "spine-corridor" ||
    topology.witness.kind !== "spine-tree"
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "This constraint solver accepts step-spine witnesses only.",
    });
  }
  if (selections.length !== topology.nodes.length) {
    return Object.freeze({
      status: "invalid",
      reason: "Step-spine spacing selections must match the region count.",
    });
  }
  const roles = stepSpineRoles(topology.witness);
  if (typeof roles === "string") {
    return Object.freeze({ status: "invalid", reason: roles });
  }
  const initialDecision = ledger.checkpoint();
  if (initialDecision !== "continue") {
    return Object.freeze({ status: "stopped", reason: initialDecision });
  }
  const structuralNodes = structuralNodeMap(topology);
  if (typeof structuralNodes === "string") {
    return Object.freeze({ status: "invalid", reason: structuralNodes });
  }

  const roleValues = {
    main: naturalStepRegion(input, structuralNodes, roles.mainSlotId),
    longBand: naturalStepRegion(input, structuralNodes, roles.longBandSlotId),
    sideStrip: naturalStepRegion(input, structuralNodes, roles.sideStripSlotId),
    corner: naturalStepRegion(input, structuralNodes, roles.cornerSlotId),
  };
  const roleIssue = Object.values(roleValues).find(
    (value): value is string => typeof value === "string",
  );
  if (roleIssue) return Object.freeze({ status: "invalid", reason: roleIssue });
  const { main, longBand, sideStrip, corner } = roleValues as Readonly<{
    main: NaturalStepRegion;
    longBand: NaturalStepRegion;
    sideStrip: NaturalStepRegion;
    corner: NaturalStepRegion;
  }>;
  const inlineAxis = topology.witness.axis;
  const crossAxis: RegionAxis = inlineAxis === "x" ? "y" : "x";
  const clearance = input.package.clearanceMm;
  if (main.node.packageCount <= 1) {
    return Object.freeze({
      status: "infeasible",
      reason: "The main step-spine rectangle must contain multiple packages.",
    });
  }
  const sideInline = sizeSpan(sideStrip.sizeMm, inlineAxis);
  const sideCross = sizeSpan(sideStrip.sizeMm, crossAxis);
  const mainInline = sizeSpan(main.sizeMm, inlineAxis);
  const mainCross = sizeSpan(main.sizeMm, crossAxis);
  const bandInline = sizeSpan(longBand.sizeMm, inlineAxis);
  const bandCross = sizeSpan(longBand.sizeMm, crossAxis);
  const cornerInline = sizeSpan(corner.sizeMm, inlineAxis);
  const cornerCross = sizeSpan(corner.sizeMm, crossAxis);
  if (
    longBand.node.packageCount <= 1 ||
    bandInline <= bandCross + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "The long band must be elongated along the spine axis.",
    });
  }
  if (
    sideStrip.node.packageCount <= 1 ||
    sideCross <= sideInline + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "The side strip must be elongated across the spine axis.",
    });
  }
  const sideMainInline = sideInline + clearance + mainInline;
  const cornerBandInline = cornerInline + clearance + bandInline;
  const sideCornerCross = sideCross + clearance + cornerCross;
  const mainBandCross = mainCross + clearance + bandCross;
  const naturalInline = Math.max(sideMainInline, cornerBandInline);
  const naturalCross = Math.max(sideCornerCross, mainBandCross);
  const naturalSize: RectangleSizeMm =
    inlineAxis === "x"
      ? { length: naturalInline, width: naturalCross }
      : { length: naturalCross, width: naturalInline };
  const generationBounds = input.generationBoundsMm;
  if (
    naturalSize.length >
      rectangleBoundsLength(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM ||
    naturalSize.width >
      rectangleBoundsWidth(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "The natural step-spine topology does not fit generation bounds.",
    });
  }
  const frameBoundsMm =
    framePolicy === "fill-generation-bounds"
      ? normalizedBounds(generationBounds, "generationBoundsMm")
      : centeredRootBounds(generationBounds, naturalSize);

  const policyFor = (
    region: NaturalStepRegion,
    axis: RegionAxis,
  ): StepSpacingPolicy | null => {
    const policy = selections[region.node.canonicalIndex]?.[axis];
    return isStepSpacingPolicy(policy) ? policy : null;
  };
  const sideInlinePolicy = policyFor(sideStrip, inlineAxis);
  const mainInlinePolicy = policyFor(main, inlineAxis);
  const cornerInlinePolicy = policyFor(corner, inlineAxis);
  const bandInlinePolicy = policyFor(longBand, inlineAxis);
  const sideCrossPolicy = policyFor(sideStrip, crossAxis);
  const cornerCrossPolicy = policyFor(corner, crossAxis);
  const mainCrossPolicy = policyFor(main, crossAxis);
  const bandCrossPolicy = policyFor(longBand, crossAxis);
  if (
    !sideInlinePolicy ||
    !mainInlinePolicy ||
    !cornerInlinePolicy ||
    !bandInlinePolicy ||
    !sideCrossPolicy ||
    !cornerCrossPolicy ||
    !mainCrossPolicy ||
    !bandCrossPolicy
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "Every step-spine region requires two spacing selections.",
    });
  }

  const mainInlineAllocation = allocateStepChain(
    axisMinimum(frameBoundsMm, inlineAxis),
    axisMaximum(frameBoundsMm, inlineAxis),
    sideInline,
    mainInline,
    clearance,
    sideInlinePolicy,
    mainInlinePolicy,
    topology.witness.inlineDirection,
    "step-spine:side-main:inline",
    `region-${sideStrip.node.canonicalIndex}:${inlineAxis}`,
    `region-${main.node.canonicalIndex}:${inlineAxis}`,
  );
  const bandInlineAllocation = allocateStepChain(
    axisMinimum(frameBoundsMm, inlineAxis),
    axisMaximum(frameBoundsMm, inlineAxis),
    cornerInline,
    bandInline,
    clearance,
    cornerInlinePolicy,
    bandInlinePolicy,
    topology.witness.inlineDirection,
    "step-spine:corner-band:inline",
    `region-${corner.node.canonicalIndex}:${inlineAxis}`,
    `region-${longBand.node.canonicalIndex}:${inlineAxis}`,
  );
  const sideCrossAllocation = allocateStepChain(
    axisMinimum(frameBoundsMm, crossAxis),
    axisMaximum(frameBoundsMm, crossAxis),
    sideCross,
    cornerCross,
    clearance,
    sideCrossPolicy,
    cornerCrossPolicy,
    topology.witness.crossDirection,
    "step-spine:side-corner:cross",
    `region-${sideStrip.node.canonicalIndex}:${crossAxis}`,
    `region-${corner.node.canonicalIndex}:${crossAxis}`,
  );
  const mainCrossAllocation = allocateStepChain(
    axisMinimum(frameBoundsMm, crossAxis),
    axisMaximum(frameBoundsMm, crossAxis),
    mainCross,
    bandCross,
    clearance,
    mainCrossPolicy,
    bandCrossPolicy,
    topology.witness.crossDirection,
    "step-spine:main-band:cross",
    `region-${main.node.canonicalIndex}:${crossAxis}`,
    `region-${longBand.node.canonicalIndex}:${crossAxis}`,
  );
  if (typeof mainInlineAllocation === "string") {
    return Object.freeze({
      status: "infeasible",
      reason: mainInlineAllocation,
    });
  }
  if (typeof bandInlineAllocation === "string") {
    return Object.freeze({
      status: "infeasible",
      reason: bandInlineAllocation,
    });
  }
  if (typeof sideCrossAllocation === "string") {
    return Object.freeze({
      status: "infeasible",
      reason: sideCrossAllocation,
    });
  }
  if (typeof mainCrossAllocation === "string") {
    return Object.freeze({
      status: "infeasible",
      reason: mainCrossAllocation,
    });
  }
  const firstSpan = (allocation: StepChainAllocation) =>
    allocation.first.maximum - allocation.first.minimum;
  if (
    approximatelyEqual(
      firstSpan(mainInlineAllocation),
      firstSpan(bandInlineAllocation),
    ) ||
    approximatelyEqual(
      firstSpan(sideCrossAllocation),
      firstSpan(mainCrossAllocation),
    )
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "Both step-spine junctions must remain offset after allocation.",
    });
  }

  const boundsBySlotId = new Map<string, RectangleBoundsMm>([
    [
      roles.mainSlotId,
      boundsFromStepIntervals(
        inlineAxis,
        mainInlineAllocation.second,
        mainCrossAllocation.first,
        "stepSpine.mainBoundsMm",
      ),
    ],
    [
      roles.longBandSlotId,
      boundsFromStepIntervals(
        inlineAxis,
        bandInlineAllocation.second,
        mainCrossAllocation.second,
        "stepSpine.longBandBoundsMm",
      ),
    ],
    [
      roles.sideStripSlotId,
      boundsFromStepIntervals(
        inlineAxis,
        mainInlineAllocation.first,
        sideCrossAllocation.first,
        "stepSpine.sideStripBoundsMm",
      ),
    ],
    [
      roles.cornerSlotId,
      boundsFromStepIntervals(
        inlineAxis,
        bandInlineAllocation.first,
        sideCrossAllocation.second,
        "stepSpine.cornerBoundsMm",
      ),
    ],
  ]);

  for (const relation of topology.relations) {
    const decision = ledger.debit("line-constraint");
    if (decision !== "continue") {
      return Object.freeze({ status: "stopped", reason: decision });
    }
    if (
      !relationHolds(
        relation,
        boundsBySlotId,
        frameBoundsMm,
        input.package.clearanceMm,
      )
    ) {
      return Object.freeze({
        status: "infeasible",
        reason: `Step-spine relation ${relation.id} is not satisfied.`,
      });
    }
  }

  const regionBoundsMm: RectangleBoundsMm[] = [];
  for (const node of [...topology.nodes].sort(
    (left, right) => left.canonicalIndex - right.canonicalIndex,
  )) {
    const bounds = boundsBySlotId.get(`region-${node.canonicalIndex}`);
    if (!bounds) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} has no step-spine bounds.`,
      });
    }
    regionBoundsMm.push(bounds);
  }
  const residualAssignments = [
    ...mainInlineAllocation.residualAssignments,
    ...bandInlineAllocation.residualAssignments,
    ...sideCrossAllocation.residualAssignments,
    ...mainCrossAllocation.residualAssignments,
  ].sort((left, right) =>
    left.sinkKey < right.sinkKey ? -1 : left.sinkKey > right.sinkKey ? 1 : 0,
  );
  return Object.freeze({
    status: "completed",
    graph: Object.freeze({
      topology,
      regionBoundsMm: Object.freeze(regionBoundsMm),
      residualAssignments: Object.freeze(residualAssignments),
      framePolicy,
    }),
  });
}

export function realizeGuillotineConstraints(
  input: NormalizedLayerSolverInput,
  topology: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  ledger: RegionWorkLedger,
  selections: readonly RegionSpacingSelection[] = [],
): GuillotineConstraintResult {
  if (typeof topology !== "object" || topology === null) {
    return Object.freeze({
      status: "invalid",
      reason: "Owned structural region graph must be an object.",
    });
  }
  if (
    topology.ownerFamily !== "guillotine" ||
    topology.witness.kind !== "guillotine-cut-tree"
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "This constraint solver accepts guillotine topology witnesses only.",
    });
  }
  if (
    framePolicy !== "center-occupied-bounds" &&
    framePolicy !== "integer-center-occupied-bounds" &&
    framePolicy !== "fill-generation-bounds"
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "Unknown region frame policy.",
    });
  }
  if (selections.length !== 0 && selections.length !== topology.nodes.length) {
    return Object.freeze({
      status: "invalid",
      reason: "Guillotine spacing selections must match the region count.",
    });
  }

  const initialDecision = ledger.checkpoint();
  if (initialDecision !== "continue") {
    return Object.freeze({ status: "stopped", reason: initialDecision });
  }

  const structuralNodes = structuralNodeMap(topology);
  if (typeof structuralNodes === "string") {
    return Object.freeze({ status: "invalid", reason: structuralNodes });
  }
  const selectionBySlotId = new Map<string, RegionSpacingSelection>();
  for (const node of topology.nodes) {
    const selection = selections[node.canonicalIndex];
    if (selection) {
      selectionBySlotId.set(`region-${node.canonicalIndex}`, selection);
    }
  }
  const naturalRoot = naturalCutTree(
    input,
    topology.witness.root,
    structuralNodes,
  );
  if (typeof naturalRoot === "string") {
    return Object.freeze({ status: "invalid", reason: naturalRoot });
  }

  const generationBounds = input.generationBoundsMm;
  if (
    naturalRoot.sizeMm.length >
      rectangleBoundsLength(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM ||
    naturalRoot.sizeMm.width >
      rectangleBoundsWidth(generationBounds) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({
      status: "infeasible",
      reason: "The natural guillotine topology does not fit generation bounds.",
    });
  }

  const centeredBounds = centeredRootBounds(
    generationBounds,
    naturalRoot.sizeMm,
  );
  let frameBoundsMm =
    framePolicy === "fill-generation-bounds"
      ? normalizedBounds(generationBounds, "generationBoundsMm")
      : centeredBounds;
  if (framePolicy === "integer-center-occupied-bounds") {
    const firstSlotId = firstGuillotineSlotId(topology.witness.root);
    const firstNode = structuralNodes.get(firstSlotId);
    const firstFootprint = firstNode ? footprintSize(input, firstNode) : null;
    if (!firstFootprint) {
      return Object.freeze({
        status: "invalid",
        reason: "The first guillotine slot has no valid package footprint.",
      });
    }
    frameBoundsMm = integerCenterPhasedRootBounds(
      generationBounds,
      centeredBounds,
      firstFootprint,
    );
  }
  const boundsBySlotId = new Map<string, RectangleBoundsMm>();
  const residualAssignments: Array<{ sinkKey: string; amountMm: number }> = [];
  const allocationIssue = allocateCutTree(
    naturalRoot,
    frameBoundsMm,
    input.package.clearanceMm,
    boundsBySlotId,
    selectionBySlotId,
    residualAssignments,
    "root",
  );
  if (allocationIssue) {
    return Object.freeze({ status: "infeasible", reason: allocationIssue });
  }

  for (const relation of topology.relations) {
    const decision = ledger.debit("line-constraint");
    if (decision !== "continue") {
      return Object.freeze({ status: "stopped", reason: decision });
    }
    if (
      !guillotineRelationHolds(
        relation,
        boundsBySlotId,
        frameBoundsMm,
        input.package.clearanceMm,
        selectionBySlotId,
      )
    ) {
      return Object.freeze({
        status: "infeasible",
        reason: `Guillotine relation ${relation.id} is not satisfied.`,
      });
    }
  }

  const regionBoundsMm: RectangleBoundsMm[] = [];
  for (const node of [...topology.nodes].sort(
    (left, right) => left.canonicalIndex - right.canonicalIndex,
  )) {
    const slotId = `region-${node.canonicalIndex}`;
    const bounds = boundsBySlotId.get(slotId);
    const naturalSize = naturalNodeSize(input, node);
    if (!bounds || !naturalSize) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} has no materialized bounds.`,
      });
    }
    regionBoundsMm.push(bounds);
    const residualX = Math.max(
      0,
      rectangleBoundsLength(bounds) - naturalSize.length,
    );
    const residualY = Math.max(
      0,
      rectangleBoundsWidth(bounds) - naturalSize.width,
    );
    if (residualX > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${slotId}:x`,
          amountMm: normalizeGeneratedGeometryMetric(
            residualX,
            `${slotId}.residualXMm`,
          ),
        }),
      );
    }
    if (residualY > SOLVER_GEOMETRY_EPSILON_MM) {
      residualAssignments.push(
        Object.freeze({
          sinkKey: `${slotId}:y`,
          amountMm: normalizeGeneratedGeometryMetric(
            residualY,
            `${slotId}.residualYMm`,
          ),
        }),
      );
    }
  }

  return Object.freeze({
    status: "completed",
    graph: Object.freeze({
      topology,
      regionBoundsMm: Object.freeze(regionBoundsMm),
      residualAssignments: Object.freeze(residualAssignments),
      framePolicy,
    }),
  });
}

export const solveGuillotineRelations = realizeGuillotineConstraints;

export function realizeRegionConstraints(
  input: NormalizedLayerSolverInput,
  topology: OwnedStructuralRegionGraph,
  framePolicy: RegionFramePolicy,
  selections: readonly RegionSpacingSelection[],
  ledger: RegionWorkLedger,
): RegionConstraintResult {
  if (typeof topology !== "object" || topology === null) {
    return Object.freeze({
      status: "invalid",
      reason: "Owned structural region graph must be an object.",
    });
  }
  if (
    framePolicy !== "center-occupied-bounds" &&
    framePolicy !== "integer-center-occupied-bounds" &&
    framePolicy !== "fill-generation-bounds"
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "Unknown region frame policy.",
    });
  }
  if (
    framePolicy === "integer-center-occupied-bounds" &&
    topology.ownerFamily !== "guillotine" &&
    topology.ownerFamily !== "bridge-chain"
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Integer-center occupied bounds are not implemented for this topology family.",
    });
  }
  if (topology.ownerFamily === "guillotine") {
    return realizeGuillotineConstraints(
      input,
      topology,
      framePolicy,
      ledger,
      selections,
    );
  }
  if (topology.ownerFamily === "pinwheel") {
    return realizePinwheelConstraints(
      input,
      topology,
      framePolicy,
      selections,
      ledger,
    );
  }
  if (topology.ownerFamily === "bridge-chain") {
    return realizeEmbeddedBridgeConstraints(
      input,
      topology,
      framePolicy,
      selections,
      ledger,
    );
  }
  if (topology.ownerFamily === "spine-corridor") {
    return realizeStepSpineConstraints(
      input,
      topology,
      framePolicy,
      selections,
      ledger,
    );
  }
  return Object.freeze({
    status: "invalid",
    reason: `No metric constraint solver is implemented for ${topology.ownerFamily}.`,
  });
}
