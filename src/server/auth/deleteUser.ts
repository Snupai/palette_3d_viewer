import { asc, eq } from "drizzle-orm";

import type { PlannerDatabase } from "../db/database";
import { users } from "../db/schema";

export type DeleteUserResult =
  | "deleted"
  | "user_not_found"
  | "self_deletion"
  | "last_admin"
  | "forbidden";

/** Deletes the account; FK actions revoke sessions and retain planner records. */
export async function deleteUser(
  db: PlannerDatabase,
  adminId: string,
  userId: string,
): Promise<DeleteUserResult> {
  return db.transaction(async (tx) => {
    // Serialize deletions through the admin rows in a stable order. Recheck
    // the caller after locking: another admin may have just deleted them.
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "admin"))
      .orderBy(asc(users.id))
      .for("update");
    if (!admins.some((admin) => admin.id === adminId)) return "forbidden";
    const [target] = await tx.select().from(users).where(eq(users.id, userId));
    if (!target) return "user_not_found";
    if (target.role === "admin" && admins.length === 1) return "last_admin";
    if (userId === adminId) return "self_deletion";
    const removed = await tx
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return removed.length === 0 ? "user_not_found" : "deleted";
  });
}
