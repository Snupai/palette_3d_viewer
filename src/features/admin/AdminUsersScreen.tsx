"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Field } from "~/components/ui/Field";
import { LOCALE_TAGS, useLocale, type MessageKey } from "~/i18n";
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";

import {
  createAdminUser,
  EMPTY_CREATE_USER_FORM,
  loadAdminScreen,
  resetAdminUserPassword,
  type AdminActionResult,
  type AdminScreenState,
  type AdminUser,
  type AdminUserRole,
  type CreateUserForm,
} from "./adminUsersModel";

type Notice = { tone: "success" | "error"; text: string };

/** Admin-only user list, create form and password reset (#32, ADR 0005). */
export function AdminUsersScreen({
  fetchImpl = fetch,
}: {
  fetchImpl?: typeof fetch;
}) {
  const { t, locale } = useLocale();
  const [screen, setScreen] = useState<AdminScreenState>({
    status: "loading",
  });
  const [notice, setNotice] = useState<Notice | null>(null);

  const reload = useCallback(async () => {
    setScreen(await loadAdminScreen(fetchImpl));
  }, [fetchImpl]);

  useEffect(() => {
    let active = true;
    void loadAdminScreen(fetchImpl).then((next) => {
      if (active) setScreen(next);
    });
    return () => {
      active = false;
    };
  }, [fetchImpl]);

  /** Applies an action's outcome; returns whether it succeeded. */
  const apply = async (
    result: AdminActionResult,
    success: string,
  ): Promise<boolean> => {
    if (result.ok) {
      setNotice({
        tone: "success",
        text: result.notice ? t(result.notice) : success,
      });
      if (result.screen) setScreen(result.screen);
      else await reload();
      return true;
    }
    setNotice({ tone: "error", text: t(result.message) });
    if (result.screen) setScreen(result.screen);
    return false;
  };

  return (
    <div className="admin-screen">
      <header className="fable-header">
        <Link className="fable-logo" href="/" aria-label={t("shell.home")}>
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 2 29 9 16 17 3 9Z" fill="var(--carton-top)" />
            <path d="M3 9 16 17 16 31 3 23Z" fill="var(--carton-left)" />
            <path d="M29 9 16 17 16 31 29 23Z" fill="var(--carton-right)" />
            <path d="M9 6 22 14" stroke="var(--carton-tape)" strokeWidth="3" />
          </svg>
          {t("shell.appName")}
        </Link>
        <span className="header-context">{t("admin.title")}</span>
        <div className="header-actions">
          <Link className="text-action" href="/">
            {t("admin.backToPlanner")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>
      <div className="fable-page admin-content">
        <header className="page-intro">
          <h1>{t("admin.title")}</h1>
        </header>
        {notice ? (
          <p
            className="fable-notice"
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}
        <ScreenBody
          screen={screen}
          locale={LOCALE_TAGS[locale]}
          fetchImpl={fetchImpl}
          onReload={() => {
            setNotice(null);
            setScreen({ status: "loading" });
            void reload();
          }}
          onResult={apply}
          clearNotice={() => setNotice(null)}
        />
      </div>
    </div>
  );
}

function ScreenBody({
  screen,
  locale,
  fetchImpl,
  onReload,
  onResult,
  clearNotice,
}: {
  screen: AdminScreenState;
  locale: string;
  fetchImpl: typeof fetch;
  onReload: () => void;
  onResult: (result: AdminActionResult, success: string) => Promise<boolean>;
  clearNotice: () => void;
}) {
  const { t } = useLocale();
  switch (screen.status) {
    case "loading":
      return (
        <p role="status" className="text-muted">
          {t("admin.loading")}
        </p>
      );
    case "unavailable":
      return (
        <p role="status" className="fable-notice">
          {t("admin.state.unavailable")}
        </p>
      );
    case "unauthenticated":
      return (
        <p role="status" className="fable-notice">
          {t("admin.state.unauthenticated")}
        </p>
      );
    case "forbidden":
      return (
        <p role="status" className="fable-notice">
          {screen.username
            ? t("admin.state.forbidden", { username: screen.username })
            : t("admin.state.forbiddenAnonymous")}
        </p>
      );
    case "error":
      return (
        <div className="admin-state">
          <p role="alert" className="fable-notice">
            {t("admin.state.error")}
          </p>
          <button className="ui-btn" type="button" onClick={onReload}>
            {t("admin.retry")}
          </button>
        </div>
      );
    case "ready":
      return (
        <>
          <UserTable
            users={screen.users}
            currentUserId={screen.currentUserId}
            locale={locale}
            fetchImpl={fetchImpl}
            onResult={onResult}
            clearNotice={clearNotice}
          />
          <CreateUserSection
            fetchImpl={fetchImpl}
            onResult={onResult}
            clearNotice={clearNotice}
          />
        </>
      );
  }
}

function UserTable({
  users,
  currentUserId,
  locale,
  fetchImpl,
  onResult,
  clearNotice,
}: {
  users: AdminUser[];
  currentUserId: string;
  locale: string;
  fetchImpl: typeof fetch;
  onResult: (result: AdminActionResult, success: string) => Promise<boolean>;
  clearNotice: () => void;
}) {
  const { t } = useLocale();
  const [resetting, setResetting] = useState<string | null>(null);
  return (
    <section className="admin-section" aria-labelledby="admin-users-heading">
      <h2 id="admin-users-heading" className="admin-heading">
        {t("admin.users.heading")}
      </h2>
      <div className="admin-table-scroll">
        <table className="ui-table">
          <thead>
            <tr>
              <th scope="col">{t("admin.users.username")}</th>
              <th scope="col">{t("admin.users.role")}</th>
              <th scope="col">{t("admin.users.createdAt")}</th>
              <th scope="col">{t("admin.users.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  {user.id === currentUserId ? (
                    <span className="text-muted"> {t("admin.users.you")}</span>
                  ) : null}
                </td>
                <td>{t(roleKey(user.role))}</td>
                <td>{new Date(user.createdAt).toLocaleDateString(locale)}</td>
                <td>
                  {resetting === user.id ? (
                    <ResetPasswordForm
                      user={user}
                      onCancel={() => setResetting(null)}
                      onSubmit={async (password, confirmation) => {
                        const ok = await onResult(
                          await resetAdminUserPassword(
                            fetchImpl,
                            user,
                            currentUserId,
                            password,
                            confirmation,
                          ),
                          t("admin.reset.success", {
                            username: user.username,
                          }),
                        );
                        if (ok) setResetting(null);
                      }}
                    />
                  ) : (
                    <button
                      className="ui-btn ui-btn-sm"
                      type="button"
                      onClick={() => {
                        clearNotice();
                        setResetting(user.id);
                      }}
                    >
                      {t("admin.reset.open")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function roleKey(role: AdminUserRole): MessageKey {
  return role === "admin" ? "admin.role.admin" : "admin.role.user";
}

function ResetPasswordForm({
  user,
  onCancel,
  onSubmit,
}: {
  user: AdminUser;
  onCancel: () => void;
  onSubmit: (password: string, confirmation: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(password, confirmation);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="admin-form"
      aria-label={t("admin.reset.heading", { username: user.username })}
      aria-busy={busy}
      onSubmit={submit}
    >
      <Field label={t("admin.field.password")}>
        <input
          className="ui-input"
          type="password"
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Field label={t("admin.field.confirmation")}>
        <input
          className="ui-input"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
      <div className="button-row">
        <button
          className="ui-btn"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          {t("admin.reset.cancel")}
        </button>
        <button className="ui-btn ui-btn-primary" type="submit" disabled={busy}>
          {busy ? t("admin.saving") : t("admin.reset.submit")}
        </button>
      </div>
    </form>
  );
}

function CreateUserSection({
  fetchImpl,
  onResult,
  clearNotice,
}: {
  fetchImpl: typeof fetch;
  onResult: (result: AdminActionResult, success: string) => Promise<boolean>;
  clearNotice: () => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState<CreateUserForm>(EMPTY_CREATE_USER_FORM);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<CreateUserForm>) => {
    clearNotice();
    setForm((current) => ({ ...current, ...patch }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const ok = await onResult(
        await createAdminUser(fetchImpl, form),
        t("admin.create.success", {
          username: form.username.trim().toLowerCase(),
        }),
      );
      if (ok) setForm(EMPTY_CREATE_USER_FORM);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-section" aria-labelledby="admin-create-heading">
      <h2 id="admin-create-heading" className="admin-heading">
        {t("admin.create.heading")}
      </h2>
      <form className="admin-form" aria-busy={busy} onSubmit={submit}>
        <Field
          label={t("admin.field.username")}
          hint={t("admin.field.usernameHint")}
        >
          <input
            className="ui-input"
            autoComplete="off"
            value={form.username}
            onChange={(event) => update({ username: event.target.value })}
          />
        </Field>
        <Field
          label={t("admin.field.password")}
          hint={t("admin.field.passwordHint")}
        >
          <input
            className="ui-input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => update({ password: event.target.value })}
          />
        </Field>
        <Field label={t("admin.field.confirmation")}>
          <input
            className="ui-input"
            type="password"
            autoComplete="new-password"
            value={form.confirmation}
            onChange={(event) => update({ confirmation: event.target.value })}
          />
        </Field>
        <Field label={t("admin.field.role")}>
          <select
            className="ui-input"
            value={form.role}
            onChange={(event) =>
              update({
                role: event.target.value === "admin" ? "admin" : "user",
              })
            }
          >
            <option value="user">{t("admin.role.user")}</option>
            <option value="admin">{t("admin.role.admin")}</option>
          </select>
        </Field>
        <div className="button-row">
          <button
            className="ui-btn ui-btn-primary"
            type="submit"
            disabled={busy}
          >
            {busy ? t("admin.saving") : t("admin.create.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
