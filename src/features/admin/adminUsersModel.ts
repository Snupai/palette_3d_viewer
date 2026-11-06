import type { MessageKey } from "~/i18n";

/**
 * State and API calls for the admin user screen (#32, ADR 0005). No React:
 * every function takes `fetch` so tests run against a fake.
 */

export type AdminUserRole = "admin" | "user";

export type AdminUser = {
  id: string;
  username: string;
  role: AdminUserRole;
  /** ISO timestamp. */
  createdAt: string;
};

export type AdminScreenState =
  | { status: "loading" }
  /** Local storage mode (ADR 0002): there are no server accounts. */
  | { status: "unavailable" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; username: string }
  | { status: "error" }
  | { status: "ready"; currentUserId: string; users: AdminUser[] };

type Fetch = typeof fetch;

const JSON_HEADERS = { "content-type": "application/json" } as const;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): AdminUser | null {
  if (!isRecord(value)) return null;
  const { id, username, role, createdAt } = value;
  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    (role !== "admin" && role !== "user") ||
    typeof createdAt !== "string"
  ) {
    return null;
  }
  return { id, username, role, createdAt };
}

/**
 * Decides what the screen shows from `GET /api/auth/me`, then lists the
 * accounts. Any unexpected answer becomes `error`, never `ready`.
 */
export async function loadAdminScreen(
  fetchImpl: Fetch,
): Promise<AdminScreenState> {
  try {
    const meResponse = await fetchImpl("/api/auth/me", { cache: "no-store" });
    if (meResponse.status === 404) return { status: "unavailable" };
    if (meResponse.status === 401) return { status: "unauthenticated" };
    if (!meResponse.ok) return { status: "error" };
    const meBody = await readJson(meResponse);
    const me = isRecord(meBody) ? meBody.user : null;
    if (!isRecord(me) || typeof me.id !== "string") return { status: "error" };
    if (me.role !== "admin") {
      return {
        status: "forbidden",
        username: typeof me.username === "string" ? me.username : "",
      };
    }
    return await loadUsers(fetchImpl, me.id);
  } catch {
    return { status: "error" };
  }
}

async function loadUsers(
  fetchImpl: Fetch,
  currentUserId: string,
): Promise<AdminScreenState> {
  const response = await fetchImpl("/api/admin/users", { cache: "no-store" });
  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) return { status: "forbidden", username: "" };
  if (response.status === 404) return { status: "unavailable" };
  if (!response.ok) return { status: "error" };
  const body = await readJson(response);
  const raw = isRecord(body) && Array.isArray(body.users) ? body.users : null;
  if (!raw) return { status: "error" };
  const users = raw.map(parseUser);
  if (users.some((user) => user === null)) return { status: "error" };
  return { status: "ready", currentUserId, users: users as AdminUser[] };
}

/**
 * Outcome of a create/reset. `screen`, when present, replaces the whole
 * screen state (session lost, role lost, own password reset).
 */
export type AdminActionResult =
  | { ok: true; notice?: MessageKey; screen?: AdminScreenState }
  | { ok: false; message: MessageKey; screen?: AdminScreenState };

const ERROR_MESSAGES: Record<string, MessageKey> = {
  username_taken: "admin.error.usernameTaken",
  invalid_username: "admin.error.invalidUsername",
  user_not_found: "admin.error.userNotFound",
  self_deletion: "admin.error.selfDeletion",
  last_admin: "admin.error.lastAdmin",
};

const WEAK_PASSWORD_MESSAGES: Record<string, MessageKey> = {
  too_short: "admin.error.weakPassword.tooShort",
  too_long: "admin.error.weakPassword.tooLong",
  contains_username: "admin.error.weakPassword.containsUsername",
  too_few_distinct: "admin.error.weakPassword.tooFewDistinct",
};

async function failureFor(response: Response): Promise<AdminActionResult> {
  const body = await readJson(response);
  const error =
    isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (error === "weak_password" && isRecord(body)) {
    const reason = typeof body.reason === "string" ? body.reason : "";
    return {
      ok: false,
      message: WEAK_PASSWORD_MESSAGES[reason] ?? "admin.error.generic",
    };
  }
  const known = ERROR_MESSAGES[error];
  if (known) return { ok: false, message: known };
  if (response.status === 401) {
    const screen: AdminScreenState = { status: "unauthenticated" };
    return { ok: false, message: "admin.error.sessionLost", screen };
  }
  if (response.status === 403) {
    const screen: AdminScreenState = { status: "forbidden", username: "" };
    return { ok: false, message: "admin.error.sessionLost", screen };
  }
  if (error === "server_storage_disabled") {
    const screen: AdminScreenState = { status: "unavailable" };
    return { ok: false, message: "admin.error.generic", screen };
  }
  return { ok: false, message: "admin.error.generic" };
}

/** Client-side checks before a request: filled in and confirmed. */
export function passwordFormProblem(
  password: string,
  confirmation: string,
): MessageKey | null {
  if (password === "") return "admin.error.passwordRequired";
  if (password !== confirmation) return "admin.error.passwordMismatch";
  return null;
}

export type CreateUserForm = {
  username: string;
  password: string;
  confirmation: string;
  role: AdminUserRole;
};

export const EMPTY_CREATE_USER_FORM: CreateUserForm = {
  username: "",
  password: "",
  confirmation: "",
  role: "user",
};

export async function createAdminUser(
  fetchImpl: Fetch,
  form: CreateUserForm,
): Promise<AdminActionResult> {
  if (form.username.trim() === "") {
    return { ok: false, message: "admin.error.usernameRequired" };
  }
  const problem = passwordFormProblem(form.password, form.confirmation);
  if (problem) return { ok: false, message: problem };
  try {
    const response = await fetchImpl("/api/admin/users", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        role: form.role,
      }),
    });
    return response.status === 201 ? { ok: true } : await failureFor(response);
  } catch {
    return { ok: false, message: "admin.error.generic" };
  }
}

/**
 * Resets `user`'s password. The server revokes all of that user's sessions,
 * so resetting one's own password ends the admin's session too: the result
 * then carries the `unauthenticated` screen.
 */
export async function resetAdminUserPassword(
  fetchImpl: Fetch,
  user: Pick<AdminUser, "id">,
  currentUserId: string,
  password: string,
  confirmation: string,
): Promise<AdminActionResult> {
  const problem = passwordFormProblem(password, confirmation);
  if (problem) return { ok: false, message: problem };
  try {
    const response = await fetchImpl(
      `/api/admin/users/${encodeURIComponent(user.id)}/password`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ password }),
      },
    );
    if (response.status !== 204) return await failureFor(response);
    return user.id === currentUserId
      ? {
          ok: true,
          notice: "admin.reset.ownSessionEnded",
          screen: { status: "unauthenticated" },
        }
      : { ok: true };
  } catch {
    return { ok: false, message: "admin.error.generic" };
  }
}

/** Called only after the screen has confirmed deletion. */
export async function deleteAdminUser(
  fetchImpl: Fetch,
  user: Pick<AdminUser, "id">,
  currentUserId: string,
): Promise<AdminActionResult> {
  if (user.id === currentUserId) {
    return { ok: false, message: "admin.error.selfDeletion" };
  }
  try {
    const response = await fetchImpl(
      `/api/admin/users/${encodeURIComponent(user.id)}`,
      { method: "DELETE" },
    );
    return response.status === 204 ? { ok: true } : await failureFor(response);
  } catch {
    return { ok: false, message: "admin.error.generic" };
  }
}
