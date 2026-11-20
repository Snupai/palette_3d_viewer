// @vitest-environment node
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import { hmiDevices, sessions, users } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";
import { setHmiRateLimiterForTesting } from "~/server/hmi/hmiAuth";

import { GET as listFinals } from "../hmi/v1/finals/route";
import { PATCH as rename } from "./hmis/[id]/route";
import { POST as revoke } from "./hmis/[id]/revoke/route";
import { POST as regenerate } from "./hmis/[id]/token/route";
import { GET as list, POST as create } from "./hmis/route";

const ORIGIN = "https://palette.werk.local";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let database: OpenDatabase;
const cookies = { chef: "", planer: "" };

type AdminHmi = {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  appVersion: string | null;
  activeFinal: unknown;
};

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  setHmiRateLimiterForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  setHmiRateLimiterForTesting(undefined);
  await database.db.delete(hmiDevices);
  await database.db.delete(sessions);
  await database.db.delete(users);
  await database.db.insert(users).values([
    { id: "chef", username: "chef", passwordHash: "x", role: "admin" },
    { id: "planer", username: "planer", passwordHash: "x", role: "user" },
  ]);
  for (const name of ["chef", "planer"] as const) {
    const session = await createSession(database.db, name, new Date());
    cookies[name] = `palette_session=${session.token}`;
  }
});

type As = keyof typeof cookies | "anonymous";

