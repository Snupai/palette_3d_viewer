"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Field } from "~/components/ui/Field";
import { useT } from "~/i18n";
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";
import { configuredStorageMode, type StorageMode } from "~/lib/storageMode";

import { loadPlannerSession, signIn } from "./plannerAccessModel";
import { safeReturnPath } from "./returnPath";

/**
 * `/login?returnTo=…` — a full-page sign-in, used where a page needs a
 * session before it can show anything (the QR page `/hmi/[hmiId]`, ADR
 * 0013). After signing in, or when already signed in, it replaces itself
 * with `returnTo` if that is a same-origin path ({@link safeReturnPath}),
 * otherwise with the planner home.
 */
export function LoginScreen({
  returnTo,
  mode = configuredStorageMode,
  fetchImpl = fetch,
}: {
  returnTo: string | null;
  mode?: StorageMode;
  fetchImpl?: typeof fetch;
}) {
  const t = useT();
  const router = useRouter();
  const target = safeReturnPath(returnTo);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (mode === "local") return;
    let active = true;
    void loadPlannerSession(fetchImpl).then((session) => {
      if (active && session.status === "signed-in") {
        setDone(true);
        router.replace(target);
      }
    });
    return () => {
      active = false;
    };
  }, [mode, fetchImpl, router, target]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(fetchImpl, username, password);
      if (!result.ok) {
        setError(t(result.message));
        return;
      }
      setPassword("");
      setDone(true);
      router.replace(target);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-screen">
      <header className="fable-header">
        <Link className="fable-logo" href="/" aria-label={t("shell.home")}>
          {t("shell.appName")}
        </Link>
        <div className="header-actions">
          <LanguageSwitcher />
        </div>
      </header>
      <div className="fable-page login-page">
        <header className="page-intro">
          <h1>{t("auth.login.title")}</h1>
          {mode === "local" ? null : <p>{t("auth.login.intro")}</p>}
        </header>
        {mode === "local" ? (
          <>
            <p role="status" className="fable-notice">
              {t("auth.login.unavailable")}
            </p>
            <Link className="text-action" href="/">
              {t("auth.login.backToPlanner")}
            </Link>
          </>
        ) : done ? (
          <p role="status" className="fable-notice">
            {t("auth.login.redirecting")}
          </p>
        ) : (
          <form
            className="admin-form"
            aria-label={t("auth.login.title")}
            onSubmit={(event) => void submit(event)}
          >
            <Field label={t("auth.field.username")}>
              <input
                className="ui-input"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
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
            {target === "/" ? null : (
              <p className="text-muted">
                {t("auth.login.returnHint", { path: target })}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
