import { describe, expect, it, vi } from "vitest";

import { translateDe } from "~/i18n";
import { createProject } from "~/domain/project/projectFactory";
import type { PlannerSession } from "~/features/auth/plannerAccessModel";

import {
  canManageFinals,
  finalDisplayName,
  finalRequestErrorMessage,
  loadProjectFinal,
  markFinalBody,
  markProjectFinal,
  projectFinalControls,
  withdrawProjectFinal,
  type ProjectFinal,
  type ProjectFinalInput,
} from "./projectFinalModel";

const SIGNED_IN: PlannerSession = {
  status: "signed-in",
  user: { id: "u-bob", username: "bob", role: "user" },
};
const ROB_TEXT = "1200 800 144\r\n200 300 150\r\n";
const FINAL: ProjectFinal = {
  id: "f-1",
  recordId: "p1",
  recordVersion: 3,
  name: "SKU 9",
  fileName: "line-7.rob",
  sha256: "a".repeat(64),
  markedAt: "2026-11-19T08:30:00.000Z",
};
const formatTime = (iso: string) => `<${iso}>`;

function input(overrides: Partial<ProjectFinalInput> = {}): ProjectFinalInput {
  return {
    storageMode: "server",
    origin: "server",
    session: SIGNED_IN,
    savedVersion: 3,
    hasUnsavedChanges: false,
    download: { ok: true, fileName: "line-7.rob", text: ROB_TEXT },
    state: { status: "loaded", final: null },
    busy: false,
    ...overrides,
  };
}

function controls(overrides: Partial<ProjectFinalInput> = {}) {
  return projectFinalControls(input(overrides), translateDe, formatTime);
}

describe("projectFinalControls", () => {
  it("is hidden outside server mode, for Browserpläne and unsaved plans", () => {
    expect(controls({ storageMode: "local" })).toEqual({ visible: false });
    expect(controls({ origin: "browser-local" })).toEqual({ visible: false });
    expect(controls({ origin: null })).toEqual({ visible: false });
    expect(controls({ savedVersion: null })).toEqual({ visible: false });
  });

  it("offers marking a plan without a Fertigstand", () => {
    expect(controls()).toEqual({
      visible: true,
      mark: { label: "Als fertig markieren", disabledReason: null },
      withdraw: null,
      hint: null,
    });
  });

  it("uses the .rob download's own refusal as the disabled reason", () => {
    expect(
      controls({
        download: {
          ok: false,
          message:
            "Speichern Sie einen Stapel für dieses Projekt, bevor Sie einen .rob-Plan herunterladen.",
        },
      }),
    ).toMatchObject({
      mark: {
        label: "Als fertig markieren",
        disabledReason:
          "Speichern Sie einen Stapel für dieses Projekt, bevor Sie einen .rob-Plan herunterladen.",
      },
    });
  });

  it("asks to save unsaved changes first", () => {
    expect(controls({ hasUnsavedChanges: true })).toMatchObject({
      mark: {
        disabledReason:
          "Speichern Sie zuerst Ihre Änderungen. Fertig markiert wird nur ein gespeicherter Stand.",
      },
    });
  });

  it("needs a signed-in user for both buttons", () => {
    expect(
      controls({
        session: { status: "anonymous" },
        state: { status: "loaded", final: { ...FINAL, recordVersion: 2 } },
      }),
    ).toEqual({
      visible: true,
      mark: {
        label: "Erneut als fertig markieren",
        disabledReason: "Melden Sie sich an, um Pläne als fertig zu markieren.",
      },
      withdraw: {
        label: "Nicht mehr fertig",
        disabledReason: "Melden Sie sich an, um Pläne als fertig zu markieren.",
      },
      hint: "Fertigstand vom <2026-11-19T08:30:00.000Z>, seitdem geändert. Die HMIs haben noch den alten Stand.",
    });
  });

  it("shows the saved version as current and only offers withdrawing", () => {
    expect(controls({ state: { status: "loaded", final: FINAL } })).toEqual({
      visible: true,
      mark: null,
      withdraw: { label: "Nicht mehr fertig", disabledReason: null },
      hint: "Fertigstand vom <2026-11-19T08:30:00.000Z>: Diese Version ist an die HMIs verteilt.",
    });
  });

  it("offers marking again when the plan changed since its Fertigstand", () => {
    expect(
      controls({ savedVersion: 5, state: { status: "loaded", final: FINAL } }),
    ).toEqual({
      visible: true,
      mark: { label: "Erneut als fertig markieren", disabledReason: null },
      withdraw: { label: "Nicht mehr fertig", disabledReason: null },
      hint: "Fertigstand vom <2026-11-19T08:30:00.000Z>, seitdem geändert. Die HMIs haben noch den alten Stand.",
    });
  });

  it("asks for a reload when a newer version was marked elsewhere", () => {
    expect(
      controls({ savedVersion: 2, state: { status: "loaded", final: FINAL } }),
    ).toEqual({
      visible: true,
      mark: {
        label: "Erneut als fertig markieren",
        disabledReason:
          "Laden Sie den Plan neu, bevor Sie ihn erneut als fertig markieren.",
      },
      withdraw: { label: "Nicht mehr fertig", disabledReason: null },
      hint: "Ein neuerer Stand dieses Plans ist seit <2026-11-19T08:30:00.000Z> fertig markiert. Laden Sie den Plan neu.",
    });
  });

  it("waits for the Fertigstand to load and for running requests", () => {
    expect(controls({ state: { status: "unknown" } })).toMatchObject({
      mark: { disabledReason: "Fertigstand wird geladen …" },
    });
    expect(
      controls({
        busy: true,
        state: { status: "loaded", final: { ...FINAL, recordVersion: 1 } },
      }),
    ).toMatchObject({
      mark: { disabledReason: "Wird übertragen …" },
      withdraw: { disabledReason: "Wird übertragen …" },
    });
  });
});