function request(method: string, path: string, as: As, body?: unknown) {
  const headers: Record<string, string> = {};
  if (as !== "anonymous") headers.cookie = cookies[as];
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createHmi(name: string) {
  const response = await create(
    request("POST", "/api/admin/hmis", "chef", { name }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { hmi: AdminHmi; token: string };
}

function hmiApi(token: string) {
  return listFinals(
    new Request(`${ORIGIN}/api/hmi/v1/finals`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

async function storedTokenHash(id: string) {
  const [row] = await database.db
    .select({ tokenHash: hmiDevices.tokenHash })
    .from(hmiDevices)
    .where(eq(hmiDevices.id, id));
  return row!.tokenHash;
}

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("admin HMI API", () => {
  it("creates an HMI, shows its token once and stores only the hash", async () => {
    const before = Date.now();
    const { hmi, token } = await createHmi(" Linie 3 ");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hmi).toEqual({
      id: hmi.id,
      name: "Linie 3",
      createdAt: hmi.createdAt,
      revokedAt: null,
      lastSeenAt: null,
      appVersion: null,
      activeFinal: null,
    });
    expect(Date.parse(hmi.createdAt) >= before - 1000).toBe(true);
    expect(await storedTokenHash(hmi.id)).toBe(sha256(token));
    expect((await hmiApi(token)).status).toBe(200);

    const listed = await list(request("GET", "/api/admin/hmis", "chef"));
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(JSON.parse(body)).toEqual({
      hmis: [{ ...hmi, lastSeenAt: expect.any(String) as string }],
    });
    expect(body).not.toContain(token);
    expect(body).not.toContain(sha256(token));
  });

  it("refuses invalid names with 400 invalid_name", async () => {
    for (const body of [{ name: " " }, { name: "a".repeat(101) }, {}, null]) {
      const response = await create(
        request("POST", "/api/admin/hmis", "chef", body),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_name" });
    }
  });

  it("renames an HMI", async () => {
    const { hmi } = await createHmi("Linie 3");
    const response = await rename(
      request("PATCH", `/api/admin/hmis/${hmi.id}`, "chef", {
        name: "Linie 4",
      }),
      params(hmi.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hmi: { ...hmi, name: "Linie 4" } });

    const bad = await rename(
      request("PATCH", `/api/admin/hmis/${hmi.id}`, "chef", { name: "" }),
      params(hmi.id),
    );
    expect(bad.status).toBe(400);
    const missing = await rename(
      request("PATCH", `/api/admin/hmis/${UNKNOWN_ID}`, "chef", { name: "x" }),
      params(UNKNOWN_ID),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "hmi_not_found" });
  });

  it("revokes an HMI: its token gets 401", async () => {
    const { hmi, token } = await createHmi("Linie 3");
    const response = await revoke(
      request("POST", `/api/admin/hmis/${hmi.id}/revoke`, "chef", {}),
      params(hmi.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { hmi: AdminHmi };
    expect(body.hmi.revokedAt).not.toBeNull();
    expect((await hmiApi(token)).status).toBe(401);

    const missing = await revoke(
      request("POST", `/api/admin/hmis/${UNKNOWN_ID}/revoke`, "chef", {}),
      params(UNKNOWN_ID),
    );
    expect(missing.status).toBe(404);
  });

  it("regenerates the token: the new one works, the old one gets 401, a revocation is lifted", async () => {
    const { hmi, token: oldToken } = await createHmi("Linie 3");
    await revoke(
      request("POST", `/api/admin/hmis/${hmi.id}/revoke`, "chef", {}),
      params(hmi.id),
    );

    const response = await regenerate(
      request("POST", `/api/admin/hmis/${hmi.id}/token`, "chef", {}),
      params(hmi.id),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { hmi: AdminHmi; token: string };
    expect(body.hmi).toEqual({ ...hmi, revokedAt: null });
    expect(body.token).not.toBe(oldToken);
    expect(await storedTokenHash(hmi.id)).toBe(sha256(body.token));
    expect((await hmiApi(oldToken)).status).toBe(401);
    expect((await hmiApi(body.token)).status).toBe(200);
  });

  it("refuses token writes without a JSON body (CSRF guard)", async () => {
    const { hmi } = await createHmi("Linie 3");
    for (const route of [revoke, regenerate]) {
      const response = await route(
        request("POST", `/api/admin/hmis/${hmi.id}/token`, "chef"),
        params(hmi.id),
      );
      expect(response.status).toBe(415);
    }
  });

  it("is admin-only: 401 anonymous, 403 for a planner", async () => {
    const { hmi } = await createHmi("Linie 3");
    const calls = (as: As) => [
      list(request("GET", "/api/admin/hmis", as)),
      create(request("POST", "/api/admin/hmis", as, { name: "x" })),
      rename(
        request("PATCH", `/api/admin/hmis/${hmi.id}`, as, { name: "x" }),
        params(hmi.id),
      ),
      revoke(
        request("POST", `/api/admin/hmis/${hmi.id}/revoke`, as, {}),
        params(hmi.id),
      ),
      regenerate(
        request("POST", `/api/admin/hmis/${hmi.id}/token`, as, {}),
        params(hmi.id),
      ),
    ];
    for (const response of await Promise.all(calls("anonymous"))) {
      expect(response.status).toBe(401);
    }
    for (const response of await Promise.all(calls("planer"))) {
      expect(response.status).toBe(403);
    }
    const rows = await database.db.select().from(hmiDevices);
    expect(rows.map((row) => [row.name, row.revokedAt])).toEqual([
      ["Linie 3", null],
    ]);
  });

  it("answers 404 server_storage_disabled in local storage mode", async () => {
    setServerDatabaseForTesting(null);
    const responses = [
      await list(request("GET", "/api/admin/hmis", "chef")),
      await create(request("POST", "/api/admin/hmis", "chef", { name: "x" })),
      await rename(
        request("PATCH", `/api/admin/hmis/${UNKNOWN_ID}`, "chef", {
          name: "x",
        }),
        params(UNKNOWN_ID),
      ),
      await revoke(
        request("POST", `/api/admin/hmis/${UNKNOWN_ID}/revoke`, "chef", {}),
        params(UNKNOWN_ID),
      ),
      await regenerate(
        request("POST", `/api/admin/hmis/${UNKNOWN_ID}/token`, "chef", {}),
        params(UNKNOWN_ID),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "server_storage_disabled",
      });
    }
  });
});
