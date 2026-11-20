import type { MessageKey } from "~/i18n";

import {
  parseAdminHmi,
  type AdminHmi,
  type HmiConnection,
} from "../admin/adminHmisModel";

/**
 * State and API calls of the QR page `/hmi/[hmiId]` (ADR 0013): show one
 * HMI, pick a Fertigstand and propose it, then follow the proposal until the
 * operator answers on the HMI. No React: every function takes `fetch` (and
 * the clock where it matters) so tests run without a DOM.
 *
 * Proposing never changes what runs on the HMI; the page says so and only
 * reports the operator's answer.
 */

type Fetch = typeof fetch;

const JSON_HEADERS = { "content-type": "application/json" } as const;

/** The page re-reads the HMI this often while it is visible. */
export const HMI_PAGE_POLL_MS = 5_000;
/**
 * One HMI read gives up after this long, so a hanging request cannot block
 * the polls after it (longer than the poll interval).
 */
export const HMI_PAGE_REQUEST_TIMEOUT_MS = 15_000;

export type ProposalState =
  | "pending"
  | "accepted"
  | "rejected"
  | "superseded"
  | "expired"
  | "cancelled";

const PROPOSAL_STATES: readonly ProposalState[] = [
  "pending",
  "accepted",
  "rejected",
  "superseded",
  "expired",
  "cancelled",
];

export type HmiPageProposal = {
  id: string;
  finalId: string;
  finalName: string;
  /** Proposing user's name; `null` once that account is deleted. */
  proposedBy: string | null;
  createdAt: string;
  state: ProposalState;
  resolvedAt: string | null;
};

export type HmiPageFinal = {
  id: string;
  name: string;
  fileName: string;
  markedAt: string;
};

export type HmiPageState =
  | { status: "loading" }
  /** Local storage mode: no accounts, no HMIs. */
  | { status: "unavailable" }
  | { status: "unauthenticated" }
  | { status: "not-found" }
  | { status: "error" }
  | {
      status: "ready";
      hmi: AdminHmi;
      /** The HMI's latest proposal in any state, or `null`. */
      proposal: HmiPageProposal | null;
    };

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

export function parseHmiPageProposal(value: unknown): HmiPageProposal | null {
  if (!isRecord(value)) return null;
  const { id, finalId, finalName, proposedBy, createdAt, state, resolvedAt } =
    value;
  if (
    typeof id !== "string" ||
    typeof finalId !== "string" ||
    typeof finalName !== "string" ||
    !isNullableString(proposedBy) ||
    typeof createdAt !== "string" ||
    !PROPOSAL_STATES.includes(state as ProposalState) ||
    !isNullableString(resolvedAt)
  ) {
    return null;
  }
  return {
    id,
    finalId,
    finalName,
    proposedBy,
    createdAt,
    state: state as ProposalState,
    resolvedAt,
  };
}

function parseFinal(value: unknown): HmiPageFinal | null {
  if (!isRecord(value)) return null;
  const { id, name, fileName, markedAt } = value;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof fileName !== "string" ||
    typeof markedAt !== "string"
  ) {
    return null;
  }
  return { id, name, fileName, markedAt };
}

/**
 * `GET /api/hmis/:hmiId`. Gives up after `timeoutMs`, body included (a
 * plain `AbortController` and timer: older iOS Safari lacks
 * `AbortSignal.timeout`); a timeout counts as `error`, so polling goes on.
 */
