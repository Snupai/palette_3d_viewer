import { getServerDatabase } from "~/server/db/serverDatabase";
import { listRecords } from "~/server/records/recordRepository";

import { jsonNoStore, serverStorageDisabled } from "../../auth/responses";
import {
  recordReader,
  rejectionResponse,
  toApiRecord,
  unknownStore,
  writePolicyFor,
} from "../recordApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/records/:store` — every record of the store, ordered by id, as
 * `{ records: [{ record, version, createdBy? }] }`. Public (ADR 0003): no
 * session needed, and never filtered by creator; `createdBy` is projected
 * per reader (`toApiRecord`).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ store: string }> },
): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const { store } = await context.params;
  if (!writePolicyFor(store)) return unknownStore();

  const result = await listRecords(db, store);
  if (!result.ok) return rejectionResponse(result);
  const reader = await recordReader(request, db);
  return jsonNoStore({
    records: result.records.map((stored) => toApiRecord(stored, reader)),
  });
}
