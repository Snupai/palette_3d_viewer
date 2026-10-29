import type { RectangleSizeMm } from "~/domain/geometry";
import {
  normalizeGeneratedCoordinateMm,
  normalizeGeneratedGeometryMetric,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import type {
  MetricRegionGraph,
  RegionQuantization,
  RegionSpacingPolicy,
  SpacedRegionGraph,
  StructuralRegionNode,
} from "~/domain/solver/region-topology/model";
import type { RegionWorkLedger } from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";
import type { Rotation } from "~/domain/palletTypes";

export type RegionLineSpacingRequest = Readonly<{
  minimumMm: number;
  maximumMm: number;
  itemSpanMm: number;
  clearanceMm: number;
  count: number;
  policy: RegionSpacingPolicy;
  groupCapacity?: number;
  groupRemainder?: "first" | "last";
  centerPhaseMm?: 0 | 0.5;
}>;

export type RegionLineSpacingResult =
  | Readonly<{
      status: "feasible";
      centersMm: readonly number[];
      quantization: RegionQuantization;
    }>
  | Readonly<{
      status: "infeasible";
      reason:
        | "unsupported-policy"
        | "insufficient-span"
        | "quantization-out-of-bounds"
        | "quantization-violates-clearance";
    }>
  | Readonly<{ status: "invalid"; reason: string }>;

export const REGION_RECURSIVE_CORE_ALIGNMENTS = [
  "fill-parent",
  "center",
  "min-x-min-y",
  "min-x-max-y",
  "max-x-min-y",
  "max-x-max-y",
] as const;

export type RegionRecursiveCoreAlignment =
  (typeof REGION_RECURSIVE_CORE_ALIGNMENTS)[number];

export const PINWHEEL_RESIDUAL_PLACEMENTS = ["between", "cycle-seams"] as const;

export type PinwheelResidualPlacement =
  (typeof PINWHEEL_RESIDUAL_PLACEMENTS)[number];

export const PINWHEEL_ARM_RESIDUAL_POLICIES = [
  "balanced",
  "spacing-directed",
  "first-region",
  "second-region",
] as const;

export type PinwheelArmResidualPolicy =
  (typeof PINWHEEL_ARM_RESIDUAL_POLICIES)[number];

export type RegionSpacingSelection = Readonly<{
  x: RegionSpacingPolicy;
  y: RegionSpacingPolicy;
  recursiveCoreAlignment?: RegionRecursiveCoreAlignment;
  pinwheelResidualPlacement?: PinwheelResidualPlacement;
  pinwheelArmResidualPolicy?: PinwheelArmResidualPolicy;
  suctionGroupRemainder?: "first" | "last";
  suctionGroupCenterPhaseMm?: 0 | 0.5;
  /** Exact metric residual absorbed by this arm on each cycle axis. */
  pinwheelArmResidualMm?: Readonly<{ x?: number; y?: number }>;
}>;

export type RegionSpacingResult =
  | Readonly<{ status: "completed"; graph: SpacedRegionGraph }>
  | Readonly<{
      status: "infeasible";
      regionIndex: number;
      axis: "x" | "y";
      reason: Extract<
        RegionLineSpacingResult,
        { status: "infeasible" }
      >["reason"];
    }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{
      status: "stopped";
      reason: Exclude<ReturnType<RegionWorkLedger["checkpoint"]>, "continue">;
    }>;

const supportedPolicies = new Set<RegionSpacingPolicy>([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
  "suction-group-aware",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function usedSpan(count: number, itemSpan: number, clearance: number): number {
  return normalizeGeneratedGeometryMetric(
    count * itemSpan + (count - 1) * clearance,
    "regionLine.usedSpanMm",
  );
}

function roundHalfTowardZero(value: number): number {
  const sign = Math.sign(value);
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  const roundedAbsolute =
    fraction > 0.5 + SOLVER_GEOMETRY_EPSILON_MM ? whole + 1 : whole;
  return sign * roundedAbsolute;
}

function normalizedCenters(values: readonly number[]): readonly number[] {
  return Object.freeze(
    values.map((value, index) =>
      normalizeGeneratedCoordinateMm(value, `regionLine.centersMm[${index}]`),
    ),
  );
}

function centersStayWithinBounds(
  centers: readonly number[],
  minimum: number,
  maximum: number,
  itemSpan: number,
): boolean {
  const halfSpan = itemSpan / 2;
  return centers.every(
    (center) =>
      center - halfSpan >= minimum - SOLVER_GEOMETRY_EPSILON_MM &&
      center + halfSpan <= maximum + SOLVER_GEOMETRY_EPSILON_MM,
  );
}

function centersRespectClearance(
  centers: readonly number[],
  itemSpan: number,
  clearance: number,
): boolean {
  for (let index = 1; index < centers.length; index += 1) {
    if (
      centers[index]! - centers[index - 1]! <
      itemSpan + clearance - SOLVER_GEOMETRY_EPSILON_MM
    ) {
      return false;
    }
  }
  return true;
}

export function realizeRegionLineSpacing(
  request: RegionLineSpacingRequest,
): RegionLineSpacingResult {
  if (typeof request !== "object" || request === null) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line spacing request must be an object.",
    });
  }

  const { minimumMm, maximumMm, itemSpanMm, clearanceMm, count, policy } =
    request;
  if (!isFiniteNumber(minimumMm) || !isFiniteNumber(maximumMm)) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line bounds must be finite numbers.",
    });
  }
  if (maximumMm <= minimumMm) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line maximum must exceed its minimum.",
    });
  }
  if (!isFiniteNumber(itemSpanMm) || itemSpanMm <= 0) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line item span must be a finite positive number.",
    });
  }
  if (!isFiniteNumber(clearanceMm) || clearanceMm < 0) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line clearance must be a finite non-negative number.",
    });
  }
  if (!isPositiveSafeInteger(count)) {
    return Object.freeze({
      status: "invalid",
      reason: "Region line count must be a positive safe integer.",
    });
  }
  if (!supportedPolicies.has(policy)) {
    return Object.freeze({
      status: "infeasible",
      reason: "unsupported-policy",
    });
  }
  if (
    request.centerPhaseMm !== undefined &&
    request.centerPhaseMm !== 0 &&
    request.centerPhaseMm !== 0.5
  )
    return Object.freeze({
      status: "invalid",
      reason: "Center phase must be 0 or 0.5 mm.",
    });

  const available = maximumMm - minimumMm;
  if (
    usedSpan(count, itemSpanMm, clearanceMm) >
    available + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return Object.freeze({ status: "infeasible", reason: "insufficient-span" });
  }

  let centers: readonly number[];
  let quantization: RegionQuantization = "continuous";
  if (policy === "suction-group-aware") {
    const capacity = request.groupCapacity ?? 1;
    if (!isPositiveSafeInteger(capacity))
      return Object.freeze({
        status: "invalid",
        reason: "Group capacity must be a positive safe integer.",
      });
    const groupCount = Math.ceil(count / capacity);
    const remainder = count % capacity || capacity;
    const residual = available - usedSpan(count, itemSpanMm, clearanceMm);
    const gap = groupCount > 1 ? residual / (groupCount - 1) : 0;
    let cursor = minimumMm + (groupCount === 1 ? residual / 2 : 0);
    const values: number[] = [];
    for (let group = 0; group < groupCount; group++) {
      const remainderIndex =
        request.groupRemainder === "first" ? 0 : groupCount - 1;
      const size = group === remainderIndex ? remainder : capacity;
      const groupSpan = usedSpan(size, itemSpanMm, clearanceMm);
      let groupStart = cursor;
      if (request.centerPhaseMm !== undefined) {
        const phase = request.centerPhaseMm;
        const minimum =
          Math.ceil(
            minimumMm + groupSpan / 2 - phase - SOLVER_GEOMETRY_EPSILON_MM,
          ) + phase;
        const maximum =
          Math.floor(
            maximumMm - groupSpan / 2 - phase + SOLVER_GEOMETRY_EPSILON_MM,
          ) + phase;
        if (minimum > maximum)
          return Object.freeze({
            status: "infeasible",
            reason: "quantization-out-of-bounds",
          });
        groupStart =
          Math.min(
            maximum,
            Math.max(
              minimum,
              roundHalfTowardZero(cursor + groupSpan / 2 - phase) + phase,
            ),
          ) -
          groupSpan / 2;
        quantization = "half-mm-center";
      }
      for (let item = 0; item < size; item++) {
        values.push(
          groupStart + itemSpanMm / 2 + item * (itemSpanMm + clearanceMm),
        );
      }
      cursor += size * (itemSpanMm + clearanceMm) + gap;
    }
    centers = normalizedCenters(values);
  } else if (policy === "compact" || policy === "inter-region-seam") {
    centers = normalizedCenters(
      Array.from(
        { length: count },
        (_, index) =>
          minimumMm + itemSpanMm / 2 + index * (itemSpanMm + clearanceMm),
      ),
    );
  } else if (policy === "continuous-space-between") {
    if (count === 1) {
      centers = normalizedCenters([minimumMm + available / 2]);
    } else {
      const first = minimumMm + itemSpanMm / 2;
      const last = maximumMm - itemSpanMm / 2;
      const step = (last - first) / (count - 1);
      if (step < itemSpanMm + clearanceMm - SOLVER_GEOMETRY_EPSILON_MM) {
        return Object.freeze({
          status: "infeasible",
          reason: "insufficient-span",
        });
      }
      centers = normalizedCenters(
        Array.from({ length: count }, (_, index) => first + index * step),
      );
    }
  } else {
    const phase = request.centerPhaseMm ?? 0;
    quantization = phase === 0 ? "integer-center" : "half-mm-center";
    const first =
      Math.ceil(
        minimumMm + itemSpanMm / 2 - phase - SOLVER_GEOMETRY_EPSILON_MM,
      ) + phase;
    const last =
      Math.floor(
        maximumMm - itemSpanMm / 2 - phase + SOLVER_GEOMETRY_EPSILON_MM,
      ) + phase;
    if (first > last) {
      return Object.freeze({
        status: "infeasible",
        reason: "quantization-out-of-bounds",
      });
    }
    if (count === 1) {
      centers = normalizedCenters([
        Math.min(
          last,
          Math.max(
            first,
            roundHalfTowardZero(minimumMm + available / 2 - phase) + phase,
          ),
        ),
      ]);
    } else {
      const step = (last - first) / (count - 1);
      centers = normalizedCenters(
        Array.from(
          { length: count },
          (_, index) =>
            roundHalfTowardZero(first + index * step - phase) + phase,
        ),
      );
    }
  }

  if (!centersStayWithinBounds(centers, minimumMm, maximumMm, itemSpanMm)) {
    return Object.freeze({
      status: "infeasible",
      reason: "quantization-out-of-bounds",
    });
  }
  if (!centersRespectClearance(centers, itemSpanMm, clearanceMm)) {
    return Object.freeze({
      status: "infeasible",
      reason: "quantization-violates-clearance",
    });
  }

  return Object.freeze({
    status: "feasible",
    centersMm: centers,
    quantization,
  });
}

