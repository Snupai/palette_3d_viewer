// @vitest-environment node
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createUser } from "~/server/auth/accounts";
import { hashSessionToken } from "~/server/auth/sessionToken";
import type { OpenDatabase } from "~/server/db/database";
import { sessions } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";

import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";

const ORIGIN = "https://palette.werk.local";

let database: OpenDatabase;
let userId: string;

beforeAll(async () => {
  database = await openMigratedTestDatabase();
  const user = await createUser(
    database.db,
    { username: "Planer", password: "correct horse battery", role: "user" },
    new Date("2026-01-01T00:00:00Z"),
  );
  userId = user.id;
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(sessions);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function loginRequest(
  body: unknown,
  init: { origin?: string; cookie?: string; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": init.contentType ?? "application/json",
  };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${init.origin ?? ORIGIN}/api/auth/login`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function withCookie(path: string, cookie?: string, method = "GET"): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

/** `name=value` of the response's session cookie. */
function sessionCookiePair(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0]!;
}

async function signIn(): Promise<string> {
  const response = await login(
    loginRequest({ username: "planer", password: "correct horse battery" }),
  );
  expect(response.status).toBe(200);
  return sessionCookiePair(response);
}

describe("POST /api/auth/login", () => {
  it("sets an httpOnly, SameSite=Lax, Secure session cookie and returns the user", async () => {
    const response = await login(
      loginRequest({ username: " PLANER ", password: "correct horse battery" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: { id: userId, username: "planer", role: "user" },
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^palette_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=43200");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Secure");

    const token = sessionCookiePair(response).split("=")[1]!;
    const stored = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect(stored.map((row) => row.userId)).toEqual([userId]);
  });

  it("answers wrong password and unknown user identically, without a cookie", async () => {
    const wrongPassword = await login(
      loginRequest({ username: "planer", password: "wrong" }),
    );
    const unknownUser = await login(
      loginRequest({ username: "nobody", password: "correct horse battery" }),
    );
    const invalidName = await login(
      loginRequest({ username: "!", password: "correct horse battery" }),
    );

    for (const response of [wrongPassword, unknownUser, invalidName]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({ error: "invalid_credentials" });
    }
    expect(await database.db.select().from(sessions)).toEqual([]);
  });

  it("rejects malformed bodies and non-JSON content types", async () => {
    const notJson = await login(loginRequest("{"));
    const missingPassword = await login(loginRequest({ username: "planer" }));
    const form = await login(
      loginRequest("username=planer&password=x", {
        contentType: "application/x-www-form-urlencoded",
      }),
    );

    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid_request" });
    expect(missingPassword.status).toBe(400);
    expect(form.status).toBe(415);
  });

  it("revokes the browser's previous session on a new login", async () => {
    const first = await signIn();
    const second = await login(
      loginRequest(
        { username: "planer", password: "correct horse battery" },
        { cookie: first },
      ),
    );

    expect(second.status).toBe(200);
    expect(sessionCookiePair(second)).not.toBe(first);
    expect((await me(withCookie("/api/auth/me", first))).status).toBe(401);
    expect(
      (await me(withCookie("/api/auth/me", sessionCookiePair(second)))).status,
    ).toBe(200);
  });

  it("omits Secure only for development over localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const local = await login(
      loginRequest(
        { username: "planer", password: "correct horse battery" },
        { origin: "http://localhost:3000" },
      ),
    );
    const lan = await login(
      loginRequest(
        { username: "planer", password: "correct horse battery" },
        { origin: "http://192.168.1.20:3000" },
      ),
    );

    expect(local.headers.get("set-cookie")).not.toContain("Secure");
    expect(lan.headers.get("set-cookie")).toContain("Secure");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    const cookie = await signIn();

    const response = await me(
      withCookie("/api/auth/me", `theme=dark; ${cookie}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      user: { id: userId, username: "planer", role: "user" },
    });
  });

  it("answers 401 without, or with a forged, session cookie", async () => {
    const missing = await me(withCookie("/api/auth/me"));
    const forged = await me(
      withCookie("/api/auth/me", `palette_session=${"a".repeat(43)}`),
    );

    for (const response of [missing, forged]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const cookie = await signIn();

    const response = await logout(
      withCookie("/api/auth/logout", cookie, "POST"),
    );

    expect(response.status).toBe(204);
    const cleared = response.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^palette_session=;/);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Secure");
    expect(await database.db.select().from(sessions)).toEqual([]);
    expect((await me(withCookie("/api/auth/me", cookie))).status).toBe(401);
  });

  it("succeeds without a session", async () => {
    const response = await logout(
      withCookie("/api/auth/logout", undefined, "POST"),
    );

    expect(response.status).toBe(204);
  });
});

describe("local storage mode", () => {
  it("answers 404 on every auth route", async () => {
    setServerDatabaseForTesting(null);

    const responses = await Promise.all([
      login(loginRequest({ username: "planer", password: "x" })),
      logout(withCookie("/api/auth/logout", undefined, "POST")),
      me(withCookie("/api/auth/me")),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404,
    ]);
  });
});
