import { z } from "zod";

/** Compatibility version used by the existing ProjectV2 fixtures and adapters. */
export const PROJECT_SCHEMA_VERSION = 2 as const;
/** Canonical version persisted by the planning repository. */
export const CURRENT_PROJECT_SCHEMA_VERSION = 3 as const;

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const positiveNumber = finiteNumber.positive();
export const projectIdSchema = z.string().trim().min(1).max(200);
const optionalReferenceSchema = projectIdSchema.nullable();

export const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const dimensionsMmSchema = z
  .object({
    length: positiveNumber,
    width: positiveNumber,
    height: positiveNumber,
  })
  .strict();

export const palletizingDirectionSchema = z.enum([
  "x-positive-y-positive",
  "x-positive-y-negative",
  "x-negative-y-positive",
  "x-negative-y-negative",
]);

export const projectGripSchema = z
  .object({
    id: projectIdSchema,
    /** Stable editor-visible identity; execution order is stored separately. */
    groupNumber: z.number().int().positive().optional(),
    pickX: finiteNumber,
    pickY: finiteNumber,
    pickRotation: rotationSchema,
    x: finiteNumber,
    y: finiteNumber,
    rotation: rotationSchema,
    numPackages: z.number().int().positive(),
    dx: finiteNumber,
    dy: finiteNumber,
  })
  .strict();

export const packageSpecSchema = z
  .object({
    shape: z.enum(["cuboid", "round"]),
    dimensionsMm: dimensionsMmSchema,
    weightKg: nonNegativeNumber.nullable(),
    clearanceMm: nonNegativeNumber,
    multiPickAllowed: z.boolean(),
    inletOrientation: z.enum(["lengthwise", "crosswise"]),
    palletizingDirection: palletizingDirectionSchema.nullable(),
    labelSidesAtPickup: z.array(z.enum(["top", "right", "bottom", "left"])),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.labelSidesAtPickup).size !== value.labelSidesAtPickup.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["labelSidesAtPickup"],
        message: "must not contain duplicate sides",
      });
    }
  });

export const palletSpecSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["euro", "industrial", "custom"]),
    dimensionsMm: dimensionsMmSchema,
    storageEnvelopeMm: dimensionsMmSchema.nullable(),
    /** Signed allowance per side: positive is overhang, negative is underhang. */
    allowedOverhangMm: z
      .object({
        length: finiteNumber,
        width: finiteNumber,
      })
      .strict(),
    tareKg: nonNegativeNumber.nullable(),
    maxGrossKg: positiveNumber.nullable(),
    subPalletPattern: z.enum(["none", "quarter", "half"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.tareKg !== null &&
      value.maxGrossKg !== null &&
      value.maxGrossKg < value.tareKg
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxGrossKg"],
        message: "must be greater than or equal to tareKg",
      });
    }

    const loadLength =
      value.dimensionsMm.length + value.allowedOverhangMm.length * 2;
    const loadWidth =
      value.dimensionsMm.width + value.allowedOverhangMm.width * 2;
    if (loadLength <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOverhangMm", "length"],
        message: "underhang leaves no usable load length",
      });
    }
    if (loadWidth <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOverhangMm", "width"],
        message: "underhang leaves no usable load width",
      });
    }

    if (value.storageEnvelopeMm) {
      if (value.storageEnvelopeMm.length < loadLength) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storageEnvelopeMm", "length"],
          message: "must contain the allowed load length",
        });
      }
      if (value.storageEnvelopeMm.width < loadWidth) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storageEnvelopeMm", "width"],
          message: "must contain the allowed load width",
        });
      }
      if (value.storageEnvelopeMm.height < value.dimensionsMm.height) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storageEnvelopeMm", "height"],
          message: "must be at least the pallet height",
        });
      }
    }
  });

const tcpSchema = z
  .object({ x: finiteNumber, y: finiteNumber, z: finiteNumber })
  .strict();

const horizontalEnvelopeSchema = z
  .object({
    negativeX: nonNegativeNumber,
    positiveX: nonNegativeNumber,
    negativeY: nonNegativeNumber,
    positiveY: nonNegativeNumber,
  })
  .strict();

const dimensionRangeSchema = z
  .object({ min: nonNegativeNumber, max: positiveNumber })
  .strict()
  .superRefine((value, context) => {
    if (value.max < value.min) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "must be greater than or equal to min",
      });
    }
  });

