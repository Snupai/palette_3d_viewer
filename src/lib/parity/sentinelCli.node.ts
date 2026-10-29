#!/usr/bin/env bun

import {
  DEFAULT_ROB_SENTINEL_MAX_CANDIDATES_PER_GENERATOR,
  runRobCorpusSentinel,
} from "~/lib/parity/sentinel.node";

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
  const run = await runRobCorpusSentinel({
    maxCandidatesPerGenerator: positiveIntegerFromEnvironment(
      "ROB_CORPUS_SENTINEL_MAX_CANDIDATES_PER_GENERATOR",
      DEFAULT_ROB_SENTINEL_MAX_CANDIDATES_PER_GENERATOR,
    ),
  });
  console.log(
    JSON.stringify(
      {
        manifest: run.manifest,
        summary: run.summary,
      },
      null,
      2,
    ),
  );
  if (run.summary.executionFailureCount > 0) process.exitCode = 1;
}

try {
  await main();
} catch (cause) {
  console.error(
    cause instanceof Error
      ? cause.message
      : "The ROB corpus sentinel run failed.",
  );
  process.exitCode = 1;
}
