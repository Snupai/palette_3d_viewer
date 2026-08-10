import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertPrivacySafeCorpusReport } from "~/lib/parity/schemas";
import type { RobCorpusReport } from "~/lib/parity/types";

function defaultReportFilename(generatedAt: string): string {
  return `rob-corpus-report-${generatedAt.replace(/[:.]/g, "-")}.json`;
}

export async function writeLocalRobCorpusReport(
  reportInput: RobCorpusReport,
  options: { workingDirectory?: string; filename?: string } = {},
): Promise<string> {
  const report = assertPrivacySafeCorpusReport(reportInput);
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const reportDirectory = resolve(workingDirectory, ".rob-corpus");
  const filename =
    options.filename ?? defaultReportFilename(report.generatedAt);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename) ||
    filename === "." ||
    filename === ".."
  ) {
    throw new Error("The local corpus report filename is invalid.");
  }

  await mkdir(reportDirectory, { recursive: true });
  const outputPath = resolve(reportDirectory, filename);
  if (dirname(outputPath) !== reportDirectory) {
    throw new Error("The local corpus report must stay inside .rob-corpus.");
  }
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}