const stationRadiusRangeSchema = z
  .object({ min: nonNegativeNumber, max: nonNegativeNumber })
  .strict()
  .superRefine((value, context) => {
    if (value.max < value.min) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["max"],
        message: "must be greater than or equal to min",
      });
    }
  });

const packageLimitsSchema = z
  .object({
    lengthMm: dimensionRangeSchema,
    widthMm: dimensionRangeSchema,
    heightMm: dimensionRangeSchema,
  })
  .strict();

const gripperTypeSettingsSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("suction"),
      multipickSinglePlace: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("clamp"),
      allowedPickPositions: z.array(
        z.enum([
          "0-left",
          "0-center",
          "0-right",
          "180-left",
          "180-center",
          "180-right",
        ]),
      ),
      packageOverhangMm: nonNegativeNumber,
      maxOverhangMm: nonNegativeNumber,
      flapLengthMm: nonNegativeNumber,
    })
    .strict(),
  z
    .object({
      type: z.literal("fork"),
      tineSpacingMm: nonNegativeNumber,
      tineWidthMm: positiveNumber,
      tineCount: z.number().int().positive(),
      firstTineOffsetMm: finiteNumber,
      depthMm: positiveNumber,
      maxOverhangMm: nonNegativeNumber,
      movableTines: z.boolean(),
      allowedPickRotations: z.array(z.union([z.literal(0), z.literal(180)])),
    })
    .strict(),
]);

export const gripperSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    externalId: z.string().trim().max(200).nullable(),
    isDefault: z.boolean(),
    maxPickupLengthMm: positiveNumber.nullable(),
    tcpMm: tcpSchema,
    envelopeMm: horizontalEnvelopeSchema,
    inletOrientation: z.enum(["any", "lengthwise", "crosswise"]),
    allowedPlaceRotations: z.array(rotationSchema).min(1),
    packageLimits: packageLimitsSchema.nullable(),
    settings: gripperTypeSettingsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.allowedPlaceRotations).size !==
      value.allowedPlaceRotations.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedPlaceRotations"],
        message: "must not contain duplicate rotations",
      });
    }
  });

export const palletStationSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    externalId: z.string().trim().max(200).nullable(),
    isDefault: z.boolean(),
    palletOrigin: z
      .object({
        x: z.enum(["left", "center", "right"]),
        y: z.enum(["bottom", "center", "top"]),
      })
      .strict(),
    obstacleEnvelopeMm: horizontalEnvelopeSchema,
    tcpEnvelopeMm: horizontalEnvelopeSchema,
    allowedDirections: z.array(palletizingDirectionSchema).min(1),
    preferredDirection: palletizingDirectionSchema,
    robotCenterMm: z.object({ x: finiteNumber, y: finiteNumber }).strict(),
    robotRadiusMm: stationRadiusRangeSchema,
    inletAlignment: z.enum(["left", "center", "right"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.allowedDirections).size !== value.allowedDirections.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedDirections"],
        message: "must not contain duplicate directions",
      });
    }
    if (!value.allowedDirections.includes(value.preferredDirection)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferredDirection"],
        message: "must be one of allowedDirections",
      });
    }
  });

/** ProjectV2 layer pattern retained verbatim for fixture and adapter compatibility. */
export const layerPatternSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    grips: z.array(projectGripSchema),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIdIssues(value.grips, context, ["grips"]);
    addDuplicateValueIssues(
      value.grips.flatMap(({ groupNumber }) =>
        groupNumber === undefined ? [] : [groupNumber],
      ),
      context,
      ["grips"],
      "grip group number",
    );
  });

const projectV2StackLayerSchema = z
  .object({
    id: projectIdSchema,
    patternId: projectIdSchema,
    interlayerBefore: z.number().int().nonnegative(),
  })
  .strict();

const projectV2LayerStackSchema = z
  .object({
    interlayerThicknessMm: positiveNumber,
    layers: z.array(projectV2StackLayerSchema),
    trailingInterlayer: z.number().int().nonnegative(),
  })
  .strict();

export const stackLayerSchema = z
  .object({
    id: projectIdSchema,
    patternId: projectIdSchema,
    interlayerBefore: z.number().int().nonnegative(),
    /** Exact thickness for sheets before this layer; shared thickness is the fallback. */
    interlayerThicknessMm: positiveNumber.optional(),
  })
  .strict();

