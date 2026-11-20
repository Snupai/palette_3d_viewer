import { describe, expect, it } from "vitest";

import {
  checkHmiServerUrl,
  createAdminHmi,
  HMI_ONLINE_WINDOW_MS,
  hmiActiveFinalText,
  hmiConfigFile,
  hmiConnection,
  hmiLastSeenText,
  hmiNameProblem,
  loadAdminHmis,
  parseAdminHmi,
  regenerateAdminHmiToken,
  renameAdminHmi,
  replaceHmi,
  revokeAdminHmi,
  type AdminHmi,
} from "./adminHmisModel";

type Call = { url: string; init?: RequestInit };

const NOW = Date.parse("2026-11-20T10:00:00.000Z");
const TOKEN = "q9bXo3Y2vAbCdEfGhIjKlMnOpQrStUvWxYz0123456-";

const LINE_3: AdminHmi = {
  id: "2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10",
  name: "Linie 3",
  createdAt: "2026-11-01T07:00:00.000Z",
  revokedAt: null,
  lastSeenAt: "2026-11-20T09:59:48.000Z",
  appVersion: "MultipackParser 3.4.0",
  activeFinal: {
    id: "8d0a6f0e-4b52-4f8f-a1f4-5b9f6f0f2c11",
    name: "SKU 9 · P-12",
    sha256: "2ba87cd84ffc7f6f302c26707adc128a889977bd5480f745ab58aab0a4e4db3e",
    withdrawn: false,
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fake `fetch` answering by `METHOD url`; records every call. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[`${init?.method ?? "GET"} ${url}`];
    if (!route) throw new Error(`unexpected ${url}`);
    return route();
  }) as typeof fetch;
  return { impl, calls };
}

describe("loadAdminHmis", () => {
  it("lists the HMIs", async () => {
    const { impl } = fakeFetch({
      "GET /api/admin/hmis": () => json({ hmis: [LINE_3] }),
    });
    expect(await loadAdminHmis(impl)).toEqual({
      status: "ready",
      hmis: [LINE_3],
    });
  });

  it("replaces the screen when the session, the role or server mode is gone", async () => {
    for (const [status, screen] of [
      [401, { status: "unauthenticated" }],
      [403, { status: "forbidden", username: "" }],
      [404, { status: "unavailable" }],
    ] as const) {
      const { impl } = fakeFetch({
        "GET /api/admin/hmis": () => json({ error: "x" }, status),
      });
      expect(await loadAdminHmis(impl)).toEqual({ status: "screen", screen });
    }
  });

  it("treats server errors, malformed bodies and network errors as error", async () => {
    const answers = [
      () => json({ error: "boom" }, 500),
      () => json({ hmis: [{ ...LINE_3, revokedAt: 5 }] }),
      () => json({ users: [] }),
      () => {
        throw new TypeError("offline");
      },
    ];
    for (const answer of answers) {
      const { impl } = fakeFetch({ "GET /api/admin/hmis": answer });
      expect(await loadAdminHmis(impl)).toEqual({ status: "error" });
    }
  });
});

describe("parseAdminHmi", () => {
  it("accepts an HMI without activity yet", () => {
    const fresh = {
      ...LINE_3,
      lastSeenAt: null,
      appVersion: null,
      activeFinal: null,
    };
    expect(parseAdminHmi(fresh)).toEqual(fresh);
  });

  it("refuses unexpected shapes", () => {
    expect(parseAdminHmi({ ...LINE_3, activeFinal: { id: "x" } })).toBeNull();
    expect(parseAdminHmi({ ...LINE_3, name: 3 })).toBeNull();
    expect(parseAdminHmi(null)).toBeNull();
  });
});

