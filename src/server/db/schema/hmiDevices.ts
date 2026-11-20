import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { planFinals } from "./planFinals";

/**
 * Registered HMIs (ADR 0013): the Raspberry Pi operator panels that pull
 * Fertigstände. Admins create, rename, revoke them and regenerate their
 * tokens; rows are never deleted.
 *
 * - `token_hash` is the SHA-256 hex of the device's bearer token, like
 *   `sessions.token_hash`; the token itself is shown to the admin once.
 *   Regenerating replaces the hash, so the old token stops working.
 * - `revoked_at` set: every token request is refused until a new token is
 *   generated, which clears it.
 * - `last_seen_at` is the last authenticated request, written at most every
 *   few seconds (`LAST_SEEN_WRITE_INTERVAL_MS`), not on every poll.
 * - `active_final_id` and `app_version` are what the HMI last reported via
 *   `POST /api/hmi/v1/status`. Fertigstände are never deleted, so the
 *   reference stays valid; `set null` only guards against manual cleanup.
 */
export const hmiDevices = pgTable(
  "hmi_devices",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    }),
    activeFinalId: uuid("active_final_id").references(() => planFinals.id, {
      onDelete: "set null",
    }),
    appVersion: text("app_version"),
  },
  (table) => [
    check(
      "hmi_devices_token_hash_hex",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type HmiDeviceRow = typeof hmiDevices.$inferSelect;