export const layerStackSchema = z
  .object({
    /** Compatibility fallback for ProjectV2 and boundaries without an override. */
    interlayerThicknessMm: positiveNumber,
    layers: z.array(stackLayerSchema),
    trailingInterlayer: z.number().int().nonnegative(),
    /** Exact deck-sheet thickness; shared thickness is the fallback. */
    trailingInterlayerThicknessMm: positiveNumber.optional(),
  })
  .strict();

export const projectSolutionSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    origin: z.enum(["imported", "calculated", "manual"]),
    patterns: z.array(layerPatternSchema),
    stack: projectV2LayerStackSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIdIssues(value.patterns, context, ["patterns"]);
    addDuplicateIdIssues(value.stack.layers, context, ["stack", "layers"]);
    addStackReferenceIssues(value.patterns, value.stack.layers, context);
  });

export const projectSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }).strict(),
  z
    .object({
      kind: z.literal("rob-import"),
      fileName: z.string().trim().min(1),
      rawRobText: z.string().min(1).optional(),
      originalRawText: z.string().min(1).optional(),
    })
    .strict(),
]);

function addDuplicateIdIssues(
  values: readonly { id: string }[],
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  values.forEach(({ id }, index) => {
    if (seen.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "id"],
        message: `duplicate id "${id}"`,
      });
    }
    seen.add(id);
  });
}

function addDuplicateValueIssues(
  values: readonly (string | number)[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string | number>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: `duplicate ${label} "${value}"`,
      });
    }
    seen.add(value);
  });
}

function addStackReferenceIssues(
  patterns: readonly { id: string }[],
  layers: readonly { patternId: string }[],
  context: z.RefinementCtx,
): void {
  const patternIds = new Set(patterns.map(({ id }) => id));
  layers.forEach((layer, index) => {
    if (!patternIds.has(layer.patternId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stack", "layers", index, "patternId"],
        message: "references a missing layer pattern",
      });
    }
  });
}

function addProjectReferenceIssues(
  value: {
    createdAt: number;
    updatedAt: number;
    grippers: readonly { id: string }[];
    palletStations: readonly { id: string }[];
    selectedGripperId: string | null;
    selectedPalletStationId: string | null;
    solutions: readonly { id: string }[];
    activeSolutionId: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (value.updatedAt < value.createdAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["updatedAt"],
      message: "must be greater than or equal to createdAt",
    });
  }

  addDuplicateIdIssues(value.grippers, context, ["grippers"]);
  addDuplicateIdIssues(value.palletStations, context, ["palletStations"]);
  addDuplicateIdIssues(value.solutions, context, ["solutions"]);

  const gripperIds = new Set(value.grippers.map(({ id }) => id));
  if (
    value.selectedGripperId !== null &&
    !gripperIds.has(value.selectedGripperId)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedGripperId"],
      message: "references a missing gripper",
    });
  }

  const stationIds = new Set(value.palletStations.map(({ id }) => id));
  if (
    value.selectedPalletStationId !== null &&
    !stationIds.has(value.selectedPalletStationId)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedPalletStationId"],
      message: "references a missing pallet station",
    });
  }

  const solutionIds = new Set(value.solutions.map(({ id }) => id));
  if (
    value.activeSolutionId !== null &&
    !solutionIds.has(value.activeSolutionId)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["activeSolutionId"],
      message: "references a missing solution",
    });
  }
}

export const projectV2Schema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    id: projectIdSchema,
    projectNumber: z.string().trim().max(200),
    productNumber: z.string().trim().max(200),
    createdAt: nonNegativeNumber,
    updatedAt: nonNegativeNumber,
    source: projectSourceSchema,
    package: packageSpecSchema,
    pallet: palletSpecSchema.nullable(),
    grippers: z.array(gripperSchema),
    palletStations: z.array(palletStationSchema),
    selectedGripperId: optionalReferenceSchema,
    selectedPalletStationId: optionalReferenceSchema,
    solutions: z.array(projectSolutionSchema),
    activeSolutionId: optionalReferenceSchema,
  })
  .strict()
  .superRefine(addProjectReferenceIssues);

const placementLabelSchema = z
  .enum([
    "top",
    "right",
    "bottom",
    "left",
    "top_right",
    "bottom_right",
    "bottom_left",
    "top_left",
  ])
  .nullable();

