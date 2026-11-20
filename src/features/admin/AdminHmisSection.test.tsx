import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminHmisSection } from "./AdminHmisSection";

const TOKEN = "q9bXo3Y2vAbCdEfGhIjKlMnOpQrStUvWxYz0123456-";
const NEW_TOKEN = "Zz9bXo3Y2vAbCdEfGhIjKlMnOpQrStUvWxYz012345";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hmi(overrides: Record<string, unknown> = {}) {
  return {
    id: "2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10",
    name: "Linie 3",
    createdAt: "2026-11-01T07:00:00.000Z",
    revokedAt: null,
    lastSeenAt: null,
    appVersion: null,
    activeFinal: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("AdminHmisSection", () => {
  it("shows a new HMI's token once, with the configuration download, and forgets it on close", async () => {
    let hmis: ReturnType<typeof hmi>[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/hmis" && init?.method === "POST") {
        hmis = [hmi()];
        return json({ hmi: hmis[0], token: TOKEN }, 201);
      }
      return json({ hmis });
    }) as typeof fetch;
    render(<AdminHmisSection fetchImpl={fetchImpl} onScreen={vi.fn()} />);

    expect(
      await screen.findByText("Noch keine HMIs registriert."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Linie 3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HMI registrieren" }));

    const panel = await screen.findByRole("region", {
      name: "Konfiguration für Linie 3",
    });
    expect(
      within(panel).getByDisplayValue(TOKEN).getAttribute("readonly"),
    ).toBe("");
    expect(within(panel).getByLabelText(/^Planer-Adresse/)).toHaveProperty(
      "value",
      window.location.origin,
    );
    expect(
      within(panel).getByRole<HTMLButtonElement>("button", {
        name: "Konfigurationsdatei herunterladen",
      }).disabled,
    ).toBe(false);
    expect(screen.getByText("HMI Linie 3 wurde registriert.")).toBeTruthy();
    expect(await screen.findByText("Noch nie verbunden")).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText(/^Planer-Adresse/), {
      target: { value: "planer" },
    });
    expect(
      within(panel).getByText(
        "Bitte eine vollständige http(s)-Adresse ohne Parameter eingeben.",
      ),
    ).toBeTruthy();
    expect(
      within(panel).getByRole<HTMLButtonElement>("button", {
        name: "Konfigurationsdatei herunterladen",
      }).disabled,
    ).toBe(true);

    fireEvent.click(within(panel).getByRole("button", { name: "Schließen" }));
    expect(screen.queryByDisplayValue(TOKEN)).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Konfiguration für Linie 3" }),
    ).toBeNull();
  });

  it("asks before generating a new token, then shows it", async () => {
    let tokenCalls = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/token") && init?.method === "POST") {
        tokenCalls++;
        return json({ hmi: hmi(), token: NEW_TOKEN });
      }
      return json({
        hmis: [hmi({ revokedAt: "2026-11-19T07:00:00.000Z" })],
      });
    }) as typeof fetch;
    render(<AdminHmisSection fetchImpl={fetchImpl} onScreen={vi.fn()} />);

    const row = (await screen.findByText("Linie 3")).closest("tr")!;
    expect(within(row).getByText("Gesperrt")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Sperren" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Neuer Token" }));
    expect(
      within(row).getByText(/Der bisherige Token wird sofort ungültig/),
    ).toBeTruthy();
    expect(tokenCalls).toBe(0);
    fireEvent.click(
      within(row).getByRole("button", { name: "Token erzeugen" }),
    );

    expect(await screen.findByDisplayValue(NEW_TOKEN)).toBeTruthy();
    expect(tokenCalls).toBe(1);
    await waitFor(() =>
      expect(within(row).getByText("Noch nie verbunden")).toBeTruthy(),
    );
  });

  it("refreshes the list in the background so a polling HMI shows as online", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let lastSeenAt: string | null = null;
      const fetchImpl = (async () =>
        json({ hmis: [hmi({ lastSeenAt })] })) as typeof fetch;
      render(<AdminHmisSection fetchImpl={fetchImpl} onScreen={vi.fn()} />);
      expect(await screen.findByText("Noch nie verbunden")).toBeTruthy();

      lastSeenAt = new Date(Date.now()).toISOString();
      await act(() => vi.advanceTimersByTimeAsync(15_000));

      expect(await screen.findByText("Online")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