describe("HMI writes", () => {
  it("creates an HMI with a trimmed name and returns its one-time token", async () => {
    const { impl, calls } = fakeFetch({
      "POST /api/admin/hmis": () => json({ hmi: LINE_3, token: TOKEN }, 201),
    });

    expect(await createAdminHmi(impl, "  Linie 3 ")).toEqual({
      ok: true,
      hmi: LINE_3,
      token: TOKEN,
    });
    expect(calls).toEqual([
      {
        url: "/api/admin/hmis",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"name":"Linie 3"}',
        },
      },
    ]);
  });

  it("checks the name before sending", async () => {
    const { impl, calls } = fakeFetch({});
    expect(await createAdminHmi(impl, "  ")).toEqual({
      ok: false,
      message: "admin.hmis.error.nameRequired",
    });
    expect(await renameAdminHmi(impl, LINE_3, "x".repeat(101))).toEqual({
      ok: false,
      message: "admin.hmis.error.invalidName",
    });
    expect(calls).toEqual([]);
    expect(hmiNameProblem("x".repeat(100))).toBeNull();
  });

  it("renames, revokes and regenerates with the right requests", async () => {
    const renamed = { ...LINE_3, name: "Linie 4" };
    const revoked = { ...LINE_3, revokedAt: "2026-11-20T10:00:00.000Z" };
    const base = `/api/admin/hmis/${LINE_3.id}`;
    const { impl, calls } = fakeFetch({
      [`PATCH ${base}`]: () => json({ hmi: renamed }),
      [`POST ${base}/revoke`]: () => json({ hmi: revoked }),
      [`POST ${base}/token`]: () => json({ hmi: LINE_3, token: TOKEN }),
    });

    expect(await renameAdminHmi(impl, LINE_3, " Linie 4 ")).toEqual({
      ok: true,
      hmi: renamed,
    });
    expect(await revokeAdminHmi(impl, LINE_3)).toEqual({
      ok: true,
      hmi: revoked,
    });
    expect(await regenerateAdminHmiToken(impl, LINE_3)).toEqual({
      ok: true,
      hmi: LINE_3,
      token: TOKEN,
    });
    expect(
      calls.map((call) => [call.init?.method, call.url, call.init?.body]),
    ).toEqual([
      ["PATCH", base, '{"name":"Linie 4"}'],
      ["POST", `${base}/revoke`, "{}"],
      ["POST", `${base}/token`, "{}"],
    ]);
  });

  it("maps server errors to messages and lost sessions to screens", async () => {
    const base = `/api/admin/hmis/${LINE_3.id}`;
    const cases = [
      [
        json({ error: "hmi_not_found" }, 404),
        { ok: false, message: "admin.hmis.error.notFound" },
      ],
      [
        json({ error: "invalid_name" }, 400),
        { ok: false, message: "admin.hmis.error.invalidName" },
      ],
      [
        json({ error: "unauthenticated" }, 401),
        {
          ok: false,
          message: "admin.error.sessionLost",
          screen: { status: "unauthenticated" },
        },
      ],
      [
        json({ error: "forbidden" }, 403),
        {
          ok: false,
          message: "admin.error.sessionLost",
          screen: { status: "forbidden", username: "" },
        },
      ],
      [
        json({ error: "server_storage_disabled" }, 404),
        {
          ok: false,
          message: "admin.error.generic",
          screen: { status: "unavailable" },
        },
      ],
      [json({ hmi: LINE_3 }), { ok: false, message: "admin.error.generic" }],
    ] as const;
    for (const [response, expected] of cases) {
      const { impl } = fakeFetch({ [`POST ${base}/token`]: () => response });
      expect(await regenerateAdminHmiToken(impl, LINE_3)).toEqual(expected);
    }
  });

  it("replaces one HMI in the list", () => {
    const other = { ...LINE_3, id: "other", name: "Linie 1" };
    const renamed = { ...LINE_3, name: "Linie 4" };
    expect(replaceHmi([other, LINE_3], renamed)).toEqual([other, renamed]);
  });
});

