import { z } from "zod";
import {
  CANDIDATE_GEOMETRY_EQUALITY_VERSION,
  CANDIDATE_IDENTITY_VERSION,
} from "~/domain/solver/candidateIdentity";
import type { PalletData } from "~/domain/palletTypes";
import { projectSchema, projectV2Schema } from "~/domain/project/projectSchema";
import { parseRobText, serializeRobText } from "~/lib/robParser";

/** Legacy import-only schema retained as a public compatibility contract. */
export const PARITY_GOLDEN_CASE_SCHEMA_VERSION = 1 as const;
/** Current generalized parity corpus schema. */
export const PARITY_CASE_SCHEMA_VERSION = 2 as const;

export const PARITY_EVIDENCE_STATUSES = ["Golden", "Observed", "Open"] as const;
export const parityEvidenceStatusSchema = z.enum(PARITY_EVIDENCE_STATUSES);
export type ParityEvidenceStatus = z.infer<typeof parityEvidenceStatusSchema>;

export const PARITY_SCORECARD_DIMENSIONS = [
  "input",
  "geometry",
  "diversity",
  "ranking",
  "stack",
  "robotics",
  "export",
  "usability",
  "performance",
] as const;
export const parityScorecardDimensionNameSchema = z.enum(
  PARITY_SCORECARD_DIMENSIONS,
);
export type ParityScorecardDimensionName = z.infer<
  typeof parityScorecardDimensionNameSchema
>;

const caseIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const artifactIdSchema = caseIdSchema;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const dimensionsSchema = z
  .object({
    width: z.number().int().positive(),
    length: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const uniqueLayerSummarySchema = z
  .object({
    uniqueLayerId: z.number().int().positive(),
    gripCount: z.number().int().nonnegative(),
    packageCount: z.number().int().nonnegative(),
    gripSizeHistogram: z.array(
      z
        .object({
          packagesPerGrip: z.number().int().positive(),
          gripCount: z.number().int().positive(),
        })
        .strict(),
    ),
    grips: z.array(
      z
        .object({
          pickX: z.number().int(),
          pickY: z.number().int(),
          pickRotation: z.union([
            z.literal(0),
            z.literal(90),
            z.literal(180),
            z.literal(270),
          ]),
          x: z.number().int(),
          y: z.number().int(),
          rotation: z.union([
            z.literal(0),
            z.literal(90),
            z.literal(180),
            z.literal(270),
          ]),
          numPackages: z.number().int().positive(),
          dx: z.number().int(),
          dy: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

export const robPlanSummarySchema = z
  .object({
    pallet: dimensionsSchema.nullable(),
    package: dimensionsSchema,
    inputDirection: z.union([z.literal(0), z.literal(1)]),
    inputDirectionExplicit: z.boolean(),
    uniqueLayerCount: z.number().int().nonnegative(),
    physicalLayerCount: z.number().int().nonnegative(),
    totalPackages: z.number().int().nonnegative(),
    layerPatternIds: z.array(z.number().int().positive()),
    packagesPerPhysicalLayer: z.array(z.number().int().nonnegative()),
    robotCyclesPerPhysicalLayer: z.array(z.number().int().nonnegative()),
    uniqueLayers: z.array(uniqueLayerSummarySchema),
    interlayers: z
      .object({
        underPhysicalLayers: z.array(z.number().int().nonnegative()),
        trailing: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/**
 * Original schema and export name. Keep this strict v1 object unchanged so
 * existing fixtures and consumers do not silently migrate when parsed.
 */
export const parityGoldenCaseSchema = z
  .object({
    schemaVersion: z.literal(PARITY_GOLDEN_CASE_SCHEMA_VERSION),
    id: caseIdSchema,
    title: z.string().min(1),
    source: z
      .object({
        kind: z.literal("anonymized-rob-fixture"),
        fixture: z.string().min(1),
        notes: z.string().min(1).optional(),
      })
      .strict(),
    expected: robPlanSummarySchema,
    requirements: z
      .object({
        semanticRoundTrip: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ParityValue =
  | string
  | number
  | boolean
  | null
  | ParityValue[]
  | { [key: string]: ParityValue };

export const parityValueSchema: z.ZodType<ParityValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(parityValueSchema),
    z.record(parityValueSchema),
  ]),
);

const evidenceObjectSchema = z
  .object({
    status: parityEvidenceStatusSchema,
    asOf: dateSchema,
    basis: z.string().min(1),
    artifactIds: z.array(artifactIdSchema),
  })
  .strict();

function addDuplicateStringIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  const seen = new Set<string>();
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

export const parityEvidenceSchema = evidenceObjectSchema.superRefine(
  (value, context) => {
    addDuplicateStringIssues(
      value.artifactIds,
      context,
      ["artifactIds"],
      "artifact reference",
    );
  },
);

export const parityArtifactReferenceSchema = z
  .object({
    id: artifactIdSchema,
    kind: z.enum([
      "rob-input",
      "rob-export",
      "project-input",
      "candidate-set",
      "screenshot",
      "research-note",
      "other",
    ]),
    availability: z.enum(["repository", "external", "missing"]),
    path: z
      .string()
      .min(1)
      .refine(
        (value) =>
          !value.startsWith("/") &&
          !/^[A-Za-z]:/.test(value) &&
          !value.split("/").includes("..") &&
          !value.includes("\\"),
        "must be a repository-relative POSIX path",
      )
      .optional(),
    mediaType: z.string().min(1).optional(),
    description: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.availability === "repository" && value.path === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "repository artifacts require a path",
      });
    }
    if (value.availability !== "repository" && value.path !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["path"],
        message: "only repository artifacts may declare a path",
      });
    }
  });

const parityProjectInputSchema = z.union([projectV2Schema, projectSchema]);

export const parityCaseInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("rob-import"),
      artifactId: artifactIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("project"),
      project: parityProjectInputSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("described-observation"),
      values: z.record(parityValueSchema),
    })
    .strict(),
]);

const candidateLabelSchema = z.enum([
  "top",
  "right",
  "bottom",
  "left",
  "top_right",
  "bottom_right",
  "bottom_left",
  "top_left",
]);
const candidateRotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const parityCandidatePlacementSchema = z
  .object({
    id: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative().optional(),
    positionMm: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict(),
    rotation: candidateRotationSchema,
    labelSide: candidateLabelSchema.nullable().optional(),
    gripId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const parityCandidateGripSchema = z
  .object({
    id: z.string().min(1),
    sequence: z.number().int().nonnegative().optional(),
    pickX: z.number().finite(),
    pickY: z.number().finite(),
    pickRotation: candidateRotationSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: candidateRotationSchema,
    numPackages: z.number().int().positive(),
    dx: z.number().finite(),
    dy: z.number().finite(),
  })
  .strict();

export const parityCandidateRecordSchema = z
  .object({
    id: z.string().min(1),
    geometryId: z.string().min(1).optional(),
    identityFingerprint: z.string().min(1).optional(),
    geometryFingerprint: z.string().min(1).optional(),
    placements: z.array(parityCandidatePlacementSchema).optional(),
    grips: z.array(parityCandidateGripSchema).optional(),
    metrics: z.record(parityValueSchema).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.grips) {
      addDuplicateStringIssues(
        value.grips.map(({ id }) => id),
        context,
        ["grips"],
        "grip id",
      );
    }
  });

export const parityCandidateSetValueSchema = z
  .object({
    /** null records that the source identity semantics are not known. */
    identitySchemaVersion: z.literal(CANDIDATE_IDENTITY_VERSION).nullable(),
    /** null records that source geometric deduplication is not known. */
    geometryEqualitySchemaVersion: z
      .literal(CANDIDATE_GEOMETRY_EQUALITY_VERSION)
      .nullable(),
    totalCandidates: z.number().int().nonnegative().optional(),
    orderedCandidateIds: z.array(z.string().min(1)).optional(),
    candidates: z.array(parityCandidateRecordSchema).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.totalCandidates === undefined &&
      value.orderedCandidateIds === undefined &&
      value.candidates === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "candidate expectations require at least one expected value",
      });
    }
    if (value.orderedCandidateIds) {
      addDuplicateStringIssues(
        value.orderedCandidateIds,
        context,
        ["orderedCandidateIds"],
        "ordered candidate id",
      );
    }
    if (value.candidates) {
      addDuplicateStringIssues(
        value.candidates.map(({ id }) => id),
        context,
        ["candidates"],
        "candidate id",
      );
    }
  });

export const parityCandidateExpectationSchema = z
  .object({
    evidence: parityEvidenceSchema,
    value: parityCandidateSetValueSchema,
  })
  .strict();

export const parityMetricExpectationSchema = z
  .object({
    evidence: parityEvidenceSchema,
    value: parityValueSchema.optional(),
    unit: z.string().min(1).optional(),
    tolerance: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidence.status !== "Open" && value.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Golden and Observed metrics require an expected value",
      });
    }
    if (value.tolerance !== undefined && typeof value.value !== "number") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tolerance"],
        message: "tolerance is only valid for numeric metrics",
      });
    }
  });

