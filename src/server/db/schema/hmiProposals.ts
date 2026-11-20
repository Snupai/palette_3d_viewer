import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { hmiDevices } from "./hmiDevices";
import { planFinals } from "./planFinals";
import { users } from "./users";

/**
 * Planvorschläge (ADR 0013): a signed-in user, usually via the QR code on an
 * HMI, suggests one Fertigstand to that HMI. Nothing changes on the HMI until
 * its operator accepts; the HMI reports `accepted` or `rejected`.
 *
 * - `state` starts `pending`. A newer proposal to the same HMI closes the open
 *   one as `superseded` (so does withdrawing its Fertigstand); after 24 h it is
 *   `expired`; the proposing side may `cancelled` it. Closed rows are kept.
 * - At most one `pending` row per HMI (partial unique index).
 * - `proposed_by` is set to null when that user is deleted, like
 *   `plan_finals.marked_by`. HMIs and Fertigstände are never deleted.
 */
export const HMI_PROPOSAL_STATES = [
  "pending",
  "accepted",
  "rejected",
  "superseded",
  "expired",
  "cancelled",
] as const;
export type HmiProposalState = (typeof HMI_PROPOSAL_STATES)[number];

export const hmiProposals = pgTable(
  "hmi_proposals",
  {
    id: uuid("id").primaryKey(),
    hmiId: uuid("hmi_id")
      .notNull()
      .references(() => hmiDevices.id),
    finalId: uuid("final_id")
      .notNull()
      .references(() => planFinals.id),
    proposedBy: text("proposed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    state: text("state").$type<HmiProposalState>().notNull(),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("hmi_proposals_one_pending_per_hmi")
      .on(table.hmiId)
      .where(sql`${table.state} = 'pending'`),
    index("hmi_proposals_hmi_created_idx").on(table.hmiId, table.createdAt),
    check(
      "hmi_proposals_state_known",
      sql`${table.state} IN ('pending', 'accepted', 'rejected', 'superseded', 'expired', 'cancelled')`,
    ),
    check(
      "hmi_proposals_resolved_when_closed",
      sql`(${table.state} = 'pending') = (${table.resolvedAt} IS NULL)`,
    ),
  ],
);

export type HmiProposalRow = typeof hmiProposals.$inferSelect;