function representativeRotation(
  input: NormalizedLayerSolverInput,
  node: StructuralRegionNode,
): Rotation | null {
  if (node.footprintClass === "square") {
    return input.constraints.allowedRotations[0] ?? null;
  }
  return (
    input.constraints.allowedRotations.find((rotation) =>
      node.footprintClass === "lengthwise"
        ? rotation === 0 || rotation === 180
        : rotation === 90 || rotation === 270,
    ) ?? null
  );
}

function footprintSize(
  input: NormalizedLayerSolverInput,
  node: StructuralRegionNode,
): RectangleSizeMm | null {
  const rotation = representativeRotation(input, node);
  if (rotation === null) return null;
  const dimensions = input.package.dimensionsMm;
  return rotation === 0 || rotation === 180
    ? { length: dimensions.length, width: dimensions.width }
    : { length: dimensions.width, width: dimensions.length };
}

function graphQuantization(
  x: RegionLineSpacingResult,
  y: RegionLineSpacingResult,
): RegionQuantization {
  return x.status === "feasible" &&
    y.status === "feasible" &&
    x.quantization === "integer-center" &&
    y.quantization === "integer-center"
    ? "integer-center"
    : "continuous";
}

type RealizedRegionSpacing = Readonly<{
  xCentersMm: readonly number[];
  yCentersMm: readonly number[];
}>;