export const parityImportExpectationSchema = z
  .object({
    evidence: parityEvidenceSchema,
    summary: robPlanSummarySchema,
    semanticRoundTrip: z.boolean().optional(),
  })
  .strict();

const scorecardDimensionSchema = evidenceObjectSchema
  .extend({ applicable: z.boolean() })
  .superRefine((value, context) => {
    addDuplicateStringIssues(
      value.artifactIds,
      context,
      ["artifactIds"],
      "artifact reference",
    );
    if (!value.applicable && value.status !== "Open") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "non-applicable dimensions must use Open status",
      });
    }
  });

export const parityScorecardSchema = z
  .object({
    input: scorecardDimensionSchema,
    geometry: scorecardDimensionSchema,
    diversity: scorecardDimensionSchema,
    ranking: scorecardDimensionSchema,
    stack: scorecardDimensionSchema,
    robotics: scorecardDimensionSchema,
    export: scorecardDimensionSchema,
    usability: scorecardDimensionSchema,
    performance: scorecardDimensionSchema,
  })
  .strict();

export const parityCaseV2Schema = z
  .object({
    schemaVersion: z.literal(PARITY_CASE_SCHEMA_VERSION),
    id: caseIdSchema,
    title: z.string().min(1),
    provenance: z
      .object({
        kind: z.enum(["synthetic", "anonymized", "observed"]),
        description: z.string().min(1),
        system: z.string().min(1).optional(),
      })
      .strict(),
    artifacts: z.array(parityArtifactReferenceSchema),
    input: parityCaseInputSchema,
    expected: z
      .object({
        importBaseline: parityImportExpectationSchema.optional(),
        candidates: parityCandidateExpectationSchema.optional(),
        metrics: z.record(parityMetricExpectationSchema).optional(),
      })
      .strict(),
    scorecard: parityScorecardSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const artifactIds = value.artifacts.map(({ id }) => id);
    addDuplicateStringIssues(
      artifactIds,
      context,
      ["artifacts"],
      "artifact id",
    );
    const availableArtifactIds = new Set(artifactIds);

    const evidenceEntries: Array<{
      evidence: z.infer<typeof parityEvidenceSchema>;
      path: (string | number)[];
    }> = [];
    if (value.expected.importBaseline) {
      evidenceEntries.push({
        evidence: value.expected.importBaseline.evidence,
        path: ["expected", "importBaseline", "evidence", "artifactIds"],
      });
    }
    if (value.expected.candidates) {
      evidenceEntries.push({
        evidence: value.expected.candidates.evidence,
        path: ["expected", "candidates", "evidence", "artifactIds"],
      });
    }
    for (const [metricName, metric] of Object.entries(
      value.expected.metrics ?? {},
    )) {
      evidenceEntries.push({
        evidence: metric.evidence,
        path: ["expected", "metrics", metricName, "evidence", "artifactIds"],
      });
    }
    for (const dimension of PARITY_SCORECARD_DIMENSIONS) {
      evidenceEntries.push({
        evidence: value.scorecard[dimension],
        path: ["scorecard", dimension, "artifactIds"],
      });
    }

    for (const { evidence, path } of evidenceEntries) {
      evidence.artifactIds.forEach((artifactId, index) => {
        if (!availableArtifactIds.has(artifactId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, index],
            message: `references missing artifact "${artifactId}"`,
          });
        }
      });
    }

    if (
      value.input.kind === "rob-import" &&
      !availableArtifactIds.has(value.input.artifactId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input", "artifactId"],
        message: `references missing artifact "${value.input.artifactId}"`,
      });
    }

    if (
      value.expected.importBaseline === undefined &&
      value.expected.candidates === undefined &&
      Object.keys(value.expected.metrics ?? {}).length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected"],
        message: "a parity case requires at least one expectation",
      });
    }
  });

/** Accepts both the exact legacy contract and the generalized v2 contract. */
export const parityCaseSchema = z.union([
  parityGoldenCaseSchema,
  parityCaseV2Schema,
]);

export type RobPlanSummary = z.infer<typeof robPlanSummarySchema>;
export type ParityGoldenCase = z.infer<typeof parityGoldenCaseSchema>;
export type ParityCaseV2 = z.infer<typeof parityCaseV2Schema>;
export type ParityCase = z.infer<typeof parityCaseSchema>;
export type ParityCandidateSetValue = z.infer<
  typeof parityCandidateSetValueSchema
>;

export type ParityMismatch = {
  path: string;
  expected: unknown;
  actual: unknown;
};

export type RobGoldenCaseResult = {
  goldenCase: ParityGoldenCase;
  actual: RobPlanSummary;
  mismatches: ParityMismatch[];
  semanticRoundTripMatches: boolean;
};

