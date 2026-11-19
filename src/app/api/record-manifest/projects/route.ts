import { getServerDatabase } from "~/server/db/serverDatabase";
import { listRecordManifest } from "~/server/records/recordRepository";

import { jsonNoStore, serverStorageDisabled } from "../../auth/responses";
import { rejectionResponse } from "../../records/recordApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/record-manifest/projects` — `{ entries: [{ id, version }] }` for
 * every live project, ordered by id, without payloads or `createdBy`. Public
 * and identical for every reader (ADR 0003). Clients fetch ids they do not
 * hold with `GET /api/records/projects/:id`.
 */
export async function GET(): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const result = await listRecordManifest(db, "projects");
  if (!result.ok) return rejectionResponse(result);
  return jsonNoStore({ entries: result.entries });
}
