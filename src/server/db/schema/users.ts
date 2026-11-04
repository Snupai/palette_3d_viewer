import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Local accounts (ADR 0005). `username` is stored normalized (trimmed,
 * lower-case), so the unique constraint is effectively case-insensitive.
 * `password_hash` is an argon2id PHC string. `id` is a text UUID so that
 * `planner_records.created_by` (text) can reference it.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("users_role_valid", sql`${table.role} IN ('admin', 'user')`),
  ],
);

/**
 * Login sessions. Only the SHA-256 hex of the cookie token is stored, so the
 * database alone cannot be replayed. Deleting a user removes their sessions.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
