// @vitest-environment node
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "~/server/db/database";
import { hmiDevices, planFinals, plannerRecords } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";
import { markFinal, withdrawFinal } from "~/server/finals/finalRepository";
import {
  createHmiRateLimiter,
  setHmiRateLimiterForTesting,
} from "~/server/hmi/hmiAuth";
import { createHmi, revokeHmi } from "~/server/hmi/hmiRepository";

import { GET as downloadRob } from "./finals/[id]/rob/route";
import { GET as listFinals } from "./finals/route";
import { POST as postStatus } from "./status/route";

const ORIGIN = "https://palette.werk.local";
const T0 = new Date("2026-11-19T08:30:00.000Z");
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
const LF_ROB = `${ROB_LINES.join("\n")}\n`;

let database: OpenDatabase;
let hmiId: string;
let token: string;

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
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
  const created = await createHmi(database.db, "Linie 3", T0);
  if (!created.ok) throw new Error("createHmi failed");
  hmiId = created.hmi.id;
  token = created.token;
});

function request(
  method: string,
  path: string,
  init: { token?: string | null; headers?: Record<string, string> } = {},
  body?: unknown,
): Request {
  const headers: Record<string, string> = { ...init.headers };
  const bearer = init.token === undefined ? token : init.token;
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
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

async function mark(
  recordId: string,
  name: string,
  robText: string,
  fileName = "line-7.rob",
) {
  await database.db
    .insert(plannerRecords)
    .values({ store: "projects", id: recordId, json: { id: recordId } })
    .onConflictDoNothing();
  const marked = await markFinal(
    database.db,
    { recordId, recordVersion: 1, name, fileName, robText, userId: null },
    T0,
  );
  if (!marked.ok) throw new Error("markFinal failed");
  return marked.final;
}

async function storedDevice() {
  const [row] = await database.db
    .select()
    .from(hmiDevices)
    .where(eq(hmiDevices.id, hmiId));
  return row!;
}

describe("authentication", () => {
  it("answers 401 with a bearer challenge for missing, unknown and revoked tokens", async () => {
    const unknown = "A".repeat(43);
    const responses = [
      await listFinals(request("GET", "/api/hmi/v1/finals", { token: null })),
      await listFinals(
        request("GET", "/api/hmi/v1/finals", { token: unknown }),
      ),
    ];
    await revokeHmi(database.db, hmiId, T0);
    responses.push(
      await listFinals(request("GET", "/api/hmi/v1/finals")),
      await postStatus(
        request(
          "POST",
          "/api/hmi/v1/status",
          {},
          {
            activeFinalId: null,
            activeSha256: null,
            appVersion: "x",
          },
        ),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="hmi"',
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthenticated" });
    }
    expect((await storedDevice()).lastSeenAt).toBeNull();
  });

  it("answers 429 with Retry-After once a token used its budget", async () => {
    const clock = Date.now();
    setHmiRateLimiterForTesting(createHmiRateLimiter(() => clock, 2, 60_000));

    expect(
      (await listFinals(request("GET", "/api/hmi/v1/finals"))).status,
    ).toBe(200);
    expect(
      (await listFinals(request("GET", "/api/hmi/v1/finals"))).status,
    ).toBe(200);
    const limited = await listFinals(request("GET", "/api/hmi/v1/finals"));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(await limited.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/hmi/v1/finals", () => {
  it("lists the current Fertigstände by name with an ETag, and 304 when unchanged", async () => {
    const b = await mark("p2", "sku 10", LF_ROB, "b.rob");
    const a = await mark("p1", "SKU 9 · P-12", CRLF_ROB);

    const response = await listFinals(request("GET", "/api/hmi/v1/finals"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      finals: [
        {
          id: b.id,
          recordId: "p2",
          name: "sku 10",
          fileName: "b.rob",
          sha256: b.sha256,
          markedAt: "2026-11-19T08:30:00.000Z",
        },
        {
          id: a.id,
          recordId: "p1",
          name: "SKU 9 · P-12",
          fileName: "line-7.rob",
          sha256: CRLF_SHA256,
          markedAt: "2026-11-19T08:30:00.000Z",
        },
      ],
    });
    const etag = response.headers.get("etag")!;
    expect(etag).toBe(
      `"${createHash("sha256").update(body, "utf8").digest("hex")}"`,
    );

    const unchanged = await listFinals(
      request("GET", "/api/hmi/v1/finals", {
        headers: { "if-none-match": etag },
      }),
    );
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe(etag);
    expect(await unchanged.text()).toBe("");

    // Weak form and lists match too.
    const weak = await listFinals(
      request("GET", "/api/hmi/v1/finals", {
        headers: { "if-none-match": `"other", W/${etag}` },
      }),
    );
    expect(weak.status).toBe(304);

    await withdrawFinal(database.db, b.id, T0);
    const changed = await listFinals(
      request("GET", "/api/hmi/v1/finals", {
        headers: { "if-none-match": etag },
      }),
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect(
      ((await changed.json()) as { finals: { id: string }[] }).finals.map(
        (final) => final.id,
      ),
    ).toEqual([a.id]);
  });

  it("answers an empty list when nothing is marked", async () => {
    const response = await listFinals(request("GET", "/api/hmi/v1/finals"));
    expect(await response.json()).toEqual({ finals: [] });
  });

  it("records the HMI as seen", async () => {
    const before = Date.now();
    await listFinals(request("GET", "/api/hmi/v1/finals"));
    const seen = (await storedDevice()).lastSeenAt!.getTime();
    expect(seen >= before && seen <= Date.now()).toBe(true);
  });
});

describe("GET /api/hmi/v1/finals/:id/rob", () => {
  it("returns the marked bytes unchanged, CRLF included, with the SHA-256 as ETag", async () => {
    const final = await mark("p1", "SKU 9", CRLF_ROB, "Linie 7 – Ä.rob");

    const response = await downloadRob(
      request("GET", `/api/hmi/v1/finals/${final.id}/rob`),
      params({ id: final.id }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("etag")).toBe(`"${CRLF_SHA256}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Linie 7 _ _.rob"; filename*=UTF-8''Linie%207%20%E2%80%93%20%C3%84.rob`,
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.equals(Buffer.from(CRLF_ROB, "utf8"))).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(CRLF_SHA256);

    const unchanged = await downloadRob(
      request("GET", `/api/hmi/v1/finals/${final.id}/rob`, {
        headers: { "if-none-match": `"${CRLF_SHA256}"` },
      }),
      params({ id: final.id }),
    );
    expect(unchanged.status).toBe(304);
  });

  it("keeps a withdrawn Fertigstand downloadable", async () => {
    const final = await mark("p1", "SKU 9", LF_ROB);
    await withdrawFinal(database.db, final.id, T0);

    const response = await downloadRob(
      request("GET", `/api/hmi/v1/finals/${final.id}/rob`),
      params({ id: final.id }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(LF_ROB);
  });

  it("answers 404 final_not_found for unknown and malformed ids", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "nope"]) {
      const response = await downloadRob(
        request("GET", `/api/hmi/v1/finals/${id}/rob`),
        params({ id }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "final_not_found" });
    }
  });

  it("requires a valid token", async () => {
    const final = await mark("p1", "SKU 9", LF_ROB);
    const response = await downloadRob(
      request("GET", `/api/hmi/v1/finals/${final.id}/rob`, { token: null }),
      params({ id: final.id }),
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/hmi/v1/status", () => {
  it("stores the active Fertigstand and app version: 204", async () => {
    const final = await mark("p1", "SKU 9", CRLF_ROB);

    const response = await postStatus(
      request(
        "POST",
        "/api/hmi/v1/status",
        {},
        {
          activeFinalId: final.id,
          activeSha256: CRLF_SHA256.toUpperCase(),
          appVersion: "MultipackParser 3.4.0",
          futureField: true,
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const row = await storedDevice();
    expect(row.activeFinalId).toBe(final.id);
    expect(row.appVersion).toBe("MultipackParser 3.4.0");
    expect(row.lastSeenAt).not.toBeNull();

    await postStatus(
      request(
        "POST",
        "/api/hmi/v1/status",
        {},
        {
          activeFinalId: null,
          activeSha256: null,
          appVersion: "MultipackParser 3.5.0",
        },
      ),
    );
    expect(await storedDevice()).toMatchObject({
      activeFinalId: null,
      appVersion: "MultipackParser 3.5.0",
    });
  });

  it("refuses malformed bodies with 400 invalid_request", async () => {
    for (const body of [
      {},
      { activeFinalId: "x", activeSha256: null, appVersion: null },
      { activeFinalId: null, activeSha256: "abc", appVersion: null },
      { activeFinalId: null, activeSha256: null, appVersion: 3 },
      [],
    ]) {
      const response = await postStatus(
        request("POST", "/api/hmi/v1/status", {}, body),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect((await storedDevice()).lastSeenAt).toBeNull();
  });
});

describe("local storage mode", () => {
  it("answers 404 server_storage_disabled on every HMI route", async () => {
    setServerDatabaseForTesting(null);
    const id = "00000000-0000-4000-8000-000000000000";
    const responses = [
      await listFinals(request("GET", "/api/hmi/v1/finals")),
      await downloadRob(
        request("GET", `/api/hmi/v1/finals/${id}/rob`),
        params({ id }),
      ),
      await postStatus(
        request(
          "POST",
          "/api/hmi/v1/status",
          {},
          {
            activeFinalId: null,
            activeSha256: null,
            appVersion: null,
          },
        ),
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
