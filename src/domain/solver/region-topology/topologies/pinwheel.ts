import {
  PINWHEEL_CHIRALITIES,
  type PinwheelChirality,
  type PinwheelCycleNode,
  type RegionFootprintClass,
  type RegionGraphTemplate,
  type RegionRelation,
  type RegionSide,
  type RegionSlotDefinition,
  type RegionTemplateAutomorphism,
} from "~/domain/solver/region-topology/model";

const PINWHEEL_PHASES = ["lengthwise", "crosswise"] as const;
type PinwheelPhase = (typeof PINWHEEL_PHASES)[number];

const supportedSpacing = Object.freeze([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
  "suction-group-aware",
] as const);
const framePolicies = Object.freeze([
  "center-occupied-bounds",
  "fill-generation-bounds",
] as const);
const MAX_PINWHEEL_CORE_DEPTH = 2;
const ARM_ROLES = ["bottom", "right", "top", "left"] as const;

type PinwheelCoreSpec =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "grid" }>
  | Readonly<{ kind: "cycle"; cycle: PinwheelCycleSpec }>;

type PinwheelArmPackageCountDomains = readonly [
  readonly number[] | undefined,
  readonly number[] | undefined,
  readonly number[] | undefined,
  readonly number[] | undefined,
];

type PinwheelCycleSpec = Readonly<{
  phase: PinwheelPhase;
  chirality: PinwheelChirality;
  armPackageCountDomains: PinwheelArmPackageCountDomains;
  core: PinwheelCoreSpec;
}>;

type TemplateAccumulator = {
  slots: RegionSlotDefinition[];
  relations: RegionRelation[];
  rotationSystem: Array<{
    slotId: string;
    relationIdsClockwise: readonly string[];
  }>;
};

export type PinwheelTopologyCatalogLimits = Readonly<{
  maxCoreDepth: number;
  coreArmPackageCounts?: readonly number[];
  includeGridCore?: boolean;
}>;

function assertNonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizedCoreArmPackageCounts(
  values: readonly number[] | undefined,
): readonly number[] {
  const requested: unknown = values ?? [1, 2];
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new RangeError(
      "limits.coreArmPackageCounts must be a non-empty array.",
    );
  }
  const unique = new Set<number>();
  for (const value of requested as readonly unknown[]) {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new RangeError(
        "limits.coreArmPackageCounts must contain positive safe integers.",
      );
    }
    unique.add(value);
  }
  return Object.freeze([...unique].sort((left, right) => left - right));
}

function independentArmPackageCountDomains(
  values: readonly number[] | undefined,
): PinwheelArmPackageCountDomains {
  return Object.freeze(
    Array.from({ length: 4 }, () =>
      values === undefined ? undefined : Object.freeze([...values]),
    ),
  ) as PinwheelArmPackageCountDomains;
}

function rootArmPackageCountDomains(): PinwheelArmPackageCountDomains {
  return independentArmPackageCountDomains(undefined);
}

function oppositePhase(phase: PinwheelPhase): PinwheelPhase {
  return phase === "lengthwise" ? "crosswise" : "lengthwise";
}

function armSlotId(path: string, role: (typeof ARM_ROLES)[number]): string {
  return `${path}-${role}`;
}

function slot(
  id: string,
  footprintClass: PinwheelPhase,
  packageCounts: readonly number[] | undefined,
): RegionSlotDefinition {
  return Object.freeze({
    id,
    optionalZero: false,
    footprintClasses: Object.freeze([
      footprintClass,
      "square",
    ] as const satisfies readonly RegionFootprintClass[]),
    minimumColumns: 1,
    minimumRows: 1,
    packageCounts,
    spacingX: supportedSpacing,
    spacingY: supportedSpacing,
  });
}

function gridCoreSlot(id: string): RegionSlotDefinition {
  return Object.freeze({
    id,
    optionalZero: false,
    footprintClasses: Object.freeze([
      "lengthwise",
      "crosswise",
      "square",
    ] as const satisfies readonly RegionFootprintClass[]),
    minimumColumns: 1,
    minimumRows: 1,
    packageCounts: undefined,
    spacingX: supportedSpacing,
    spacingY: supportedSpacing,
  });
}

