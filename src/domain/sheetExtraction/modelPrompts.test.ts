import { describe, expect, it } from "vitest";
import {
  NUEXTRACT_PROMPT,
  NUEXTRACT_TEMPLATE,
  nuExtractJsonSchema,
  nuExtractToRawSheet,
  sheetPromptPlan,
  sheetPromptStyleFor,
} from "./modelPrompts";
import { rawPalletSheetSchema } from "./sheetSchema";

describe("sheetPromptStyleFor", () => {
  it("picks the style from option id or model name", () => {
    expect(sheetPromptStyleFor("qwen", "qwen3.8-27b")).toBe("instruct");
    expect(sheetPromptStyleFor("ocr", "Nanonets-OCR2-3B")).toBe("ocr-extract");
    expect(sheetPromptStyleFor("nuextract", "model.gguf")).toBe("nuextract");
    expect(sheetPromptStyleFor(undefined)).toBe("instruct");
  });
});

describe("NuExtract template", () => {
  it("follows NuExtract's Template/Context layout", () => {
    expect(NUEXTRACT_PROMPT.startsWith("# Template:\n{")).toBe(true);
    expect(NUEXTRACT_PROMPT.endsWith("}\n# Context:\n")).toBe(true);
  });

  it("maps every template field onto a sheet schema key", () => {
    const mapped = nuExtractToRawSheet(
      Object.fromEntries(
        Object.keys(NUEXTRACT_TEMPLATE).map((key) => [key, null]),
      ),
    ) as Record<string, unknown>;
    expect(Object.keys(mapped).sort()).toEqual(
      Object.keys(rawPalletSheetSchema.shape).sort(),
    );
  });

  it("allows null for every field and limits the layout to the known choices", () => {
    const schema = nuExtractJsonSchema(NUEXTRACT_TEMPLATE) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required).toHaveLength(15);
    expect(schema.properties.sheet_layout).toEqual({
      enum: [
        "multipack",
        "pester",
        "loreal",
        "tops",
        "kao",
        "flyer",
        "other",
        null,
      ],
    });
    expect(schema.properties.wooden_pallet_footprint_mm).toEqual({
      type: "object",
      properties: {
        length: { type: ["number", "null"] },
        width: { type: ["number", "null"] },
      },
      required: ["length", "width"],
    });
    expect(schema.properties.handwritten_notes).toEqual({
      type: ["string", "null"],
    });
  });
});

describe("sheetPromptPlan", () => {
  it("runs an OCR prelude only for Nanonets and retries only chat models", () => {
    expect(sheetPromptPlan("instruct")).toMatchObject({
      prelude: [],
      allowRetry: true,
    });
    expect(sheetPromptPlan("nuextract")).toMatchObject({
      prelude: [],
      allowRetry: false,
    });
    expect(sheetPromptPlan("ocr-extract")).toMatchObject({
      prelude: [{ image: true, imageFirst: true }],
      extract: { image: false },
      allowRetry: true,
    });
  });
});
