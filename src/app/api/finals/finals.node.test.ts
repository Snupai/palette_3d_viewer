// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import {
  planFinals,
  plannerRecords,
  sessions,
  users,
} from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";
import { getFinal } from "~/server/finals/finalRepository";

import {
  DELETE as deleteRecordRoute,
  PUT as putRecordRoute,
} from "../records/[store]/[id]/route";
import { DELETE as withdraw } from "./[id]/route";
import { GET as list, POST as mark } from "./route";

const ORIGIN = "https://palette.werk.local";
const T0 = new Date("2026-01-01T00:00:00Z");
const ROB_LINES = [
  "1200 800 144",
  "200 300 150",
  "1",
  "1",
  "0 0",
  "1 0",
  "2",
  "100 50 0 150 200 0 1 0 0",
  "100 50 0 450 200 0 1 0 0",
];
const CRLF_ROB = `${ROB_LINES.join("\r\n")}\r\n`;
const CRLF_SHA256 =
  "2ba87cd84ffc7f6f302c26707adc128a889977bd5480f745ab58aab0a4e4db3e";

let database: OpenDatabase;
const cookies = { alice: "", bob: "" };

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
  await database.db.delete(sessions);
  await database.db.delete(users);
  await database.db.insert(users).values(
    (["alice", "bob"] as const).map((id) => ({
      id,
      username: id,
      passwordHash: "x",
      role: "user" as const,
      createdAt: T0,
    })),
  );
  for (const name of ["alice", "bob"] as const) {
    const session = await createSession(database.db, name, new Date());
    cookies[name] = `palette_session=${session.token}`;
  }
});

type As = keyof typeof cookies | "anonymous";

function request(
  method: string,
  path: string,
  as: As,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {};
  if (as !== "anonymous") headers.cookie = cookies[as];
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params<T extends Record<string, string>>(value: T) {
  return { params: Promise.resolve(value) };
}

async function saveProject(
  id: string,
  expectedVersion: number | null,
): Promise<number> {
  const response = await putRecordRoute(
    request("PUT", `/api/records/projects/${id}`, "alice", {
      record: { id, edits: expectedVersion ?? 0 },
      expectedVersion,
    }),
    params({ store: "projects", id }),
  );
  const body = (await response.json()) as { version: number };
  return body.version;
}

function markBody(overrides: Record<string, unknown> = {}) {
  return {
    recordId: "p1",
    recordVersion: 1,
    name: "SKU 9",
    fileName: "line-7.rob",
    robText: CRLF_ROB,
    ...overrides,
  };
}

async function listFinals(query = "") {
  const response = await list(
    request("GET", `/api/finals${query}`, "anonymous"),
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      finals: { id: string; recordId: string; recordVersion: number }[];
    },
  };
}

