import { SHEET_EXTRACTION_PROMPT } from "~/domain/sheetExtraction/prompt";
import { palletSheetJsonSchema } from "~/domain/sheetExtraction/sheetSchema";

/**
 * How a sheet-reading model is prompted, by model family.
 *
 * - `instruct`: general vision chat models (Qwen-VL). One long instruction
 *   prompt, schema-constrained JSON, retry with the consistency errors.
 * - `nuextract`: NuMind NuExtract 2.0. Trained on `# Template:` + `# Context:`
 *   with a typed JSON template instead of instructions; the template keys are
 *   its only semantic hint, so they are descriptive and mapped back afterwards.
 *   Not a chat model, so no retry turn.
 * - `ocr-extract`: Nanonets-OCR2. First its own trained OCR prompt (free text,
 *   tables as HTML), then the field mapping applied to that transcription.
 */
export const SHEET_PROMPT_STYLES = [
  "instruct",
  "nuextract",
  "ocr-extract",
] as const;
export type SheetPromptStyle = (typeof SHEET_PROMPT_STYLES)[number];

/** Picks the style from the option id or model name; unknown models use `instruct`. */
export function sheetPromptStyleFor(
  ...names: readonly (string | undefined)[]
): SheetPromptStyle {
  const text = names.join(" ").toLowerCase();
  if (text.includes("nuextract")) return "nuextract";
  if (text.includes("nanonets")) return "ocr-extract";
  return "instruct";
}

export type SheetPromptStep = {
  text: string;
  /** Attach the photo to this message. */
  image: boolean;
  /** Photo before the text (Nanonets reads "the above document"). */
  imageFirst?: boolean;
};

export type SheetPromptPlan = {
  /** Run once in order; each answer is kept as context for the next step. */
  prelude: readonly SheetPromptStep[];
  /** The step whose answer is the sheet JSON. */
  extract: SheetPromptStep;
  /** JSON schema the extraction answer is constrained to. */
  jsonSchema: object;
  /** Maps the parsed answer onto the `rawPalletSheetSchema` keys. */
  toRawSheet: (answer: unknown) => unknown;
  /** Whether a follow-up turn with the consistency errors makes sense. */
  allowRetry: boolean;
};

/** Nanonets-OCR2's trained document prompt, verbatim. */
export const NANONETS_OCR_PROMPT = `Extract the text from the above document as if you were reading it naturally. Return the tables in html format. Return the equations in LaTeX representation. If there is an image in the document and image has a caption, put the caption inside <caption></caption>; otherwise, add a description of the image inside <img></img> tag. Watermarks should be wrapped in brackets. Ex: <watermark>OFFICIAL COPY</watermark>. Page numbers should be wrapped in brackets. Ex: <page_number>14</page_number> or <page_number>9/22</page_number>. Prefer using ☐ and ☑ for check boxes.`;

export const OCR_EXTRACT_PROMPT = `Your answer above is the transcription of a photographed German pallet specification sheet. Using that transcription and the photo, fill the JSON object described below.

${SHEET_EXTRACTION_PROMPT}`;

const dims3 = { length: "number", width: "number", height: "number" };

/**
 * NuExtract template: typed fields (`verbatim-string` copies text exactly,
 * a list is a closed choice). Keys say what to look for, since NuExtract gets
 * no instructions; `NUEXTRACT_KEYS` maps them to the sheet schema.
 * Carton, product-number and count keys carry the German sheet labels: on 20
 * real photos this raised fully correct sheets from 10 to 15 (nuextract3).
 * Keys interact — a German block key made the block worse — so measure every
 * rename with `bun run sheet:eval` before keeping it.
 */