function canonicalRegionIndex(
  slotId: string,
  nodeCount: number,
): number | null {
  const match = /^region-(\d+)$/.exec(slotId);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 && index < nodeCount
    ? index
    : null;
}

function connectedRegionPairs(
  graph: MetricRegionGraph,
): readonly (readonly [number, number])[] {
  const nodeCount = graph.topology.nodes.length;
  const pairKeys = new Set<string>();
  const pairs: Array<readonly [number, number]> = [];
  const add = (firstSlotId: string, secondSlotId: string) => {
    const first = canonicalRegionIndex(firstSlotId, nodeCount);
    const second = canonicalRegionIndex(secondSlotId, nodeCount);
    if (first === null || second === null || first === second) return;
    const ordered =
      first < second ? ([first, second] as const) : ([second, first] as const);
    const key = `${ordered[0]}:${ordered[1]}`;
    if (pairKeys.has(key)) return;
    pairKeys.add(key);
    pairs.push(Object.freeze(ordered));
  };

  for (const relation of graph.topology.relations) {
    switch (relation.kind) {
      case "contact":
        add(relation.first.slotId, relation.second.slotId);
        break;
      case "align":
        add(relation.firstSlotId, relation.secondSlotId);
        break;
      case "order":
        add(relation.beforeSlotId, relation.afterSlotId);
        break;
      case "span":
        relation.innerSlotIds.forEach((slotId) =>
          add(relation.outerSlotId, slotId),
        );
        break;
      case "containment":
        add(relation.containerSlotId, relation.containedSlotId);
        break;
      case "frame-anchor":
        break;
    }
  }
  return Object.freeze(
    pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]),
  );
}

