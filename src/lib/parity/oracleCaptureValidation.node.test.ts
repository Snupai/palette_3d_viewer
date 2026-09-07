// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256ByteDigest } from "~/lib/parity/digests.node";
import {
  MULTIPACK_ORACLE_EXECUTABLE_SHA256,
  MULTIPACK_ORACLE_FILE_VERSION,
} from "~/lib/parity/oracleCaptureManifest";
import { validateOracleCaptureManifestFile } from "~/lib/parity/oracleCaptureValidation.node";

const SYNTHETIC_ROB = [
  "200 100 10",
  "50 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "25 10 0 50 10 0 2 0 0",
].join("\n");

const EMPTY_PATTERN_ROB = [
  "200 100 10",
  "50 20 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "0",
].join("\n");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeCapture(
  options: {
    packageLengthMm?: number;
    inputDirection?: 0 | 1;
    robText?: string;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "multipack-oracle-validation-"));
  temporaryDirectories.push(root);
  const exportDirectory = join(root, "exports");
  await mkdir(exportDirectory);
  const bytes = new TextEncoder().encode(options.robText ?? SYNTHETIC_ROB);
  const basename = "candidate-0001.rob";
  const exportPath = join(exportDirectory, basename);
  await writeFile(exportPath, bytes);
  const manifestPath = join(root, "oracle-manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 2,
      oracle: {
        product: "MULTIPACK für Roboter",
        fileVersion: MULTIPACK_ORACLE_FILE_VERSION,
        executableSha256: MULTIPACK_ORACLE_EXECUTABLE_SHA256,
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
        caseId: "synthetic-validation",
        generatedAt: "2026-09-02T12:00:00.000Z",
        candidateCount: 1,
        expectedCandidateCount: 1,
        exportSetComplete: true,
      },
      input: {
        provenance: {
          caseId: "operator-asserted",
          encodedDimensions: "verified-from-rob-export",
          clearance: "operator-asserted-not-encoded",
          requestedPackagesPerLayer: "operator-asserted-not-encoded",
        },
        package: {
          lengthMm: options.packageLengthMm ?? 50,
          widthMm: 20,
          heightMm: 10,
          inputDirection: options.inputDirection ?? 0,
          clearanceMm: 0,
        },
        pallet: { lengthMm: 200, widthMm: 100 },
        requestedPackagesPerLayer: 2,
      },
      candidates: [
        {
          ordinal: 1,
          solutionNumber: 1,
          table: null,
          export: {
            basename,
            byteLength: bytes.byteLength,
            sha256: sha256ByteDigest(bytes),
          },
        },
      ],
    }),
    "utf8",
  );
  return { exportPath, manifestPath };
}

describe("validateOracleCaptureManifestFile", () => {
  it("validates the manifest, digest, parser, and encoded dimensions", async () => {
    const { manifestPath } = await writeCapture();

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).resolves.toEqual({
      candidateCount: 1,
      verifiedExportCount: 1,
      uniqueByteDigestCount: 1,
      packageCountDistribution: { "2": 1 },
    });
  });

  it("rejects an export changed after manifest creation", async () => {
    const { exportPath, manifestPath } = await writeCapture();
    await writeFile(exportPath, `${SYNTHETIC_ROB}\n`, "utf8");

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).rejects.toThrow("does not match its manifest digest");
  });

  it("rejects operator dimensions that disagree with the ROB header", async () => {
    const { manifestPath } = await writeCapture({ packageLengthMm: 51 });

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).rejects.toThrow("does not match the asserted encoded input");
  });

  it("rejects an input direction that disagrees with the ROB header", async () => {
    const { manifestPath } = await writeCapture({ inputDirection: 1 });

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).rejects.toThrow("does not match the asserted encoded input");
  });

  it("rejects a parseable export with an empty source pattern", async () => {
    const { manifestPath } = await writeCapture({ robText: EMPTY_PATTERN_ROB });

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).rejects.toThrow("contains no populated source patterns");
  });

  it("rejects nonblank content appended after the declared ROB blocks", async () => {
    const { manifestPath } = await writeCapture({
      robText: `${SYNTHETIC_ROB}\n${SYNTHETIC_ROB}`,
    });

    await expect(
      validateOracleCaptureManifestFile(manifestPath),
    ).rejects.toThrow("contains trailing nonblank content");
  });

  it.each([2, 1_000_000])(
    "rejects a truncated block declaring %i coordinates, including trailing blank lines",
    async (coordinateCount) => {
      const lines = SYNTHETIC_ROB.split("\n");
      lines[6] = String(coordinateCount);
      const { manifestPath } = await writeCapture({
        robText: `${lines.join("\n")}\n\n`,
      });

      await expect(
        validateOracleCaptureManifestFile(manifestPath),
      ).rejects.toThrow(
        "An oracle export is missing a declared coordinate line.",
      );
    },
  );
});
