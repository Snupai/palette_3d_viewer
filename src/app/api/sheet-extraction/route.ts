import { env } from "~/env";
import {
  extractPalletSheet,
  SheetExtractionError,
} from "~/lib/sheetExtraction/ollamaSheetExtractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * POST multipart `image` → structured pallet sheet. Runs entirely against the
 * local Ollama server; the photo is not stored.
 */
export async function POST(request: Request): Promise<Response> {
  let image: FormDataEntryValue | null;
  try {
    image = (await request.formData()).get("image");
  } catch {
    return Response.json(
      { error: "Expected multipart form data." },
      { status: 400 },
    );
  }
  if (!(image instanceof File) || !image.type.startsWith("image/")) {
    return Response.json(
      { error: "Attach a photo as `image`." },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return Response.json(
      { error: "Photo is larger than 20 MB." },
      { status: 413 },
    );
  }

  const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  try {
    const result = await extractPalletSheet(imageBase64, {
      ollamaUrl: env.OLLAMA_URL,
      model: env.SHEET_EXTRACTION_MODEL,
    });
    return Response.json(result);
  } catch (cause) {
    if (cause instanceof SheetExtractionError) {
      return Response.json(
        { error: cause.message },
        { status: cause.kind === "unreachable" ? 503 : 502 },
      );
    }
    console.error("Sheet extraction failed", cause);
    return Response.json(
      { error: "Sheet extraction failed." },
      { status: 500 },
    );
  }
}
