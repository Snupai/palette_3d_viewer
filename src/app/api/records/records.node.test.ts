// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSession, revokeSession } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import { plannerRecords, sessions, users } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";
import { MAX_RECORD_BYTES } from "~/server/records/recordRepository";

import {
  DELETE as deleteOne,
  GET as getOne,
  PUT as putOne,
} from "./[store]/[id]/route";
import { GET as list } from "./[store]/route";
import { MAX_RECORD_BODY_BYTES } from "./recordApi";

const ORIGIN = "https://palette.werk.local";
const T0 = new Date("2026-01-01T00:00:00Z");

let database: OpenDatabase;
const cookies: Record<"alice" | "bob" | "admin", string> = {
  alice: "",
  bob: "",
  admin: "",
};

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(plannerRecords);
  await database.db.delete(sessions);
  await database.db.delete(users);
  // Direct rows: these tests need sessions, not password logins.
  await database.db.insert(users).values([
    {
      id: "alice",
      username: "alice",
      passwordHash: "x",
      role: "user",
      createdAt: T0,
    },
    {
      id: "bob",
      username: "bob",
      passwordHash: "x",
      role: "user",
      createdAt: T0,
    },
    {
      id: "admin",
      username: "admin",
      passwordHash: "x",
      role: "admin",
      createdAt: T0,
    },
  ]);
  for (const name of ["alice", "bob", "admin"] as const) {
    const session = await createSession(database.db, name, new Date());
    cookies[name] = `palette_session=${session.token}`;
  }
});

type As = keyof typeof cookies | "anonymous";

function request(
  method: string,
  path: string,
  as: As,
  init: { body?: unknown; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (as !== "anonymous") headers.cookie = cookies[as];
  if (init.body !== undefined) {
    headers["content-type"] = init.contentType ?? "application/json";
  }
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body),
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

function get(store: string, id: string, as: As = "anonymous") {
  return getOne(
    request("GET", `/api/records/${store}/${id}`, as),
    params({ store, id }),
  );
}

function listStore(store: string, as: As = "anonymous") {
  return list(request("GET", `/api/records/${store}`, as), params({ store }));
}

function put(
  store: string,
  id: string,
  as: As,
  body: unknown,
  contentType?: string,
) {
  return putOne(
    request("PUT", `/api/records/${store}/${id}`, as, { body, contentType }),
    params({ store, id }),
  );
}

function remove(
  store: string,
  id: string,
  as: As,
  expectedVersion: string | number | null,
) {
  const query =
    expectedVersion === null ? "" : `?expectedVersion=${expectedVersion}`;
  return deleteOne(
    request("DELETE", `/api/records/${store}/${id}${query}`, as),
    params({ store, id }),
  );
}

async function create(
  store: string,
  id: string,
  as: As,
  body: Record<string, unknown> = {},
) {
  const response = await put(store, id, as, {
    record: { id, ...body },
    expectedVersion: null,
  });
  expect(response.status).toBe(201);
}

async function storedVersion(store: string, id: string) {
  const [row] = await database.db
    .select({ version: plannerRecords.version, json: plannerRecords.json })
    .from(plannerRecords)
    .where(eq(plannerRecords.id, id));
  return row && { version: row.version, json: row.json, store };
}

describe("public reads", () => {
  it("lists and gets projects and Werkskatalog entries without a session, unfiltered by creator", async () => {
    await create("projects", "p-alice", "alice", { name: "A" });
    await create("projects", "p-bob", "bob", { name: "B" });
    await create("project-resources", "r-1", "admin", { kind: "pallet" });

    const projects = await listStore("projects");
    expect(projects.status).toBe(200);
    expect(projects.headers.get("cache-control")).toBe("no-store");
    expect(await projects.json()).toEqual({
      records: [
        {
          record: { id: "p-alice", name: "A" },
          version: 1,
          createdBy: "alice",
        },
        { record: { id: "p-bob", name: "B" }, version: 1, createdBy: "bob" },
      ],
    });

    const asBob = await listStore("projects", "bob");
    expect(
      ((await asBob.json()) as { records: unknown[] }).records,
    ).toHaveLength(2);

    const one = await get("projects", "p-alice");
    expect(one.status).toBe(200);
    expect(one.headers.get("cache-control")).toBe("no-store");
    expect(await one.json()).toEqual({
      record: { id: "p-alice", name: "A" },
      version: 1,
      createdBy: "alice",
    });

    const catalog = await listStore("project-resources");
    expect(await catalog.json()).toEqual({
      records: [
        {
          record: { id: "r-1", kind: "pallet" },
          version: 1,
          createdBy: "admin",
        },
      ],
    });
  });

  it("answers 404 for a missing record and an unexposed store", async () => {
    const missing = await get("projects", "nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "record_not_found" });

    for (const store of ["pallets", "project-quarantine", "users", "x"]) {
      const listed = await listStore(store);
      const single = await get(store, "a");
      for (const response of [listed, single]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "unknown_store" });
      }
    }
  });

  it("rejects an invalid id", async () => {
    const response = await get("projects", "a\u0001b");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_id" });
  });
});