export async function loadHmiPage(
  fetchImpl: Fetch,
  hmiId: string,
  timeoutMs = HMI_PAGE_REQUEST_TIMEOUT_MS,
): Promise<HmiPageState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`/api/hmis/${encodeURIComponent(hmiId)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401) return { status: "unauthenticated" };
    const body = await readJson(response);
    // `readJson` turns an aborted body read into `null`; that is no answer.
    if (controller.signal.aborted) return { status: "error" };
    if (response.status === 404) {
      return isRecord(body) && body.error === "server_storage_disabled"
        ? { status: "unavailable" }
        : { status: "not-found" };
    }
    if (!response.ok || !isRecord(body)) return { status: "error" };
    const hmi = parseAdminHmi(body.hmi);
    const proposal =
      body.proposal === null ? null : parseHmiPageProposal(body.proposal);
    if (!hmi || (body.proposal !== null && !proposal)) {
      return { status: "error" };
    }
    return { status: "ready", hmi, proposal };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** `GET /api/finals`: the current Fertigstände, or `null` on failure. */
export async function loadHmiPageFinals(
  fetchImpl: Fetch,
): Promise<HmiPageFinal[] | null> {
  try {
    const response = await fetchImpl("/api/finals", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await readJson(response);
    if (!isRecord(body) || !Array.isArray(body.finals)) return null;
    const finals: HmiPageFinal[] = [];
    for (const value of body.finals) {
      const final = parseFinal(value);
      if (!final) return null;
      finals.push(final);
    }
    return finals;
  } catch {
    return null;
  }
}

/**
 * The Fertigstände whose name or file name contains every whitespace-separated
 * term of `query`, ignoring case. An empty query keeps all.
 */
export function filterHmiPageFinals(
  finals: HmiPageFinal[],
  query: string,
): HmiPageFinal[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return finals;
  return finals.filter((final) => {
    const text = `${final.name} ${final.fileName}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export type ProposalActionResult =
  | { ok: true; proposal: HmiPageProposal | null }
  | { ok: false; message: MessageKey; state?: HmiPageState };

function failure(response: Response, body: unknown): ProposalActionResult {
  if (response.status === 401) {
    return {
      ok: false,
      message: "hmi.error.unauthenticated",
      state: { status: "unauthenticated" },
    };
  }
  const error = isRecord(body) ? body.error : undefined;
  switch (error) {
    case "forbidden":
      return { ok: false, message: "hmi.error.forbidden" };
    case "final_not_found":
      return { ok: false, message: "hmi.error.finalGone" };
    case "hmi_revoked":
      return { ok: false, message: "hmi.error.revoked" };
    case "hmi_not_found":
      return {
        ok: false,
        message: "hmi.error.notFound",
        state: { status: "not-found" },
      };
    case "proposal_closed":
    case "proposal_not_found":
      return { ok: false, message: "hmi.error.proposalClosed" };
    default:
      return { ok: false, message: "hmi.error.generic" };
  }
}

/** `POST /api/hmis/:hmiId/proposals`. */
export async function sendHmiProposal(
  fetchImpl: Fetch,
  hmiId: string,
  finalId: string,
): Promise<ProposalActionResult> {
  try {
    const response = await fetchImpl(
      `/api/hmis/${encodeURIComponent(hmiId)}/proposals`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ finalId }),
      },
    );
    const body = await readJson(response);
    if (response.status !== 201) return failure(response, body);
    const proposal = isRecord(body)
      ? parseHmiPageProposal(body.proposal)
      : null;
    return proposal
      ? { ok: true, proposal }
      : { ok: false, message: "hmi.error.generic" };
  } catch {
    return { ok: false, message: "hmi.error.generic" };
  }
}

/** `DELETE /api/hmis/:hmiId/proposals/:id`. */
export async function cancelHmiPageProposal(
  fetchImpl: Fetch,
  hmiId: string,
  proposalId: string,
): Promise<ProposalActionResult> {
  try {
    const response = await fetchImpl(
      `/api/hmis/${encodeURIComponent(hmiId)}/proposals/${encodeURIComponent(proposalId)}`,
      { method: "DELETE" },
    );
    if (response.status === 204) return { ok: true, proposal: null };
    return failure(response, await readJson(response));
  } catch {
    return { ok: false, message: "hmi.error.generic" };
  }
}

/**
 * What the page says about the HMI's latest proposal. A pending proposal to
 * an HMI that is not online gets the "arrives once it is back online" hint.
 */
export function proposalStatusKey(
  proposal: HmiPageProposal,
  connection: HmiConnection,
): MessageKey {
  switch (proposal.state) {
    case "pending":
      return connection === "online"
        ? "hmi.proposal.state.pending"
        : "hmi.proposal.state.pendingOffline";
    case "accepted":
      return "hmi.proposal.state.accepted";
    case "rejected":
      return "hmi.proposal.state.rejected";
    case "superseded":
      return "hmi.proposal.state.superseded";
    case "expired":
      return "hmi.proposal.state.expired";
    case "cancelled":
      return "hmi.proposal.state.cancelled";
  }
}

/** Polling runs only while the page is visible and showing an HMI. */
export function shouldPollHmiPage(
  state: HmiPageState,
  visible: boolean,
): boolean {
  return visible && (state.status === "ready" || state.status === "error");
}
