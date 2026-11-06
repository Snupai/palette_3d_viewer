import type { MessageKey } from "~/i18n";
import type { StorageMode } from "~/lib/storageMode";

/**
 * Who may change what in the planner (#34, ADR 0002/0003/0005), plus the
 * session API calls. No React: the calls take `fetch` so tests run against a
 * fake.
 *
 * Local mode has no accounts: everything stays editable exactly as before.
 * In server mode every project is readable without a session (ADR 0003);
 * changing or deleting the original is reserved for its creator and admins,
 * other signed-in users save a copy instead. The server enforces the same
 * rules — this model only decides what the UI offers.
 */

export type SessionUserRole = "admin" | "user";

export type SessionUser = {
  id: string;
  username: string;
  role: SessionUserRole;
};

export type PlannerSession =
  /** Local storage mode: no accounts, no restrictions. */
  | { status: "local" }
  | { status: "loading" }
  | { status: "anonymous" }
  /** A request lost its session: retain the draft and require sign-in. */
  | { status: "session-lost" }
  | { status: "signed-in"; user: SessionUser }
  /** `/api/auth/me` gave no usable answer (server unreachable, …). */
  | { status: "error" };

/** How saving an opened project works for the current session. */
export type ProjectSaveMode =
  /** Write the project itself (also: create a project not yet stored). */
  | "overwrite"
  /** Store the changes as a new project the user owns. */
  | "copy"
  /** Save only in this browser; never publish implicitly on sign-in. */
  | "browser-local"
  /** No saving at all; see `readOnlyHint`. */
  | "none";

export type PlannerAccess = {
  /** New plans, `.rob` and package imports. */
  canCreate: boolean;
  save: ProjectSaveMode;
  canDelete: boolean;
  /** Why editing is disabled; `null` whenever `save` is not `none`. */
  readOnlyHint: MessageKey | null;
};

export function initialPlannerSession(mode: StorageMode): PlannerSession {
  return mode === "local" ? { status: "local" } : { status: "loading" };
}

const FULL_ACCESS: PlannerAccess = {
  canCreate: true,
  save: "overwrite",
  canDelete: true,
  readOnlyHint: null,
};

function readOnly(hint: MessageKey): PlannerAccess {
  return {
    canCreate: false,
    save: "none",
    canDelete: false,
    readOnlyHint: hint,
  };
}

/** Storage origin is explicit; a missing creator never identifies a Browserplan. */
export type PlannerPlanOrigin =
  | { origin: "browser-local" }
  | {
      origin: "server";
      /** undefined: new server plan; null: stored plan whose creator was deleted. */
      createdBy: string | null | undefined;
    };

/** What the session may do with a plan at the specified storage origin. */
export function plannerAccess(
  session: PlannerSession,
  plan: PlannerPlanOrigin,
): PlannerAccess {
  switch (session.status) {
    case "local":
      return FULL_ACCESS;
    case "loading":
      return readOnly("auth.readOnly.checking");
    case "session-lost":
      return readOnly("auth.readOnly.signIn");
    case "error":
      return readOnly("auth.readOnly.sessionUnknown");
    case "anonymous":
      return plan.origin === "browser-local"
        ? { ...FULL_ACCESS, save: "browser-local" }
        : readOnly("auth.readOnly.signIn");
    case "signed-in": {
      // Browserplans stay local until explicit synchronization with consent.
      if (plan.origin === "browser-local") {
        return { ...FULL_ACCESS, save: "browser-local" };
      }
      const { user } = session;
      if (
        user.role === "admin" ||
        plan.createdBy === undefined ||
        plan.createdBy === user.id
      ) {
        return FULL_ACCESS;
      }
      return {
        canCreate: true,
        save: "copy",
        canDelete: false,
        readOnlyHint: null,
      };
    }
  }
}

/** Label and disabled reason of a "save this project" button. */
export type SaveControl = {
  /** Replaces the button's usual label; `null` keeps it. */
  label: MessageKey | null;
  /** Disables the button and explains why; `null` keeps it enabled. */
  disabledReason: MessageKey | null;
  /** Informational save-target hint; does not disable saving. */
  hint?: MessageKey;
};

/** A {@link SaveControl} with translated texts, as save buttons take it. */
export type SaveButtonState = {
  label: string | null;
  disabledReason: string | null;
  hint?: string;
};

export function saveControl(access: PlannerAccess): SaveControl {
  switch (access.save) {
    case "browser-local":
      return {
        label: "auth.saveInBrowser",
        disabledReason: null,
        hint: "auth.browserLocalHint",
      };
    case "overwrite":
      return { label: null, disabledReason: null };
    case "copy":
      return { label: "auth.saveAsCopy", disabledReason: null };
    case "none":
      return { label: null, disabledReason: access.readOnlyHint };
  }
}

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

function parseSessionUser(body: unknown): SessionUser | null {
  const user = isRecord(body) ? body.user : null;
  if (!isRecord(user)) return null;
  const { id, username, role } = user;
  if (
    typeof id !== "string" ||
    typeof username !== "string" ||
    (role !== "admin" && role !== "user")
  ) {
    return null;
  }
  return { id, username, role };
}

/** The session from `GET /api/auth/me`; any unexpected answer is `error`. */
export async function loadPlannerSession(
  fetchImpl: Fetch,
): Promise<PlannerSession> {
  try {
    const response = await fetchImpl("/api/auth/me", { cache: "no-store" });
    if (response.status === 401) return { status: "anonymous" };
    if (!response.ok) return { status: "error" };
    const user = parseSessionUser(await readJson(response));
    return user ? { status: "signed-in", user } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export type LoginResult =
  | { ok: true; session: PlannerSession & { status: "signed-in" } }
  | { ok: false; message: MessageKey };

/** `POST /api/auth/login`. Unknown user and wrong password look the same. */
export async function signIn(
  fetchImpl: Fetch,
  username: string,
  password: string,
): Promise<LoginResult> {
  if (username.trim() === "" || password === "") {
    return { ok: false, message: "auth.error.missingCredentials" };
  }
  try {
    const response = await fetchImpl("/api/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ username, password }),
    });
    if (response.status === 401) {
      return { ok: false, message: "auth.error.invalidCredentials" };
    }
    if (!response.ok) return { ok: false, message: "auth.error.generic" };
    const user = parseSessionUser(await readJson(response));
    return user
      ? { ok: true, session: { status: "signed-in", user } }
      : { ok: false, message: "auth.error.generic" };
  } catch {
    return { ok: false, message: "auth.error.generic" };
  }
}

/** `POST /api/auth/logout`; `true` once the server ended the session. */
export async function signOut(fetchImpl: Fetch): Promise<boolean> {
  try {
    const response = await fetchImpl("/api/auth/logout", { method: "POST" });
    return response.status === 204;
  } catch {
    return false;
  }
}
