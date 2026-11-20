import { getFinal } from "~/server/finals/finalRepository";

import { jsonNoStore } from "../../../../../auth/responses";
import { ifNoneMatchMatches, notModified, requireHmi } from "../../../hmiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `Content-Disposition` with an ASCII fallback and the exact UTF-8 name. */
function attachmentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  // RFC 8187 attr-chars: `encodeURIComponent` leaves `'()*!` unescaped.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * `GET /api/hmi/v1/finals/:id/rob` — the frozen `.rob` of a current **or
 * withdrawn** Fertigstand (an HMI may need to reload a plan it still runs):
 * the same bytes and line endings as marked, `ETag: "<sha256>"`, `304` when
 * `If-None-Match` matches, 404 `final_not_found` for an unknown id.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireHmi(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const final = await getFinal(auth.db, id);
  if (!final) return jsonNoStore({ error: "final_not_found" }, 404);
  const etag = `"${final.sha256}"`;
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return notModified(etag);
  }
  return new Response(Buffer.from(final.robText, "utf8"), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      etag,
      "content-disposition": attachmentDisposition(final.fileName),
      "cache-control": "no-store",
    },
  });
}
