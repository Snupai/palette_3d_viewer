import type { Translate } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import type { PlannerSession } from "~/features/auth/plannerAccessModel";
import type { LibraryRobDownload } from "~/features/project/projectRobDownload";
import type { StorageMode } from "~/lib/storageMode";

/**
 * "Als fertig markieren" (ADR 0013): marking freezes the `.rob` of the saved
 * project version as its Fertigstand, which the HMIs pick up. No React; the
 * API calls take `fetch` so tests run against a fake.
 *
 * Marking is offered under exactly the conditions of the `.rob` download —
 * the caller passes the download result (`libraryRobDownload`) and its
 * failure message becomes the disabled reason; there is no separate gating.
 * On top of that only what marking itself needs: server mode, a plan stored
 * on the server at a known version, no unsaved changes, a signed-in user.
 */

/** A Fertigstand as `/api/finals` returns it. */
export type ProjectFinal = {
  id: string;
  recordId: string;
  recordVersion: number;
  name: string;
  fileName: string;
  sha256: string;
  /** ISO timestamp. */
  markedAt: string;
};

/**
 * Who may mark or withdraw — mirrors the server's `mayManageFinals`
 * (`src/server/finals/finalPermission.ts`), which decides; change both
 * together. For now: every signed-in user.
 */
export function canManageFinals(session: PlannerSession): boolean {
  return session.status === "signed-in";
}

/** The Fertigstand of the open plan as last read from the server. */
export type ProjectFinalState =
  /** Not read yet (or the read failed). */
  { status: "unknown" } | { status: "loaded"; final: ProjectFinal | null };

export type ProjectFinalInput = {
  storageMode: StorageMode;
  /** Where the open plan is stored; `null` when it is not stored at all. */
  origin: "server" | "browser-local" | null;
  session: PlannerSession;
  /** Server version the open plan was read or saved at; `null` if unknown. */
  savedVersion: number | null;
  hasUnsavedChanges: boolean;
  /** `libraryRobDownload` of the saved plan: the `.rob` that would be frozen. */
  download: LibraryRobDownload;
  state: ProjectFinalState;
  /** A mark or withdraw request is running. */
  busy: boolean;
};

export type ProjectFinalButton = {
  label: string;
  /** Disables the button and explains why; `null` keeps it enabled. */
  disabledReason: string | null;
};

export type ProjectFinalControls =
  | { visible: false }
  | {
      visible: true;
      /** `null`: the saved version already is the current Fertigstand. */
      mark: ProjectFinalButton | null;
      /** `null`: there is no current Fertigstand to withdraw. */
      withdraw: ProjectFinalButton | null;
      /** Status line under the buttons, e.g. "seitdem geändert". */
      hint: string | null;
    };

/**
 * What the workspace shows next to the `.rob` download. `formatTime` renders
 * a Fertigstand's ISO marking time for the hint.
 */
export function projectFinalControls(
  input: ProjectFinalInput,
  t: Translate,
  formatTime: (iso: string) => string,
): ProjectFinalControls {
  if (
    input.storageMode !== "server" ||
    input.origin !== "server" ||
    input.savedVersion === null
  ) {
    return { visible: false };
  }
  const final = input.state.status === "loaded" ? input.state.final : null;
  const permissionReason = canManageFinals(input.session)
    ? null
    : t("project.final.signInRequired");
  const busyReason = input.busy ? t("project.final.busy") : null;

  let hint: string | null = null;
  let mark: ProjectFinalButton | null;
  if (final && final.recordVersion === input.savedVersion) {
    hint = t("project.final.current", {
      date: formatTime(final.markedAt),
    });
    mark = null;
  } else {
    const newer = final !== null && final.recordVersion > input.savedVersion;
    if (final) {
      hint = t(
        newer ? "project.final.newerElsewhere" : "project.final.changedSince",
        {
          date: formatTime(final.markedAt),
        },
      );
    }
    mark = {
      label: t(final ? "project.final.markAgain" : "project.final.mark"),
      disabledReason:
        busyReason ??
        permissionReason ??
        (input.state.status === "unknown"
          ? t("project.final.loading")
          : null) ??
        (newer ? t("project.final.reloadFirst") : null) ??
        (input.hasUnsavedChanges ? t("project.final.saveFirst") : null) ??
        (input.download.ok ? null : input.download.message),
    };
  }
  const withdraw: ProjectFinalButton | null = final
    ? {
        label: t("project.final.withdraw"),
        disabledReason: busyReason ?? permissionReason,
      }
    : null;
  return { visible: true, mark, withdraw, hint };
}

/** The name an HMI lists the Fertigstand under. */
export function finalDisplayName(project: Project, t: Translate): string {
  const parts = [project.productNumber, project.projectNumber]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value !== "");
  return parts.length > 0 ? parts.join(" · ") : t("project.untitledPlan");
}

