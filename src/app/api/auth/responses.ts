import { NextResponse } from "next/server";

/** Auth API responses are per-user and must never be cached. */
export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/** Local storage mode (ADR 0002): the server has no accounts. */
export function serverStorageDisabled(): NextResponse {
  return jsonNoStore({ error: "server_storage_disabled" }, 404);
}

/** Login and admin bodies are a few short strings; 16 KiB is generous. */
export const MAX_AUTH_JSON_BODY_BYTES = 16 * 1024;

/**
 * Reads a JSON request body of at most `maxBytes`. JSON only: a cross-site
 * HTML form cannot send `application/json` without a CORS preflight, so this
 * is the CSRF guard for cookie-authenticated POSTs. Returns the parsed body or
 * an error response (415 for other content types, 413 `payload_too_large`
 * when the declared or streamed size exceeds the cap, 400 for invalid UTF-8 or
 * unparsable JSON). The body is never buffered past the cap.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = MAX_AUTH_JSON_BODY_BYTES,
): Promise<{ body: unknown } | { response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return {
      response: jsonNoStore({ error: "unsupported_media_type" }, 415),
    };
  }
  const tooLarge = () => ({
    response: jsonNoStore({ error: "payload_too_large" }, 413),
  });
  const invalidRequest = () => ({
    response: jsonNoStore({ error: "invalid_request" }, 400),
  });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    return tooLarge();
  }
  if (!request.body) return invalidRequest();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return { body: JSON.parse(text) as unknown };
  } catch {
    return invalidRequest();
  }
}
