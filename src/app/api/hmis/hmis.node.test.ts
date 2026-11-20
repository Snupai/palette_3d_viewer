// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSession } from "~/server/auth/accounts";
import type { OpenDatabase } from "~/server/db/database";
import {
  hmiDevices,
  hmiProposals,
  planFinals,
  plannerRecords,
  sessions,
  users,
} from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";
import { markFinal, withdrawFinal } from "~/server/finals/finalRepository";
import { answerHmiProposal } from "~/server/hmi/hmiProposalRepository";
import { createHmi, revokeHmi } from "~/server/hmi/hmiRepository";

import {
  DELETE as cancel,
  GET as getOne,
} from "./[hmiId]/proposals/[id]/route";
import { GET as list, POST as propose } from "./[hmiId]/proposals/route";
import { GET as getHmiRoute } from "./[hmiId]/route";

const ORIGIN = "https://palette.werk.local";
const T0 = new Date("2026-11-20T08:00:00.000Z");
const ROB = ["1200 800 144", "200 300 150", "1", "1", "0 0", "1 0", "2"]
  .concat(["100 50 0 150 200 0 1 0 0", "100 50 0 450 200 0 1 0 0", ""])
  .join("\r\n");
const ROB_SHA256 =
  "2ba87cd84ffc7f6f302c26707adc128a889977bd5480f745ab58aab0a4e4db3e";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let database: OpenDatabase;
let cookie = "";
let hmiId: string;
let finalId: string;

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});

beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(hmiProposals);
  await database.db.delete(hmiDevices);
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
  await database.db.delete(sessions);
  await database.db.delete(users);
  await database.db.insert(users).values({
    id: "alice",
    username: "alice",
    passwordHash: "x",
    role: "user",
    createdAt: T0,
  });
  cookie = `palette_session=${(await createSession(database.db, "alice", new Date())).token}`;
  const created = await createHmi(database.db, "Linie 3", T0);
  if (!created.ok) throw new Error("createHmi failed");
  hmiId = created.hmi.id;
  await database.db
    .insert(plannerRecords)
    .values({ store: "projects", id: "project-1", json: { id: "project-1" } });
  const marked = await markFinal(
    database.db,
    {
      recordId: "project-1",
      recordVersion: 1,
      name: "SKU 9 · P-12",
      fileName: "line-7.rob",
      robText: ROB,
      userId: "alice",
    },
    T0,
  );
  if (!marked.ok) throw new Error("markFinal failed");
  finalId = marked.final.id;
});

function request(
  method: string,
  path: string,
  signedIn = true,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {};
  if (signedIn) headers.cookie = cookie;
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

async function proposeFinal(id = finalId) {
  return propose(
    request("POST", `/api/hmis/${hmiId}/proposals`, true, { finalId: id }),
    params({ hmiId }),
  );
}

describe("POST /api/hmis/:hmiId/proposals", () => {
  it("creates a pending proposal and supersedes the open one", async () => {
    const first = await proposeFinal();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      proposal: { id: string; createdAt: string };
      supersededId: string | null;
    };
    expect(firstBody).toEqual({
      proposal: {
        id: firstBody.proposal.id,
        hmiId,
        finalId,
        finalName: "SKU 9 · P-12",
        finalSha256: ROB_SHA256,
        proposedBy: "alice",
        createdAt: firstBody.proposal.createdAt,
        state: "pending",
        resolvedAt: null,
      },
      supersededId: null,
    });

    const second = await proposeFinal();
    const secondBody = (await second.json()) as {
      proposal: { id: string };
      supersededId: string;
    };
    expect(secondBody.supersededId).toBe(firstBody.proposal.id);

    const listed = await list(
      request("GET", `/api/hmis/${hmiId}/proposals`),
      params({ hmiId }),
    );
    const { proposals } = (await listed.json()) as {
      proposals: { id: string; state: string }[];
    };
    expect(proposals.map((p) => [p.id, p.state])).toEqual([
      [secondBody.proposal.id, "pending"],
      [firstBody.proposal.id, "superseded"],
    ]);
  });

  it("refuses unknown HMIs, withdrawn Fertigstände and revoked HMIs", async () => {
    const unknownHmi = await propose(
      request("POST", `/api/hmis/${UNKNOWN_ID}/proposals`, true, { finalId }),
      params({ hmiId: UNKNOWN_ID }),
    );
    expect(unknownHmi.status).toBe(404);
    expect(await unknownHmi.json()).toEqual({ error: "hmi_not_found" });

    const malformed = await propose(
      request("POST", `/api/hmis/${hmiId}/proposals`, true, { finalId: 7 }),
      params({ hmiId }),
    );
    expect(malformed.status).toBe(400);

    await withdrawFinal(database.db, finalId, new Date());
    const withdrawn = await proposeFinal();
    expect(withdrawn.status).toBe(404);
    expect(await withdrawn.json()).toEqual({ error: "final_not_found" });

    await revokeHmi(database.db, hmiId, new Date());
    const revoked = await proposeFinal();
    expect(revoked.status).toBe(409);
    expect(await revoked.json()).toEqual({ error: "hmi_revoked" });
  });

  it("requires a session and JSON", async () => {
    const anonymous = await propose(
      request("POST", `/api/hmis/${hmiId}/proposals`, false, { finalId }),
      params({ hmiId }),
    );
    expect(anonymous.status).toBe(401);
    const form = await propose(
      new Request(`${ORIGIN}/api/hmis/${hmiId}/proposals`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `finalId=${finalId}`,
      }),
      params({ hmiId }),
    );
    expect(form.status).toBe(415);
  });
});

