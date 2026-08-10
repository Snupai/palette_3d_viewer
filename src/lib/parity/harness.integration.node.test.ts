// @vitest-environment node

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExternalRobCorpus } from "~/lib/parity/runner.node";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("committed anonymized .rob corpus integration", () => {
  it("runs parser, source, scenario, and privacy gates without retaining source text", async () => {
    const root = await mkdtemp(join(tmpdir(), "rob-corpus-fixture-"));
    temporaryDirectories.push(root);
    await copyFile(
      resolve(
        process.cwd(),
        "src",
        "lib",
        "__fixtures__",
        "anonymized-plan-lf.rob",
      ),
      join(root, "fixture.rob"),
    );

    const report = await runExternalRobCorpus({
      root,
      maxCandidatesPerGenerator: 25,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    const file = report.files[0]!;

    expect(report.summary.discoveredFileCount).toBe(1);
    expect(
      file.checks.find(({ id }) => id === "parser.semantic-roundtrip"),
    ).toMatchObject({ status: "PASS", mismatches: [] });
    expect(file.source?.stack).toMatchObject({
      physicalLayerCount: 3,
      sourcePatternIdentitySequence: [1, 2, 1],
      patternEqualitySequence: [
        "pattern-equality-1",
        "pattern-equality-2",
        "pattern-equality-1",
      ],
      packagesPerPhysicalLayer: [1, 3, 1],
      cyclesPerPhysicalLayer: [1, 2, 1],
      interlayersBeforePhysicalLayers: [1, 0, 1],
      trailingInterlayer: 0,
    });
    expect(file.scenarios.map(({ id }) => id)).toEqual([
      "nominal-strict-v1",
      "observed-envelope-v1",
    ]);
    expect(
      file.checks.find(
        ({ id }) => id === "source.geometry-validation-profiles",
      ),
    ).toMatchObject({
      status: "OBSERVED",
      evidence: {
        solverValidationToleranceMm: 0,
        sourceOnlyRobIntegerToleranceMm: 0.500_001,
      },
    });
    expect(report.harness.privacy).toEqual({
      sourceTextStored: false,
      absolutePathsStored: false,
      reportFileNamesAreBasenamesOnly: true,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain('"rawText":');
    expect(serialized).not.toContain('"sourceText":');
  });
});
