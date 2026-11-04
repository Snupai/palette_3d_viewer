import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Generic JSON record table (ADR 0004, ADR 0009): one row per planner record,
 * keyed by the client store name (`projects`, `pallets`, …) and the record id.
 * The server only checks structure; full Zod validation stays in the client.
 *
 * - `json` holds the record as a `jsonb` object.
 * - `version` starts at 1 and is bumped by every write (ADR 0006).
 * - `created_by` is the creating user's id; nullable and without a foreign
 *   key until the users table exists (#28), which may add the constraint.
 */
export const plannerRecords = pgTable(
  "planner_records",
  {
    store: text("store").notNull(),
    id: text("id").notNull(),
    json: jsonb("json").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
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
