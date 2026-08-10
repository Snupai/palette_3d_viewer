// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256ByteDigest } from "~/lib/parity/digests.node";
import {
  runRobCorpusSentinel,
  summarizeRobCorpusSentinelReport,
} from "~/lib/parity/sentinel.node";

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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("hash-only ROB corpus sentinel", () => {
  it("selects by digest and anonymizes every report basename", async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), "rob-sentinel-work-"),
    );
    const corpusRoot = await mkdtemp(join(tmpdir(), "rob-sentinel-corpus-"));
    temporaryDirectories.push(workingDirectory, corpusRoot);
    const firstBytes = new TextEncoder().encode(SYNTHETIC_ROB);
    const secondBytes = new TextEncoder().encode(`${SYNTHETIC_ROB}\n`);
    const prefixes = [firstBytes, secondBytes].map((bytes) =>
      sha256ByteDigest(bytes).slice(0, 16),
    );
    await Promise.all([
      writeFile(join(corpusRoot, "source-a.rob"), firstBytes),
      writeFile(join(corpusRoot, "source-b.rob"), secondBytes),
    ]);
    const manifestPath = join(workingDirectory, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        digestPrefixLength: 16,
        privacy: {
          absolutePathsStored: false,
          sourceTextStored: false,
          fileNamesStored: false,
        },
        selection: {
          caseCount: prefixes.length,
          stableIdentity: "sha256-byte-digest",
        },
        cases: prefixes.map((byteDigestPrefix) => ({ byteDigestPrefix })),
      }),
      "utf8",
    );

    const run = await runRobCorpusSentinel({
      root: corpusRoot,
      manifestPath,
      maxCandidatesPerGenerator: 100,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(run.summary).toMatchObject({
      selectedCases: 2,
      sourcePatternBlocks: 2,
      patternComparisons: 4,
      executionFailureCount: 0,
    });
    expect(run.report.files.map(({ basename }) => basename)).toEqual([
      "sentinel-case-01.rob",
      "sentinel-case-02.rob",
    ]);
    expect(run.report.harness).toMatchObject({
      generatedSymmetryVariants: false,
      sourceSymmetryOrbitCompared: true,
    });
    const serialized = JSON.stringify(run.report);
    expect(serialized).not.toContain(corpusRoot);
    expect(serialized).not.toContain("source-a.rob");
    expect(serialized).not.toContain("source-b.rob");
  });

  it("includes pattern-level failures in the execution failure count", async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), "rob-sentinel-work-"),
    );
    const corpusRoot = await mkdtemp(join(tmpdir(), "rob-sentinel-corpus-"));
    temporaryDirectories.push(workingDirectory, corpusRoot);
    const bytes = new TextEncoder().encode(SYNTHETIC_ROB);
    const prefix = sha256ByteDigest(bytes).slice(0, 16);
    await writeFile(join(corpusRoot, "source.rob"), bytes);
    const manifestPath = join(workingDirectory, "manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        digestPrefixLength: 16,
        privacy: {
          absolutePathsStored: false,
          sourceTextStored: false,
          fileNamesStored: false,
        },
        selection: {
          caseCount: 1,
          stableIdentity: "sha256-byte-digest",
        },
        cases: [{ byteDigestPrefix: prefix }],
      }),
      "utf8",
    );
    const run = await runRobCorpusSentinel({
      root: corpusRoot,
      manifestPath,
      maxCandidatesPerGenerator: 100,
    });
    const pattern = run.report.files[0]?.scenarios[0]?.patterns[0];
    if (!pattern) throw new Error("Missing synthetic pattern report.");
    pattern.checks.push({
      id: "patterns[0].synthetic-regression",
      status: "FAIL",
      summary: "Synthetic pattern-level failure.",
      evidence: {},
      mismatches: [
        {
          path: "patterns[0].synthetic-regression",
          expected: "pass",
          actual: "fail",
        },
      ],
    });

    expect(
      summarizeRobCorpusSentinelReport(run.report).executionFailureCount,
    ).toBe(1);
  });
});

const externalCorpusRoot = process.env.ROB_CORPUS_DIR;

describe.skipIf(!externalCorpusRoot)("configured local ROB sentinel", () => {
  it("runs every manifest case by byte digest without source names", async () => {
    const run = await runRobCorpusSentinel({ root: externalCorpusRoot });

    expect(run.summary.selectedCases).toBe(run.manifest.caseCount);
    expect(run.summary.selectedCases).toBeGreaterThan(0);
    expect(run.summary.patternComparisons).toBeGreaterThan(0);
    expect(run.summary.executionFailureCount).toBe(0);
    expect(
      run.report.files.every(({ basename }) =>
        /^sentinel-case-\d+\.rob$/.test(basename),
      ),
    ).toBe(true);
    expect(JSON.stringify(run.report)).not.toContain(externalCorpusRoot);
  }, 600_000);
});
