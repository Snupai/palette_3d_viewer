// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authenticate, createUser } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import { sessions, users } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";

import { POST as login } from "../auth/login/route";
import { GET as me } from "../auth/me/route";
import { POST as resetPassword } from "./users/[id]/password/route";
import { GET as listUsers, POST as createUserRoute } from "./users/route";

const ORIGIN = "https://palette.werk.local";
const ADMIN_PASSWORD = "Kraftkarton-2026";
const USER_PASSWORD = "correct horse battery";
const NEW_PASSWORD = "Frische Palette 42";

let database: OpenDatabase;
let adminId: string;
let userId: string;

beforeAll(async () => {
  database = await openMigratedTestDatabase();
  const admin = await createUser(
    database.db,
    { username: "chef", password: ADMIN_PASSWORD, role: "admin" },
    new Date("2026-01-01T00:00:00Z"),
  );
  const user = await createUser(
    database.db,
    { username: "planer", password: USER_PASSWORD, role: "user" },
    new Date("2026-01-02T00:00:00Z"),
  );
  adminId = admin.id;
  userId = user.id;
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(sessions);
  // Only the two seeded accounts survive between tests.
  const seeded = await database.db.select({ id: users.id }).from(users);
  for (const row of seeded) {
    if (row.id !== adminId && row.id !== userId) {
      await database.db.delete(users).where(eq(users.id, row.id));
    }
  }
});

async function signIn(username: string, password: string): Promise<string> {
  const response = await login(
    new Request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0]!;
}

function request(
  path: string,
  init: {
    method?: string;
    cookie?: string;
    body?: unknown;
    contentType?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) {
    headers["content-type"] = init.contentType ?? "application/json";
  }
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body),
  });
}

function reset(id: string, init: Parameters<typeof request>[1]) {
  return resetPassword(
    request(`/api/admin/users/${id}/password`, { method: "POST", ...init }),
    { params: Promise.resolve({ id }) },
  );
}

const asAdmin = () => signIn("chef", ADMIN_PASSWORD);
const asUser = () => signIn("planer", USER_PASSWORD);

