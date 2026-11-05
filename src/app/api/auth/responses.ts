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

/**
 * Reads a JSON request body. JSON only: a cross-site HTML form cannot send
 * `application/json` without a CORS preflight, so this is the CSRF guard for
 * cookie-authenticated POSTs. Returns the parsed body or an error response
 * (415 for other content types, 400 for unparsable JSON).
 */
export async function readJsonBody(
  request: Request,
): Promise<{ body: unknown } | { response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return {
      response: jsonNoStore({ error: "unsupported_media_type" }, 415),
    };
  }
  try {
    return { body: await request.json() };
  } catch {
    return { response: jsonNoStore({ error: "invalid_request" }, 400) };
  }
}
