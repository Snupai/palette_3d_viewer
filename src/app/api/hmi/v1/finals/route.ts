import { listCurrentFinals } from "~/server/finals/finalRepository";

import {
  bodyEtag,
  ifNoneMatchMatches,
  notModified,
  requireHmi,
  toHmiFinal,
} from "../hmiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/hmi/v1/finals` — the current Fertigstände as `{ finals: [{ id,
 * recordId, name, fileName, sha256, markedAt }] }`, ordered by name, with an
 * ETag over the body; `304` when `If-None-Match` matches. Records the HMI as
 * seen (throttled). Device token only; 404 in local storage mode.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireHmi(request);
  if ("response" in auth) return auth.response;
  const finals = await listCurrentFinals(auth.db);
  const body = JSON.stringify({ finals: finals.map(toHmiFinal) });
  const etag = bodyEtag(body);
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return notModified(etag);
  }
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      etag,
      "cache-control": "no-store",
    },
  });
}
