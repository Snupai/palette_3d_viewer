import { describe, expect, it, vi } from "vitest";

import type { AdminHmi } from "../admin/adminHmisModel";
import {
  cancelHmiPageProposal,
  filterHmiPageFinals,
  loadHmiPage,
  loadHmiPageFinals,
  proposalStatusKey,
  sendHmiProposal,
  shouldPollHmiPage,
  type HmiPageFinal,
  type HmiPageProposal,
} from "./hmiProposalModel";

const HMI_ID = "2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10";
const HMI: AdminHmi = {
  id: HMI_ID,
  name: "Linie 3",
  createdAt: "2026-11-20T08:00:00.000Z",
  revokedAt: null,
  lastSeenAt: "2026-11-20T08:30:00.000Z",
  appVersion: "MultipackParser 3.4.0",
  activeFinal: null,
};
const PROPOSAL: HmiPageProposal = {
  id: "c3a1d7b2-0f8e-4e57-9c1a-3f2b6d5e4a90",
  finalId: "8d0a6f0e-4b52-4f8f-a1f4-5b9f6f0f2c11",
  finalName: "SKU 9 · P-12",
  proposedBy: "alice",
  createdAt: "2026-11-20T08:31:00.000Z",
  state: "pending",
  resolvedAt: null,
};
const API_PROPOSAL = {
  ...PROPOSAL,
  hmiId: HMI_ID,
  finalSha256: "2ba87cd8".padEnd(64, "0"),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe("loadHmiPage", () => {
  it("reads the HMI and its latest proposal", async () => {
    const fetchImpl = fetchReturning(
      json({ hmi: HMI, proposal: API_PROPOSAL }),
    );
    expect(await loadHmiPage(fetchImpl, HMI_ID)).toEqual({
      status: "ready",
      hmi: HMI,
      proposal: PROPOSAL,
    });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/hmis/${HMI_ID}`, {
      cache: "no-store",
    });
    expect(
      await loadHmiPage(
        fetchReturning(json({ hmi: HMI, proposal: null })),
        HMI_ID,
      ),
    ).toEqual({ status: "ready", hmi: HMI, proposal: null });
  });

  it("maps session, mode and lookup failures to page states", async () => {
    const cases: [Response, string][] = [
      [json({ error: "unauthenticated" }, 401), "unauthenticated"],
      [json({ error: "server_storage_disabled" }, 404), "unavailable"],
      [json({ error: "hmi_not_found" }, 404), "not-found"],
      [json({ error: "boom" }, 500), "error"],
      [json({ hmi: { id: 1 }, proposal: null }), "error"],
      [
        json({ hmi: HMI, proposal: { ...API_PROPOSAL, state: "odd" } }),
        "error",
      ],
    ];
    for (const [response, status] of cases) {
      expect(await loadHmiPage(fetchReturning(response), HMI_ID)).toEqual({
        status,
      });
    }
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("x"));
    expect(await loadHmiPage(offline, HMI_ID)).toEqual({ status: "error" });
  });
});

describe("loadHmiPageFinals and filterHmiPageFinals", () => {
  const finals: HmiPageFinal[] = [
    {
      id: "a",
      name: "SKU 9 · P-12",
      fileName: "line-7.rob",
      markedAt: "2026-11-19T08:30:00.000Z",
    },
    {
      id: "b",
      name: "Kartons Halle Süd",
      fileName: "sued.rob",
      markedAt: "2026-11-19T09:30:00.000Z",
    },
  ];

  it("reads the current Fertigstände", async () => {
    const listed = finals.map((final) => ({
      ...final,
      recordId: "p",
      recordVersion: 1,
      sha256: "0".repeat(64),
    }));
    expect(
      await loadHmiPageFinals(fetchReturning(json({ finals: listed }))),
    ).toEqual(finals);
    expect(await loadHmiPageFinals(fetchReturning(json({}, 500)))).toBeNull();
    expect(
      await loadHmiPageFinals(fetchReturning(json({ finals: [{ id: 1 }] }))),
    ).toBeNull();
  });

  it("matches every term against name and file name, ignoring case", () => {
    expect(filterHmiPageFinals(finals, "").map((f) => f.id)).toEqual([
      "a",
      "b",
    ]);
    expect(
      filterHmiPageFinals(finals, "  sku  LINE-7 ").map((f) => f.id),
    ).toEqual(["a"]);
    expect(filterHmiPageFinals(finals, "süd").map((f) => f.id)).toEqual(["b"]);
    expect(filterHmiPageFinals(finals, "sku süd")).toEqual([]);
  });
});

describe("sendHmiProposal", () => {
  it("posts the Fertigstand and returns the created proposal", async () => {
    const fetchImpl = fetchReturning(
      json({ proposal: API_PROPOSAL, supersededId: null }, 201),
    );
    expect(await sendHmiProposal(fetchImpl, HMI_ID, PROPOSAL.finalId)).toEqual({
      ok: true,
      proposal: PROPOSAL,
    });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/hmis/${HMI_ID}/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ finalId: PROPOSAL.finalId }),
    });
  });

  it("explains refusals", async () => {
    const cases: [Response, unknown][] = [
      [
        json({ error: "unauthenticated" }, 401),
        {
          ok: false,
          message: "hmi.error.unauthenticated",
          state: { status: "unauthenticated" },
        },
      ],
      [
        json({ error: "forbidden" }, 403),
        { ok: false, message: "hmi.error.forbidden" },
      ],
      [
        json({ error: "final_not_found" }, 404),
        { ok: false, message: "hmi.error.finalGone" },
      ],
      [
        json({ error: "hmi_revoked" }, 409),
        { ok: false, message: "hmi.error.revoked" },
      ],
      [
        json({ error: "hmi_not_found" }, 404),
        {
          ok: false,
          message: "hmi.error.notFound",
          state: { status: "not-found" },
        },
      ],
      [json({}, 500), { ok: false, message: "hmi.error.generic" }],
    ];
    for (const [response, expected] of cases) {
      expect(
        await sendHmiProposal(fetchReturning(response), HMI_ID, "f"),
      ).toEqual(expected);
    }
  });
});

describe("cancelHmiPageProposal", () => {
  it("deletes the proposal; a closed one is explained", async () => {
    const fetchImpl = fetchReturning(new Response(null, { status: 204 }));
    expect(await cancelHmiPageProposal(fetchImpl, HMI_ID, PROPOSAL.id)).toEqual(
      {
        ok: true,
        proposal: null,
      },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/hmis/${HMI_ID}/proposals/${PROPOSAL.id}`,
      { method: "DELETE" },
    );
    expect(
      await cancelHmiPageProposal(
        fetchReturning(
          json({ error: "proposal_closed", state: "accepted" }, 409),
        ),
        HMI_ID,
        PROPOSAL.id,
      ),
    ).toEqual({ ok: false, message: "hmi.error.proposalClosed" });
  });
});

