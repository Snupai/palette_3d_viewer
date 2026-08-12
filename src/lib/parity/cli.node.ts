#!/usr/bin/env bun

import { basename } from "node:path";
import {
  DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR,
  runExternalRobCorpus,
} from "~/lib/parity/runner.node";
import { writeLocalRobCorpusReport } from "~/lib/parity/reportWriter.node";

function positiveIntegerFromEnvironment(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer when set.`);
  }
  return value;
}

async function main(): Promise<void> {
  const report = await runExternalRobCorpus({
    maxCandidatesPerGenerator: positiveIntegerFromEnvironment(
      "ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR",
      DEFAULT_ROB_CORPUS_MAX_CANDIDATES_PER_GENERATOR,
    ),
  });
  const reportPath = await writeLocalRobCorpusReport(report);
  const summary = report.summary;
  console.log(
    JSON.stringify(
      {
        discoveredFiles: summary.discoveredFileCount,
        rejectedEntries: summary.rejectedEntryCount,
        families: summary.familyCount,
        fileStatuses: summary.fileStatusCounts,
        checkStatuses: summary.checkStatusCounts,
        scenarioStatuses: summary.scenarioStatusCounts,
        report: `.rob-corpus/${basename(reportPath)}`,
      },
      null,
      2,
    ),
  );
  if (summary.checkStatusCounts.FAIL > 0) process.exitCode = 1;
}

try {
  await main();
} catch (cause) {
  console.error(
    cause instanceof Error ? cause.message : "The .rob corpus run failed.",
  );
  process.exitCode = 1;
}
