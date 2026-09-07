import {
  REGION_FOOTPRINT_CLASSES,
  type GuillotineCutNode,
  type RegionAxis,
  type RegionGraphTemplate,
  type RegionRelation,
  type RegionSide,
  type RegionSlotDefinition,
  type RegionTemplateAutomorphism,
} from "~/domain/solver/region-topology/model";

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
const MAX_GUILLOTINE_REGIONS = 3;

export type GuillotineTopologyCatalogLimits = Readonly<{
  maxRegionsPerTopology: number;
}>;

function assertPositiveSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function slotId(index: number): string {
  return `zone-${index}`;
}

function slot(index: number): RegionSlotDefinition {
  return Object.freeze({
    id: slotId(index),
    optionalZero: false,
    footprintClasses: REGION_FOOTPRINT_CLASSES,
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

function frameAnchor(
  id: string,
  slotIdValue: string,
  side: RegionSide,
): RegionRelation {
  return Object.freeze({
    id,
    kind: "frame-anchor",
    port: Object.freeze({ slotId: slotIdValue, side }),
    frameSide: side,
  });
}

function fullGridRelations(): readonly RegionRelation[] {
  const id = slotId(0);
  return Object.freeze([
    frameAnchor("anchor-min-x", id, "min-x"),
    frameAnchor("anchor-max-x", id, "max-x"),
    frameAnchor("anchor-min-y", id, "min-y"),
    frameAnchor("anchor-max-y", id, "max-y"),
  ]);
}

function axisSides(axis: RegionAxis): Readonly<{
  minimum: RegionSide;
  maximum: RegionSide;
  crossMinimum: RegionSide;
  crossMaximum: RegionSide;
  crossAxis: RegionAxis;
}> {
  return axis === "x"
    ? {
        minimum: "min-x",
        maximum: "max-x",
        crossMinimum: "min-y",
        crossMaximum: "max-y",
        crossAxis: "y",
      }
    : {
        minimum: "min-y",
        maximum: "max-y",
        crossMinimum: "min-x",
        crossMaximum: "max-x",
        crossAxis: "x",
      };
}

function cutRelations(
  axis: RegionAxis,
  zoneCount: 2 | 3,
): readonly RegionRelation[] {
  const sides = axisSides(axis);
  const relations: RegionRelation[] = [];

  relations.push(
    frameAnchor(`anchor-${axis}-minimum`, slotId(0), sides.minimum),
    frameAnchor(`anchor-${axis}-maximum`, slotId(zoneCount - 1), sides.maximum),
  );

  for (let index = 0; index < zoneCount; index += 1) {
    const currentSlotId = slotId(index);
    relations.push(
      frameAnchor(
        `anchor-${currentSlotId}-${sides.crossMinimum}`,
        currentSlotId,
        sides.crossMinimum,
      ),
      frameAnchor(
        `anchor-${currentSlotId}-${sides.crossMaximum}`,
        currentSlotId,
        sides.crossMaximum,
      ),
    );
    if (index === 0) continue;

    const previousSlotId = slotId(index - 1);
    relations.push(
      Object.freeze({
        id: `contact-${axis}-${index - 1}-${index}`,
        kind: "contact",
        first: Object.freeze({
          slotId: previousSlotId,
          side: sides.maximum,
        }),
        second: Object.freeze({ slotId: currentSlotId, side: sides.minimum }),
        gap: "clearance",
        overlap: "equal-span",
      }),
      Object.freeze({
        id: `order-${axis}-${index - 1}-${index}`,
        kind: "order",
        axis,
        beforeSlotId: previousSlotId,
        afterSlotId: currentSlotId,
        minimumGap: "clearance",
      }),
      Object.freeze({
        id: `align-${sides.crossAxis}-minimum-${index}`,
        kind: "align",
        axis: sides.crossAxis,
        edge: "min",
        firstSlotId: slotId(0),
        secondSlotId: currentSlotId,
      }),
      Object.freeze({
        id: `align-${sides.crossAxis}-maximum-${index}`,
        kind: "align",
        axis: sides.crossAxis,
        edge: "max",
        firstSlotId: slotId(0),
        secondSlotId: currentSlotId,
      }),
    );
  }

  return Object.freeze(relations);
}

function cutRoot(axis: RegionAxis, zoneCount: 2 | 3): GuillotineCutNode {
  const first = Object.freeze({ kind: "slot" as const, slotId: slotId(0) });
  const second = Object.freeze({ kind: "slot" as const, slotId: slotId(1) });
  const children =
    zoneCount === 2
      ? ([first, second] as const)
      : ([
          first,
          second,
          Object.freeze({ kind: "slot" as const, slotId: slotId(2) }),
        ] as const);
  return Object.freeze({ kind: "cut", axis, children });
}

function recursiveCutRoot(
  rootAxis: RegionAxis,
  nestedAxis: RegionAxis,
  branchIndex: 0 | 1,
): GuillotineCutNode {
  const nestedStart = branchIndex === 0 ? 0 : 1;
  const nested = Object.freeze({
    kind: "cut" as const,
    axis: nestedAxis,
    children: Object.freeze([
      Object.freeze({ kind: "slot" as const, slotId: slotId(nestedStart) }),
      Object.freeze({
        kind: "slot" as const,
        slotId: slotId(nestedStart + 1),
      }),
    ]) as Extract<GuillotineCutNode, { kind: "cut" }>["children"],
  });
  const outer = Object.freeze({
    kind: "slot" as const,
    slotId: slotId(branchIndex === 0 ? 2 : 0),
  });
  return Object.freeze({
    kind: "cut",
    axis: rootAxis,
    children: Object.freeze(
      branchIndex === 0 ? [nested, outer] : [outer, nested],
    ) as Extract<GuillotineCutNode, { kind: "cut" }>["children"],
  });
}

function recursiveCutRelations(
  rootAxis: RegionAxis,
  nestedAxis: RegionAxis,
  branchIndex: 0 | 1,
): readonly RegionRelation[] {
  const rootSides = axisSides(rootAxis);
  const nestedSides = axisSides(nestedAxis);
  const nestedStart = branchIndex === 0 ? 0 : 1;
  const firstNested = slotId(nestedStart);
  const secondNested = slotId(nestedStart + 1);
  const outer = slotId(branchIndex === 0 ? 2 : 0);
  const nestedRootSide =
    branchIndex === 0 ? rootSides.minimum : rootSides.maximum;
  const outerRootSide =
    branchIndex === 0 ? rootSides.maximum : rootSides.minimum;
  const beforeIds = branchIndex === 0 ? [firstNested, secondNested] : [outer];
  const afterIds = branchIndex === 0 ? [outer] : [firstNested, secondNested];
  const relations: RegionRelation[] = [
    frameAnchor("anchor-outer-root", outer, outerRootSide),
    frameAnchor("anchor-outer-cross-minimum", outer, rootSides.crossMinimum),
    frameAnchor("anchor-outer-cross-maximum", outer, rootSides.crossMaximum),
    frameAnchor("anchor-nested-first-root", firstNested, nestedRootSide),
    frameAnchor("anchor-nested-second-root", secondNested, nestedRootSide),
    frameAnchor(
      "anchor-nested-cross-minimum",
      firstNested,
      nestedSides.minimum,
    ),
    frameAnchor(
      "anchor-nested-cross-maximum",
      secondNested,
      nestedSides.maximum,
    ),
    Object.freeze({
      id: "contact-nested",
      kind: "contact",
      first: Object.freeze({
        slotId: firstNested,
        side: nestedSides.maximum,
      }),
      second: Object.freeze({
        slotId: secondNested,
        side: nestedSides.minimum,
      }),
      gap: "clearance",
      overlap: "equal-span",
    }),
    Object.freeze({
      id: "order-nested",
      kind: "order",
      axis: nestedAxis,
      beforeSlotId: firstNested,
      afterSlotId: secondNested,
      minimumGap: "clearance",
    }),
    Object.freeze({
      id: "span-outer-cross",
      kind: "span",
      axis: nestedAxis,
      outerSlotId: outer,
      innerSlotIds: Object.freeze([firstNested, secondNested]),
    }),
  ];
  for (const [beforeIndex, beforeSlotId] of beforeIds.entries()) {
    for (const [afterIndex, afterSlotId] of afterIds.entries()) {
      relations.push(
        Object.freeze({
          id: `contact-root-${beforeIndex}-${afterIndex}`,
          kind: "contact",
          first: Object.freeze({
            slotId: beforeSlotId,
            side: rootSides.maximum,
          }),
          second: Object.freeze({
            slotId: afterSlotId,
            side: rootSides.minimum,
          }),
          gap: "clearance",
          overlap: "positive",
        }),
        Object.freeze({
          id: `order-root-${beforeIndex}-${afterIndex}`,
          kind: "order",
          axis: rootAxis,
          beforeSlotId,
          afterSlotId,
          minimumGap: "clearance",
        }),
      );
    }
  }
  return Object.freeze(relations);
}

function createRecursiveGuillotineCutTemplate(
  rootAxis: RegionAxis,
  nestedAxis: RegionAxis,
  branchIndex: 0 | 1,
): RegionGraphTemplate {
  if (rootAxis === nestedAxis) {
    throw new RangeError("Recursive guillotine cuts must alternate axes.");
  }
  const slots = Object.freeze([slot(0), slot(1), slot(2)]);
  return Object.freeze({
    templateKey: `guillotine-v1:recursive-${rootAxis}-${nestedAxis}-branch-${branchIndex}`,
    claimedFamily: "guillotine",
    definitionVersion: 1,
    slots,
    relations: recursiveCutRelations(rootAxis, nestedAxis, branchIndex),
    embedding: Object.freeze({ rotationSystem: Object.freeze([]) }),
    automorphisms: Object.freeze([identityAutomorphism(slots)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness: Object.freeze({
      kind: "guillotine-cut-tree",
      root: recursiveCutRoot(rootAxis, nestedAxis, branchIndex),
    }),
  });
}

export function createFullGridGuillotineTemplate(): RegionGraphTemplate {
  const slots = Object.freeze([slot(0)]);
  return Object.freeze({
    templateKey: "guillotine-v1:full-grid",
    claimedFamily: "guillotine",
    definitionVersion: 1,
    slots,
    relations: fullGridRelations(),
    embedding: Object.freeze({ rotationSystem: Object.freeze([]) }),
    automorphisms: Object.freeze([identityAutomorphism(slots)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness: Object.freeze({
      kind: "guillotine-cut-tree",
      root: Object.freeze({ kind: "slot", slotId: slotId(0) }),
    }),
  });
}

export function createOrderedGuillotineCutTemplate(
  axis: RegionAxis,
  zoneCount: 2 | 3,
): RegionGraphTemplate {
  if (axis !== "x" && axis !== "y") {
    throw new RangeError('axis must be "x" or "y".');
  }
  if (zoneCount !== 2 && zoneCount !== 3) {
    throw new RangeError("zoneCount must be 2 or 3.");
  }

  const slots = Object.freeze(
    Array.from({ length: zoneCount }, (_, index) => slot(index)),
  );
  return Object.freeze({
    templateKey: `guillotine-v1:ordered-${axis}-${zoneCount}`,
    claimedFamily: "guillotine",
    definitionVersion: 1,
    slots,
    relations: cutRelations(axis, zoneCount),
    embedding: Object.freeze({ rotationSystem: Object.freeze([]) }),
    automorphisms: Object.freeze([identityAutomorphism(slots)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness: Object.freeze({
      kind: "guillotine-cut-tree",
      root: cutRoot(axis, zoneCount),
    }),
  });
}

export function buildGuillotineTopologyTemplates(
  limits: GuillotineTopologyCatalogLimits,
): readonly RegionGraphTemplate[] {
  if (typeof limits !== "object" || limits === null) {
    throw new TypeError("Region topology catalog limits must be an object.");
  }
  const maxRegions = assertPositiveSafeInteger(
    limits.maxRegionsPerTopology,
    "limits.maxRegionsPerTopology",
  );
  if (maxRegions > MAX_GUILLOTINE_REGIONS) {
    throw new RangeError(
      `limits.maxRegionsPerTopology must not exceed ${MAX_GUILLOTINE_REGIONS} in the guillotine slice.`,
    );
  }
  const templates: RegionGraphTemplate[] = [createFullGridGuillotineTemplate()];
  if (maxRegions >= 2) {
    templates.push(
      createOrderedGuillotineCutTemplate("x", 2),
      createOrderedGuillotineCutTemplate("y", 2),
    );
  }
  if (maxRegions >= 3) {
    templates.push(
      createOrderedGuillotineCutTemplate("x", 3),
      createOrderedGuillotineCutTemplate("y", 3),
      createRecursiveGuillotineCutTemplate("x", "y", 0),
      createRecursiveGuillotineCutTemplate("x", "y", 1),
      createRecursiveGuillotineCutTemplate("y", "x", 0),
      createRecursiveGuillotineCutTemplate("y", "x", 1),
    );
  }
  return Object.freeze(templates);
}