describe("proposalStatusKey", () => {
  it("says whether a pending proposal can reach the HMI", () => {
    expect(proposalStatusKey(PROPOSAL, "online")).toBe(
      "hmi.proposal.state.pending",
    );
    expect(proposalStatusKey(PROPOSAL, "offline")).toBe(
      "hmi.proposal.state.pendingOffline",
    );
    expect(proposalStatusKey(PROPOSAL, "never")).toBe(
      "hmi.proposal.state.pendingOffline",
    );
  });

  it.each([
    ["accepted", "hmi.proposal.state.accepted"],
    ["rejected", "hmi.proposal.state.rejected"],
    ["superseded", "hmi.proposal.state.superseded"],
    ["expired", "hmi.proposal.state.expired"],
    ["cancelled", "hmi.proposal.state.cancelled"],
  ] as const)("names the closed state %s", (state, key) => {
    expect(proposalStatusKey({ ...PROPOSAL, state }, "online")).toBe(key);
  });
});

describe("shouldPollHmiPage", () => {
  it("polls only a visible page that shows (or retries) an HMI", () => {
    const ready = { status: "ready" as const, hmi: HMI, proposal: null };
    expect(shouldPollHmiPage(ready, true)).toBe(true);
    expect(shouldPollHmiPage(ready, false)).toBe(false);
    expect(shouldPollHmiPage({ status: "error" }, true)).toBe(true);
    expect(shouldPollHmiPage({ status: "unauthenticated" }, true)).toBe(false);
    expect(shouldPollHmiPage({ status: "not-found" }, true)).toBe(false);
    expect(shouldPollHmiPage({ status: "loading" }, true)).toBe(false);
  });
});
