#!/usr/bin/env bun

/**
 * Scores the local sheet extractor against hand-labelled photos.
 *
 *   SHEET_CORPUS_DIR=/abs/path SHEET_EXTRACTION_MODEL=qwen2.5vl:32b bun run sheet:eval
 *
 * Reads the same SHEET_EXTRACTION_API / _URL / _MODEL / _API_KEY settings as
 * the app (see `sheetExtractionConfig.ts`).
 *
 * The corpus folder holds the photos plus `labels.json`
 * (`{ "<file>": { carton: [l, w, h], block: [l, w, h|null], perLayer, layers, perPallet } }`).
 * Photos contain customer data and stay outside the repository; the report is
 * written next to them.
 */
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { countSheetErrors, type PalletSheet } from "~/domain/sheetExtraction";
import { readCorpusPhoto } from "~/lib/sheetExtraction/corpusPhoto.node";
import { extractPalletSheet } from "~/lib/sheetExtraction/ollamaSheetExtractor";
import { resolveSheetExtractionEndpoint } from "~/lib/sheetExtraction/sheetExtractionConfig";

type Label = {
  carton: [number, number, number];
  block: [number, number, number | null];
  perLayer: number;
  layers: number;
  perPallet: number;
  /** Scored only when labelled; many sheets carry no internal number. */
  productNumber?: string;
};

type FieldName =
  | "carton"
  | "block"
  | "perLayer"
  | "layers"
  | "perPallet"
  | "productNumber";
const FIELDS: readonly FieldName[] = [
  "carton",
  "block",
  "perLayer",
  "layers",
  "perPallet",
  "productNumber",
];

function photoMimeType(file: string): string {
  const extension = file.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

const close = (a: number | null | undefined, b: number) =>
  a !== null && a !== undefined && Math.abs(a - b) <= 1;

function score(sheet: PalletSheet, label: Label): Record<FieldName, boolean> {
  const [cl, cw] = [...label.carton.slice(0, 2)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  const [bl, bw] = [label.block[0], label.block[1]].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return {
    carton:
      close(sheet.cartonMm?.length, cl) &&
      close(sheet.cartonMm?.width, cw) &&
      close(sheet.cartonMm?.height, label.carton[2]),
    block:
      close(sheet.blockMm?.length, bl) &&
      close(sheet.blockMm?.width, bw) &&
      (label.block[2] === null ||
        Math.abs((sheet.blockMm?.height ?? 0) - label.block[2]) <= 5),
    perLayer: sheet.cartonsPerLayer === label.perLayer,
    layers: sheet.layers === label.layers,
    perPallet: sheet.cartonsPerPallet === label.perPallet,
    productNumber:
      label.productNumber === undefined ||
      (sheet.productNumber ?? "").replace(/\s/g, "") === label.productNumber,
  };
}

async function main(): Promise<void> {
  const corpusDir = process.env.SHEET_CORPUS_DIR;
  if (!corpusDir || !isAbsolute(corpusDir)) {
    throw new Error("Set SHEET_CORPUS_DIR to an absolute folder path.");
  }
  const endpoint = resolveSheetExtractionEndpoint({
    SHEET_EXTRACTION_API: process.env.SHEET_EXTRACTION_API,
    SHEET_EXTRACTION_URL: process.env.SHEET_EXTRACTION_URL,
    OLLAMA_URL: process.env.OLLAMA_URL,
    SHEET_EXTRACTION_MODEL: process.env.SHEET_EXTRACTION_MODEL,
    SHEET_EXTRACTION_API_KEY: process.env.SHEET_EXTRACTION_API_KEY,
  });
  // Without a configured name (`openai`), label the report with the model the
  // server reports, so runs against different loaded models do not collide.
  let reportedModel: string | undefined;
  const only = process.env.SHEET_EVAL_ONLY?.split(",");
  const root = await realpath(corpusDir);
  const labels = JSON.parse(
    await readFile(join(root, "labels.json"), "utf8"),
  ) as Record<string, Label>;

  const rows: unknown[] = [];
  const totals = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<
    FieldName,
    number
  >;
  let allCorrect = 0;
  let flaggedWrong = 0;
  let silentWrong = 0;
  const files = Object.keys(labels).filter((f) => !only || only.includes(f));

  for (const file of files) {
    try {
      const image = (await readCorpusPhoto(root, file)).toString("base64");
      const result = await extractPalletSheet(image, {
        ...endpoint,
        imageMimeType: photoMimeType(file),
      });
      reportedModel ??= result.model;
      const fields = score(result.sheet, labels[file]!);
      const correct = FIELDS.every((f) => fields[f]);
      const errors = countSheetErrors(result.issues);
      for (const f of FIELDS) if (fields[f]) totals[f] += 1;
      if (correct) allCorrect += 1;
      else if (errors > 0) flaggedWrong += 1;
      else silentWrong += 1;
      const failed = FIELDS.filter((f) => !fields[f]);
      console.log(
        `${file.padEnd(7)} ${correct ? "OK  " : "FAIL"} ${(result.durationMs / 1000).toFixed(1).padStart(5)}s` +
          ` attempts=${result.attempts} errors=${errors}` +
          (failed.length ? ` wrong=${failed.join(",")}` : ""),
      );
      rows.push({
        file,
        fields,
        issues: result.issues,
        sheet: result.sheet,
        durationMs: result.durationMs,
        attempts: result.attempts,
      });
    } catch (cause) {
      flaggedWrong += 1;
      console.log(
        `${file.padEnd(7)} ERROR ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      rows.push({ file, error: String(cause) });
    }
  }

  const model = endpoint.model ?? reportedModel ?? `${endpoint.api}-unknown`;
  const n = files.length;
  console.log(`\nModel ${model}: ${allCorrect}/${n} sheets fully correct`);
  console.log(
    `  wrong but flagged by checks: ${flaggedWrong}, wrong and NOT flagged: ${silentWrong}`,
  );
  const labelledNumbers = files.filter(
    (file) => labels[file]!.productNumber !== undefined,
  ).length;
  for (const f of FIELDS) {
    const unlabelled = f === "productNumber" ? n - labelledNumbers : 0;
    console.log(
      `  ${f.padEnd(13)} ${totals[f] - unlabelled}/${n - unlabelled}`,
    );
  }
  const reportPath = join(
    root,
    `report-${model.replace(/[^\w.-]/g, "_")}.json`,
  );
  // Exclusive temp file + rename: a pre-placed link at either path is never
  // followed, it is replaced (rename) or makes the write fail (wx).
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify({ model, rows }, null, 2), {
    flag: "wx",
  });
  await rename(tempPath, reportPath);
  console.log(`Report: ${reportPath}`);
}

await main();
