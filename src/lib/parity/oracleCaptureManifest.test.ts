import { describe, expect, it } from "vitest";
import {
  MULTIPACK_ORACLE_EXECUTABLE_SHA256,
  MULTIPACK_ORACLE_FILE_VERSION,
  oracleCaptureManifestSchema,
} from "~/lib/parity/oracleCaptureManifest";

function manifest(
  options: {
    complete?: boolean;
    includeTable?: boolean;
    includeFirstExport?: boolean;
    includeSecondExport?: boolean;
    secondOrdinal?: number;
    firstBasename?: string;
    secondSha256?: string;
    fileVersion?: string;
    executableSha256?: string;
    expectedCandidateCount?: number;
    caseId?: string;
  } = {},
) {
  const {
    complete = true,
    includeTable = true,
    includeFirstExport = true,
    includeSecondExport = true,
    secondOrdinal = 2,
    firstBasename = "candidate-0001.rob",
    secondSha256 = "b".repeat(64),
    fileVersion = MULTIPACK_ORACLE_FILE_VERSION,
    executableSha256 = MULTIPACK_ORACLE_EXECUTABLE_SHA256,
    expectedCandidateCount = 2,
    caseId = "package-201x139-euro",
  } = options;
  return {
    schemaVersion: 2,
    oracle: {
      product: "MULTIPACK für Roboter",
      fileVersion,
      executableSha256,
      architecture: "x86",
    },
    privacy: {
      absolutePathsStored: false,
      sourceTextStored: false,
      sourceBasenamesStored: false,
      operatorProvidedCaseIdStored: true,
      screenshotsStored: false,
    },
    capture: {
      caseId,
      generatedAt: "2026-09-02T10:00:00.000Z",
      candidateCount: 2,
      expectedCandidateCount,
      exportSetComplete: complete,
    },
    input: {
      provenance: {
        caseId: "operator-asserted",
        encodedDimensions: complete
          ? "verified-from-rob-export"
          : "operator-asserted-unverified",
        clearance: "operator-asserted-not-encoded",
        requestedPackagesPerLayer: "operator-asserted-not-encoded",
      },
      package: {
        lengthMm: 201,
        widthMm: 139,
        heightMm: 231,
        inputDirection: 0,
        clearanceMm: 0,
      },
      pallet: { lengthMm: 1_200, widthMm: 800 },
      requestedPackagesPerLayer: 31,
    },
    candidates: [
      {
        ordinal: 1,
        solutionNumber: 1,
        table: includeTable
          ? {
              packageCount: 31,
              multiPackBlocks: 4,
              cycleCount: 22,
              footprintLengthMm: 1_159,
              footprintWidthMm: 757,
            }
          : null,
        export: includeFirstExport
          ? {
              basename: firstBasename,
              byteLength: 1_337,
              sha256: "a".repeat(64),
            }
          : null,
      },
      {
        ordinal: secondOrdinal,
        solutionNumber: secondOrdinal,
        table: includeTable
          ? {
              packageCount: 31,
              multiPackBlocks: "unknown",
              cycleCount: 27,
              footprintLengthMm: 1_174,
              footprintWidthMm: 757,
            }
          : null,
        export: includeSecondExport
          ? {
              basename: "candidate-0002.rob",
              byteLength: 1_441,
              sha256: secondSha256,
            }
          : null,
      },
    ],
  };
}

describe("oracleCaptureManifestSchema", () => {
  it("accepts an exact hash-only candidate capture", () => {
    const parsed = oracleCaptureManifestSchema.parse(manifest());

    expect(parsed.capture).toEqual({
      caseId: "package-201x139-euro",
      generatedAt: "2026-09-02T10:00:00.000Z",
      candidateCount: 2,
      expectedCandidateCount: 2,
      exportSetComplete: true,
    });
    expect(parsed.candidates.map(({ ordinal }) => ordinal)).toEqual([1, 2]);
    expect(JSON.stringify(parsed)).not.toContain("C:\\");
    expect(JSON.stringify(parsed)).not.toContain("rawText");
  });

  it("allows an incomplete inventory without ROB exports", () => {
    const value = manifest({
      complete: false,
      includeTable: false,
      includeFirstExport: false,
      includeSecondExport: false,
    });

    expect(oracleCaptureManifestSchema.parse(value).candidates).toEqual([
      {
        ordinal: 1,
        solutionNumber: 1,
        table: null,
        export: null,
      },
      {
        ordinal: 2,
        solutionNumber: 2,
        table: null,
        export: null,
      },
    ]);
  });

  it("rejects partial exports in an inventory manifest", () => {
    const result = oracleCaptureManifestSchema.safeParse(
      manifest({ complete: false, includeSecondExport: false }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toContain(
      "An inventory manifest must not contain candidate exports.",
    );
  });

  it("preserves byte-identical exports as distinct candidate rows", () => {
    const digest = "a".repeat(64);
    const parsed = oracleCaptureManifestSchema.parse(
      manifest({ secondSha256: digest }),
    );

    expect(
      parsed.candidates.map(
        ({ export: candidateExport }) => candidateExport?.sha256,
      ),
    ).toEqual([digest, digest]);
  });

  it("rejects gaps and missing exports in a complete capture", () => {
    const result = oracleCaptureManifestSchema.safeParse(
      manifest({ secondOrdinal: 3, includeSecondExport: false }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toEqual([
      "Candidate ordinals must be contiguous and start at one.",
      "MultiPack solution numbers must match the captured candidate order.",
      "A complete export set requires an export for every candidate.",
    ]);
  });

  it("rejects a candidate count different from the expected count", () => {
    const result = oracleCaptureManifestSchema.safeParse(
      manifest({ expectedCandidateCount: 3 }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toContain(
      "The captured candidate count must match the expected count.",
    );
  });

  it("rejects a different executable identity", () => {
    expect(
      oracleCaptureManifestSchema.safeParse(
        manifest({
          fileVersion: "9.9.9",
          executableSha256: "0".repeat(64),
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects a Case ID that resembles a ROB basename", () => {
    expect(
      oracleCaptureManifestSchema.safeParse(
        manifest({ caseId: "customer-001.rob" }),
      ).success,
    ).toBe(false);
  });

  it("rejects source paths as candidate basenames", () => {
    expect(
      oracleCaptureManifestSchema.safeParse(
        manifest({ firstBasename: "C:\\customer\\candidate-0001.rob" }),
      ).success,
    ).toBe(false);
  });
});
