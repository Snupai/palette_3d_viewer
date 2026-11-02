// @vitest-environment node

import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRobCorpusReportDirectory } from "~/lib/parity/reportWriter.node";

describe("local ROB corpus report directory", () => {
  it("defaults to a fixed folder under the OS temp directory", () => {
    expect(resolveRobCorpusReportDirectory({})).toBe(
      join(tmpdir(), "palette-rob-corpus-reports"),
    );
  });

  it("accepts only an absolute ROB_CORPUS_REPORT_DIR", () => {
    expect(
      resolveRobCorpusReportDirectory({
        ROB_CORPUS_REPORT_DIR: "/var/reports/rob/",
      }),
    ).toBe(resolve("/var/reports/rob"));
    expect(() =>
      resolveRobCorpusReportDirectory({ ROB_CORPUS_REPORT_DIR: "reports" }),
    ).toThrow("ROB_CORPUS_REPORT_DIR must be an absolute path.");
  });
});
