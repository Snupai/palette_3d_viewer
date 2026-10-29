import { z } from "zod";
import {
  CORPUS_PARITY_STATUSES,
  CORPUS_REPORT_SCHEMA_VERSION,
  ROB_CORPUS_SCENARIO_IDS,
  type JsonValue,
  type RobCorpusReport,
} from "~/lib/parity/types";

export const corpusParityStatusSchema = z.enum(CORPUS_PARITY_STATUSES);
export const robCorpusScenarioIdSchema = z.enum(ROB_CORPUS_SCENARIO_IDS);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const basenameSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("/") &&
      !value.includes("\\") &&
      !/^[A-Za-z]:/.test(value),
    "must contain a basename only",
  );
const boundsSchema = z
  .object({
    minX: z.number().finite(),
    minY: z.number().finite(),
    maxX: z.number().finite(),
    maxY: z.number().finite(),
  })
  .strict();
const dimensionsSchema = z
  .object({
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const inputDirectionSchema = z
  .object({
    value: z.union([z.literal(0), z.literal(1)]),
    explicit: z.boolean(),
  })
  .strict();
const orientationHistogramSchema = z
  .object({
    0: z.number().int().nonnegative(),
    90: z.number().int().nonnegative(),
    180: z.number().int().nonnegative(),
    270: z.number().int().nonnegative(),
  })
  .strict();
const physicalFootprintOrientationHistogramSchema = z
  .object({
    lengthwise: z.number().int().nonnegative(),
    crosswise: z.number().int().nonnegative(),
    square: z.number().int().nonnegative(),
  })
  .strict();

export const corpusMismatchSchema = z
  .object({
    path: z.string().min(1),
    expected: jsonValueSchema.optional(),
    actual: jsonValueSchema.optional(),
    detail: z.string().min(1).optional(),
  })
  .strict();

export const corpusCheckSchema = z
  .object({
    id: z.string().min(1),
    status: corpusParityStatusSchema,
    summary: z.string().min(1),
    evidence: z.record(jsonValueSchema),
    mismatches: z.array(corpusMismatchSchema),
  })
  .strict();

const statusCountsSchema = z
  .object({
    PASS: z.number().int().nonnegative(),
    FAIL: z.number().int().nonnegative(),
    OBSERVED: z.number().int().nonnegative(),
    BLOCKED: z.number().int().nonnegative(),
    SKIPPED: z.number().int().nonnegative(),
  })
  .strict();

const encodedInputSchema = z
  .object({
    packageDimensionsMm: dimensionsSchema,
    palletDimensionsMm: dimensionsSchema.nullable(),
    inputDirection: inputDirectionSchema,
    sourceFeasiblePackageCount: z.number().int().nonnegative(),
    sourceFeasibleCountRole: z.literal(
      "feasible-reference-not-asserted-maximum",
    ),
    fieldsNotEncoded: z.tuple([
      z.literal("clearance"),
      z.literal("allowed-overhang"),
      z.literal("multipick-eligibility"),
      z.literal("gripper"),
      z.literal("station"),
    ]),
  })
  .strict();

const familySchema = z
  .object({
    id: z.string().min(1),
    packageDimensionsMm: dimensionsSchema,
    palletDimensionsMm: dimensionsSchema.nullable(),
    inputDirection: inputDirectionSchema,
  })
  .strict();

const sourcePatternSchema = z
  .object({
    ordinal: z.number().int().positive(),
    sourceUniqueLayerId: z.number().int(),
    packageCount: z.number().int().nonnegative(),
    gripCount: z.number().int().nonnegative(),
    geometryId: z.string().min(1),
    boundsMm: boundsSchema.nullable(),
    orientations: orientationHistogramSchema,
    placeOrientations: orientationHistogramSchema,
    physicalFootprintOrientations: physicalFootprintOrientationHistogramSchema,
  })
  .strict();

const physicalLayerSchema = z
  .object({
    physicalLayerIndex: z.number().int().nonnegative(),
    sourceUniqueLayerId: z.number().int(),
    sourcePatternOrdinal: z.number().int().positive().nullable(),
    patternEqualityId: z.string().min(1),
    geometryId: z.string().min(1),
    packageCount: z.number().int().nonnegative(),
    cycleCount: z.number().int().nonnegative(),
    interlayerBefore: z.number().int().nonnegative(),
  })
  .strict();

const sourceCharacterizationSchema = z
  .object({
    encodedInput: encodedInputSchema,
    family: familySchema,
    patterns: z.array(sourcePatternSchema),
    observedEnvelopeMm: boundsSchema.nullable(),
    stack: z
      .object({
        physicalLayerCount: z.number().int().nonnegative(),
        sourcePatternIdentitySequence: z.array(z.number().int()),
        patternEqualitySequence: z.array(z.string().min(1)),
        physicalLayers: z.array(physicalLayerSchema),
        packagesPerPhysicalLayer: z.array(z.number().int().nonnegative()),
        cyclesPerPhysicalLayer: z.array(z.number().int().nonnegative()),
        interlayersBeforePhysicalLayers: z.array(
          z.number().int().nonnegative(),
        ),
        trailingInterlayer: z.number().int().nonnegative(),
      })
      .strict(),
    robotics: z
      .object({
        sourceGripCountsByPattern: z.array(z.number().int().nonnegative()),
        sourceCyclesPerPhysicalLayer: z.array(z.number().int().nonnegative()),
        parityScope: z.literal("Open"),
        generatedComparison: z.literal("blocked-until-group-planning"),
      })
      .strict(),
  })
  .strict();

const geometryMatchSchema = z
  .object({
    matched: z.boolean(),
    candidateRank: z.number().int().positive().nullable(),
    candidateId: z.string().min(1).nullable(),
    symmetry: z.string().min(1).nullable(),
  })
  .strict();

const patternComparisonSchema = z
  .object({
    sourcePatternOrdinal: z.number().int().positive(),
    sourceUniqueLayerId: z.number().int(),
    sourcePackageCount: z.number().int().nonnegative(),
    sourceCountRole: z.literal("feasible-reference-not-asserted-maximum"),
    sourceBoundsMm: boundsSchema.nullable(),
    sourceOrientations: orientationHistogramSchema,
    sourcePlaceOrientations: orientationHistogramSchema,
    sourcePhysicalFootprintOrientations:
      physicalFootprintOrientationHistogramSchema,
    physicalFootprintExact: geometryMatchSchema,
    physicalFootprintRobIntegerCompatible: geometryMatchSchema,
    operationalDirectedYawExact: geometryMatchSchema,
    acceptedMatchKind: z
      .enum([
        "physical-footprint-exact",
        "physical-footprint-rob-integer-compatible",
      ])
      .nullable(),
    acceptedSymmetry: z.string().min(1).nullable(),
    matchedCandidateRank: z.number().int().positive().nullable(),
    matchedCandidateBoundsMm: boundsSchema.nullable(),
    matchedCandidateOrientations: orientationHistogramSchema.nullable(),
    matchedCandidatePhysicalFootprintOrientations:
      physicalFootprintOrientationHistogramSchema.nullable(),
    maximumCenterDisplacementMm: z.number().nonnegative().nullable(),
    maximumBoundsDifferenceMm: z.number().nonnegative().nullable(),
    generatedMaximumPackageCount: z.number().int().nonnegative(),
    generatedMaximumRelationToSource: z.enum(["below", "equal", "above"]),
    checks: z.array(corpusCheckSchema),
    status: corpusParityStatusSchema,
  })
  .strict();

const scenarioInputSchema = z
  .object({
    clearanceMm: z.literal(0),
    allowedOverhangPolicyMm: z
      .object({
        lengthPerSide: z.literal(0),
        widthPerSide: z.literal(0),
      })
      .strict()
      .nullable(),
    envelopeMm: boundsSchema.nullable(),
    envelopeSource: z.enum(["encoded-pallet", "observed-source-extents"]),
    observationOnly: z.boolean(),
    sourcePackageCountConstraintApplied: z.literal(false),
    allowedRotationsSource: z.literal(
      "unconstrained-because-gripper-not-encoded",
    ),
  })
  .strict();

const solverSummarySchema = z
  .object({
    status: z.enum(["completed", "cancelled"]),
    candidateCount: z.number().int().nonnegative(),
    generatedMaximumPackageCount: z.number().int().nonnegative(),
    generationLimitReached: z.boolean(),
    diagnostics: z.array(
      z
        .object({
          severity: z.enum(["info", "warning", "error"]),
          phase: z.string().min(1),
          code: z.string().min(1),
          generator: z.string().min(1).nullable(),
          count: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

const scenarioSchema = z
  .object({
    id: robCorpusScenarioIdSchema,
    basis: z.enum(["strict-policy", "source-observation"]),
    input: scenarioInputSchema,
    status: corpusParityStatusSchema,
    skipReason: z.string().min(1).nullable(),
    solver: solverSummarySchema.nullable(),
    patterns: z.array(patternComparisonSchema),
    checks: z.array(corpusCheckSchema),
  })
  .strict();

const fileReportSchema = z
  .object({
    fileId: z.string().regex(/^file-\d+$/),
    basename: basenameSchema,
    byteLength: z.number().int().nonnegative(),
    byteDigestSha256: digestSchema.nullable(),
    semanticDigestSha256: digestSchema.nullable(),
    familyId: z.string().min(1).nullable(),
    status: corpusParityStatusSchema,
    checks: z.array(corpusCheckSchema),
    source: sourceCharacterizationSchema.nullable(),
    scenarios: z.array(scenarioSchema),
  })
  .strict();

const duplicateGroupSchema = z
  .object({
    digestSha256: digestSchema,
    fileIds: z.array(z.string().regex(/^file-\d+$/)).min(2),
    count: z.number().int().min(2),
  })
  .strict()
  .refine((value) => value.fileIds.length === value.count, {
    message: "duplicate group count must equal fileIds length",
    path: ["count"],
  });

const familyAggregateSchema = z
  .object({
    family: familySchema,
    fileIds: z.array(z.string().regex(/^file-\d+$/)).min(1),
    status: corpusParityStatusSchema,
    fileStatusCounts: statusCountsSchema,
    checkStatusCounts: statusCountsSchema,
    scenarioStatusCounts: statusCountsSchema,
  })
  .strict();

export const robCorpusReportSchema: z.ZodType<RobCorpusReport> = z
  .object({
    schemaVersion: z.literal(CORPUS_REPORT_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    harness: z
      .object({
        maxFileBytes: z.number().int().positive(),
        maxCandidatesPerGenerator: z.number().int().positive(),
        generatedSymmetryVariants: z.boolean(),
        sourceSymmetryOrbitCompared: z.literal(true),
        scenarios: z.tuple([
          z.literal("nominal-strict-v1"),
          z.literal("observed-envelope-v1"),
        ]),
        privacy: z
          .object({
            sourceTextStored: z.literal(false),
            absolutePathsStored: z.literal(false),
            reportFileNamesAreBasenamesOnly: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    summary: z
      .object({
        discoveredFileCount: z.number().int().nonnegative(),
        acceptedFileCount: z.number().int().nonnegative(),
        rejectedEntryCount: z.number().int().nonnegative(),
        familyCount: z.number().int().nonnegative(),
        fileStatusCounts: statusCountsSchema,
        checkStatusCounts: statusCountsSchema,
        scenarioStatusCounts: statusCountsSchema,
      })
      .strict(),
    discoveryIssues: z.array(
      z
        .object({
          basename: basenameSchema,
          code: z.enum([
            "symlink-rejected",
            "out-of-root-rejected",
            "not-regular-file",
            "file-too-large",
            "entry-unreadable",
          ]),
          status: z.literal("SKIPPED"),
          summary: z.string().min(1),
        })
        .strict(),
    ),
    duplicateGroups: z
      .object({
        byteIdentical: z.array(duplicateGroupSchema),
        semanticallyIdentical: z.array(duplicateGroupSchema),
      })
      .strict(),
    files: z.array(fileReportSchema),
    families: z.array(familyAggregateSchema),
  })
  .strict();

const forbiddenReportKeys = new Set([
  "absolutePath",
  "realPath",
  "rawText",
  "sourceText",
  "bytes",
]);

function assertNoPrivateFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoPrivateFields(entry, `${path}[${index}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenReportKeys.has(key)) {
      throw new Error(`Privacy-unsafe report field at ${path}.${key}.`);
    }
    assertNoPrivateFields(entry, `${path}.${key}`);
  }
}

export function assertPrivacySafeCorpusReport(value: unknown): RobCorpusReport {
  const report = robCorpusReportSchema.parse(value);
  assertNoPrivateFields(report, "report");
  return report;
}
