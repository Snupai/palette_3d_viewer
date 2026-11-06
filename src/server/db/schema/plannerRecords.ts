import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * Generic JSON record table (ADR 0004, ADR 0009): one row per planner record,
 * keyed by the client store name (`projects`, `pallets`, …) and the record id.
 * The server only checks structure; full Zod validation stays in the client.
 *
 * - `json` holds the record as a `jsonb` object.
 * - `version` starts at 1 and is bumped by every put, including recreation.
 * - `deleted` retains version continuity without retaining the deleted payload.
 * - `created_by` is the creating user's id (`users.id`, #28); nullable, and
 *   set to null when that user is deleted so their records survive.
 */
export const plannerRecords = pgTable(
  "planner_records",
  {
    store: text("store").notNull(),
    id: text("id").notNull(),
    json: jsonb("json").$type<Record<string, unknown>>().notNull(),
    deleted: boolean("deleted").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.store, table.id] }),
    check(
      "planner_records_json_object",
      sql`jsonb_typeof(${table.json}) = 'object'`,
    ),
    check("planner_records_version_positive", sql`${table.version} >= 1`),
  ],
);

export type PlannerRecordRow = typeof plannerRecords.$inferSelect;
export type NewPlannerRecordRow = typeof plannerRecords.$inferInsert;
