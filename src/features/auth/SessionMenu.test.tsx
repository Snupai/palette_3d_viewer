import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageMode } from "~/lib/storageMode";

import { SessionMenu, usePlannerSession } from "./SessionMenu";

function Harness({
  mode,
  fetchImpl,
  onSignedOut,
  beforeLeave,
}: {
  mode: StorageMode;
  fetchImpl: typeof fetch;
  onSignedOut?: () => void;
  beforeLeave?: () => boolean;
}) {
  const controls = usePlannerSession(mode, fetchImpl);
  return (
    <>
      <output data-testid="status">{controls.session.status}</output>
      <SessionMenu
        controls={controls}
        onSignedOut={onSignedOut}
        beforeLeave={beforeLeave}
      />
    </>
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The model only calls `fetch` with path strings. */
function pathOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : "";
}

afterEach(cleanup);

describe("SessionMenu", () => {
  it("renders nothing and never asks the server in local mode", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { container } = render(
      <Harness mode="local" fetchImpl={fetchImpl} />,
    );
    expect(screen.getByTestId("status").textContent).toBe("local");
    expect(container.querySelector("details")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signs an anonymous visitor in and out", async () => {
    const alice = { id: "u-alice", username: "alice", role: "user" };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      switch (pathOf(input)) {
        case "/api/auth/me":
          return json({ error: "unauthenticated" }, 401);
        case "/api/auth/login":
          return json({ user: alice });
        case "/api/auth/logout":
          return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request ${pathOf(input)}`);
    });
    const onSignedOut = vi.fn();
    render(
      <Harness mode="server" fetchImpl={fetchImpl} onSignedOut={onSignedOut} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anonymous"),
    );
    expect(screen.getByText("Nur lesen")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("signed-in"),
    );
    expect(screen.getByText("Angemeldet als alice")).toBeTruthy();
    expect(screen.queryByText("Nur lesen")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anonymous"),
    );
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it("shows a wrong password without signing in", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      pathOf(input) === "/api/auth/me"
        ? json({ error: "unauthenticated" }, 401)
        : json({ error: "invalid_credentials" }, 401),
    );
    render(<Harness mode="server" fetchImpl={fetchImpl} />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anonymous"),
    );
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "wrong" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Benutzername oder Kennwort ist falsch.",
    );
    expect(screen.getByTestId("status").textContent).toBe("anonymous");
  });

  it("asks before leaving for the user management and stays when declined", async () => {
    const admin = { id: "u-admin", username: "admin", role: "admin" };
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ user: admin }));
    const beforeLeave = vi.fn(() => false);
    render(
      <Harness mode="server" fetchImpl={fetchImpl} beforeLeave={beforeLeave} />,
    );
    const link = await screen.findByRole("link", {
      name: "Benutzerverwaltung",
    });

    // `false`: the click's default (following the link) was prevented.
    expect(fireEvent.click(link)).toBe(false);
    expect(beforeLeave).toHaveBeenCalledOnce();
  });

  it("keeps a sign-in when the slower initial session check answers later", async () => {
    const alice = { id: "u-alice", username: "alice", role: "user" };
    let answerMe: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      pathOf(input) === "/api/auth/me"
        ? new Promise<Response>((resolve) => {
            answerMe = resolve;
          })
        : Promise.resolve(json({ user: alice })),
    );
    render(<Harness mode="server" fetchImpl={fetchImpl} />);
    expect(screen.getByTestId("status").textContent).toBe("loading");

    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("signed-in"),
    );
    // The check started before the sign-in answers "anonymous" only now.
    answerMe?.(json({ error: "unauthenticated" }, 401));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId("status").textContent).toBe("signed-in");
  });
});