describe("writes need a session", () => {
  it("answers 401 to anonymous and revoked or forged sessions and changes nothing", async () => {
    await create("projects", "p-1", "alice");
    const aliceToken = cookies.alice.split("=")[1]!;
    await revokeSession(database.db, aliceToken);
    cookies.bob = `palette_session=${"a".repeat(43)}`;

    for (const as of ["anonymous", "alice", "bob"] as const) {
      const responses = [
        await put("projects", "p-1", as, {
          record: { id: "p-1", name: "x" },
          expectedVersion: 1,
        }),
        await put("projects", "p-new", as, {
          record: { id: "p-new" },
          expectedVersion: null,
        }),
        await put("project-resources", "r-1", as, {
          record: { id: "r-1" },
          expectedVersion: null,
        }),
        await remove("projects", "p-1", as, 1),
      ];
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthenticated" });
      }
    }
    expect(await storedVersion("projects", "p-1")).toMatchObject({
      version: 1,
      json: { id: "p-1" },
    });
    expect(await storedVersion("projects", "p-new")).toBeUndefined();
  });
});

describe("projects: creator or admin", () => {
  it("lets any signed-in user create a project and records them as creator", async () => {
    const response = await put("projects", "p-1", "bob", {
      record: { id: "p-1", name: "B" },
      expectedVersion: null,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      record: { id: "p-1", name: "B" },
      version: 1,
      createdBy: "bob",
    });
  });

  it("lets the creator update and delete", async () => {
    await create("projects", "p-1", "alice", { name: "A" });

    const updated = await put("projects", "p-1", "alice", {
      record: { id: "p-1", name: "A2" },
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      record: { id: "p-1", name: "A2" },
      version: 2,
      createdBy: "alice",
    });

    const deleted = await remove("projects", "p-1", "alice", 2);
    expect(deleted.status).toBe(204);
    expect(deleted.headers.get("cache-control")).toBe("no-store");
    expect(await storedVersion("projects", "p-1")).toBeUndefined();
  });

  it("forbids another user to update or delete, even with a stale version", async () => {
    await create("projects", "p-1", "alice", { name: "A" });

    const responses = [
      await put("projects", "p-1", "bob", {
        record: { id: "p-1", name: "B" },
        expectedVersion: 1,
      }),
      await put("projects", "p-1", "bob", {
        record: { id: "p-1", name: "B" },
        expectedVersion: 5,
      }),
      await remove("projects", "p-1", "bob", 1),
      await remove("projects", "p-1", "bob", 5),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(await storedVersion("projects", "p-1")).toMatchObject({
      version: 1,
      json: { id: "p-1", name: "A" },
    });
  });

  it("lets an admin update and delete someone else's project without taking it over", async () => {
    await create("projects", "p-1", "alice", { name: "A" });

    const updated = await put("projects", "p-1", "admin", {
      record: { id: "p-1", name: "fixed" },
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      record: { id: "p-1", name: "fixed" },
      version: 2,
      createdBy: "alice",
    });

    expect((await remove("projects", "p-1", "admin", 2)).status).toBe(204);
    expect(await storedVersion("projects", "p-1")).toBeUndefined();
  });

  it("leaves a project whose creator was deleted to admins", async () => {
    await create("projects", "p-1", "alice");
    await database.db.delete(users).where(eq(users.id, "alice"));

    const byBob = await put("projects", "p-1", "bob", {
      record: { id: "p-1" },
      expectedVersion: 1,
    });
    expect(byBob.status).toBe(403);
    const byAdmin = await put("projects", "p-1", "admin", {
      record: { id: "p-1" },
      expectedVersion: 1,
    });
    expect(byAdmin.status).toBe(200);
    expect(await byAdmin.json()).toMatchObject({ createdBy: null });
  });
});

describe("Werkskatalog: admin only", () => {
  it("forbids a user to create, update or delete entries", async () => {
    await create("project-resources", "r-1", "admin", { kind: "pallet" });

    const responses = [
      await put("project-resources", "r-2", "alice", {
        record: { id: "r-2" },
        expectedVersion: null,
      }),
      await put("project-resources", "r-1", "alice", {
        record: { id: "r-1", kind: "gripper" },
        expectedVersion: 1,
      }),
      await remove("project-resources", "r-1", "alice", 1),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(await storedVersion("project-resources", "r-1")).toMatchObject({
      version: 1,
      json: { id: "r-1", kind: "pallet" },
    });
    expect(await storedVersion("project-resources", "r-2")).toBeUndefined();
  });

  it("lets an admin create, update and delete entries", async () => {
    await create("project-resources", "r-1", "admin", { kind: "pallet" });

    const updated = await put("project-resources", "r-1", "admin", {
      record: { id: "r-1", kind: "gripper" },
      expectedVersion: 1,
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      record: { id: "r-1", kind: "gripper" },
      version: 2,
      createdBy: "admin",
    });
    expect((await remove("project-resources", "r-1", "admin", 2)).status).toBe(
      204,
    );
  });
});

describe("version conflicts (ADR 0006)", () => {
  it("answers 409 with the current version for a stale update or delete", async () => {
    await create("projects", "p-1", "alice", { name: "A" });
    await put("projects", "p-1", "alice", {
      record: { id: "p-1", name: "A2" },
      expectedVersion: 1,
    });

    const stalePut = await put("projects", "p-1", "alice", {
      record: { id: "p-1", name: "stale" },
      expectedVersion: 1,
    });
    const staleDelete = await remove("projects", "p-1", "alice", 1);
    for (const response of [stalePut, staleDelete]) {
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: "version_conflict",
        currentVersion: 2,
      });
    }
    expect(await storedVersion("projects", "p-1")).toMatchObject({
      version: 2,
      json: { id: "p-1", name: "A2" },
    });
  });

  it("answers 409 when creating an existing id, including someone else's", async () => {
    await create("projects", "p-1", "alice");
    for (const as of ["alice", "bob"] as const) {
      const response = await put("projects", "p-1", as, {
        record: { id: "p-1", name: "dup" },
        expectedVersion: null,
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "version_conflict",
        currentVersion: 1,
      });
    }
  });

  it("answers 409 with currentVersion null for a record that no longer exists", async () => {
    const update = await put("projects", "gone", "alice", {
      record: { id: "gone" },
      expectedVersion: 3,
    });
    const deleted = await remove("projects", "gone", "alice", 3);
    for (const response of [update, deleted]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "version_conflict",
        currentVersion: null,
      });
    }
  });
});

