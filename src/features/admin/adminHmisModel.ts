import type { MessageKey, MessageParams } from "~/i18n";

import type { AdminScreenState } from "./adminUsersModel";

/**
 * State and API calls for the HMI section of the admin screen (ADR 0013,
 * `docs/hmi-api-v1.md`). No React: every function takes `fetch` (and the
 * clock where it matters) so tests run without a DOM.
 *
 * A device token exists in the browser only in the answer to a create or
 * regenerate; the screen shows it once, offers the configuration file and
 * then forgets it.
 */

/** The Fertigstand an HMI reported as running. */
export type AdminHmiActiveFinal = {
  id: string;
  name: string;
  sha256: string;
  withdrawn: boolean;
};

export type AdminHmi = {
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  appVersion: string | null;
  activeFinal: AdminHmiActiveFinal | null;
};

export type AdminHmisLoad =
  | { status: "ready"; hmis: AdminHmi[] }
  | { status: "error" }
  /** The session or admin role is gone, or the server runs in local mode. */
  | { status: "screen"; screen: AdminScreenState };

/** A freshly issued token, shown once together with its configuration file. */
export type IssuedHmiToken = { hmi: AdminHmi; token: string };

export type HmiActionResult =
  | { ok: true; hmi: AdminHmi; token?: string }
  | { ok: false; message: MessageKey; screen?: AdminScreenState };

type Fetch = typeof fetch;

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** An HMI counts as online when its last request is at most this old. */
export const HMI_ONLINE_WINDOW_MS = 60_000;

/** Same limit as the server (`MAX_HMI_NAME_LENGTH`). */
export const MAX_HMI_NAME_LENGTH = 100;

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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseActiveFinal(value: unknown): AdminHmiActiveFinal | null | false {
  if (value === null) return null;
  if (!isRecord(value)) return false;
  const { id, name, sha256, withdrawn } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof sha256 !== "string" ||
    typeof withdrawn !== "boolean"
  ) {
    return false;
  }
  return { id, name, sha256, withdrawn };
}

/** One HMI from the admin API, or `null` when the shape is unexpected. */
export function parseAdminHmi(value: unknown): AdminHmi | null {
  if (!isRecord(value)) return null;
  const { id, name, createdAt, revokedAt, lastSeenAt, appVersion } = value;
  const activeFinal = parseActiveFinal(value.activeFinal);
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof createdAt !== "string" ||
    !isNullableString(revokedAt) ||
    !isNullableString(lastSeenAt) ||
    !isNullableString(appVersion) ||
    activeFinal === false
  ) {
    return null;
  }
  return {
    id,
    name,
    createdAt,
    revokedAt,
    lastSeenAt,
    appVersion,
    activeFinal,
  };
}

function sessionScreen(response: Response): AdminScreenState | null {
  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) return { status: "forbidden", username: "" };
  return null;
}

export async function loadAdminHmis(fetchImpl: Fetch): Promise<AdminHmisLoad> {
  try {
    const response = await fetchImpl("/api/admin/hmis", { cache: "no-store" });
    const screen = sessionScreen(response);
    if (screen) return { status: "screen", screen };
    if (response.status === 404) {
      return { status: "screen", screen: { status: "unavailable" } };
    }
    if (!response.ok) return { status: "error" };
    const body = await readJson(response);
    const raw = isRecord(body) && Array.isArray(body.hmis) ? body.hmis : null;
    if (!raw) return { status: "error" };
    const hmis = raw.map(parseAdminHmi);
    if (hmis.some((hmi) => hmi === null)) return { status: "error" };
    return { status: "ready", hmis: hmis as AdminHmi[] };
  } catch {
    return { status: "error" };
  }
}

const ERROR_MESSAGES: Record<string, MessageKey> = {
  invalid_name: "admin.hmis.error.invalidName",
  hmi_not_found: "admin.hmis.error.notFound",
};

async function failureFor(response: Response): Promise<HmiActionResult> {
  const body = await readJson(response);
  const error =
    isRecord(body) && typeof body.error === "string" ? body.error : "";
  const known = ERROR_MESSAGES[error];
  if (known) return { ok: false, message: known };
  const screen = sessionScreen(response);
  if (screen) return { ok: false, message: "admin.error.sessionLost", screen };
  if (error === "server_storage_disabled") {
    return {
      ok: false,
      message: "admin.error.generic",
      screen: { status: "unavailable" },
    };
  }
  return { ok: false, message: "admin.error.generic" };
}

/** Sends one admin write; `expectToken` for create and regenerate. */
async function send(
  fetchImpl: Fetch,
  url: string,
  init: { method: string; body: unknown },
  success: number,
  expectToken: boolean,
): Promise<HmiActionResult> {
  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: JSON_HEADERS,
      body: JSON.stringify(init.body),
    });
    if (response.status !== success) return await failureFor(response);
    const body = await readJson(response);
    const hmi = isRecord(body) ? parseAdminHmi(body.hmi) : null;
    const token = isRecord(body) ? body.token : undefined;
    if (!hmi || (expectToken && typeof token !== "string")) {
      return { ok: false, message: "admin.error.generic" };
    }
    return expectToken
      ? { ok: true, hmi, token: token as string }
      : { ok: true, hmi };
  } catch {
    return { ok: false, message: "admin.error.generic" };
  }
}

