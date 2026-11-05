import { describe, expect, it } from "vitest";

import {
  createAdminUser,
  EMPTY_CREATE_USER_FORM,
  loadAdminScreen,
  passwordFormProblem,
  resetAdminUserPassword,
} from "./adminUsersModel";

type Call = { url: string; init?: RequestInit };

const ADMIN = { id: "a1", username: "chef", role: "admin" };
const USERS = [
  {
    id: "a1",
    username: "chef",
    role: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "u1",
    username: "planer",
    role: "user",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

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

describe("loadAdminScreen", () => {
  it("lists the users for an admin", async () => {
    const { impl } = fakeFetch({
      "GET /api/auth/me": () => json({ user: ADMIN }),
      "GET /api/admin/users": () => json({ users: USERS }),
    });

    expect(await loadAdminScreen(impl)).toEqual({
      status: "ready",
      currentUserId: "a1",
      users: USERS,
    });
  });

  it("maps local mode, anonymous and non-admin without listing users", async () => {
    const local = fakeFetch({
      "GET /api/auth/me": () => json({ error: "server_storage_disabled" }, 404),
    });
    const anonymous = fakeFetch({
      "GET /api/auth/me": () => json({ error: "unauthenticated" }, 401),
    });
    const user = fakeFetch({
      "GET /api/auth/me": () =>
        json({ user: { id: "u1", username: "planer", role: "user" } }),
    });

    expect(await loadAdminScreen(local.impl)).toEqual({
      status: "unavailable",
    });
    expect(await loadAdminScreen(anonymous.impl)).toEqual({
      status: "unauthenticated",
    });
    expect(await loadAdminScreen(user.impl)).toEqual({
      status: "forbidden",
      username: "planer",
    });
    expect(user.calls.map((call) => call.url)).toEqual(["/api/auth/me"]);
  });

  it("reports malformed answers and network failures as errors", async () => {
    const malformed = fakeFetch({
      "GET /api/auth/me": () => json({ user: ADMIN }),
      "GET /api/admin/users": () =>
        json({ users: [{ id: "x", username: "x", role: "root" }] }),
    });
    const serverError = fakeFetch({
      "GET /api/auth/me": () => json({ error: "boom" }, 500),
    });
    const offline = (async () => {
      throw new TypeError("network");
    }) as typeof fetch;

    expect(await loadAdminScreen(malformed.impl)).toEqual({ status: "error" });
    expect(await loadAdminScreen(serverError.impl)).toEqual({
      status: "error",
    });
    expect(await loadAdminScreen(offline)).toEqual({ status: "error" });
  });

  it("drops to unauthenticated when the list request loses the session", async () => {
    const { impl } = fakeFetch({
      "GET /api/auth/me": () => json({ user: ADMIN }),
      "GET /api/admin/users": () => json({ error: "unauthenticated" }, 401),
    });

    expect(await loadAdminScreen(impl)).toEqual({ status: "unauthenticated" });
  });
});

describe("passwordFormProblem", () => {
  it("requires a password and a matching confirmation", () => {
    expect(passwordFormProblem("", "")).toBe("admin.error.passwordRequired");
    expect(passwordFormProblem("Frische Palette 42", "frische")).toBe(
      "admin.error.passwordMismatch",
    );
    expect(
      passwordFormProblem("Frische Palette 42", "Frische Palette 42"),
    ).toBe(null);
  });
});

describe("createAdminUser", () => {
  const form = {
    username: "Lager.Nord",
    password: "Frische Palette 42",
    confirmation: "Frische Palette 42",
    role: "user" as const,
  };

  it("posts JSON and succeeds on 201", async () => {
    const { impl, calls } = fakeFetch({
      "POST /api/admin/users": () => json({ user: {} }, 201),
    });

    expect(await createAdminUser(impl, form)).toEqual({ ok: true });
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      username: "Lager.Nord",
      password: "Frische Palette 42",
      role: "user",
    });
  });

  it("validates locally before sending", async () => {
    const { impl, calls } = fakeFetch({});

    expect(await createAdminUser(impl, EMPTY_CREATE_USER_FORM)).toEqual({
      ok: false,
      message: "admin.error.usernameRequired",
    });
    expect(
      await createAdminUser(impl, { ...form, confirmation: "anders" }),
    ).toEqual({ ok: false, message: "admin.error.passwordMismatch" });
    expect(calls).toEqual([]);
  });

  it("maps server errors to messages", async () => {
    const answer = (body: unknown, status: number) =>
      createAdminUser(
        fakeFetch({ "POST /api/admin/users": () => json(body, status) }).impl,
        form,
      );

    expect(await answer({ error: "username_taken" }, 409)).toEqual({
      ok: false,
      message: "admin.error.usernameTaken",
    });
    expect(await answer({ error: "invalid_username" }, 400)).toEqual({
      ok: false,
      message: "admin.error.invalidUsername",
    });
    expect(
      await answer({ error: "weak_password", reason: "too_few_distinct" }, 400),
    ).toEqual({
      ok: false,
      message: "admin.error.weakPassword.tooFewDistinct",
    });
    expect(await answer({ error: "forbidden" }, 403)).toEqual({
      ok: false,
      message: "admin.error.sessionLost",
      screen: { status: "forbidden", username: "" },
    });
    expect(await answer({ error: "boom" }, 500)).toEqual({
      ok: false,
      message: "admin.error.generic",
    });
  });
});

describe("resetAdminUserPassword", () => {
  const route = "POST /api/admin/users/u%201/password";

  it("posts the new password for the encoded user id", async () => {
    const { impl, calls } = fakeFetch({
      [route]: () => new Response(null, { status: 204 }),
    });

    expect(
      await resetAdminUserPassword(
        impl,
        { id: "u 1" },
        "a1",
        "Frische Palette 42",
        "Frische Palette 42",
      ),
    ).toEqual({ ok: true });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      password: "Frische Palette 42",
    });
  });

  it("ends the screen when an admin resets their own password", async () => {
    const { impl } = fakeFetch({
      "POST /api/admin/users/a1/password": () =>
        new Response(null, { status: 204 }),
    });

    expect(
      await resetAdminUserPassword(
        impl,
        { id: "a1" },
        "a1",
        "Frische Palette 42",
        "Frische Palette 42",
      ),
    ).toEqual({
      ok: true,
      notice: "admin.reset.ownSessionEnded",
      screen: { status: "unauthenticated" },
    });
  });

  it("maps a vanished user and a lost session", async () => {
    const answer = (body: unknown, status: number) =>
      resetAdminUserPassword(
        fakeFetch({ [route]: () => json(body, status) }).impl,
        { id: "u 1" },
        "a1",
        "Frische Palette 42",
        "Frische Palette 42",
      );

    expect(await answer({ error: "user_not_found" }, 404)).toEqual({
      ok: false,
      message: "admin.error.userNotFound",
    });
    expect(await answer({ error: "unauthenticated" }, 401)).toEqual({
      ok: false,
      message: "admin.error.sessionLost",
      screen: { status: "unauthenticated" },
    });
  });
});
