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