/** Client-side name check, mirroring the server's. */
export function hmiNameProblem(name: string): MessageKey | null {
  const trimmed = name.trim();
  if (trimmed === "") return "admin.hmis.error.nameRequired";
  if (trimmed.length > MAX_HMI_NAME_LENGTH) {
    return "admin.hmis.error.invalidName";
  }
  return null;
}

/** Registers an HMI; the result carries its token, shown only once. */
export async function createAdminHmi(
  fetchImpl: Fetch,
  name: string,
): Promise<HmiActionResult> {
  const problem = hmiNameProblem(name);
  if (problem) return { ok: false, message: problem };
  return send(
    fetchImpl,
    "/api/admin/hmis",
    { method: "POST", body: { name: name.trim() } },
    201,
    true,
  );
}

export async function renameAdminHmi(
  fetchImpl: Fetch,
  hmi: Pick<AdminHmi, "id">,
  name: string,
): Promise<HmiActionResult> {
  const problem = hmiNameProblem(name);
  if (problem) return { ok: false, message: problem };
  return send(
    fetchImpl,
    `/api/admin/hmis/${encodeURIComponent(hmi.id)}`,
    { method: "PATCH", body: { name: name.trim() } },
    200,
    false,
  );
}

/** Called only after the screen has confirmed the revocation. */
export async function revokeAdminHmi(
  fetchImpl: Fetch,
  hmi: Pick<AdminHmi, "id">,
): Promise<HmiActionResult> {
  return send(
    fetchImpl,
    `/api/admin/hmis/${encodeURIComponent(hmi.id)}/revoke`,
    { method: "POST", body: {} },
    200,
    false,
  );
}

/**
 * Called only after the screen has confirmed: the old token stops working,
 * so the HMI needs the new configuration file.
 */
export async function regenerateAdminHmiToken(
  fetchImpl: Fetch,
  hmi: Pick<AdminHmi, "id">,
): Promise<HmiActionResult> {
  return send(
    fetchImpl,
    `/api/admin/hmis/${encodeURIComponent(hmi.id)}/token`,
    { method: "POST", body: {} },
    200,
    true,
  );
}

/** Replaces one HMI in the list (after a rename, revoke or new token). */
export function replaceHmi(hmis: AdminHmi[], next: AdminHmi): AdminHmi[] {
  return hmis.map((hmi) => (hmi.id === next.id ? next : hmi));
}

export type HmiConnection = "revoked" | "never" | "online" | "offline";

export function hmiConnection(hmi: AdminHmi, nowMs: number): HmiConnection {
  if (hmi.revokedAt !== null) return "revoked";
  if (hmi.lastSeenAt === null) return "never";
  return nowMs - Date.parse(hmi.lastSeenAt) <= HMI_ONLINE_WINDOW_MS
    ? "online"
    : "offline";
}

export type MessageText = { key: MessageKey; params?: MessageParams };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "nie", "vor 12 s", "vor 3 min", "vor 2 h", "vor 4 Tagen". */
export function hmiLastSeenText(hmi: AdminHmi, nowMs: number): MessageText {
  if (hmi.lastSeenAt === null) return { key: "admin.hmis.seen.never" };
  const ago = Math.max(0, nowMs - Date.parse(hmi.lastSeenAt));
  if (ago < MINUTE_MS) {
    return {
      key: "admin.hmis.seen.seconds",
      params: { count: Math.floor(ago / 1000) },
    };
  }
  if (ago < HOUR_MS) {
    return {
      key: "admin.hmis.seen.minutes",
      params: { count: Math.floor(ago / MINUTE_MS) },
    };
  }
  if (ago < DAY_MS) {
    return {
      key: "admin.hmis.seen.hours",
      params: { count: Math.floor(ago / HOUR_MS) },
    };
  }
  return {
    key: "admin.hmis.seen.days",
    params: { count: Math.floor(ago / DAY_MS) },
  };
}

/** What runs on the HMI, as far as the planner knows. */
export function hmiActiveFinalText(hmi: AdminHmi): MessageText {
  if (hmi.activeFinal === null) return { key: "admin.hmis.active.none" };
  return {
    key: hmi.activeFinal.withdrawn
      ? "admin.hmis.active.withdrawn"
      : "admin.hmis.active.current",
    params: { name: hmi.activeFinal.name },
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type ServerUrlCheck =
  | {
      ok: true;
      /** Origin and path without a trailing slash, as the HMI expects it. */
      serverUrl: string;
      /** Plain HTTP to a non-loopback host: tokens would cross the mesh unencrypted. */
      insecure: boolean;
    }
  | { ok: false; message: MessageKey };

/**
 * Checks the planner address written into the configuration file. Prefilled
 * with the admin's own origin, which may not be what the HMIs reach.
 */
export function checkHmiServerUrl(input: string): ServerUrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, message: "admin.hmis.config.invalidUrl" };
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return { ok: false, message: "admin.hmis.config.invalidUrl" };
  }
  const serverUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  return {
    ok: true,
    serverUrl,
    insecure: url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname),
  };
}

/** The configuration file an HMI imports (`docs/hmi-api-v1.md`). */
export function hmiConfigFile(
  serverUrl: string,
  issued: IssuedHmiToken,
): { fileName: string; text: string } {
  const slug =
    issued.hmi.name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "hmi";
  const config = {
    serverUrl,
    hmiId: issued.hmi.id,
    token: issued.token,
  };
  return {
    fileName: `hmi-${slug}.json`,
    text: `${JSON.stringify(config, null, 2)}\n`,
  };
}
