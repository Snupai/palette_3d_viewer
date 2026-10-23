#!/usr/bin/env bun

/**
 * Scores the local sheet extractor against hand-labelled photos.
 *
 *   SHEET_CORPUS_DIR=/abs/path SHEET_EXTRACTION_MODEL=qwen2.5vl:32b bun run sheet:eval
 *
 * The corpus folder holds the photos plus `labels.json`
 * (`{ "<file>": { carton: [l, w, h], block: [l, w, h|null], perLayer, layers, perPallet } }`).
 * Photos contain customer data and stay outside the repository; the report is
 * written next to them.
 */
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { countSheetErrors, type PalletSheet } from "~/domain/sheetExtraction";
import { extractPalletSheet } from "~/lib/sheetExtraction/ollamaSheetExtractor";

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
  const model = process.env.SHEET_EXTRACTION_MODEL ?? "qwen2.5vl:32b";
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
  const only = process.env.SHEET_EVAL_ONLY?.split(",");
  const labels = JSON.parse(
    await readFile(join(corpusDir, "labels.json"), "utf8"),
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
    const image = (await readFile(join(corpusDir, file))).toString("base64");
    try {
      const result = await extractPalletSheet(image, { ollamaUrl, model });
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
    corpusDir,
    `report-${model.replace(/[^\w.-]/g, "_")}.json`,
  );
  await writeFile(reportPath, JSON.stringify({ model, rows }, null, 2));
  console.log(`Report: ${reportPath}`);
}

await main();
