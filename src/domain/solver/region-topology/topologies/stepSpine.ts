import type {
  RegionAxis,
  RegionFootprintClass,
  RegionGraphTemplate,
  RegionRelation,
  RegionSide,
  RegionSlotDefinition,
  RegionTemplateAutomorphism,
} from "~/domain/solver/region-topology/model";

const STEP_SPINE_PHASES = ["lengthwise", "crosswise"] as const;
export type StepSpinePhase = (typeof STEP_SPINE_PHASES)[number];

const supportedSpacing = Object.freeze([
  "compact",
  "continuous-space-between",
  "integer-balanced",
  "inter-region-seam",
] as const);
const framePolicies = Object.freeze([
  "center-occupied-bounds",
  "fill-generation-bounds",
] as const);

const MAIN_SLOT_ID = "main";
const LONG_BAND_SLOT_ID = "long-band";
const SIDE_STRIP_SLOT_ID = "side-strip";
const CORNER_SLOT_ID = "corner";

function oppositePhase(phase: StepSpinePhase): StepSpinePhase {
  return phase === "lengthwise" ? "crosswise" : "lengthwise";
}

function footprintClasses(
  phase: StepSpinePhase,
): readonly RegionFootprintClass[] {
  return Object.freeze([phase, "square"]);
}

function slot(
  id: string,
  allowedFootprintClasses: readonly RegionFootprintClass[],
  bounds: Readonly<{
    minimumColumns: number;
    minimumRows: number;
    maximumColumns?: number;
    maximumRows?: number;
    packageCounts?: readonly number[];
  }>,
): RegionSlotDefinition {
  return Object.freeze({
    id,
    optionalZero: false,
    footprintClasses: Object.freeze([...allowedFootprintClasses]),
    ...bounds,
    spacingX: supportedSpacing,
    spacingY: supportedSpacing,
  });
}

function slots(mainPhase: StepSpinePhase): readonly RegionSlotDefinition[] {
  const orthogonalPhase = oppositePhase(mainPhase);
  const swappableRoles = Object.freeze([
    mainPhase,
    orthogonalPhase,
    "square",
  ] as const satisfies readonly RegionFootprintClass[]);
  const main = slot(MAIN_SLOT_ID, footprintClasses(mainPhase), {
    minimumColumns: 1,
    minimumRows: 1,
  });
  const longBand = slot(LONG_BAND_SLOT_ID, footprintClasses(orthogonalPhase), {
    minimumColumns: 1,
    minimumRows: 1,
  });
  const sideStrip = slot(SIDE_STRIP_SLOT_ID, swappableRoles, {
    minimumColumns: 1,
    minimumRows: 1,
  });
  const corner = slot(CORNER_SLOT_ID, swappableRoles, {
    minimumColumns: 1,
    maximumColumns: 1,
    minimumRows: 1,
    maximumRows: 1,
    packageCounts: Object.freeze([1]),
  });
  return Object.freeze([main, longBand, sideStrip, corner]);
}

