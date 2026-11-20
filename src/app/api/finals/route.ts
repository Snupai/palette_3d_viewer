import { z } from "zod";

import { getServerDatabase } from "~/server/db/serverDatabase";
import { listCurrentFinals, markFinal } from "~/server/finals/finalRepository";
import { isValidRecordId } from "~/server/records/recordRepository";

import {
  jsonNoStore,
  readJsonBody,
  serverStorageDisabled,
} from "../auth/responses";
import {
  finalRejectionResponse,
  MAX_MARK_BODY_BYTES,
  requireFinalManager,
  toApiFinal,
} from "./finalApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/finals[?recordId=…]` — current Fertigstände (ADR 0013) as
 * `{ finals: [{ id, recordId, recordVersion, name, fileName, sha256,
 * markedAt }] }`, ordered by name. Public like project reads (ADR 0003); the
 * `.rob` text is not part of the list. 404 in local storage mode.
 */
export async function GET(request: Request): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();
  const recordId = new URL(request.url).searchParams.get("recordId");
  if (recordId !== null && !isValidRecordId(recordId)) {
    return jsonNoStore({ error: "invalid_request" }, 400);
  }
  const finals = await listCurrentFinals(
    db,
    recordId === null ? {} : { recordId },
  );
  return jsonNoStore({ finals: finals.map(toApiFinal) });
}

const markSchema = z.object({
  recordId: z.string(),
  recordVersion: z.number().int(),
  name: z.string(),
  fileName: z.string(),
  robText: z.string(),
});

/**
 * `POST /api/finals` — `{ recordId, recordVersion, name, fileName, robText }`,
 * JSON only. Marks the project finished at exactly `recordVersion`: 201 with
 * the new Fertigstand (replacing and withdrawing a current one), 200 when the
 * same text and version were already current. 401 without a session, 403
 * when the user may not mark, 409 `version_conflict` with `currentVersion`
 * (`null`: the project is gone) when the project is not stored at that
 * version, 413 `rob_too_large`, 422 `rob_invalid` when the text does not
 * parse as `.rob`. The text is stored unchanged.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireFinalManager(request);
  if ("response" in auth) return auth.response;

  const json = await readJsonBody(request, MAX_MARK_BODY_BYTES);
  if ("response" in json) return json.response;
  const parsed = markSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);

  const result = await markFinal(
    auth.db,
    { ...parsed.data, userId: auth.user.id },
    new Date(),
  );
  if (!result.ok) return finalRejectionResponse(result);
  return jsonNoStore(
    {
      final: toApiFinal(result.final),
      replacedId: result.replaced?.id ?? null,
    },
    result.unchanged ? 200 : 201,
  );
}
