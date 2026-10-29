import { z } from "zod";

export const ORACLE_CAPTURE_SCHEMA_VERSION = 2;
export const MULTIPACK_ORACLE_FILE_VERSION = "2.1.315.25";
export const MULTIPACK_ORACLE_EXECUTABLE_SHA256 =
  "629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const safeIdentifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine((value) => !value.toLowerCase().endsWith(".rob"));
const candidateBasenameSchema = z
  .string()
  .regex(/^candidate-\d{4}\.rob$/)
  .refine((value) => !value.includes("/") && !value.includes("\\"));

const observedTableMetricsSchema = z
  .object({
    packageCount: z.number().int().positive(),
    multiPackBlocks: z.union([
      z.number().int().nonnegative(),
      z.literal("unknown"),
    ]),
    cycleCount: z.number().int().nonnegative(),
    footprintLengthMm: z.number().positive(),
    footprintWidthMm: z.number().positive(),
  })
  .strict();

const oracleCandidateSchema = z
  .object({
    ordinal: z.number().int().positive(),
    solutionNumber: z.number().int().positive(),
    table: observedTableMetricsSchema.nullable(),
    export: z
      .object({
        basename: candidateBasenameSchema,
        byteLength: z.number().int().positive(),
        sha256: sha256Schema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export const oracleCaptureManifestSchema = z
  .object({
    schemaVersion: z.literal(ORACLE_CAPTURE_SCHEMA_VERSION),
    oracle: z
      .object({
        product: z.literal("MULTIPACK für Roboter"),
        fileVersion: z.literal(MULTIPACK_ORACLE_FILE_VERSION),
        executableSha256: z.literal(MULTIPACK_ORACLE_EXECUTABLE_SHA256),
        architecture: z.literal("x86"),
      })
      .strict(),
    privacy: z
      .object({
        absolutePathsStored: z.literal(false),
        sourceTextStored: z.literal(false),
        sourceBasenamesStored: z.literal(false),
        operatorProvidedCaseIdStored: z.literal(true),
        screenshotsStored: z.literal(false),
      })
      .strict(),
    capture: z
      .object({
        caseId: safeIdentifierSchema,
        generatedAt: z.string().datetime({ offset: true }),
        candidateCount: z.number().int().positive(),
        expectedCandidateCount: z.number().int().positive(),
        exportSetComplete: z.boolean(),
      })
      .strict(),
    input: z
      .object({
        provenance: z
          .object({
            caseId: z.literal("operator-asserted"),
            encodedDimensions: z.enum([
              "operator-asserted-unverified",
              "verified-from-rob-export",
            ]),
            clearance: z.literal("operator-asserted-not-encoded"),
            requestedPackagesPerLayer: z.literal(
              "operator-asserted-not-encoded",
            ),
          })
          .strict(),
        package: z
          .object({
            lengthMm: z.number().positive(),
            widthMm: z.number().positive(),
            heightMm: z.number().positive(),
            inputDirection: z.union([z.literal(0), z.literal(1)]),
            clearanceMm: z.number().nonnegative(),
          })
          .strict(),
        pallet: z
          .object({
            lengthMm: z.number().positive(),
            widthMm: z.number().positive(),
          })
          .strict(),
        requestedPackagesPerLayer: z.number().int().positive().nullable(),
      })
      .strict(),
    candidates: z.array(oracleCandidateSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.capture.candidateCount !== manifest.candidates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capture", "candidateCount"],
        message: "candidateCount must equal the number of candidates.",
      });
    }

    const expectedOrdinals = manifest.candidates.map((_, index) => index + 1);
    const ordinals = manifest.candidates.map(({ ordinal }) => ordinal);
    const solutionNumbers = manifest.candidates.map(
      ({ solutionNumber }) => solutionNumber,
    );
    if (
      ordinals.some((ordinal, index) => ordinal !== expectedOrdinals[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "Candidate ordinals must be contiguous and start at one.",
      });
    }
    if (
      solutionNumbers.some(
        (solutionNumber, index) => solutionNumber !== expectedOrdinals[index],
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message:
          "MultiPack solution numbers must match the captured candidate order.",
      });
    }

    for (const candidate of manifest.candidates) {
      if (
        candidate.export !== null &&
        candidate.export.basename !==
          `candidate-${String(candidate.ordinal).padStart(4, "0")}.rob`
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidates", candidate.ordinal - 1, "export", "basename"],
          message: "Candidate export basenames must match their ordinals.",
        });
      }
    }

    if (
      manifest.capture.expectedCandidateCount !==
      manifest.capture.candidateCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capture", "expectedCandidateCount"],
        message: "The captured candidate count must match the expected count.",
      });
    }

    const expectedDimensionProvenance = manifest.capture.exportSetComplete
      ? "verified-from-rob-export"
      : "operator-asserted-unverified";
    if (
      manifest.input.provenance.encodedDimensions !==
      expectedDimensionProvenance
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input", "provenance", "encodedDimensions"],
        message:
          "Encoded-dimension provenance must match capture completeness.",
      });
    }

    const exports = manifest.candidates.flatMap(
      ({ export: candidateExport }) =>
        candidateExport === null ? [] : [candidateExport],
    );
    if (
      manifest.capture.exportSetComplete &&
      exports.length !== manifest.candidates.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capture", "exportSetComplete"],
        message:
          "A complete export set requires an export for every candidate.",
      });
    }
    if (!manifest.capture.exportSetComplete && exports.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "An inventory manifest must not contain candidate exports.",
      });
    }
    if (
      new Set(exports.map(({ basename }) => basename)).size !== exports.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates"],
        message: "Candidate export basenames must be unique.",
      });
    }
  });

export type OracleCaptureManifest = z.infer<typeof oracleCaptureManifestSchema>;

export function assertOracleCaptureManifest(
  value: unknown,
): OracleCaptureManifest {
  return oracleCaptureManifestSchema.parse(value);
}
