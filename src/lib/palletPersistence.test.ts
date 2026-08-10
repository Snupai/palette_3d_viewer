import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CURRENT_PALLET_SCHEMA_VERSION,
  formatPalletStorageIssues,
  normalizeStoredPallet,
  palletDataSchema,
  parseLegacyPalletJson,
  validateStoredPallets,
} from "~/lib/palletPersistence";
import { parseRobText } from "~/lib/robParser";

const rawText = readFileSync(
  resolve(
    process.cwd(),
    "src",
    "lib",
    "__fixtures__",
    "anonymized-plan-lf.rob",
  ),
  "utf8",
);
const data = parseRobText(rawText);

function legacyRecord() {
  return {
    id: "legacy-pallet",
    name: "Legacy pallet",
    createdAt: 1,
    data,
    rawText,
  };
}

describe("persisted pallet validation", () => {
  it("migrates a valid unversioned record", () => {
    const result = normalizeStoredPallet(legacyRecord());

    expect("pallet" in result).toBe(true);
    if (!("pallet" in result)) return;
    expect(result.repaired).toBe(true);
    expect(result.pallet.schemaVersion).toBe(CURRENT_PALLET_SCHEMA_VERSION);
    expect(result.pallet.data.layer_count).toBe(3);
  });

  it("accepts backward-compatible planner and variable sheet preview fields", () => {
    const enriched = {
      ...data,
      interlayer: { width: 1100, length: 700 },
      trailingInterlayerDimensions: { width: 1050, length: 650 },
      planner: {
        projectId: "project-1",
        solutionId: "solution-1",
        layers: data.layers.map((_, index) => ({
          id: `layer-${index + 1}`,
          label: `Layer ${index + 1}`,
          patternRef: `pattern-${index + 1}`,
          candidateId: null,
          isSpecialTop: false,
        })),
        metrics: {
          packageCount: data.total_boxes,
          cycleCount: 4,
          loadStackHeightMm: 450,
          areaUtilizationPercent: 50,
          volumeUtilizationPercent: 40,
          grossWeightKg: null,
        },
        warningCodes: [],
      },
    };
    const result = normalizeStoredPallet({
      ...legacyRecord(),
      schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
      data: enriched,
    });

    expect("pallet" in result).toBe(true);
    if (!("pallet" in result)) return;
    expect(result.repaired).toBe(false);
    expect(result.pallet.data.interlayer).toEqual({ width: 1100, length: 700 });
    expect(result.pallet.data.planner?.projectId).toBe("project-1");
  });

  it("rejects exact per-layer thickness arrays with the wrong cardinality", () => {
    const invalid = structuredClone(data);
    invalid.layers[0]!.zwischenlage = 2;
    invalid.layers[0]!.interlayerThicknessesMm = [5];

    const result = palletDataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["layers", 0, "interlayerThicknessesMm"],
        }),
      ]),
    );
  });

  it("rejects exact trailing thickness arrays with the wrong cardinality", () => {
    const invalid = structuredClone(data);
    invalid.trailingZwischenlage = 1;
    invalid.trailingInterlayerThicknessesMm = [4, 6];

    const result = palletDataSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["trailingInterlayerThicknessesMm"],
        }),
      ]),
    );
  });

  it("accepts exact thickness arrays when their cardinalities match", () => {
    const exact = structuredClone(data);
    exact.layers[0]!.zwischenlage = 2;
    exact.layers[0]!.interlayerThicknessesMm = [5, 7];
    exact.trailingZwischenlage = 2;
    exact.trailingInterlayerThicknessesMm = [4, 6];

    expect(palletDataSchema.safeParse(exact).success).toBe(true);
  });

  it("keeps count-based legacy thickness fallback when exact arrays are absent", () => {
    const legacy = structuredClone(data);
    legacy.layers[0]!.zwischenlage = 2;
    legacy.layers[0]!.interlayerThicknessesMm = undefined;
    legacy.trailingZwischenlage = 2;
    legacy.trailingInterlayerThicknessesMm = undefined;

    expect(palletDataSchema.safeParse(legacy).success).toBe(true);
  });

  it("recovers invalid nested data from valid raw ROB text", () => {
    const result = normalizeStoredPallet({
      ...legacyRecord(),
      schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
      data: { package: null },
    });

    expect("pallet" in result).toBe(true);
    if (!("pallet" in result)) return;
    expect(result.repaired).toBe(true);
    expect(result.pallet.data.total_boxes).toBe(data.total_boxes);
    expect(result.pallet.originalRawText).toBe(rawText);
  });

  it("keeps valid records while skipping unrecoverable rows", () => {
    const result = validateStoredPallets([
      legacyRecord(),
      {
        ...legacyRecord(),
        id: "recovered-pallet",
        name: "Recovered pallet",
        data: { layers: "invalid" },
      },
      {
        id: "damaged-pallet",
        name: "Damaged pallet",
        createdAt: 2,
        data: { layers: "invalid" },
        rawText: "not a ROB plan",
      },
    ]);

    expect(result.pallets.map(({ id }) => id)).toEqual([
      "legacy-pallet",
      "recovered-pallet",
    ]);
    expect(result.repaired).toHaveLength(2);
    expect(result.issues).toHaveLength(1);
    expect(formatPalletStorageIssues(result.issues)).toMatch(
      /Skipped 1 saved pallet.*Damaged pallet.*recovery failed/i,
    );
  });

  it("reports malformed legacy JSON without throwing", () => {
    const result = parseLegacyPalletJson("{not-json");

    expect(result.parsed).toBe(false);
    expect(result.pallets).toEqual([]);
    expect(formatPalletStorageIssues(result.issues)).toMatch(/invalid JSON/i);
  });

  it("rejects inconsistent nested pallet counts when recovery is unavailable", () => {
    const result = normalizeStoredPallet({
      ...legacyRecord(),
      schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
      rawText: undefined,
      data: { ...data, layer_count: data.layer_count + 1 },
    });

    expect("issue" in result).toBe(true);
    if (!("issue" in result)) return;
    expect(result.issue.reason).toMatch(/no raw \.rob text/i);
  });
});
