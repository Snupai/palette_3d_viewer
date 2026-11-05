import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AdminUsersScreen } from "./AdminUsersScreen";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminUsersScreen", () => {
  it("shows the login-required state to anonymous visitors", async () => {
    const fetchImpl = (async () =>
      json({ error: "unauthenticated" }, 401)) as typeof fetch;

    render(<AdminUsersScreen fetchImpl={fetchImpl} />);

    expect(
      await screen.findByText(
        "Bitte als Admin anmelden, um Benutzer zu verwalten.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists users and creates one, reloading the list", async () => {
    let users = [
      {
        id: "a1",
        username: "chef",
        role: "admin",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me") {
        return json({ user: { id: "a1", username: "chef", role: "admin" } });
      }
      if (url === "/api/admin/users" && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as { username: string };
        users = [
          ...users,
          {
            id: "u1",
            username: body.username,
            role: "user",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
        ];
        return json({ user: users[1] }, 201);
      }
      return json({ users });
    }) as typeof fetch;

    render(<AdminUsersScreen fetchImpl={fetchImpl} />);

    expect(await screen.findByText("chef")).toBeTruthy();
    expect(screen.getByText("(Sie)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Benutzername/), {
      target: { value: "lager" },
    });
    fireEvent.change(screen.getByLabelText(/^Kennwort mindestens/), {
      target: { value: "Frische Palette 42" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort wiederholen"), {
      target: { value: "Frische Palette 42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Benutzer anlegen" }));

    expect(
      await screen.findByText("Benutzer lager wurde angelegt."),
    ).toBeTruthy();
    expect(await screen.findByText("lager")).toBeTruthy();
  });
});
