"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Field } from "~/components/ui/Field";
import { useT, type MessageKey } from "~/i18n";
import type { StorageMode } from "~/lib/storageMode";

import {
  initialPlannerSession,
  loadPlannerSession,
  signIn,
  signOut,
  type PlannerSession,
  type SessionUser,
} from "./plannerAccessModel";

export type PlannerSessionControls = {
  session: PlannerSession;
  /** Resolves to an error message key, or `null` once signed in. */
  signIn: (username: string, password: string) => Promise<MessageKey | null>;
  /** `true` once the server ended the session. */
  signOut: () => Promise<boolean>;
  /** A request answered 401: the session is gone. */
  markSessionLost: () => void;
};

/**
 * The planner's session (#34). In local mode it stays `local` and never
 * calls the server; in server mode it asks `/api/auth/me` once on mount.
 */
export function usePlannerSession(
  mode: StorageMode,
  fetchImpl: typeof fetch = fetch,
): PlannerSessionControls {
  const [session, setSession] = useState<PlannerSession>(() =>
    initialPlannerSession(mode),
  );
  /**
   * Bumped by every session change; a `/api/auth/me` answer that arrives
   * after a sign-in or sign-out is stale and must not overwrite it.
   */
  const sessionGeneration = useRef(0);

  useEffect(() => {
    if (mode === "local") return;
    const generation = ++sessionGeneration.current;
    void loadPlannerSession(fetchImpl).then((next) => {
      if (generation === sessionGeneration.current) setSession(next);
    });
    return () => {
      sessionGeneration.current += 1;
    };
  }, [mode, fetchImpl]);

  const doSignIn = useCallback(
    async (username: string, password: string) => {
      const result = await signIn(fetchImpl, username, password);
      if (!result.ok) return result.message;
      sessionGeneration.current += 1;
      setSession(result.session);
      return null;
    },
    [fetchImpl],
  );
  const doSignOut = useCallback(async () => {
    const ok = await signOut(fetchImpl);
    if (ok) {
      sessionGeneration.current += 1;
      setSession({ status: "anonymous" });
    }
    return ok;
  }, [fetchImpl]);
  const markSessionLost = useCallback(() => {
    sessionGeneration.current += 1;
    setSession((current) =>
      current.status === "local" ? current : { status: "session-lost" },
    );
  }, []);

  return { session, signIn: doSignIn, signOut: doSignOut, markSessionLost };
}

/**
 * Header account menu (server mode only; renders nothing in local mode):
 * a sign-in form for anonymous visitors, the user and "Abmelden" otherwise.
 * When `hasUnsavedDrafts()` (asked on each click) is true, "Abmelden" first asks inline: "Abbrechen" or
 * "Entwürfe verwerfen und abmelden" (ADR 0002). `beforeLeave` (opening the
 * user management) lets the caller confirm unsaved changes first and return
 * whether to proceed; `onSignedOut` runs once the server ended the session,
 * with the user who signed out.
 */
export function SessionMenu({
  controls,
  hasUnsavedDrafts,
  beforeLeave,
  onSignedOut,
}: {
  controls: PlannerSessionControls;
  hasUnsavedDrafts?: () => boolean;
  beforeLeave?: () => boolean;
  onSignedOut?: (user: SessionUser) => void;
}) {
  const t = useT();
  const { session } = controls;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  if (session.status === "local") return null;

  const close = (element: HTMLElement) => {
    const menu = element.closest("details");
    if (menu) menu.open = false;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const message = await controls.signIn(username, password);
      if (message) {
        setError(t(message));
        return;
      }
      setPassword("");
      close(form);
    } finally {
      setBusy(false);
    }
  };

  if (session.status !== "signed-in") {
    const readOnlyHint = t(
      session.status === "error"
        ? "auth.readOnly.sessionUnknown"
        : "auth.readOnly.signIn",
    );
    return (
      <>
        {session.status === "loading" ? null : (
          <span className="session-badge" title={readOnlyHint}>
            {t("auth.readOnly.badge")}
            <span className="sr-only"> {readOnlyHint}</span>
          </span>
        )}
        <details className="fable-tool-menu session-menu">
          <summary>{t("auth.signIn")}</summary>
          <div>
            <form
              className="session-form"
              aria-label={t("auth.signIn")}
              onSubmit={(event) => void submit(event)}
            >
              <Field label={t("auth.field.username")}>
                <input
                  className="ui-input"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field label={t("auth.field.password")}>
                <input
                  className="ui-input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {error ? (
                <p role="alert" className="session-error">
                  {error}
                </p>
              ) : null}
              <button className="ui-btn-primary" type="submit" disabled={busy}>
                {busy ? t("auth.signingIn") : t("auth.signIn")}
              </button>
            </form>
          </div>
        </details>
      </>
    );
  }

  const { user } = session;
  const signOutNow = (target: HTMLElement) => {
    setError(null);
    void controls.signOut().then((ok) => {
      setConfirmSignOut(false);
      if (!ok) {
        setError(t("auth.error.signOutFailed"));
        return;
      }
      close(target);
      onSignedOut?.(user);
    });
  };
  return (
    <details className="fable-tool-menu session-menu">
      <summary>{user.username}</summary>
      <div>
        <p className="session-user">
          {t("auth.signedInAs", { username: user.username })}
          <span>
            {t(user.role === "admin" ? "auth.role.admin" : "auth.role.user")}
          </span>
        </p>
        {user.role === "admin" ? (
          <Link
            href="/admin"
            onClick={(event) => {
              if (beforeLeave && !beforeLeave()) event.preventDefault();
            }}
          >
            {t("auth.userManagement")}
          </Link>
        ) : null}
        {error ? (
          <p role="alert" className="session-error">
            {error}
          </p>
        ) : null}
        {confirmSignOut ? (
          <div role="alert" className="session-confirm">
            <p>{t("auth.confirm.signOutUnsaved")}</p>
            <button
              type="button"
              className="text-danger"
              onClick={(event) => signOutNow(event.currentTarget)}
            >
              {t("auth.confirm.discardAndSignOut")}
            </button>
            <button type="button" onClick={() => setConfirmSignOut(false)}>
              {t("auth.confirm.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              if (hasUnsavedDrafts?.()) {
                setError(null);
                setConfirmSignOut(true);
                return;
              }
              signOutNow(event.currentTarget);
            }}
          >
            {t("auth.signOut")}
          </button>
        )}
      </div>
    </details>
  );
}
