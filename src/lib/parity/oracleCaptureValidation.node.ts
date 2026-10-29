import type { Dirent } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseRobText } from "~/lib/robParser";
import {
  oracleCaptureManifestSchema,
  type OracleCaptureManifest,
} from "~/lib/parity/oracleCaptureManifest";
import { sha256ByteDigest } from "~/lib/parity/digests.node";
import { characterizeRobSource } from "~/lib/parity/sourceCharacterization";

const MAX_ORACLE_EXPORT_BYTES = 8 * 1024 * 1024;

export type OracleCaptureValidationSummary = {
  candidateCount: number;
  verifiedExportCount: number;
  uniqueByteDigestCount: number;
  packageCountDistribution: Record<string, number>;
};

function nodeErrorCode(value: unknown): string | null {
  if (!(value instanceof Error) || !("code" in value)) return null;
  return typeof value.code === "string" ? value.code : null;
}

function incrementCount(counts: Map<number, number>, value: number): void {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function sortedDistribution(
  counts: Map<number, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()]
      .sort(([left], [right]) => right - left)
      .map(([value, count]) => [String(value), count]),
  );
}

function firstNonNegativeInteger(line: string | undefined): number | null {
  const token = line?.trim().split(/\s+/)[0];
  if (!token || !/^\d+$/.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

function assertNoTrailingRobContent(text: string): void {
  const lines = text.split(/\r?\n/);
  const uniqueLayerCount = firstNonNegativeInteger(lines[2]);
  const physicalLayerCount = firstNonNegativeInteger(lines[3]);
  if (uniqueLayerCount === null || physicalLayerCount === null) return;

  let currentLine = 5 + physicalLayerCount;
  const uniqueLayerBlockCount = Math.max(1, uniqueLayerCount);
  for (let block = 0; block < uniqueLayerBlockCount; block += 1) {
    while (currentLine < lines.length && lines[currentLine]?.trim() === "") {
      currentLine += 1;
    }
    const coordinateCount = firstNonNegativeInteger(lines[currentLine]);
    if (coordinateCount === null) return;
    currentLine += 1;
    for (let coordinate = 0; coordinate < coordinateCount; coordinate += 1) {
      while (currentLine < lines.length && lines[currentLine]?.trim() === "") {
        currentLine += 1;
      }
      if (currentLine >= lines.length) {
        throw new Error(
          "An oracle export is missing a declared coordinate line.",
        );
      }
      currentLine += 1;
    }
  }
  if (lines.slice(currentLine).some((line) => line.trim() !== "")) {
    throw new Error("An oracle export contains trailing nonblank content.");
  }
}

function encodedDimensionsMatch(
  manifest: OracleCaptureManifest,
  source: ReturnType<typeof characterizeRobSource>,
): boolean {
  const encodedPackage = source.encodedInput.packageDimensionsMm;
  const encodedPallet = source.encodedInput.palletDimensionsMm;
  return (
    encodedPackage.length === manifest.input.package.lengthMm &&
    encodedPackage.width === manifest.input.package.widthMm &&
    encodedPackage.height === manifest.input.package.heightMm &&
    source.encodedInput.inputDirection.value ===
      manifest.input.package.inputDirection &&
    encodedPallet !== null &&
    encodedPallet.length === manifest.input.pallet.lengthMm &&
    encodedPallet.width === manifest.input.pallet.widthMm
  );
}

async function parseManifest(
  manifestPath: string,
): Promise<OracleCaptureManifest> {
  if (!isAbsolute(manifestPath)) {
    throw new Error("The oracle manifest path must be absolute.");
  }
  const stat = await lstat(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("The oracle manifest must be a regular non-symlink file.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("The oracle manifest is not valid JSON.");
  }
  return oracleCaptureManifestSchema.parse(value);
}

export async function validateOracleCaptureManifestFile(
  manifestPathInput: string,
): Promise<OracleCaptureValidationSummary> {
  const manifestPath = resolve(manifestPathInput);
  const manifest = await parseManifest(manifestPath);
  const captureRoot = dirname(manifestPath);
  const exportDirectory = resolve(captureRoot, "exports");
  const expectedBasenames = new Set(
    manifest.candidates.flatMap(({ export: candidateExport }) =>
      candidateExport === null ? [] : [candidateExport.basename],
    ),
  );

  let entries: Dirent[] = [];
  try {
    const exportDirectoryStat = await lstat(exportDirectory);
    if (
      exportDirectoryStat.isSymbolicLink() ||
      !exportDirectoryStat.isDirectory()
    ) {
      throw new Error(
        "The oracle exports path must be a regular non-symlink directory.",
      );
    }
    entries = await readdir(exportDirectory, { withFileTypes: true });
  } catch (cause) {
    if (nodeErrorCode(cause) !== "ENOENT" || expectedBasenames.size > 0) {
      throw cause;
    }
  }
  if (
    entries.some(
      (entry) =>
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !expectedBasenames.has(entry.name),
    ) ||
    entries.length !== expectedBasenames.size
  ) {
    throw new Error(
      "The oracle exports directory does not match the manifest.",
    );
  }

  const byteDigests = new Set<string>();
  const packageCounts = new Map<number, number>();
  let verifiedExportCount = 0;
  for (const candidate of manifest.candidates) {
    const candidateExport = candidate.export;
    if (candidateExport === null) continue;
    const exportPath = resolve(exportDirectory, candidateExport.basename);
    if (dirname(exportPath) !== exportDirectory) {
      throw new Error("An oracle export escaped the exports directory.");
    }
    const stat = await lstat(exportPath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size <= 0 ||
      stat.size > MAX_ORACLE_EXPORT_BYTES
    ) {
      throw new Error("An oracle export is not a bounded regular file.");
    }
    const bytes = new Uint8Array(await readFile(exportPath));
    const byteDigest = sha256ByteDigest(bytes);
    if (
      bytes.byteLength !== candidateExport.byteLength ||
      byteDigest !== candidateExport.sha256
    ) {
      throw new Error("An oracle export does not match its manifest digest.");
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("An oracle export is not strict UTF-8 text.");
    }
    assertNoTrailingRobContent(text);
    const source = characterizeRobSource(parseRobText(text));
    if (!encodedDimensionsMatch(manifest, source)) {
      throw new Error(
        "An oracle export does not match the asserted encoded input.",
      );
    }
    if (
      source.stack.physicalLayerCount <= 0 ||
      source.patterns.length === 0 ||
      source.patterns.some(
        ({ packageCount, gripCount }) => packageCount <= 0 || gripCount <= 0,
      )
    ) {
      throw new Error(
        "An oracle export contains no populated source patterns.",
      );
    }
    incrementCount(
      packageCounts,
      source.encodedInput.sourceFeasiblePackageCount,
    );
    byteDigests.add(byteDigest);
    verifiedExportCount += 1;
  }

  if (
    manifest.capture.exportSetComplete &&
    (verifiedExportCount !== manifest.capture.candidateCount ||
      manifest.input.provenance.encodedDimensions !==
        "verified-from-rob-export")
  ) {
    throw new Error("The complete oracle capture is not fully verified.");
  }

  return {
    candidateCount: manifest.capture.candidateCount,
    verifiedExportCount,
    uniqueByteDigestCount: byteDigests.size,
    packageCountDistribution: sortedDistribution(packageCounts),
  };
}
