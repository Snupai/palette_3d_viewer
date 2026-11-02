import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { assertPrivacySafeCorpusReport } from "~/lib/parity/schemas";
import type { RobCorpusReport } from "~/lib/parity/types";

export const DEFAULT_ROB_CORPUS_REPORT_DIRECTORY_NAME =
  "palette-rob-corpus-reports";

function defaultReportFilename(generatedAt: string): string {
  return `rob-corpus-report-${generatedAt.replace(/[:.]/g, "-")}.json`;
}

/**
 * Local report directory outside the repository: `ROB_CORPUS_REPORT_DIR` when
 * set (must be absolute), otherwise a fixed folder under the OS temp dir.
 */
export function resolveRobCorpusReportDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env.ROB_CORPUS_REPORT_DIR;
  if (configured === undefined || configured.trim() === "") {
    return join(tmpdir(), DEFAULT_ROB_CORPUS_REPORT_DIRECTORY_NAME);
  }
  if (!isAbsolute(configured)) {
    throw new Error("ROB_CORPUS_REPORT_DIR must be an absolute path.");
  }
  return resolve(configured);
}

export async function writeLocalRobCorpusReport(
  reportInput: RobCorpusReport,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    filename?: string;
  } = {},
): Promise<string> {
  const report = assertPrivacySafeCorpusReport(reportInput);
  const reportDirectory = resolveRobCorpusReportDirectory(options.env);
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
    throw new Error(
      "The local corpus report must stay inside the report directory.",
    );
  }
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}