function orderRelation(
  id: string,
  axis: "x" | "y",
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

function appendRootAnchors(
  path: string,
  armSlotIds: PinwheelCycleNode["armSlotIds"],
  chirality: PinwheelChirality,
  relations: RegionRelation[],
): void {
  const [bottom, right, top, left] = armSlotIds;
  const anchors: readonly Readonly<{
    slotId: string;
    sides: readonly [RegionSide, RegionSide];
  }>[] =
    chirality === "clockwise"
      ? [
          { slotId: bottom, sides: ["min-y", "max-x"] },
          { slotId: right, sides: ["max-x", "max-y"] },
          { slotId: top, sides: ["max-y", "min-x"] },
          { slotId: left, sides: ["min-x", "min-y"] },
        ]
      : [
          { slotId: bottom, sides: ["min-y", "min-x"] },
          { slotId: right, sides: ["max-x", "min-y"] },
          { slotId: top, sides: ["max-y", "max-x"] },
          { slotId: left, sides: ["min-x", "max-y"] },
        ];

  for (const { slotId, sides } of anchors) {
    for (const side of sides) {
      relations.push(
        frameAnchor(`${path}-anchor-${slotId}-${side}`, slotId, side),
      );
    }
  }
}

function appendCycleRelations(
  path: string,
  armSlotIds: PinwheelCycleNode["armSlotIds"],
  chirality: PinwheelChirality,
  accumulator: TemplateAccumulator,
): void {
  const [bottom, right, top, left] = armSlotIds;
  const cycleRelations =
    chirality === "clockwise"
      ? [
          orderRelation(`${path}-seam-left-bottom`, "x", left, bottom),
          orderRelation(`${path}-seam-bottom-right`, "y", bottom, right),
          orderRelation(`${path}-seam-top-right`, "x", top, right),
          orderRelation(`${path}-seam-left-top`, "y", left, top),
        ]
      : [
          orderRelation(`${path}-seam-bottom-right`, "x", bottom, right),
          orderRelation(`${path}-seam-right-top`, "y", right, top),
          orderRelation(`${path}-seam-left-top`, "x", left, top),
          orderRelation(`${path}-seam-bottom-left`, "y", bottom, left),
        ];
  accumulator.relations.push(...cycleRelations);

  // A degree-two cycle has a unique local rotation system. Its directed
  // embedding is carried by the recursive witness chirality instead of a
  // redundant per-arm edge order.
}

function appendCycle(
  spec: PinwheelCycleSpec,
  path: string,
  accumulator: TemplateAccumulator,
): PinwheelCycleNode {
  const armSlotIds = Object.freeze(
    ARM_ROLES.map((role) => armSlotId(path, role)),
  ) as PinwheelCycleNode["armSlotIds"];
  const secondaryPhase = oppositePhase(spec.phase);
  accumulator.slots.push(
    slot(armSlotIds[0], spec.phase, spec.armPackageCountDomains[0]),
    slot(armSlotIds[1], secondaryPhase, spec.armPackageCountDomains[1]),
    slot(armSlotIds[2], spec.phase, spec.armPackageCountDomains[2]),
    slot(armSlotIds[3], secondaryPhase, spec.armPackageCountDomains[3]),
  );
  appendCycleRelations(path, armSlotIds, spec.chirality, accumulator);

  const core = (() => {
    if (spec.core.kind === "empty") {
      return Object.freeze({ kind: "empty" as const });
    }
    if (spec.core.kind === "grid") {
      const slotId = `${path}-core-grid`;
      accumulator.slots.push(gridCoreSlot(slotId));
      return Object.freeze({ kind: "grid" as const, slotId });
    }
    return Object.freeze({
      kind: "cycle" as const,
      cycle: appendCycle(spec.core.cycle, `${path}-core`, accumulator),
    });
  })();
  return Object.freeze({
    armSlotIds,
    chirality: spec.chirality,
    residualAnchorSlotId: armSlotIds[0],
    core,
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

function exactDepthSpecs(
  depth: number,
  coreArmPackageCounts: readonly number[],
  armPackageCountDomains: PinwheelArmPackageCountDomains = rootArmPackageCountDomains(),
): readonly PinwheelCycleSpec[] {
  const cores: readonly PinwheelCoreSpec[] =
    depth === 0
      ? [Object.freeze({ kind: "empty" as const })]
      : exactDepthSpecs(
          depth - 1,
          coreArmPackageCounts,
          independentArmPackageCountDomains(coreArmPackageCounts),
        ).map((cycle) => Object.freeze({ kind: "cycle" as const, cycle }));
  const specs: PinwheelCycleSpec[] = [];
  for (const phase of PINWHEEL_PHASES) {
    for (const chirality of PINWHEEL_CHIRALITIES) {
      for (const core of cores) {
        specs.push(
          Object.freeze({
            phase,
            chirality,
            armPackageCountDomains,
            core,
          }),
        );
      }
    }
  }
  return Object.freeze(specs);
}

function gridCoreSpecs(): readonly PinwheelCycleSpec[] {
  const specs: PinwheelCycleSpec[] = [];
  for (const phase of PINWHEEL_PHASES) {
    for (const chirality of PINWHEEL_CHIRALITIES) {
      specs.push(
        Object.freeze({
          phase,
          chirality,
          armPackageCountDomains: independentArmPackageCountDomains(undefined),
          core: Object.freeze({ kind: "grid" as const }),
        }),
      );
    }
  }
  return Object.freeze(specs);
}

function specKey(spec: PinwheelCycleSpec): string {
  const own = `${spec.phase}-${spec.chirality}`;
  if (spec.core.kind === "empty") return own;
  if (spec.core.kind === "grid") return `${own}/grid`;
  return `${own}/${specKey(spec.core.cycle)}`;
}

function createPinwheelTemplate(
  depth: number,
  spec: PinwheelCycleSpec,
): RegionGraphTemplate {
  const accumulator: TemplateAccumulator = {
    slots: [],
    relations: [],
    rotationSystem: [],
  };
  const root = appendCycle(spec, "root", accumulator);
  appendRootAnchors(
    "root",
    root.armSlotIds,
    root.chirality,
    accumulator.relations,
  );
  const slots = Object.freeze(accumulator.slots);
  return Object.freeze({
    templateKey: `pinwheel-v1:d${depth}:${specKey(spec)}`,
    claimedFamily: "pinwheel",
    definitionVersion: 1,
    slots,
    relations: Object.freeze(accumulator.relations),
    embedding: Object.freeze({
      rotationSystem: Object.freeze(accumulator.rotationSystem),
    }),
    automorphisms: Object.freeze([identityAutomorphism(slots)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness: Object.freeze({ kind: "four-arm-cycle", root }),
  });
}

export function buildPinwheelTopologyTemplates(
  limits: PinwheelTopologyCatalogLimits,
): readonly RegionGraphTemplate[] {
  if (typeof limits !== "object" || limits === null) {
    throw new TypeError("Pinwheel topology catalog limits must be an object.");
  }
  const maxCoreDepth = assertNonNegativeSafeInteger(
    limits.maxCoreDepth,
    "limits.maxCoreDepth",
  );
  if (maxCoreDepth > MAX_PINWHEEL_CORE_DEPTH) {
    throw new RangeError(
      `limits.maxCoreDepth must not exceed ${MAX_PINWHEEL_CORE_DEPTH}.`,
    );
  }

  const coreArmPackageCounts = normalizedCoreArmPackageCounts(
    limits.coreArmPackageCounts,
  );
  const templates: RegionGraphTemplate[] = [];
  for (let depth = 0; depth <= maxCoreDepth; depth += 1) {
    const specs =
      depth === 0 && limits.includeGridCore !== false
        ? [...exactDepthSpecs(depth, coreArmPackageCounts), ...gridCoreSpecs()]
        : exactDepthSpecs(depth, coreArmPackageCounts);
    for (const spec of specs) {
      templates.push(createPinwheelTemplate(depth, spec));
    }
  }
  return Object.freeze(templates);
}