function axisSides(axis: RegionAxis): Readonly<{
  inlineMinimum: RegionSide;
  inlineMaximum: RegionSide;
  crossMinimum: RegionSide;
  crossMaximum: RegionSide;
  crossAxis: RegionAxis;
}> {
  return axis === "x"
    ? {
        inlineMinimum: "min-x",
        inlineMaximum: "max-x",
        crossMinimum: "min-y",
        crossMaximum: "max-y",
        crossAxis: "y",
      }
    : {
        inlineMinimum: "min-y",
        inlineMaximum: "max-y",
        crossMinimum: "min-x",
        crossMaximum: "max-x",
        crossAxis: "x",
      };
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

function contact(
  id: string,
  firstSlotId: string,
  firstSide: RegionSide,
  secondSlotId: string,
  secondSide: RegionSide,
  overlap: "positive" | "equal-span",
): RegionRelation {
  return Object.freeze({
    id,
    kind: "contact",
    first: Object.freeze({ slotId: firstSlotId, side: firstSide }),
    second: Object.freeze({ slotId: secondSlotId, side: secondSide }),
    gap: "residual-seam",
    overlap,
  });
}

function relations(axis: RegionAxis): readonly RegionRelation[] {
  const sides = axisSides(axis);
  return Object.freeze([
    frameAnchor(
      "anchor-side-inline-min",
      SIDE_STRIP_SLOT_ID,
      sides.inlineMinimum,
    ),
    frameAnchor(
      "anchor-corner-inline-min",
      CORNER_SLOT_ID,
      sides.inlineMinimum,
    ),
    frameAnchor("anchor-main-inline-max", MAIN_SLOT_ID, sides.inlineMaximum),
    frameAnchor(
      "anchor-band-inline-max",
      LONG_BAND_SLOT_ID,
      sides.inlineMaximum,
    ),
    frameAnchor(
      "anchor-side-cross-min",
      SIDE_STRIP_SLOT_ID,
      sides.crossMinimum,
    ),
    frameAnchor("anchor-main-cross-min", MAIN_SLOT_ID, sides.crossMinimum),
    frameAnchor("anchor-band-cross-max", LONG_BAND_SLOT_ID, sides.crossMaximum),
    frameAnchor("anchor-corner-cross-max", CORNER_SLOT_ID, sides.crossMaximum),
    order("order-side-main", axis, SIDE_STRIP_SLOT_ID, MAIN_SLOT_ID),
    order("order-corner-band", axis, CORNER_SLOT_ID, LONG_BAND_SLOT_ID),
    order(
      "order-side-corner",
      sides.crossAxis,
      SIDE_STRIP_SLOT_ID,
      CORNER_SLOT_ID,
    ),
    order("order-main-band", sides.crossAxis, MAIN_SLOT_ID, LONG_BAND_SLOT_ID),
    contact(
      "contact-side-main",
      SIDE_STRIP_SLOT_ID,
      sides.inlineMaximum,
      MAIN_SLOT_ID,
      sides.inlineMinimum,
      "positive",
    ),
    contact(
      "contact-corner-band",
      CORNER_SLOT_ID,
      sides.inlineMaximum,
      LONG_BAND_SLOT_ID,
      sides.inlineMinimum,
      "positive",
    ),
    contact(
      "contact-side-corner",
      SIDE_STRIP_SLOT_ID,
      sides.crossMaximum,
      CORNER_SLOT_ID,
      sides.crossMinimum,
      "positive",
    ),
    contact(
      "contact-main-band",
      MAIN_SLOT_ID,
      sides.crossMaximum,
      LONG_BAND_SLOT_ID,
      sides.crossMinimum,
      "positive",
    ),
  ]);
}

function identityAutomorphism(
  definitions: readonly RegionSlotDefinition[],
): RegionTemplateAutomorphism {
  return Object.freeze(
    Object.fromEntries(definitions.map(({ id }) => [id, id])) as Record<
      string,
      string
    >,
  );
}

export function createStepSpineTopologyTemplate(
  axis: RegionAxis,
  mainPhase: StepSpinePhase,
): RegionGraphTemplate {
  if (axis !== "x" && axis !== "y") {
    throw new RangeError('axis must be "x" or "y".');
  }
  if (!STEP_SPINE_PHASES.includes(mainPhase)) {
    throw new RangeError("mainPhase must be a non-square footprint class.");
  }

  const definitions = slots(mainPhase);
  return Object.freeze({
    templateKey: `step-spine-v1:${axis}:${mainPhase}`,
    claimedFamily: "spine-corridor",
    definitionVersion: 1,
    slots: definitions,
    relations: relations(axis),
    embedding: Object.freeze({ rotationSystem: Object.freeze([]) }),
    automorphisms: Object.freeze([identityAutomorphism(definitions)]),
    collapseRules: Object.freeze([]),
    framePolicies,
    witness: Object.freeze({
      kind: "spine-tree",
      axis,
      inlineDirection: 1,
      crossDirection: 1,
      mainSlotId: MAIN_SLOT_ID,
      orderedSpines: Object.freeze([
        Object.freeze({
          spineSlotId: LONG_BAND_SLOT_ID,
          attachmentSlotIds: Object.freeze([
            SIDE_STRIP_SLOT_ID,
            CORNER_SLOT_ID,
          ] as const),
        }),
      ] as const),
    }),
  });
}

export function buildStepSpineTopologyTemplates(): readonly RegionGraphTemplate[] {
  return Object.freeze(
    (["x", "y"] as const).flatMap((axis) =>
      STEP_SPINE_PHASES.map((phase) =>
        createStepSpineTopologyTemplate(axis, phase),
      ),
    ),
  );
}