function groupsFormOnePhysicalGrid(
  input: NormalizedLayerSolverInput,
  graph: MetricRegionGraph,
  spacingByRegion: readonly RealizedRegionSpacing[],
  regionIndices: readonly number[],
): boolean {
  const firstNode = graph.topology.nodes[regionIndices[0]!];
  if (!firstNode) return false;
  if (
    regionIndices.some(
      (index) =>
        graph.topology.nodes[index]?.footprintClass !==
        firstNode.footprintClass,
    )
  ) {
    return false;
  }
  const dimensions = input.package.dimensionsMm;
  const itemLength =
    firstNode.footprintClass === "crosswise"
      ? dimensions.width
      : dimensions.length;
  const itemWidth =
    firstNode.footprintClass === "crosswise"
      ? dimensions.length
      : dimensions.width;
  const xValues = new Set<number>();
  const yValues = new Set<number>();
  const centers = new Set<string>();
  let centerCount = 0;
  for (const regionIndex of regionIndices) {
    const spacing = spacingByRegion[regionIndex];
    if (!spacing) return false;
    for (const y of spacing.yCentersMm) {
      yValues.add(y);
      for (const x of spacing.xCentersMm) {
        xValues.add(x);
        const key = `${x}:${y}`;
        if (centers.has(key)) return false;
        centers.add(key);
        centerCount += 1;
      }
    }
  }
  if (xValues.size * yValues.size !== centerCount) return false;

  const respectsSpan = (
    values: ReadonlySet<number>,
    itemSpan: number,
  ): boolean => {
    const ordered = [...values].sort((left, right) => left - right);
    for (let index = 1; index < ordered.length; index += 1) {
      if (
        ordered[index]! - ordered[index - 1]! <
        itemSpan + input.package.clearanceMm - SOLVER_GEOMETRY_EPSILON_MM
      ) {
        return false;
      }
    }
    return true;
  };
  return respectsSpan(xValues, itemLength) && respectsSpan(yValues, itemWidth);
}

function normalizedPhysicalMergeGroups(
  input: NormalizedLayerSolverInput,
  graph: MetricRegionGraph,
  spacingByRegion: readonly RealizedRegionSpacing[],
): readonly (readonly number[])[] {
  const nodeCount = graph.topology.nodes.length;
  if (graph.topology.ownerFamily !== "bridge-chain") {
    return Object.freeze(
      Array.from({ length: nodeCount }, (_, index) => Object.freeze([index])),
    );
  }

  const parent = Array.from({ length: nodeCount }, (_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = current;
      index = next;
    }
    return current;
  };
  const members = (rootIndex: number): number[] =>
    Array.from({ length: nodeCount }, (_, index) => index).filter(
      (index) => root(index) === rootIndex,
    );

  for (const [first, second] of connectedRegionPairs(graph)) {
    const firstRoot = root(first);
    const secondRoot = root(second);
    if (firstRoot === secondRoot) continue;
    const combined = [...members(firstRoot), ...members(secondRoot)].sort(
      (left, right) => left - right,
    );
    if (!groupsFormOnePhysicalGrid(input, graph, spacingByRegion, combined)) {
      continue;
    }
    parent[secondRoot] = firstRoot;
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < nodeCount; index += 1) {
    const groupRoot = root(index);
    const group = groups.get(groupRoot) ?? [];
    group.push(index);
    groups.set(groupRoot, group);
  }
  return Object.freeze(
    [...groups.values()]
      .map((group) => Object.freeze(group.sort((left, right) => left - right)))
      .sort((left, right) => left[0]! - right[0]!),
  );
}

