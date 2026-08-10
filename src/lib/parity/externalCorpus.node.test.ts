// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR,
  runExternalRobCorpus,
} from "~/lib/parity/runner.node";
import { robCorpusReportSchema } from "~/lib/parity/schemas";

const corpusRoot = process.env.ROB_CORPUS_DIR;
const configuredLimit = Number(
  process.env.ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR ??
    DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR,
);

describe.skipIf(!corpusRoot)("external privacy-safe .rob corpus", () => {
  it("discovers, loads, characterizes, solves, compares, and aggregates the configured corpus", async () => {
    const report = await runExternalRobCorpus({
      root: corpusRoot,
      maxCandidatesPerGenerator:
        Number.isInteger(configuredLimit) && configuredLimit > 0
          ? configuredLimit
          : DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR,
    });

    expect(report.summary.discoveredFileCount).toBeGreaterThan(0);
    expect(robCorpusReportSchema.parse(report)).toEqual(report);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(corpusRoot);
    expect(serialized).not.toContain('\"rawText\":');
    expect(serialized).not.toContain('\"sourceText\":');
  }, 600_000);
});