export type MarkFinalBody = {
  recordId: string;
  recordVersion: number;
  name: string;
  fileName: string;
  robText: string;
};

/**
 * The `POST /api/finals` body for the saved project at `version`, with the
 * text the `.rob` download produces; `null` when there is none.
 */
export function markFinalBody(
  project: Project,
  version: number,
  download: LibraryRobDownload,
  t: Translate,
): MarkFinalBody | null {
  if (!download.ok) return null;
  return {
    recordId: project.id,
    recordVersion: version,
    name: finalDisplayName(project, t),
    fileName: download.fileName,
    robText: download.text,
  };
}

type Fetch = typeof fetch;

export type FinalRequestError =
  /** The project is no longer stored at that version (409). */
  | "conflict"
  /** No session (401). */
  | "unauthenticated"
  /** The user may not mark or withdraw (403). */
  | "forbidden"
  /** Already withdrawn or unknown (404). */
  | "not-found"
  /** The server refused the `.rob` (413, 422) or the request (400). */
  | "rejected"
  /** No HTTP answer or an unexpected one. */
  | "failed";

export type FinalRequestResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: FinalRequestError; message: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFinal(value: unknown): ProjectFinal | null {
  if (!isRecord(value)) return null;
  const { id, recordId, recordVersion, name, fileName, sha256, markedAt } =
    value;
  if (
    typeof id !== "string" ||
    typeof recordId !== "string" ||
    typeof recordVersion !== "number" ||
    typeof name !== "string" ||
    typeof fileName !== "string" ||
    typeof sha256 !== "string" ||
    typeof markedAt !== "string"
  ) {
    return null;
  }
  return { id, recordId, recordVersion, name, fileName, sha256, markedAt };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function failure(response: Response): Promise<{
  ok: false;
  error: FinalRequestError;
  message: string | null;
}> {
  const body = await readJson(response);
  const message =
    isRecord(body) && typeof body.message === "string" ? body.message : null;
  const error: FinalRequestError =
    response.status === 409
      ? "conflict"
      : response.status === 401
        ? "unauthenticated"
        : response.status === 403
          ? "forbidden"
          : response.status === 404
            ? "not-found"
            : [400, 413, 422].includes(response.status)
              ? "rejected"
              : "failed";
  return { ok: false, error, message };
}

const NETWORK_FAILURE = {
  ok: false,
  error: "failed",
  message: null,
} as const;

/** The current Fertigstand of one project (`GET /api/finals?recordId=`). */
export async function loadProjectFinal(
  fetchImpl: Fetch,
  recordId: string,
): Promise<FinalRequestResult<{ final: ProjectFinal | null }>> {
  try {
    const response = await fetchImpl(
      `/api/finals?recordId=${encodeURIComponent(recordId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return failure(response);
    const body = await readJson(response);
    const list =
      isRecord(body) && Array.isArray(body.finals) ? body.finals : null;
    if (!list) return NETWORK_FAILURE;
    const finals = list.map(parseFinal);
    if (finals.some((final) => final === null)) return NETWORK_FAILURE;
    return {
      ok: true,
      final: finals.find((final) => final?.recordId === recordId) ?? null,
    };
  } catch {
    return NETWORK_FAILURE;
  }
}

/** `POST /api/finals`. */
export async function markProjectFinal(
  fetchImpl: Fetch,
  body: MarkFinalBody,
): Promise<FinalRequestResult<{ final: ProjectFinal }>> {
  try {
    const response = await fetchImpl("/api/finals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return failure(response);
    const answer = await readJson(response);
    const final = isRecord(answer) ? parseFinal(answer.final) : null;
    return final ? { ok: true, final } : NETWORK_FAILURE;
  } catch {
    return NETWORK_FAILURE;
  }
}

/** `DELETE /api/finals/:id`. */
export async function withdrawProjectFinal(
  fetchImpl: Fetch,
  id: string,
): Promise<FinalRequestResult<object>> {
  try {
    const response = await fetchImpl(`/api/finals/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return response.status === 204 ? { ok: true } : failure(response);
  } catch {
    return NETWORK_FAILURE;
  }
}

/** The error text for a failed mark or withdraw request. */
export function finalRequestErrorMessage(
  error: FinalRequestError,
  message: string | null,
  t: Translate,
): string {
  switch (error) {
    case "conflict":
      return t("project.final.error.conflict");
    case "unauthenticated":
      return t("auth.error.sessionExpired");
    case "forbidden":
      return t("project.final.error.forbidden");
    case "not-found":
      return t("project.final.error.notFound");
    case "rejected":
      return message
        ? t("project.final.error.rejectedWithReason", { message })
        : t("project.final.error.rejected");
    case "failed":
      return t("project.final.error.failed");
  }
}