export function realizeRegionSpacing(
  input: NormalizedLayerSolverInput,
  graph: MetricRegionGraph,
  selections: readonly RegionSpacingSelection[],
  ledger: RegionWorkLedger,
): RegionSpacingResult {
  if (typeof graph !== "object" || graph === null) {
    return Object.freeze({
      status: "invalid",
      reason: "Metric region graph must be an object.",
    });
  }
  const nodes = graph.topology.nodes;
  if (
    graph.regionBoundsMm.length !== nodes.length ||
    selections.length !== nodes.length
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Region bounds and spacing selections must match the structural node count.",
    });
  }

  if (nodes.length === 0) {
    return Object.freeze({
      status: "invalid",
      reason: "A metric region graph must contain at least one region.",
    });
  }

  let spacingCenterCount = 0;
  for (const node of nodes) {
    if (
      !isPositiveSafeInteger(node.columns) ||
      !isPositiveSafeInteger(node.rows) ||
      !isPositiveSafeInteger(node.packageCount) ||
      !Number.isSafeInteger(node.columns * node.rows) ||
      node.columns * node.rows !== node.packageCount ||
      node.columns > Number.MAX_SAFE_INTEGER - node.rows
    ) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} has invalid grid counts.`,
      });
    }
    const regionCenterCount = node.columns + node.rows;
    if (spacingCenterCount > Number.MAX_SAFE_INTEGER - regionCenterCount) {
      return Object.freeze({
        status: "invalid",
        reason: "Region spacing center count exceeds safe integer range.",
      });
    }
    spacingCenterCount += regionCenterCount;
  }

  const decision = ledger.debit("spacing-realization", spacingCenterCount);
  if (decision !== "continue") {
    return Object.freeze({ status: "stopped", reason: decision });
  }

  const spacingByRegion: Array<{
    x: RegionSpacingPolicy;
    y: RegionSpacingPolicy;
    quantization: RegionQuantization;
    xCentersMm: readonly number[];
    yCentersMm: readonly number[];
  }> = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const bounds = graph.regionBoundsMm[index]!;
    const selection = selections[index]!;
    const footprint = footprintSize(input, node);
    if (!footprint) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${index} has no allowed representative rotation.`,
      });
    }

    const x = realizeRegionLineSpacing({
      minimumMm: bounds.minX,
      maximumMm: bounds.maxX,
      itemSpanMm: footprint.length,
      clearanceMm: input.package.clearanceMm,
      count: node.columns,
      policy: selection.x,
      groupCapacity:
        node.footprintClass === "crosswise"
          ? 1
          : input.constraints.provisionalPackagesPerCycle,
      groupRemainder: selection.suctionGroupRemainder,
      centerPhaseMm: selection.suctionGroupCenterPhaseMm,
    });
    const afterX = ledger.checkpoint();
    if (afterX !== "continue") {
      return Object.freeze({ status: "stopped", reason: afterX });
    }
    if (x.status === "invalid") {
      return Object.freeze({ status: "invalid", reason: x.reason });
    }
    if (x.status === "infeasible") {
      return Object.freeze({
        status: "infeasible",
        regionIndex: index,
        axis: "x",
        reason: x.reason,
      });
    }

    const y = realizeRegionLineSpacing({
      minimumMm: bounds.minY,
      maximumMm: bounds.maxY,
      itemSpanMm: footprint.width,
      clearanceMm: input.package.clearanceMm,
      count: node.rows,
      policy: selection.y,
      groupCapacity:
        node.footprintClass === "crosswise"
          ? input.constraints.provisionalPackagesPerCycle
          : 1,
      groupRemainder: selection.suctionGroupRemainder,
      centerPhaseMm: selection.suctionGroupCenterPhaseMm,
    });
    const afterY = ledger.checkpoint();
    if (afterY !== "continue") {
      return Object.freeze({ status: "stopped", reason: afterY });
    }
    if (y.status === "invalid") {
      return Object.freeze({ status: "invalid", reason: y.reason });
    }
    if (y.status === "infeasible") {
      return Object.freeze({
        status: "infeasible",
        regionIndex: index,
        axis: "y",
        reason: y.reason,
      });
    }

    spacingByRegion.push(
      Object.freeze({
        x: selection.x,
        y: selection.y,
        quantization: graphQuantization(x, y),
        xCentersMm: x.centersMm,
        yCentersMm: y.centersMm,
      }),
    );
  }

  return Object.freeze({
    status: "completed",
    graph: Object.freeze({
      ...graph,
      spacingByRegion: Object.freeze(spacingByRegion),
      physicalMergeGroups: normalizedPhysicalMergeGroups(
        input,
        graph,
        spacingByRegion,
      ),
    }),
  });
}