/** One physical package center in a reusable layer pattern. */
export const packagePlacementSchema = z
  .object({
    id: projectIdSchema,
    sequence: z.number().int().nonnegative(),
    positionMm: z.object({ x: finiteNumber, y: finiteNumber }).strict(),
    rotation: rotationSchema,
    gripId: optionalReferenceSchema,
    labelSide: placementLabelSchema,
  })
  .strict();

export const patternOrderDependencySchema = z
  .object({
    beforeGripId: projectIdSchema,
    afterGripId: projectIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.beforeGripId === value.afterGripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["afterGripId"],
        message: "must differ from beforeGripId",
      });
    }
  });

export const planningLayerPatternSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    /** Compatibility representation used by the existing .rob adapter/editor. */
    grips: z.array(projectGripSchema),
    placements: z.array(packagePlacementSchema),
    /** Stable grip ids in editable execution order; group numbers never change here. */
    groupOrder: z.array(projectIdSchema).optional(),
    orderDependencies: z.array(patternOrderDependencySchema).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIdIssues(value.grips, context, ["grips"]);
    addDuplicateIdIssues(value.placements, context, ["placements"]);
    addDuplicateValueIssues(
      value.grips.flatMap(({ groupNumber }) =>
        groupNumber === undefined ? [] : [groupNumber],
      ),
      context,
      ["grips"],
      "grip group number",
    );
    addDuplicateValueIssues(
      value.placements.map(({ sequence }) => sequence),
      context,
      ["placements"],
      "placement sequence",
    );

    const gripsById = new Map(value.grips.map((grip) => [grip.id, grip]));
    const placementCounts = new Map<string, number>();
    value.placements.forEach((placement, index) => {
      if (placement.gripId === null) return;
      if (!gripsById.has(placement.gripId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["placements", index, "gripId"],
          message: "references a missing grip",
        });
        return;
      }
      placementCounts.set(
        placement.gripId,
        (placementCounts.get(placement.gripId) ?? 0) + 1,
      );
    });

    value.grips.forEach((grip, index) => {
      if ((placementCounts.get(grip.id) ?? 0) !== grip.numPackages) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["grips", index, "numPackages"],
          message: "must match the number of referenced package placements",
        });
      }
    });

    if (value.groupOrder) {
      addDuplicateValueIssues(
        value.groupOrder,
        context,
        ["groupOrder"],
        "grip order reference",
      );
      value.groupOrder.forEach((gripId, index) => {
        if (gripsById.has(gripId)) return;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupOrder", index],
          message: "references a missing grip",
        });
      });
    }

    const dependencyKeys = new Set<string>();
    value.orderDependencies?.forEach((dependency, index) => {
      const key = `${dependency.beforeGripId}::${dependency.afterGripId}`;
      if (dependencyKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orderDependencies", index],
          message: "duplicates an order dependency",
        });
      }
      dependencyKeys.add(key);
      for (const field of ["beforeGripId", "afterGripId"] as const) {
        if (gripsById.has(dependency[field])) continue;
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orderDependencies", index, field],
          message: "references a missing grip",
        });
      }
    });
  });

export const robotPoseSchema = z
  .object({
    x: finiteNumber,
    y: finiteNumber,
    z: finiteNumber.nullable(),
    rotation: rotationSchema,
  })
  .strict();

/** A deterministic pick/place action for one grip in one layer pattern. */
export const robotCycleSchema = z
  .object({
    id: projectIdSchema,
    patternId: projectIdSchema,
    sequence: z.number().int().nonnegative(),
    gripId: optionalReferenceSchema,
    placementIds: z.array(projectIdSchema).min(1),
    gripperId: optionalReferenceSchema,
    pickPose: robotPoseSchema,
    placePose: robotPoseSchema,
    labelOffset: z.object({ x: finiteNumber, y: finiteNumber }).strict(),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateValueIssues(
      value.placementIds,
      context,
      ["placementIds"],
      "package placement reference",
    );
  });

