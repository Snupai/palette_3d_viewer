// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExternalRobCorpus } from "~/lib/parity/runner.node";
import { combineStatuses, countStatuses } from "~/lib/parity/status";

const SYNTHETIC_ROB = [
  "200 100 10",
  "100 100 10 0",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "50 50 0 100 50 0 2 0 0",
].join("\n");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("corpus statuses and report aggregation", () => {
  it("combines and counts every structured status deterministically", () => {
    expect(combineStatuses([])).toBe("SKIPPED");
    expect(combineStatuses(["PASS", "SKIPPED"])).toBe("PASS");
    expect(combineStatuses(["PASS", "OBSERVED"])).toBe("OBSERVED");
    expect(combineStatuses(["OBSERVED", "BLOCKED"])).toBe("BLOCKED");
    expect(combineStatuses(["BLOCKED", "FAIL"])).toBe("FAIL");
    expect(
      countStatuses(["PASS", "PASS", "FAIL", "OBSERVED", "BLOCKED"]),
    ).toEqual({
      PASS: 2,
      FAIL: 1,
      OBSERVED: 1,
      BLOCKED: 1,
      SKIPPED: 0,
    });
  });

  it("groups byte and semantic duplicates and aggregates a package/pallet family", async () => {
    const root = await mkdtemp(join(tmpdir(), "rob-corpus-aggregate-"));
    temporaryDirectories.push(root);
    await Promise.all([
      writeFile(join(root, "first.rob"), SYNTHETIC_ROB, "utf8"),
      writeFile(join(root, "second.ROB"), SYNTHETIC_ROB, "utf8"),
      writeFile(join(root, "third.rob"), `${SYNTHETIC_ROB}\n`, "utf8"),
    ]);

    const report = await runExternalRobCorpus({
      root,
      maxCandidatesPerGenerator: 20,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(report.generatedAt).toBe("2026-08-06T00:00:00.000Z");
    expect(report.summary).toMatchObject({
      discoveredFileCount: 3,
      acceptedFileCount: 3,
      familyCount: 1,
    });
    expect(report.duplicateGroups.byteIdentical).toEqual([
      expect.objectContaining({ count: 2, fileIds: ["file-1", "file-2"] }),
    ]);
    expect(report.duplicateGroups.semanticallyIdentical).toEqual([
      expect.objectContaining({
        count: 3,
        fileIds: ["file-1", "file-2", "file-3"],
      }),
    ]);
    expect(report.families).toHaveLength(1);
    expect(report.families[0]).toMatchObject({
      fileIds: ["file-1", "file-2", "file-3"],
      family: {
        packageDimensionsMm: { length: 100, width: 100, height: 10 },
        palletDimensionsMm: { length: 200, width: 100, height: 10 },
      },
    });
    expect(
      Object.values(report.summary.fileStatusCounts).reduce(
        (total, count) => total + count,
        0,
      ),
    ).toBe(3);
    expect(JSON.stringify(report)).not.toContain(root);
    expect(JSON.stringify(report)).not.toContain('\"rawText\":');
  });
});