describe("permissions", () => {
  it("answers 401 to anonymous requests on every admin route", async () => {
    const responses = [
      await listUsers(request("/api/admin/users")),
      await createUserRoute(
        request("/api/admin/users", {
          method: "POST",
          body: { username: "neu", password: NEW_PASSWORD },
        }),
      ),
      await reset(userId, { body: { password: NEW_PASSWORD } }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    }
    expect(await authenticate(database.db, "planer", USER_PASSWORD)).not.toBe(
      null,
    );
  });

  it("answers 403 to a signed-in non-admin on every admin route", async () => {
    const cookie = await asUser();

    const responses = [
      await listUsers(request("/api/admin/users", { cookie })),
      await createUserRoute(
        request("/api/admin/users", {
          method: "POST",
          cookie,
          body: { username: "neu", password: NEW_PASSWORD },
        }),
      ),
      await reset(adminId, { cookie, body: { password: NEW_PASSWORD } }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const names = await database.db
      .select({ username: users.username })
      .from(users);
    expect(names.map((row) => row.username).sort()).toEqual(["chef", "planer"]);
    expect(await authenticate(database.db, "chef", ADMIN_PASSWORD)).not.toBe(
      null,
    );
  });

  it("answers 404 on every admin route in local storage mode", async () => {
    setServerDatabaseForTesting(null);

    const responses = [
      await listUsers(request("/api/admin/users")),
      await createUserRoute(
        request("/api/admin/users", { method: "POST", body: {} }),
      ),
      await reset(userId, { body: {} }),
    ];

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404,
    ]);
  });
});

describe("GET /api/admin/users", () => {
  it("lists every account by username without hashes", async () => {
    const cookie = await asAdmin();

    const response = await listUsers(request("/api/admin/users", { cookie }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      users: [
        {
          id: adminId,
          username: "chef",
          role: "admin",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: userId,
          username: "planer",
          role: "user",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("POST /api/admin/users", () => {
  it("creates a user that can sign in, role defaulting to user", async () => {
    const cookie = await asAdmin();

    const response = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        cookie,
        body: { username: " Lager.Nord ", password: NEW_PASSWORD },
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      user: { id: string; username: string; role: string };
    };
    expect(body.user).toMatchObject({ username: "lager.nord", role: "user" });
    expect(Object.keys(body.user).sort()).toEqual([
      "createdAt",
      "id",
      "role",
      "username",
    ]);
    const signedIn = await authenticate(
      database.db,
      "lager.nord",
      NEW_PASSWORD,
    );
    expect(signedIn?.id).toBe(body.user.id);
  });

  it("creates an admin when asked", async () => {
    const cookie = await asAdmin();

    const response = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        cookie,
        body: { username: "vertretung", password: NEW_PASSWORD, role: "admin" },
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      user: { username: "vertretung", role: "admin" },
    });
  });

  it("rejects taken names, invalid names and weak passwords", async () => {
    const cookie = await asAdmin();
    const create = (body: unknown) =>
      createUserRoute(
        request("/api/admin/users", { method: "POST", cookie, body }),
      );

    const taken = await create({ username: "PLANER", password: NEW_PASSWORD });
    const invalidName = await create({ username: "a", password: NEW_PASSWORD });
    const short = await create({ username: "neu", password: "kurz" });
    const containsName = await create({
      username: "lager",
      password: "mein-LAGER-kennwort",
    });
    const repetitive = await create({
      username: "neu",
      password: "121212121212",
    });
    const badRole = await create({
      username: "neu",
      password: NEW_PASSWORD,
      role: "root",
    });

    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "username_taken" });
    expect(invalidName.status).toBe(400);
    expect(await invalidName.json()).toEqual({ error: "invalid_username" });
    for (const [response, reason] of [
      [short, "too_short"],
      [containsName, "contains_username"],
      [repetitive, "too_few_distinct"],
    ] as const) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "weak_password", reason });
    }
    expect(badRole.status).toBe(400);
    expect(await badRole.json()).toEqual({ error: "invalid_request" });
    expect(await database.db.select({ id: users.id }).from(users)).toHaveLength(
      2,
    );
  });

  it("accepts JSON only", async () => {
    const cookie = await asAdmin();

    const form = await createUserRoute(
      request("/api/admin/users", {
        method: "POST",
        cookie,
        body: `username=neu&password=${NEW_PASSWORD}`,
        contentType: "application/x-www-form-urlencoded",
      }),
    );
    const broken = await createUserRoute(
      request("/api/admin/users", { method: "POST", cookie, body: "{" }),
    );

    expect(form.status).toBe(415);
    expect(broken.status).toBe(400);
  });
});

describe("POST /api/admin/users/:id/password", () => {
  it("sets the password and revokes the user's sessions", async () => {
    const userCookie = await asUser();
    const adminCookie = await asAdmin();

    const response = await reset(userId, {
      cookie: adminCookie,
      body: { password: NEW_PASSWORD },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      (await me(request("/api/auth/me", { cookie: userCookie }))).status,
    ).toBe(401);
    expect(
      (await me(request("/api/auth/me", { cookie: adminCookie }))).status,
    ).toBe(200);
    expect(await authenticate(database.db, "planer", USER_PASSWORD)).toBe(null);
    expect((await authenticate(database.db, "planer", NEW_PASSWORD))?.id).toBe(
      userId,
    );

    // Restore the seeded password for the other tests.
    await reset(userId, {
      cookie: adminCookie,
      body: { password: USER_PASSWORD },
    });
  });

  it("answers 404 for an unknown user and 400 for a weak password", async () => {
    const cookie = await asAdmin();

    const unknown = await reset("00000000-0000-0000-0000-000000000000", {
      cookie,
      body: { password: NEW_PASSWORD },
    });
    const weak = await reset(userId, {
      cookie,
      body: { password: "mein-planer-pw" },
    });
    const missing = await reset(userId, { cookie, body: {} });

    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "user_not_found" });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toEqual({
      error: "weak_password",
      reason: "contains_username",
    });
    expect(missing.status).toBe(400);
    expect(await authenticate(database.db, "planer", USER_PASSWORD)).not.toBe(
      null,
    );
  });
});