export const planningSolutionSchema = z
  .object({
    id: projectIdSchema,
    name: z.string().trim().min(1).max(200),
    origin: z.enum(["imported", "calculated", "manual"]),
    patterns: z.array(planningLayerPatternSchema),
    stack: layerStackSchema,
    robotCycles: z.array(robotCycleSchema),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIdIssues(value.patterns, context, ["patterns"]);
    addDuplicateIdIssues(value.stack.layers, context, ["stack", "layers"]);
    addDuplicateIdIssues(value.robotCycles, context, ["robotCycles"]);
    addStackReferenceIssues(value.patterns, value.stack.layers, context);

    const patternById = new Map(
      value.patterns.map((pattern) => [pattern.id, pattern]),
    );
    const assignedPlacements = new Set<string>();
    const sequenceKeys = new Set<string>();

    value.robotCycles.forEach((cycle, cycleIndex) => {
      const pattern = patternById.get(cycle.patternId);
      if (!pattern) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["robotCycles", cycleIndex, "patternId"],
          message: "references a missing layer pattern",
        });
        return;
      }

      const sequenceKey = `${cycle.patternId}::${cycle.sequence}`;
      if (sequenceKeys.has(sequenceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["robotCycles", cycleIndex, "sequence"],
          message: "duplicates a robot-cycle sequence in this pattern",
        });
      }
      sequenceKeys.add(sequenceKey);

      const gripsById = new Set(pattern.grips.map(({ id }) => id));
      if (cycle.gripId !== null && !gripsById.has(cycle.gripId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["robotCycles", cycleIndex, "gripId"],
          message: "references a missing grip in the cycle pattern",
        });
      }

      const placementsById = new Map(
        pattern.placements.map((placement) => [placement.id, placement]),
      );
      cycle.placementIds.forEach((placementId, placementIndex) => {
        const placement = placementsById.get(placementId);
        if (!placement) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["robotCycles", cycleIndex, "placementIds", placementIndex],
            message: "references a missing placement in the cycle pattern",
          });
          return;
        }
        if (cycle.gripId !== null && placement.gripId !== cycle.gripId) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["robotCycles", cycleIndex, "placementIds", placementIndex],
            message: "does not belong to the referenced cycle grip",
          });
        }
        const assignmentKey = `${cycle.patternId}::${placementId}`;
        if (assignedPlacements.has(assignmentKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["robotCycles", cycleIndex, "placementIds", placementIndex],
            message: "is already assigned to another robot cycle",
          });
        }
        assignedPlacements.add(assignmentKey);
      });
    });
  });

/** Latest canonical planning project. ProjectV2 is migrated explicitly to this schema. */
export const projectSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
    id: projectIdSchema,
    projectNumber: z.string().trim().max(200),
    productNumber: z.string().trim().max(200),
    createdAt: nonNegativeNumber,
    updatedAt: nonNegativeNumber,
    source: projectSourceSchema,
    package: packageSpecSchema,
    pallet: palletSpecSchema.nullable(),
    grippers: z.array(gripperSchema),
    palletStations: z.array(palletStationSchema),
    selectedGripperId: optionalReferenceSchema,
    selectedPalletStationId: optionalReferenceSchema,
    solutions: z.array(planningSolutionSchema),
    activeSolutionId: optionalReferenceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    addProjectReferenceIssues(value, context);
    const gripperIds = new Set(value.grippers.map(({ id }) => id));
    value.solutions.forEach((solution, solutionIndex) => {
      solution.robotCycles.forEach((cycle, cycleIndex) => {
        if (cycle.gripperId !== null && !gripperIds.has(cycle.gripperId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              "solutions",
              solutionIndex,
              "robotCycles",
              cycleIndex,
              "gripperId",
            ],
            message: "references a missing project gripper",
          });
        }
      });
    });
  });

export type ProjectV2 = z.infer<typeof projectV2Schema>;
export type ProjectSolution = z.infer<typeof projectSolutionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type PlanningSolution = z.infer<typeof planningSolutionSchema>;
export type PackagePlacement = z.infer<typeof packagePlacementSchema>;
export type LayerPattern = z.infer<typeof planningLayerPatternSchema>;
export type PatternOrderDependency = z.infer<
  typeof patternOrderDependencySchema
>;
export type LayerStack = z.infer<typeof layerStackSchema>;
export type RobotCycle = z.infer<typeof robotCycleSchema>;
export type PackageSpec = z.infer<typeof packageSpecSchema>;
export type PalletSpec = z.infer<typeof palletSpecSchema>;
export type Gripper = z.infer<typeof gripperSchema>;
export type PalletStation = z.infer<typeof palletStationSchema>;
export type PalletizingDirection = z.infer<typeof palletizingDirectionSchema>;
