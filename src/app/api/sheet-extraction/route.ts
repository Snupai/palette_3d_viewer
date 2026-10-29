import { env } from "~/env";
import {
  extractPalletSheet,
  SheetExtractionError,
  type SheetExtractionErrorKind,
} from "~/lib/sheetExtraction/ollamaSheetExtractor";
import {
  createAdmissionGate,
  limitRequestBody,
  RequestBodyTooLargeError,
} from "~/lib/sheetExtraction/requestGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Multipart framing and small extra fields; anything beyond is rejected. */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 256 * 1024;

/**
 * One vision inference at a time per process by default. Each call can hold
 * the local Ollama server for minutes, so a saturated gate answers 429 at
 * once instead of queueing requests behind it. Authentication and per-caller
 * rate limiting are deliberately left to the deployment: the route is meant
 * for the local line network only, or behind an authenticating proxy (see
 * README, "Sheet-photo extraction deployment").
 */
const admission = createAdmissionGate(env.SHEET_EXTRACTION_MAX_CONCURRENT);
/** Bound multipart memory use separately from model concurrency. */
const uploadAdmission = createAdmissionGate(4);

function statusForExtractionError(kind: SheetExtractionErrorKind): number {
  switch (kind) {
    case "unreachable":
      return 503;
    case "timeout":
      return 504;
    case "model":
    case "invalid-response":
      return 502;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Fixed client-facing text per failure kind. The detailed message carries the
 * model URL, transport errors and backend bodies, so it is only logged.
 */
function publicExtractionError(kind: SheetExtractionErrorKind): string {
  switch (kind) {
    case "unreachable":
      return "The sheet-reading model is not reachable.";
    case "timeout":
      return "The sheet-reading model timed out.";
    case "model":
      return "The sheet-reading model reported an error.";
    case "invalid-response":
      return "The sheet-reading model returned an unusable answer.";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

/**
 * POST multipart `image` → structured pallet sheet. Runs entirely against the
 * local Ollama server; the photo is not stored.
 */
export async function POST(request: Request): Promise<Response> {
  let image: FormDataEntryValue | null;
  const releaseUpload = uploadAdmission.tryAcquire();
  if (!releaseUpload) {
    return Response.json(
      { error: "Too many photo uploads. Try again shortly." },
      { status: 429, headers: { "retry-after": "10" } },
    );
  }
  try {
    image = (await limitRequestBody(request, MAX_BODY_BYTES).formData()).get(
      "image",
    );
  } catch (cause) {
    if (request.signal.aborted || isAbortError(cause)) {
      return new Response(null, { status: 499 });
    }
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return Response.json(
        { error: "Photo upload timed out." },
        { status: 408 },
      );
    }
    if (cause instanceof RequestBodyTooLargeError) {
      return Response.json(
        { error: "Photo is larger than 20 MB." },
        { status: 413 },
      );
    }
    return Response.json(
      { error: "Expected multipart form data." },
      { status: 400 },
    );
  } finally {
    releaseUpload();
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

  if (request.signal.aborted) return new Response(null, { status: 499 });
  const release = admission.tryAcquire();
  if (!release) {
    return Response.json(
      { error: "Sheet extraction is busy. Try again shortly." },
      { status: 429, headers: { "retry-after": "10" } },
    );
  }
  try {
    const imageBase64 = Buffer.from(await image.arrayBuffer()).toString(
      "base64",
    );
    const result = await extractPalletSheet(imageBase64, {
      ollamaUrl: env.OLLAMA_URL,
      model: env.SHEET_EXTRACTION_MODEL,
      signal: request.signal,
    });
    return Response.json(result);
  } catch (cause) {
    if (request.signal.aborted || isAbortError(cause)) {
      return new Response(null, { status: 499 });
    }
    if (cause instanceof SheetExtractionError) {
      console.error("Sheet extraction failed", cause.message);
      return Response.json(
        { error: publicExtractionError(cause.kind) },
        { status: statusForExtractionError(cause.kind) },
      );
    }
    console.error("Sheet extraction failed", cause);
    return Response.json(
      { error: "Sheet extraction failed." },
      { status: 500 },
    );
  } finally {
    release();
  }
}
