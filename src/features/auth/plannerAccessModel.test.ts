import { describe, expect, it, vi } from "vitest";

import {
  initialPlannerSession,
  loadPlannerSession,
  plannerAccess,
  saveControl,
  signIn,
  signOut,
  type PlannerSession,
} from "./plannerAccessModel";

const ALICE: PlannerSession = {
  status: "signed-in",
  user: { id: "u-alice", username: "alice", role: "user" },
};
const ADMIN: PlannerSession = {
  status: "signed-in",
  user: { id: "u-admin", username: "admin", role: "admin" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("plannerAccess", () => {
  it("leaves local mode fully editable, with or without a creator", () => {
    const local: PlannerSession = { status: "local" };
    expect(initialPlannerSession("local")).toEqual(local);
    expect(plannerAccess(local, undefined)).toEqual({
      canCreate: true,
      save: "overwrite",
      canDelete: true,
      readOnlyHint: null,
    });
    expect(plannerAccess(local, "someone")).toEqual(
      plannerAccess(local, undefined),
    );
  });

  it("makes anonymous visitors read-only with a sign-in hint", () => {
    expect(plannerAccess({ status: "anonymous" }, "u-alice")).toEqual({
      canCreate: false,
      save: "none",
      canDelete: false,
      readOnlyHint: "auth.readOnly.signIn",
    });
    expect(plannerAccess({ status: "anonymous" }, undefined).save).toBe("none");
  });

  it("stays read-only while the session is loading or unknown", () => {
    expect(initialPlannerSession("server")).toEqual({ status: "loading" });
    expect(
      [{ status: "loading" } as const, { status: "error" } as const].map(
        (session) => plannerAccess(session, "u-alice"),
      ),
    ).toEqual([
      {
        canCreate: false,
        save: "none",
        canDelete: false,
        readOnlyHint: "auth.readOnly.checking",
      },
      {
        canCreate: false,
        save: "none",
        canDelete: false,
        readOnlyHint: "auth.readOnly.sessionUnknown",
      },
    ]);
  });

  it("lets the creator overwrite and delete their project", () => {
    expect(plannerAccess(ALICE, "u-alice")).toEqual({
      canCreate: true,
      save: "overwrite",
      canDelete: true,
      readOnlyHint: null,
    });
  });

  it("lets a signed-in user create a project not stored yet", () => {
    expect(plannerAccess(ALICE, undefined).save).toBe("overwrite");
  });

  it("makes another user's project save as a copy, without delete", () => {
    expect(plannerAccess(ALICE, "u-bob")).toEqual({
      canCreate: true,
      save: "copy",
      canDelete: false,
      readOnlyHint: null,
    });
    // A deleted creator leaves no owner: only admins may change the original.
    expect(plannerAccess(ALICE, null).save).toBe("copy");
  });

  it("lets admins overwrite and delete every project", () => {
    expect(
      ["u-bob", null, undefined].map((createdBy) =>
        plannerAccess(ADMIN, createdBy),
      ),
    ).toEqual(
      Array(3).fill({
        canCreate: true,
        save: "overwrite",
        canDelete: true,
        readOnlyHint: null,
      }),
    );
  });
});

describe("saveControl", () => {
  it("keeps, relabels or disables the save button per save mode", () => {
    expect(saveControl(plannerAccess(ALICE, "u-alice"))).toEqual({
      label: null,
      disabledReason: null,
    });
    expect(saveControl(plannerAccess(ALICE, "u-bob"))).toEqual({
      label: "auth.saveAsCopy",
      disabledReason: null,
    });
    expect(
      saveControl(plannerAccess({ status: "anonymous" }, "u-bob")),
    ).toEqual({ label: null, disabledReason: "auth.readOnly.signIn" });
  });
});

describe("session API", () => {
  it("reads the session from /api/auth/me", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        user: { id: "u-alice", username: "alice", role: "user" },
      }),
    );
    expect(await loadPlannerSession(fetchImpl)).toEqual(ALICE);
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/me", {
      cache: "no-store",
    });
  });

  it("maps 401 to anonymous and anything unexpected to error", async () => {
    const answers = [
      jsonResponse({ error: "unauthenticated" }, 401),
      jsonResponse({ error: "server_storage_disabled" }, 404),
      jsonResponse({ user: { id: "u", username: "x", role: "root" } }),
      new Response("not json", { status: 200 }),
    ];
    const sessions = [];
    for (const answer of answers) {
      sessions.push(await loadPlannerSession(async () => answer));
    }
    sessions.push(
      await loadPlannerSession(async () => {
        throw new TypeError("offline");
      }),
    );
    expect(sessions).toEqual([
      { status: "anonymous" },
      { status: "error" },
      { status: "error" },
      { status: "error" },
      { status: "error" },
    ]);
  });

  it("signs in with JSON credentials and returns the user", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        user: { id: "u-admin", username: "admin", role: "admin" },
      }),
    );
    expect(await signIn(fetchImpl, "admin", "secret")).toEqual({
      ok: true,
      session: ADMIN,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" }),
    });
  });

  it("reports missing input, wrong credentials and failures", async () => {
    const neverCalled = vi.fn<typeof fetch>();
    const results = [
      await signIn(neverCalled, "  ", "secret"),
      await signIn(neverCalled, "alice", ""),
      await signIn(
        async () => jsonResponse({ error: "invalid_credentials" }, 401),
        "alice",
        "wrong",
      ),
      await signIn(async () => jsonResponse({ error: "x" }, 500), "a", "b"),
      await signIn(
        async () => {
          throw new TypeError("offline");
        },
        "a",
        "b",
      ),
    ];
    expect(neverCalled).not.toHaveBeenCalled();
    expect(results).toEqual([
      { ok: false, message: "auth.error.missingCredentials" },
      { ok: false, message: "auth.error.missingCredentials" },
      { ok: false, message: "auth.error.invalidCredentials" },
      { ok: false, message: "auth.error.generic" },
      { ok: false, message: "auth.error.generic" },
    ]);
  });

  it("signs out only when the server confirms with 204", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await signOut(fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(await signOut(async () => new Response(null, { status: 500 }))).toBe(
      false,
    );
    expect(
      await signOut(async () => {
        throw new TypeError("offline");
      }),
    ).toBe(false);
  });
});
