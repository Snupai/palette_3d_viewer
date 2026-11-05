import { NextResponse } from "next/server";

import { revokeSession } from "~/server/auth/accounts";
import {
  readSessionToken,
  sessionCookieOptionsFor,
} from "~/server/auth/sessionUser";
import { getServerDatabase } from "~/server/db/serverDatabase";

import { serverStorageDisabled } from "../responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `POST /api/auth/logout` — revokes the session and clears the cookie. */
export async function POST(request: Request): Promise<Response> {
  const db = getServerDatabase();
  if (!db) return serverStorageDisabled();

  const token = readSessionToken(request);
  if (token) await revokeSession(db, token);

  const response = new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
  response.cookies.set({
    ...sessionCookieOptionsFor(request),
    value: "",
    maxAge: 0,
  });
  return response;
}