describe("canManageFinals", () => {
  it("allows every signed-in user and nobody else", () => {
    expect(canManageFinals(SIGNED_IN)).toBe(true);
    expect(
      canManageFinals({
        status: "signed-in",
        user: { id: "a", username: "chef", role: "admin" },
      }),
    ).toBe(true);
    for (const status of [
      "local",
      "loading",
      "anonymous",
      "session-lost",
      "error",
    ] as const) {
      expect(canManageFinals({ status })).toBe(false);
    }
  });
});

describe("markFinalBody", () => {
  const ids = { now: () => 1, createId: (kind: string) => `${kind}-1` };

  it("sends the download's text and file name unchanged with the saved version", () => {
    const project = createProject(
      { id: "p1", productNumber: "SKU 9", projectNumber: "P-12" },
      ids,
    );
    expect(
      markFinalBody(
        project,
        3,
        { ok: true, fileName: "line-7.rob", text: ROB_TEXT },
        translateDe,
      ),
    ).toEqual({
      recordId: "p1",
      recordVersion: 3,
      name: "SKU 9 · P-12",
      fileName: "line-7.rob",
      robText: ROB_TEXT,
    });
    expect(
      markFinalBody(project, 3, { ok: false, message: "x" }, translateDe),
    ).toBeNull();
  });

  it("names an unnamed plan like the planner does", () => {
    expect(
      finalDisplayName(createProject({ id: "p2" }, ids), translateDe),
    ).toBe("Unbenannter Plan");
  });
});

function respond(status: number, body?: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  );
}

describe("final API calls", () => {
  it("loads the project's current Fertigstand", async () => {
    const fetchImpl = respond(200, { finals: [FINAL] });
    // Only the requested project's Fertigstand counts.
    expect(await loadProjectFinal(fetchImpl, "p 1")).toEqual({
      ok: true,
      final: null,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/finals?recordId=p%201");
    expect(
      await loadProjectFinal(respond(200, { finals: [FINAL] }), "p1"),
    ).toEqual({
      ok: true,
      final: FINAL,
    });
    expect(await loadProjectFinal(respond(200, { finals: [] }), "p1")).toEqual({
      ok: true,
      final: null,
    });
  });

  it("posts the mark body as JSON and maps a conflict", async () => {
    const fetchImpl = respond(201, { final: FINAL, replacedId: null });
    const body = {
      recordId: "p1",
      recordVersion: 3,
      name: "SKU 9",
      fileName: "line-7.rob",
      robText: ROB_TEXT,
    };
    expect(await markProjectFinal(fetchImpl, body)).toEqual({
      ok: true,
      final: FINAL,
    });
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/finals",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ]);
    expect(
      await markProjectFinal(
        respond(409, { error: "version_conflict", currentVersion: 4 }),
        body,
      ),
    ).toEqual({ ok: false, error: "conflict", message: null });
    expect(
      await markProjectFinal(
        respond(422, { error: "rob_invalid", message: ".rob line 3: x" }),
        body,
      ),
    ).toEqual({ ok: false, error: "rejected", message: ".rob line 3: x" });
  });

  it("withdraws by id and maps an already withdrawn one", async () => {
    const fetchImpl = respond(204);
    expect(await withdrawProjectFinal(fetchImpl, "f-1")).toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0]).toEqual([
      "/api/finals/f-1",
      { method: "DELETE" },
    ]);
    expect(
      await withdrawProjectFinal(
        respond(404, { error: "final_not_found" }),
        "f-1",
      ),
    ).toEqual({ ok: false, error: "not-found", message: null });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await withdrawProjectFinal(offline, "f-1")).toEqual({
      ok: false,
      error: "failed",
      message: null,
    });
  });

  it("explains each failure", () => {
    expect(finalRequestErrorMessage("conflict", null, translateDe)).toBe(
      "Der Plan wurde inzwischen geändert oder gelöscht. Laden Sie ihn neu und markieren Sie ihn dann erneut.",
    );
    expect(
      finalRequestErrorMessage("rejected", ".rob line 3: x", translateDe),
    ).toBe("Der Server hat die .rob-Datei abgelehnt: .rob line 3: x");
  });
});