describe("/api/finals", () => {
  it("marks a saved project version finished and keeps the .rob bytes", async () => {
    await saveProject("p1", null);
    const response = await mark(
      request("POST", "/api/finals", "bob", markBody()),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      final: { id: string; markedAt: string };
      replacedId: string | null;
    };
    expect(body).toEqual({
      final: {
        id: body.final.id,
        recordId: "p1",
        recordVersion: 1,
        name: "SKU 9",
        fileName: "line-7.rob",
        sha256: CRLF_SHA256,
        markedAt: body.final.markedAt,
      },
      replacedId: null,
    });
    const stored = await getFinal(database.db, body.final.id);
    expect(stored?.robText).toBe(CRLF_ROB);
    expect(stored?.markedBy).toBe("bob");
    expect((await listFinals()).body.finals.map(({ id }) => id)).toEqual([
      body.final.id,
    ]);
  });

  it("answers a stale project version with 409 and the current version", async () => {
    const v1 = await saveProject("p1", null);
    await saveProject("p1", v1);
    const response = await mark(
      request("POST", "/api/finals", "alice", markBody({ recordVersion: 1 })),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "version_conflict",
      currentVersion: 2,
    });
    expect((await listFinals()).body.finals).toEqual([]);
  });

  it("replaces the current Fertigstand on a new mark", async () => {
    const v1 = await saveProject("p1", null);
    const first = (await (
      await mark(request("POST", "/api/finals", "alice", markBody()))
    ).json()) as { final: { id: string } };
    const v2 = await saveProject("p1", v1);
    const response = await mark(
      request("POST", "/api/finals", "alice", markBody({ recordVersion: v2 })),
    );
    expect(response.status).toBe(201);
    const second = (await response.json()) as {
      final: { id: string };
      replacedId: string;
    };
    expect(second.replacedId).toBe(first.final.id);
    expect(
      (await listFinals("?recordId=p1")).body.finals.map(
        ({ id, recordVersion }) => [id, recordVersion],
      ),
    ).toEqual([[second.final.id, 2]]);
  });

  it("answers an identical repeated mark with 200 and the same Fertigstand", async () => {
    await saveProject("p1", null);
    const first = (await (
      await mark(request("POST", "/api/finals", "alice", markBody()))
    ).json()) as { final: { id: string } };
    const again = await mark(
      request("POST", "/api/finals", "alice", markBody()),
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as { final: { id: string } }).final.id).toBe(
      first.final.id,
    );
  });

  it("refuses text that is not a .rob and oversized text", async () => {
    await saveProject("p1", null);
    const notRob = await mark(
      request("POST", "/api/finals", "alice", markBody({ robText: "hallo" })),
    );
    expect(notRob.status).toBe(422);
    expect(await notRob.json()).toEqual({
      error: "rob_invalid",
      message: "Unexpected .rob format: expected at least 6 lines",
    });
    const tooLarge = await mark(
      request(
        "POST",
        "/api/finals",
        "alice",
        markBody({ robText: CRLF_ROB + " ".repeat(256 * 1024) }),
      ),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "rob_too_large" });
  });

  it("needs a session to mark or withdraw, not to list", async () => {
    await saveProject("p1", null);
    const response = await mark(
      request("POST", "/api/finals", "anonymous", markBody()),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    const withdrawn = await withdraw(
      request(
        "DELETE",
        "/api/finals/00000000-0000-4000-8000-000000000000",
        "anonymous",
      ),
      params({ id: "00000000-0000-4000-8000-000000000000" }),
    );
    expect(withdrawn.status).toBe(401);
    expect((await listFinals()).status).toBe(200);
  });

  it("withdraws a Fertigstand once; it leaves the list", async () => {
    await saveProject("p1", null);
    const marked = (await (
      await mark(request("POST", "/api/finals", "alice", markBody()))
    ).json()) as { final: { id: string } };
    const id = marked.final.id;
    const response = await withdraw(
      request("DELETE", `/api/finals/${id}`, "bob"),
      params({ id }),
    );
    expect(response.status).toBe(204);
    expect((await listFinals()).body.finals).toEqual([]);
    const again = await withdraw(
      request("DELETE", `/api/finals/${id}`, "bob"),
      params({ id }),
    );
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "final_not_found" });
  });

  it("withdraws a deleted project's Fertigstand through the records API", async () => {
    await saveProject("p1", null);
    const marked = (await (
      await mark(request("POST", "/api/finals", "alice", markBody()))
    ).json()) as { final: { id: string } };
    const deleted = await deleteRecordRoute(
      request("DELETE", "/api/records/projects/p1?expectedVersion=1", "alice"),
      params({ store: "projects", id: "p1" }),
    );
    expect(deleted.status).toBe(204);
    expect((await listFinals()).body.finals).toEqual([]);
    const kept = await getFinal(database.db, marked.final.id);
    expect(kept?.robText).toBe(CRLF_ROB);
    expect(kept?.withdrawnAt).not.toBeNull();
  });

  it("answers 404 in local storage mode", async () => {
    setServerDatabaseForTesting(null);
    const disabled = { error: "server_storage_disabled" };
    const listed = await list(request("GET", "/api/finals", "alice"));
    expect(listed.status).toBe(404);
    expect(await listed.json()).toEqual(disabled);
    const marked = await mark(
      request("POST", "/api/finals", "alice", markBody()),
    );
    expect(marked.status).toBe(404);
    expect(await marked.json()).toEqual(disabled);
    const id = "00000000-0000-4000-8000-000000000000";
    const withdrawn = await withdraw(
      request("DELETE", `/api/finals/${id}`, "alice"),
      params({ id }),
    );
    expect(withdrawn.status).toBe(404);
    expect(await withdrawn.json()).toEqual(disabled);
  });
});
