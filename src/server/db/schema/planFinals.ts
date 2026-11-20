import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { plannerRecords } from "./plannerRecords";
import { users } from "./users";

/**
 * Fertigstände (ADR 0013): the frozen `.rob` of a project as it was when
 * someone marked it finished. Rows are never updated except to set
 * `withdrawn_at`, and never deleted — a withdrawn Fertigstand stays readable
 * so an HMI can reload the plan it is still running.
 *
 * - `record_store` is always `projects`; it exists so the composite foreign
 *   key can reference `planner_records (store, id)`. Project deletion keeps a
 *   tombstone row (ADR 0011), so the reference stays valid.
 * - `record_version` is the project version the `.rob` was generated from.
 * - `rob_text` is stored exactly as received: bytes and line endings intact.
 * - `marked_by` is set to null when that user is deleted, like
 *   `planner_records.created_by`.
 * - At most one non-withdrawn row per project (partial unique index).
 */
export const planFinals = pgTable(
  "plan_finals",
  {
    id: uuid("id").primaryKey(),
    recordStore: text("record_store").notNull().default("projects"),
    recordId: text("record_id").notNull(),
    recordVersion: integer("record_version").notNull(),
    name: text("name").notNull(),
    fileName: text("file_name").notNull(),
    robText: text("rob_text").notNull(),
    sha256: text("sha256").notNull(),
    markedBy: text("marked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    markedAt: timestamp("marked_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    foreignKey({
      name: "plan_finals_record_fk",
      columns: [table.recordStore, table.recordId],
      foreignColumns: [plannerRecords.store, plannerRecords.id],
    }),
    uniqueIndex("plan_finals_one_current_per_record")
      .on(table.recordStore, table.recordId)
      .where(sql`${table.withdrawnAt} IS NULL`),
    index("plan_finals_record_idx").on(table.recordStore, table.recordId),
    check(
      "plan_finals_record_store_projects",
      sql`${table.recordStore} = 'projects'`,
    ),
    check(
      "plan_finals_record_version_positive",
      sql`${table.recordVersion} >= 1`,
    ),
    check("plan_finals_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type PlanFinalRow = typeof planFinals.$inferSelect;
export type NewPlanFinalRow = typeof planFinals.$inferInsert;