describe("GET /api/hmis/:hmiId", () => {
  it("returns the HMI and its latest proposal in any state", async () => {
    const empty = await getHmiRoute(
      request("GET", `/api/hmis/${hmiId}`),
      params({ hmiId }),
    );
    expect(await empty.json()).toEqual({
      hmi: {
        id: hmiId,
        name: "Linie 3",
        createdAt: T0.toISOString(),
        revokedAt: null,
        lastSeenAt: null,
        appVersion: null,
        activeFinal: null,
      },
      proposal: null,
    });

    const created = (await (await proposeFinal()).json()) as {
      proposal: { id: string };
    };
    await answerHmiProposal(
      database.db,
      hmiId,
      created.proposal.id,
      "rejected",
      new Date(),
    );
    const response = await getHmiRoute(
      request("GET", `/api/hmis/${hmiId}`),
      params({ hmiId }),
    );
    const body = (await response.json()) as {
      proposal: { id: string; state: string };
    };
    expect(body.proposal).toMatchObject({
      id: created.proposal.id,
      state: "rejected",
    });
  });

  it("is not public and answers 404 for unknown HMIs", async () => {
    const anonymous = await getHmiRoute(
      request("GET", `/api/hmis/${hmiId}`, false),
      params({ hmiId }),
    );
    expect(anonymous.status).toBe(401);
    const unknown = await getHmiRoute(
      request("GET", `/api/hmis/not-a-uuid`),
      params({ hmiId: "not-a-uuid" }),
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "hmi_not_found" });
  });
});

describe("/api/hmis/:hmiId/proposals/:id", () => {
  it("reads and cancels a pending proposal once", async () => {
    const { proposal } = (await (await proposeFinal()).json()) as {
      proposal: { id: string };
    };
    const path = `/api/hmis/${hmiId}/proposals/${proposal.id}`;
    const ids = params({ hmiId, id: proposal.id });

    const read = await getOne(request("GET", path), ids);
    expect(await read.json()).toMatchObject({
      proposal: { id: proposal.id, state: "pending" },
    });

    const cancelled = await cancel(request("DELETE", path), ids);
    expect(cancelled.status).toBe(204);
    const again = await cancel(request("DELETE", path), ids);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: "proposal_closed",
      state: "cancelled",
    });

    const anonymous = await cancel(request("DELETE", path, false), ids);
    expect(anonymous.status).toBe(401);
    const unknown = await getOne(
      request("GET", `/api/hmis/${hmiId}/proposals/${UNKNOWN_ID}`),
      params({ hmiId, id: UNKNOWN_ID }),
    );
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "proposal_not_found" });
  });
});

describe("local storage mode", () => {
  it("answers 404 server_storage_disabled on every route", async () => {
    setServerDatabaseForTesting(null);
    const ids = params({ hmiId: UNKNOWN_ID, id: UNKNOWN_ID });
    const base = `/api/hmis/${UNKNOWN_ID}`;
    const responses = [
      await getHmiRoute(request("GET", base), ids),
      await list(request("GET", `${base}/proposals`), ids),
      await propose(
        request("POST", `${base}/proposals`, true, { finalId: UNKNOWN_ID }),
        ids,
      ),
      await getOne(request("GET", `${base}/proposals/${UNKNOWN_ID}`), ids),
      await cancel(request("DELETE", `${base}/proposals/${UNKNOWN_ID}`), ids),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "server_storage_disabled",
      });
    }
  });
});