export function summarizeRobPlan(data: PalletData): RobPlanSummary {
  const uniqueLayers = Object.entries(data.uniqueLayers)
    .map(([id, grips]) => {
      const sizeCounts = new Map<number, number>();
      for (const grip of grips) {
        sizeCounts.set(
          grip.numPackages,
          (sizeCounts.get(grip.numPackages) ?? 0) + 1,
        );
      }
      return {
        uniqueLayerId: Number(id),
        gripCount: grips.length,
        packageCount: grips.reduce(
          (sum, grip) => sum + Math.max(0, grip.numPackages),
          0,
        ),
        gripSizeHistogram: [...sizeCounts.entries()]
          .map(([packagesPerGrip, gripCount]) => ({
            packagesPerGrip,
            gripCount,
          }))
          .sort((a, b) => a.packagesPerGrip - b.packagesPerGrip),
        grips: grips.map(({ id: _id, rawLead: _rawLead, ...grip }) => grip),
      };
    })
    .filter(({ uniqueLayerId }) => Number.isInteger(uniqueLayerId))
    .sort((a, b) => a.uniqueLayerId - b.uniqueLayerId);

  const cyclesByUniqueLayer = new Map(
    uniqueLayers.map(({ uniqueLayerId, gripCount }) => [
      uniqueLayerId,
      gripCount,
    ]),
  );

  return {
    pallet: data.pallet,
    package: data.package,
    inputDirection: data.inputDirection,
    inputDirectionExplicit: data.inputDirectionExplicit ?? false,
    uniqueLayerCount: uniqueLayers.length,
    physicalLayerCount: data.layer_count,
    totalPackages: data.total_boxes,
    layerPatternIds: data.layers.map((layer) => layer.unique_layer_id),
    packagesPerPhysicalLayer: data.layers.map((layer) => layer.boxes.length),
    robotCyclesPerPhysicalLayer: data.layers.map(
      (layer) => cyclesByUniqueLayer.get(layer.unique_layer_id) ?? 0,
    ),
    uniqueLayers,
    interlayers: {
      underPhysicalLayers: data.layers.map((layer) => layer.zwischenlage),
      trailing: data.trailingZwischenlage ?? 0,
    },
  };
}

function semanticPlanValue(data: PalletData) {
  return summarizeRobPlan(data);
}

export function semanticRobPlanFingerprint(data: PalletData): string {
  return JSON.stringify(semanticPlanValue(data));
}

function appendMismatches(
  expected: unknown,
  actual: unknown,
  path: string,
  mismatches: ParityMismatch[],
): void {
  if (Object.is(expected, actual)) return;

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      appendMismatches(
        expected[index],
        actual[index],
        `${path}[${index}]`,
        mismatches,
      );
    }
    return;
  }

  if (
    typeof expected === "object" &&
    expected !== null &&
    !Array.isArray(expected) &&
    typeof actual === "object" &&
    actual !== null &&
    !Array.isArray(actual)
  ) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = new Set([
      ...Object.keys(expectedRecord),
      ...Object.keys(actualRecord),
    ]);
    for (const key of keys) {
      appendMismatches(
        expectedRecord[key],
        actualRecord[key],
        path === "" ? key : `${path}.${key}`,
        mismatches,
      );
    }
    return;
  }

  mismatches.push({ path, expected, actual });
}

/** Public exact, symmetric comparison used by import and corpus diagnostics. */
export function collectParityMismatches(
  expected: unknown,
  actual: unknown,
  path = "",
): ParityMismatch[] {
  const mismatches: ParityMismatch[] = [];
  appendMismatches(expected, actual, path, mismatches);
  return mismatches;
}

export function evaluateRobGoldenCase(
  rawText: string,
  input: unknown,
): RobGoldenCaseResult {
  const goldenCase = parityGoldenCaseSchema.parse(input);
  const parsed = parseRobText(rawText);
  const actual = summarizeRobPlan(parsed);
  const mismatches = collectParityMismatches(goldenCase.expected, actual);

  const roundTripped = parseRobText(serializeRobText(parsed));
  const semanticRoundTripMatches =
    semanticRobPlanFingerprint(parsed) ===
    semanticRobPlanFingerprint(roundTripped);

  if (goldenCase.requirements.semanticRoundTrip && !semanticRoundTripMatches) {
    mismatches.push({
      path: "requirements.semanticRoundTrip",
      expected: true,
      actual: false,
    });
  }

  return {
    goldenCase,
    actual,
    mismatches,
    semanticRoundTripMatches,
  };
}
