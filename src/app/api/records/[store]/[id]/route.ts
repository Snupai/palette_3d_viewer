import { z } from "zod";

import { getSessionUser } from "~/server/auth/sessionUser";
import type { PlannerDatabase } from "~/server/db/database";
import { getServerDatabase } from "~/server/db/serverDatabase";
import {
  deleteRecord,
  getRecord,
  isValidRecordId,
  putRecord,
} from "~/server/records/recordRepository";

import { jsonNoStore, serverStorageDisabled } from "../../../auth/responses";
import {
  MAX_EXPECTED_VERSION,
  MAX_RECORD_BODY_BYTES,
  readJsonBodyWithin,
  rejectionResponse,
  toApiRecord,
  unknownStore,
  writePolicyFor,
  type WritePolicy,
} from "../../recordApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecordContext = { params: Promise<{ store: string; id: string }> };

/** `GET /api/records/:store/:id` — public; 404 `record_not_found`. */
export async function GET(
  _request: Request,
  context: RecordContext,
): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const { store, id } = await context.params;
  if (!writePolicyFor(store)) return unknownStore();

  const result = await getRecord(db, store, id);
  if (!result.ok) return rejectionResponse(result);
  if (!result.record) return jsonNoStore({ error: "record_not_found" }, 404);
  return jsonNoStore(toApiRecord(result.record));
}

/**
 * The session user if `policy` lets them write at all, plus the creator
 * restriction the repository applies atomically (`undefined` for admins).
 */
async function authorizeWrite(
  request: Request,
  db: PlannerDatabase,
  policy: WritePolicy,
): Promise<
  { userId: string; onlyCreatedBy: string | undefined } | { response: Response }
> {
  const user = await getSessionUser(request, db);
  if (!user) {
    return { response: jsonNoStore({ error: "unauthenticated" }, 401) };
  }
  if (user.role === "admin") {
    return { userId: user.id, onlyCreatedBy: undefined };
  }
  if (policy === "admin") {
    return { response: jsonNoStore({ error: "forbidden" }, 403) };
  }
  return { userId: user.id, onlyCreatedBy: user.id };
}

const putSchema = z.object({
  record: z.unknown(),
  expectedVersion: z.number().int().min(1).max(MAX_EXPECTED_VERSION).nullable(),
});

/**
 * `PUT /api/records/:store/:id` — `{ record, expectedVersion }`, JSON only.
 * `expectedVersion: null` creates the record (201; the caller becomes its
 * creator), a number updates it if it is still at that version (200). The
 * answer is `{ record, version, createdBy }`. 401 without a session, 403
 * without write permission, 409 `version_conflict` with `currentVersion`
 * (ADR 0006).
 */
export async function PUT(
  request: Request,
  context: RecordContext,
): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const { store, id } = await context.params;
  const policy = writePolicyFor(store);
  if (!policy) return unknownStore();
  if (!isValidRecordId(id)) return jsonNoStore({ error: "invalid_id" }, 400);

  const auth = await authorizeWrite(request, db, policy);
  if ("response" in auth) return auth.response;

  const json = await readJsonBodyWithin(request, MAX_RECORD_BODY_BYTES);
  if ("response" in json) return json.response;
  const parsed = putSchema.safeParse(json.body);
  if (!parsed.success || parsed.data.record === undefined) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }
  const { record, expectedVersion } = parsed.data;
  if (
    typeof record === "object" &&
    record !== null &&
    !Array.isArray(record) &&
    (record as { id?: unknown }).id !== id
  ) {
    return jsonNoStore({ error: "id_mismatch" }, 400);
  }

  const result = await putRecord(
    db,
    {
      store,
      record,
      expectedVersion,
      userId: auth.userId,
      onlyCreatedBy: auth.onlyCreatedBy,
    },
    new Date(),
  );
  if (!result.ok) return rejectionResponse(result);
  return jsonNoStore(
    toApiRecord(result.record),
    expectedVersion === null ? 201 : 200,
  );
}

const VERSION_PARAM = /^[1-9][0-9]{0,9}$/;

/**
 * `DELETE /api/records/:store/:id?expectedVersion=n` — 204. Same
 * permissions and conflict answers as `PUT`; a record that no longer exists
 * is a conflict with `currentVersion: null`. No body: browsers send a
 * cross-site `DELETE` only after a CORS preflight.
 */
export async function DELETE(
  request: Request,
  context: RecordContext,
): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const { store, id } = await context.params;
  const policy = writePolicyFor(store);
  if (!policy) return unknownStore();
  if (!isValidRecordId(id)) return jsonNoStore({ error: "invalid_id" }, 400);

  const auth = await authorizeWrite(request, db, policy);
  if ("response" in auth) return auth.response;

  const raw = new URL(request.url).searchParams.get("expectedVersion") ?? "";
  const expectedVersion = Number(raw);
  if (!VERSION_PARAM.test(raw) || expectedVersion > MAX_EXPECTED_VERSION) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }

  const result = await deleteRecord(db, {
    store,
    id,
    expectedVersion,
    onlyCreatedBy: auth.onlyCreatedBy,
  });
  if (!result.ok) return rejectionResponse(result);
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