describe("request validation", () => {
  it("accepts JSON only", async () => {
    const response = await put(
      "projects",
      "p-1",
      "alice",
      "record=x",
      "application/x-www-form-urlencoded",
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
  });

  it("rejects malformed bodies, mismatched ids and invalid records", async () => {
    const cases: [unknown, number, unknown][] = [
      ["{", 400, { error: "invalid_request" }],
      [{ record: { id: "p-1" } }, 400, { error: "invalid_request" }],
      [{ expectedVersion: null }, 400, { error: "invalid_request" }],
      [
        { record: { id: "p-1" }, expectedVersion: 0 },
        400,
        { error: "invalid_request" },
      ],
      [
        { record: { id: "p-1" }, expectedVersion: 1.5 },
        400,
        { error: "invalid_request" },
      ],
      [
        { record: { id: "p-1" }, expectedVersion: 2_147_483_647 },
        400,
        { error: "invalid_request" },
      ],
      [
        { record: { id: "other" }, expectedVersion: null },
        400,
        { error: "id_mismatch" },
      ],
      [
        { record: { name: "x" }, expectedVersion: null },
        400,
        { error: "id_mismatch" },
      ],
      [
        { record: [{ id: "p-1" }], expectedVersion: null },
        400,
        { error: "invalid_record", reason: "not-object" },
      ],
      [
        { record: { id: "p-1", text: "\u0000" }, expectedVersion: null },
        400,
        { error: "invalid_record", reason: "not-json" },
      ],
    ];
    for (const [body, status, answer] of cases) {
      const response = await put("projects", "p-1", "alice", body);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(answer);
    }
    expect(await storedVersion("projects", "p-1")).toBeUndefined();
  });

  it("rejects an invalid path id and an invalid delete version", async () => {
    const badId = await put("projects", "a\u0001b", "alice", {
      record: { id: "a\u0001b" },
      expectedVersion: null,
    });
    expect(badId.status).toBe(400);
    expect(await badId.json()).toEqual({ error: "invalid_id" });

    await create("projects", "p-1", "alice");
    for (const version of [
      null,
      "",
      "0",
      "01",
      "1.0",
      "-1",
      "abc",
      "2147483647",
    ]) {
      const response = await remove("projects", "p-1", "alice", version);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(await storedVersion("projects", "p-1")).toMatchObject({
      version: 1,
    });
  });

  it("answers 413 for records over the size limit and oversized bodies", async () => {
    const overRecord = await put("projects", "p-1", "alice", {
      record: { id: "p-1", text: "x".repeat(MAX_RECORD_BYTES) },
      expectedVersion: null,
    });
    const overBody = await put("projects", "p-1", "alice", {
      record: { id: "p-1", text: "x".repeat(MAX_RECORD_BODY_BYTES) },
      expectedVersion: null,
    });
    for (const response of [overRecord, overBody]) {
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "record_too_large" });
    }
    expect(await storedVersion("projects", "p-1")).toBeUndefined();
  });

  it("checks permissions before reading the body", async () => {
    const response = await put("project-resources", "r-1", "alice", "{");
    expect(response.status).toBe(403);
  });
});

describe("local storage mode", () => {
  it("answers 404 on every records route", async () => {
    setServerDatabaseForTesting(null);

    const responses = await Promise.all([
      listStore("projects"),
      get("projects", "p-1"),
      put("projects", "p-1", "alice", {
        record: { id: "p-1" },
        expectedVersion: null,
      }),
      remove("projects", "p-1", "alice", 1),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "server_storage_disabled",
      });
    }
  });
});