export const NUEXTRACT_TEMPLATE = {
  sheet_layout: [
    "multipack",
    "pester",
    "loreal",
    "tops",
    "kao",
    "flyer",
    "other",
  ],
  product_name: "verbatim-string",
  Produkt_Nr_article_number_digits_dash_digits_may_be_handwritten:
    "verbatim-string",
  carton_code_starting_with_UK: "verbatim-string",
  carton_outer_dimensions_mm_Packstueckmasse_or_Abmessung_der_VE_or_VPE_aussen_not_EP:
    dims3,
  stacked_load_block_dimensions_without_pallet_mm: dims3,
  wooden_pallet_footprint_mm: { length: "number", width: "number" },
  pallet_load_space_height_mm: "number",
  total_height_including_pallet_mm: "number",
  cartons_per_layer_Packstuecke_VE_VPE_pro_Lage: "integer",
  number_of_layers_Lagen_pro_Palette: "integer",
  cartons_per_pallet_Packstuecke_VE_VPE_pro_Palette: "integer",
  product_units_per_shipping_carton: "integer",
  shipping_carton_weight_kg: "number",
  handwritten_notes: "string",
} as const;

const NUEXTRACT_KEYS = {
  sheet_layout: "sheetType",
  product_name: "productName",
  Produkt_Nr_article_number_digits_dash_digits_may_be_handwritten:
    "productNumber",
  carton_code_starting_with_UK: "cartonId",
  carton_outer_dimensions_mm_Packstueckmasse_or_Abmessung_der_VE_or_VPE_aussen_not_EP:
    "cartonMm",
  stacked_load_block_dimensions_without_pallet_mm: "blockMm",
  wooden_pallet_footprint_mm: "palletMm",
  pallet_load_space_height_mm: "loadSpaceHeightMm",
  total_height_including_pallet_mm: "totalHeightMm",
  cartons_per_layer_Packstuecke_VE_VPE_pro_Lage: "cartonsPerLayer",
  number_of_layers_Lagen_pro_Palette: "layers",
  cartons_per_pallet_Packstuecke_VE_VPE_pro_Palette: "cartonsPerPallet",
  product_units_per_shipping_carton: "unitsPerCarton",
  shipping_carton_weight_kg: "cartonWeightKg",
  handwritten_notes: "handwrittenNotes",
} as const satisfies Record<keyof typeof NUEXTRACT_TEMPLATE, string>;

/** NuExtract's chat template layout, written out for servers that ignore its `template` kwarg. */
export const NUEXTRACT_PROMPT = `# Template:
${JSON.stringify(NUEXTRACT_TEMPLATE, null, 4)}
# Context:
`;

type TemplateField =
  | string
  | readonly string[]
  | { [key: string]: TemplateField };

/** JSON schema of a NuExtract template; every field may be null (absent). */
export function nuExtractJsonSchema(field: TemplateField): object {
  if (Array.isArray(field))
    return { enum: [...(field as readonly string[]), null] };
  if (typeof field === "string") {
    const type =
      field === "integer"
        ? "integer"
        : field === "number"
          ? "number"
          : "string";
    return { type: [type, "null"] };
  }
  const entries = Object.entries(field as Record<string, TemplateField>);
  return {
    type: "object",
    properties: Object.fromEntries(
      entries.map(([key, value]) => [key, nuExtractJsonSchema(value)]),
    ),
    required: entries.map(([key]) => key),
  };
}

export function nuExtractToRawSheet(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null) return answer;
  const source = answer as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(NUEXTRACT_KEYS).map(([from, to]) => [to, source[from]]),
  );
}

export function sheetPromptPlan(style: SheetPromptStyle): SheetPromptPlan {
  switch (style) {
    case "instruct":
      return {
        prelude: [],
        extract: { text: SHEET_EXTRACTION_PROMPT, image: true },
        jsonSchema: palletSheetJsonSchema,
        toRawSheet: (answer) => answer,
        allowRetry: true,
      };
    case "nuextract":
      return {
        prelude: [],
        extract: { text: NUEXTRACT_PROMPT, image: true },
        jsonSchema: nuExtractJsonSchema(NUEXTRACT_TEMPLATE),
        toRawSheet: nuExtractToRawSheet,
        allowRetry: false,
      };
    case "ocr-extract":
      return {
        prelude: [{ text: NANONETS_OCR_PROMPT, image: true, imageFirst: true }],
        extract: { text: OCR_EXTRACT_PROMPT, image: false },
        jsonSchema: palletSheetJsonSchema,
        toRawSheet: (answer) => answer,
        allowRetry: true,
      };
    default: {
      const _exhaustive: never = style;
      return _exhaustive;
    }
  }
}
