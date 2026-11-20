import { z } from "zod";

import { reportHmiStatus } from "~/server/hmi/hmiRepository";

import { jsonNoStore, readJsonBody } from "../../../auth/responses";
import { requireHmi } from "../hmiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.object({
  activeFinalId: z.string().uuid().nullable(),
  activeSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .transform((value) => value.toLowerCase())
    .nullable(),
  appVersion: z.string().max(1000).nullable(),
});

/**
 * `POST /api/hmi/v1/status` — `{ activeFinalId, activeSha256, appVersion }`,
 * JSON. Stores what runs on the HMI: 204. The active
 * Fertigstand is kept only when the planner knows `activeFinalId` and
 * `activeSha256` matches it; otherwise none is recorded. 400
 * `invalid_request` for a malformed body.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireHmi(request);
  if ("response" in auth) return auth.response;
  const json = await readJsonBody(request);
  if ("response" in json) return json.response;
  const parsed = statusSchema.safeParse(json.body);
  if (!parsed.success) return jsonNoStore({ error: "invalid_request" }, 400);
  await reportHmiStatus(auth.db, auth.hmi.id, parsed.data);
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
