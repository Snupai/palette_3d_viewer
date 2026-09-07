#!/usr/bin/env bun

import { isAbsolute, resolve } from "node:path";
import { validateOracleCaptureManifestFile } from "~/lib/parity/oracleCaptureValidation.node";

const manifestPath = process.argv[2];
if (!manifestPath || !isAbsolute(manifestPath)) {
  console.error(
    "Oracle capture validation requires an absolute manifest path.",
  );
  process.exitCode = 1;
} else {
  try {
    const summary = await validateOracleCaptureManifestFile(
      resolve(manifestPath),
    );
    console.log(JSON.stringify(summary));
  } catch {
    console.error("Oracle capture validation failed.");
    process.exitCode = 1;
  }
}
