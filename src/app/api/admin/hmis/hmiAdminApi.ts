import type { HmiSummary } from "~/server/hmi/hmiRepository";

import { jsonNoStore } from "../../auth/responses";

/** What the admin API returns per HMI: never the token or its hash. */
export function toAdminHmi(hmi: HmiSummary) {
  return {
    id: hmi.id,
    name: hmi.name,
    createdAt: hmi.createdAt.toISOString(),
    revokedAt: hmi.revokedAt?.toISOString() ?? null,
    lastSeenAt: hmi.lastSeenAt?.toISOString() ?? null,
    appVersion: hmi.appVersion,
    activeFinal: hmi.activeFinal,
  };
}

export function hmiNotFound() {
  return jsonNoStore({ error: "hmi_not_found" }, 404);
}

export function invalidHmiName() {
  return jsonNoStore({ error: "invalid_name" }, 400);
}