describe("connection state", () => {
  it("is online within the window, offline after it, never before the first request, revoked when revoked", () => {
    expect(HMI_ONLINE_WINDOW_MS).toBe(60_000);
    const seenAt = (ms: number) => ({
      ...LINE_3,
      lastSeenAt: new Date(NOW - ms).toISOString(),
    });
    expect(hmiConnection(seenAt(60_000), NOW)).toBe("online");
    expect(hmiConnection(seenAt(60_001), NOW)).toBe("offline");
    expect(hmiConnection({ ...LINE_3, lastSeenAt: null }, NOW)).toBe("never");
    expect(
      hmiConnection({ ...LINE_3, revokedAt: "2026-11-20T09:00:00.000Z" }, NOW),
    ).toBe("revoked");
  });

  it("says how long ago the HMI was seen", () => {
    const seenAgo = (ms: number) =>
      hmiLastSeenText(
        { ...LINE_3, lastSeenAt: new Date(NOW - ms).toISOString() },
        NOW,
      );
    expect(hmiLastSeenText({ ...LINE_3, lastSeenAt: null }, NOW)).toEqual({
      key: "admin.hmis.seen.never",
    });
    expect(seenAgo(12_400)).toEqual({
      key: "admin.hmis.seen.seconds",
      params: { count: 12 },
    });
    expect(seenAgo(-5_000)).toEqual({
      key: "admin.hmis.seen.seconds",
      params: { count: 0 },
    });
    expect(seenAgo(3 * 60_000 + 59_000)).toEqual({
      key: "admin.hmis.seen.minutes",
      params: { count: 3 },
    });
    expect(seenAgo(2 * 3_600_000)).toEqual({
      key: "admin.hmis.seen.hours",
      params: { count: 2 },
    });
    expect(seenAgo(4 * 86_400_000 + 1)).toEqual({
      key: "admin.hmis.seen.days",
      params: { count: 4 },
    });
  });

  it("names the running Fertigstand and flags a withdrawn one", () => {
    expect(hmiActiveFinalText(LINE_3)).toEqual({
      key: "admin.hmis.active.current",
      params: { name: "SKU 9 · P-12" },
    });
    expect(
      hmiActiveFinalText({
        ...LINE_3,
        activeFinal: { ...LINE_3.activeFinal!, withdrawn: true },
      }),
    ).toEqual({
      key: "admin.hmis.active.withdrawn",
      params: { name: "SKU 9 · P-12" },
    });
    expect(hmiActiveFinalText({ ...LINE_3, activeFinal: null })).toEqual({
      key: "admin.hmis.active.none",
    });
  });
});

describe("configuration file", () => {
  it("normalizes the server address and flags plain HTTP outside loopback", () => {
    expect(checkHmiServerUrl(" https://planer.werk.local/ ")).toEqual({
      ok: true,
      serverUrl: "https://planer.werk.local",
      insecure: false,
    });
    expect(checkHmiServerUrl("https://werk.local/planer//")).toEqual({
      ok: true,
      serverUrl: "https://werk.local/planer",
      insecure: false,
    });
    expect(checkHmiServerUrl("http://10.0.0.5:3000")).toEqual({
      ok: true,
      serverUrl: "http://10.0.0.5:3000",
      insecure: true,
    });
    expect(checkHmiServerUrl("http://localhost:3000")).toEqual({
      ok: true,
      serverUrl: "http://localhost:3000",
      insecure: false,
    });
    for (const bad of [
      "planer.werk.local",
      "ftp://planer.werk.local",
      "https://planer.werk.local/?x=1",
      "https://user:pw@planer.werk.local",
      "",
    ]) {
      expect(checkHmiServerUrl(bad)).toEqual({
        ok: false,
        message: "admin.hmis.config.invalidUrl",
      });
    }
  });

  it("holds serverUrl, hmiId and token, named after the HMI", () => {
    expect(
      hmiConfigFile("https://planer.werk.local", {
        hmi: { ...LINE_3, name: "Linie 3 – Halle Süd" },
        token: TOKEN,
      }),
    ).toEqual({
      fileName: "hmi-linie-3-halle-sud.json",
      text:
        "{\n" +
        '  "serverUrl": "https://planer.werk.local",\n' +
        '  "hmiId": "2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10",\n' +
        `  "token": "${TOKEN}"\n` +
        "}\n",
    });
    expect(
      hmiConfigFile("https://p", {
        hmi: { ...LINE_3, name: "ÄÖÜ!" },
        token: TOKEN,
      }).fileName,
    ).toBe("hmi-aou.json");
    expect(
      hmiConfigFile("https://p", {
        hmi: { ...LINE_3, name: "線3" },
        token: TOKEN,
      }).fileName,
    ).toBe("hmi-3.json");
    expect(
      hmiConfigFile("https://p", {
        hmi: { ...LINE_3, name: "線" },
        token: TOKEN,
      }).fileName,
    ).toBe("hmi-hmi.json");
  });
});
