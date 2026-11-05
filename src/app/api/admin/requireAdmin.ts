import type { NextResponse } from "next/server";

import { getSessionUser, type SessionUser } from "~/server/auth/sessionUser";
import type { PlannerDatabase } from "~/server/db/database";
import { getServerDatabase } from "~/server/db/serverDatabase";

import { jsonNoStore, serverStorageDisabled } from "../auth/responses";

/**
 * Guard for the admin API (#32, ADR 0005): 404 in local storage mode, 401
 * without a valid session, 403 for a signed-in non-admin.
 */
export async function requireAdmin(
  request: Request,
): Promise<
  { db: PlannerDatabase; admin: SessionUser } | { response: NextResponse }
> {
  const db = getServerDatabase();
  if (!db) return { response: serverStorageDisabled() };
  const user = await getSessionUser(request, db);
  if (!user) {
    return { response: jsonNoStore({ error: "unauthenticated" }, 401) };
  }
  if (user.role !== "admin") {
    return { response: jsonNoStore({ error: "forbidden" }, 403) };
  }
  return { db, admin: user };
}
