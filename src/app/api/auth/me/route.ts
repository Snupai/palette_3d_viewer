import { getSessionUser } from "~/server/auth/sessionUser";
import { getServerDatabase } from "~/server/db/serverDatabase";

import { jsonNoStore, serverStorageDisabled } from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/auth/me` — the signed-in user, or 401. */
export async function GET(request: Request): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();

  const user = await getSessionUser(request, db);
  if (!user) return jsonNoStore({ error: "unauthenticated" }, 401);
  return jsonNoStore({ user });
}
