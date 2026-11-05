// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DELETE as deleteRecordRoute,
  GET as getRecordRoute,
  PUT as putRecordRoute,
} from "~/app/api/records/[store]/[id]/route";
import { GET as listRecordsRoute } from "~/app/api/records/[store]/route";
import {
  LEGACY_MIGRATIONS_STORE_NAME,
  PALLETS_STORE_NAME,
  PROJECT_QUARANTINE_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
} from "~/lib/plannerDatabase";
import { RecordVersionConflictError } from "~/lib/plannerRecordStorage";
import { describePlannerRecordStorageContract } from "~/lib/plannerRecordStorageContract";
import {
  SERVER_STORE_NAMES,
  ServerPlannerRecordStorage,
  ServerStorageError,
} from "~/lib/serverPlannerRecordStorage";
import { createSession } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import { plannerRecords, users } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";

/**
 * The server client against the real records route handlers and a PGlite
 * database (ADR 0009: no container), wired through an injected `fetch` that
 * dispatches to the handlers in process.
 */

const ORIGIN = "https://palette.werk.local";
const T0 = new Date("2026-01-01T00:00:00Z");
type Account = "admin" | "alice" | "bob";

type Server = { database: OpenDatabase; cookies: Record<Account, string> };

async function openServer(): Promise<Server> {
  const database = await openMigratedTestDatabase();
  await database.db.insert(users).values(
    (["admin", "alice", "bob"] as const).map((id) => ({
      id,
      username: id,
      passwordHash: "x",
      role: id === "admin" ? ("admin" as const) : ("user" as const),
      createdAt: T0,
    })),
  );
  const cookies = {} as Record<Account, string>;
  for (const id of ["admin", "alice", "bob"] as const) {
    const session = await createSession(database.db, id, new Date());
    cookies[id] = `palette_session=${session.token}`;
  }
  return { database, cookies };
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

/** In-process `fetch` that routes `/api/records/...` to the handlers. */
function handlerFetch(
  server: Server,
  as: Account | "anonymous",
  calls: string[] = [],
): typeof fetch {
  return async (input, init) => {
    const url = new URL(urlOf(input));
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}${url.search}`);
    expect(url.origin).toBe(ORIGIN);
    const headers = new Headers(init?.headers);
    if (as !== "anonymous") headers.set("cookie", server.cookies[as]);
    const request = new Request(url, { method, headers, body: init?.body });
    setServerDatabaseForTesting(server.database.db);
    const segments = url.pathname.split("/").slice(3).map(decodeURIComponent);
    const [store, id] = segments;
    expect(url.pathname.startsWith("/api/records/")).toBe(true);
    if (segments.length === 1 && method === "GET") {
      return listRecordsRoute(request, {
        params: Promise.resolve({ store: store! }),
      });
    }
    expect(segments).toHaveLength(2);
    const context = { params: Promise.resolve({ store: store!, id: id! }) };
    switch (method) {
      case "GET":
        return getRecordRoute(request, context);
      case "PUT":
        return putRecordRoute(request, context);
      case "DELETE":
        return deleteRecordRoute(request, context);
    }
    throw new Error(`Unexpected ${method} ${url.pathname}`);
  };
}

function client(fetchImpl: typeof fetch): ServerPlannerRecordStorage {
  return new ServerPlannerRecordStorage({ baseUrl: ORIGIN, fetch: fetchImpl });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to reject.");
    },
    (cause: unknown) => cause,
  );
}

const servers: Server[] = [];
let nextServer = 0;

beforeAll(async () => {
  // Two databases rotated per factory call: every storage starts empty, and
  // the two storages a test may create never share one.
  servers.push(...(await Promise.all([openServer(), openServer()])));
}, 30_000);

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await Promise.all(servers.map(({ database }) => database.close()));
});

describePlannerRecordStorageContract(
  async () => {
    const server = servers[nextServer++ % servers.length]!;
    await server.database.db.delete(plannerRecords);
    return client(handlerFetch(server, "admin"));
  },
  {
    label: "ServerPlannerRecordStorage",
    storeNames: SERVER_STORE_NAMES,
    versionsSurviveDelete: false,
  },
);

describe("ServerPlannerRecordStorage", () => {
  async function freshServer(): Promise<Server> {
    const server = servers[0]!;
    await server.database.db.delete(plannerRecords);
    return server;
  }

  it("passes the expected version and maps a stale write to RecordVersionConflictError", async () => {
    const server = await freshServer();
    const calls: string[] = [];
    const alice = client(handlerFetch(server, "alice", calls));
    const otherTab = client(handlerFetch(server, "alice"));

    expect(
      await alice.put(
        PROJECTS_STORE_NAME,
        { id: "p 1", n: 1 },
        { expectedVersion: null },
      ),
    ).toBe(1);
    expect(
      await otherTab.put(
        PROJECTS_STORE_NAME,
        { id: "p 1", n: 2 },
        { expectedVersion: 1 },
      ),
    ).toBe(2);
    const stale = await rejection(
      alice.put(
        PROJECTS_STORE_NAME,
        { id: "p 1", n: 3 },
        { expectedVersion: 1 },
      ),
    );
    const staleDelete = await rejection(
      alice.delete(PROJECTS_STORE_NAME, "p 1", { expectedVersion: 1 }),
    );

    expect(stale).toBeInstanceOf(RecordVersionConflictError);
    expect(stale).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
    expect(staleDelete).toBeInstanceOf(RecordVersionConflictError);
    expect(staleDelete).toMatchObject({ expectedVersion: 1, actualVersion: 2 });
    expect(await alice.getVersioned(PROJECTS_STORE_NAME, "p 1")).toEqual({
      record: { id: "p 1", n: 2 },
      version: 2,
    });
    expect(calls).toEqual([
      "PUT /api/records/projects/p%201",
      "PUT /api/records/projects/p%201",
      "DELETE /api/records/projects/p%201?expectedVersion=1",
      "GET /api/records/projects/p%201",
    ]);
  });

  it("writes without an expected version against the version it just read", async () => {
    const server = await freshServer();
    const calls: string[] = [];
    const storage = client(handlerFetch(server, "alice", calls));

    expect(await storage.put(PROJECTS_STORE_NAME, { id: "p", n: 1 })).toBe(1);
    expect(await storage.put(PROJECTS_STORE_NAME, { id: "p", n: 2 })).toBe(2);
    await storage.delete(PROJECTS_STORE_NAME, "p");

    expect(calls).toEqual([
      "GET /api/records/projects/p",
      "PUT /api/records/projects/p",
      "GET /api/records/projects/p",
      "PUT /api/records/projects/p",
      "GET /api/records/projects/p",
      "DELETE /api/records/projects/p?expectedVersion=2",
    ]);
  });

  it("rejects writes without a session as unauthenticated but serves public reads", async () => {
    const server = await freshServer();
    await client(handlerFetch(server, "alice")).put(PROJECTS_STORE_NAME, {
      id: "p",
    });
    const anonymous = client(handlerFetch(server, "anonymous"));

    expect(await anonymous.list(PROJECTS_STORE_NAME)).toEqual([{ id: "p" }]);
    const cause = await rejection(
      anonymous.put(PROJECTS_STORE_NAME, { id: "p" }, { expectedVersion: 1 }),
    );
    expect(cause).toBeInstanceOf(ServerStorageError);
    expect(cause).toMatchObject({
      name: "ServerStorageError",
      kind: "unauthenticated",
      operation: "put",
      storeName: PROJECTS_STORE_NAME,
      status: 401,
      errorCode: "unauthenticated",
      message:
        'Server storage put on "projects" failed: unauthenticated (HTTP 401, unauthenticated).',
    });
  });

  it("maps 403 to forbidden for another user's project and a user's Werkskatalog write", async () => {
    const server = await freshServer();
    await client(handlerFetch(server, "alice")).put(PROJECTS_STORE_NAME, {
      id: "p",
    });
    const bob = client(handlerFetch(server, "bob"));

    const project = await rejection(bob.delete(PROJECTS_STORE_NAME, "p"));
    const resource = await rejection(
      bob.put(PROJECT_RESOURCES_STORE_NAME, { id: "r" }),
    );

    expect(
      [project, resource].map((cause) => cause instanceof ServerStorageError),
    ).toEqual([true, true]);
    expect(project).toMatchObject({ kind: "forbidden", status: 403 });
    expect(resource).toMatchObject({ kind: "forbidden", status: 403 });
    expect(await bob.get(PROJECTS_STORE_NAME, "p")).toEqual({ id: "p" });
  });

  it("reports network failures as typed errors instead of falling back", async () => {
    const offline = new TypeError("fetch failed");
    const storage = client(() => Promise.reject(offline));

    for (const operation of [
      storage.list(PROJECTS_STORE_NAME),
      storage.get(PROJECTS_STORE_NAME, "p"),
      storage.put(PROJECTS_STORE_NAME, { id: "p" }, { expectedVersion: null }),
      storage.delete(PROJECTS_STORE_NAME, "p", { expectedVersion: 1 }),
    ]) {
      const cause = await rejection(operation);
      expect(cause).toBeInstanceOf(ServerStorageError);
      expect(cause).toMatchObject({
        kind: "network",
        status: null,
        cause: offline,
      });
    }
  });

  it("maps a server without storage and malformed answers to server errors", async () => {
    setServerDatabaseForTesting(null);
    const disabled = new ServerPlannerRecordStorage({
      baseUrl: ORIGIN,
      fetch: (input) =>
        listRecordsRoute(new Request(urlOf(input)), {
          params: Promise.resolve({ store: PROJECTS_STORE_NAME }),
        }),
    });
    const html = client(async () => new Response("<html>", { status: 200 }));

    expect(await rejection(disabled.list(PROJECTS_STORE_NAME))).toMatchObject({
      kind: "server",
      status: 404,
      errorCode: "server_storage_disabled",
    });
    expect(await rejection(html.get(PROJECTS_STORE_NAME, "p"))).toMatchObject({
      kind: "server",
      status: 200,
    });
  });

  it("keeps no local legacy stores on the server", async () => {
    const calls: string[] = [];
    const storage = client(async (input) => {
      calls.push(urlOf(input));
      throw new Error("unreachable");
    });

    for (const storeName of [
      PALLETS_STORE_NAME,
      PROJECT_QUARANTINE_STORE_NAME,
      LEGACY_MIGRATIONS_STORE_NAME,
    ] as const) {
      expect(await storage.list(storeName)).toEqual([]);
      expect(await storage.get(storeName, "x")).toBeUndefined();
      expect(
        await rejection(storage.put(storeName, { id: "x" })),
      ).toMatchObject({
        kind: "unsupported-store",
        operation: "put",
        storeName,
      });
      expect(await rejection(storage.delete(storeName, "x"))).toMatchObject({
        kind: "unsupported-store",
        operation: "delete",
        storeName,
      });
    }
    expect(calls).toEqual([]);
  });
});
