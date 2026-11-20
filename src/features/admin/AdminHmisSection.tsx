"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Field } from "~/components/ui/Field";
import { useLocale, type MessageKey } from "~/i18n";
import { downloadText } from "~/lib/download";

import {
  checkHmiServerUrl,
  createAdminHmi,
  hmiActiveFinalText,
  hmiConfigFile,
  hmiConnection,
  hmiLastSeenText,
  loadAdminHmis,
  MAX_HMI_NAME_LENGTH,
  regenerateAdminHmiToken,
  renameAdminHmi,
  replaceHmi,
  revokeAdminHmi,
  type AdminHmi,
  type HmiActionResult,
  type HmiConnection,
  type IssuedHmiToken,
} from "./adminHmisModel";
import type { AdminScreenState } from "./adminUsersModel";

type Notice = { tone: "success" | "error"; text: string };
type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; hmis: AdminHmi[] };
type Pending = { id: string; action: "rename" | "revoke" | "token" };

/** The list (connection state, running plan) and "last seen" refresh this often. */
const REFRESH_MS = 15_000;

const CONNECTION_KEYS: Record<HmiConnection, MessageKey> = {
  online: "admin.hmis.status.online",
  offline: "admin.hmis.status.offline",
  never: "admin.hmis.status.never",
  revoked: "admin.hmis.status.revoked",
};

/**
 * HMI registration on the admin screen (ADR 0013): list with connection
 * state and running Fertigstand, rename, revoke, new token, and the one-time
 * token display with the configuration file download.
 */
export function AdminHmisSection({
  fetchImpl,
  onScreen,
}: {
  fetchImpl: typeof fetch;
  /** Session lost, role lost or local mode: replaces the whole admin screen. */
  onScreen: (screen: AdminScreenState) => void;
}) {
  const { t } = useLocale();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [issued, setIssued] = useState<IssuedHmiToken | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Bumped by every successful action; older background answers are dropped. */
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const result = await loadAdminHmis(fetchImpl);
    if (result.status === "screen") onScreen(result.screen);
    else setLoad(result);
  }, [fetchImpl, onScreen]);

  useEffect(() => {
    let active = true;
    void loadAdminHmis(fetchImpl).then((result) => {
      if (!active) return;
      if (result.status === "screen") onScreen(result.screen);
      else setLoad(result);
    });
    const timer = window.setInterval(() => {
      setNow(Date.now());
      const started = generation.current;
      void loadAdminHmis(fetchImpl).then((result) => {
        if (!active || started !== generation.current) return;
        if (result.status === "screen") onScreen(result.screen);
        // A failed background refresh keeps the last list.
        else if (result.status === "ready") setLoad(result);
      });
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [fetchImpl, onScreen]);

  /** Applies an action's outcome; returns whether it succeeded. */
  const apply = (
    result: HmiActionResult,
    success: (hmi: AdminHmi) => string,
  ): boolean => {
    if (!result.ok) {
      setNotice({ tone: "error", text: t(result.message) });
      if (result.screen) onScreen(result.screen);
      return false;
    }
    generation.current++;
    setNotice({ tone: "success", text: success(result.hmi) });
    setNow(Date.now());
    setLoad((current) =>
      current.status !== "ready"
        ? current
        : current.hmis.some((hmi) => hmi.id === result.hmi.id)
          ? { status: "ready", hmis: replaceHmi(current.hmis, result.hmi) }
          : current,
    );
    if (result.token !== undefined) {
      setIssued({ hmi: result.hmi, token: result.token });
    }
    return true;
  };

  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-section" aria-labelledby="admin-hmis-heading">
      <h2 id="admin-hmis-heading" className="admin-heading">
        {t("admin.hmis.heading")}
      </h2>
      <p className="text-muted">{t("admin.hmis.intro")}</p>
      {notice ? (
        <p
          className="fable-notice"
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {issued ? (
        <IssuedTokenPanel issued={issued} onClose={() => setIssued(null)} />
      ) : null}
      {load.status === "loading" ? (
        <p role="status" className="text-muted">
          {t("admin.hmis.loading")}
        </p>
      ) : load.status === "error" ? (
        <div className="admin-state">
          <p role="alert" className="fable-notice">
            {t("admin.hmis.loadError")}
          </p>
          <button
            className="ui-btn"
            type="button"
            onClick={() => {
              setLoad({ status: "loading" });
              void reload();
            }}
          >
            {t("admin.retry")}
          </button>
        </div>
      ) : load.hmis.length === 0 ? (
        <p className="text-muted">{t("admin.hmis.empty")}</p>
      ) : (
        <div className="admin-table-scroll">
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col">{t("admin.hmis.column.name")}</th>
                <th scope="col">{t("admin.hmis.column.status")}</th>
                <th scope="col">{t("admin.hmis.column.lastSeen")}</th>
                <th scope="col">{t("admin.hmis.column.active")}</th>
                <th scope="col">{t("admin.hmis.column.appVersion")}</th>
                <th scope="col">{t("admin.hmis.column.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {load.hmis.map((hmi) => {
                const seen = hmiLastSeenText(hmi, now);
                const active = hmiActiveFinalText(hmi);
                const rowPending = pending?.id === hmi.id ? pending : null;
                return (
                  <tr key={hmi.id}>
                    <td>{hmi.name}</td>
                    <td>{t(CONNECTION_KEYS[hmiConnection(hmi, now)])}</td>
                    <td
                      title={
                        hmi.lastSeenAt
                          ? new Date(hmi.lastSeenAt).toLocaleString()
                          : undefined
                      }
                    >
                      {t(seen.key, seen.params)}
                    </td>
                    <td>{t(active.key, active.params)}</td>
                    <td>
                      {hmi.appVersion ?? t("admin.hmis.appVersion.unknown")}
                    </td>
                    <td>
                      {rowPending?.action === "rename" ? (
                        <RenameForm
                          hmi={hmi}
                          busy={busy}
                          onCancel={() => setPending(null)}
                          onSubmit={(name) =>
                            run(async () => {
                              const ok = apply(
                                await renameAdminHmi(fetchImpl, hmi, name),
                                (next) =>
                                  t("admin.hmis.rename.success", {
                                    name: next.name,
                                  }),
                              );
                              if (ok) setPending(null);
                              return ok;
                            })
                          }
                        />
                      ) : rowPending ? (
                        <div className="admin-form" aria-busy={busy}>
                          <p>
                            {t(
                              rowPending.action === "revoke"
                                ? "admin.hmis.revoke.confirm"
                                : "admin.hmis.token.confirm",
                              { name: hmi.name },
                            )}
                          </p>
                          <div className="button-row">
                            <button
                              className="ui-btn ui-btn-sm"
                              type="button"
                              disabled={busy}
                              onClick={() => setPending(null)}
                            >
                              {t("admin.hmis.cancel")}
                            </button>
                            <button
                              className={
                                rowPending.action === "revoke"
                                  ? "ui-btn ui-btn-sm ui-btn-danger"
                                  : "ui-btn ui-btn-sm ui-btn-primary"
                              }
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const revoke = rowPending.action === "revoke";
                                  const ok = apply(
                                    revoke
                                      ? await revokeAdminHmi(fetchImpl, hmi)
                                      : await regenerateAdminHmiToken(
                                          fetchImpl,
                                          hmi,
                                        ),
                                    (next) =>
                                      t(
                                        revoke
                                          ? "admin.hmis.revoke.success"
                                          : "admin.hmis.token.success",
                                        { name: next.name },
                                      ),
                                  );
                                  if (ok) setPending(null);
                                  return ok;
                                })
                              }
                            >
                              {busy
                                ? t("admin.saving")
                                : t(
                                    rowPending.action === "revoke"
                                      ? "admin.hmis.revoke.submit"
                                      : "admin.hmis.token.submit",
                                  )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="button-row">
                          {(["rename", "token", "revoke"] as const)
                            .filter(
                              (action) =>
                                action !== "revoke" || hmi.revokedAt === null,
                            )
                            .map((action) => (
                              <button
                                key={action}
                                className="ui-btn ui-btn-sm"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setNotice(null);
                                  setPending({ id: hmi.id, action });
                                }}
                              >
                                {t(`admin.hmis.${action}.open`)}
                              </button>
                            ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CreateHmiForm
        busy={busy}
        onChange={() => setNotice(null)}
        onSubmit={(name) =>
          run(async () => {
            const result = await createAdminHmi(fetchImpl, name);
            const ok = apply(result, (hmi) =>
              t("admin.hmis.create.success", { name: hmi.name }),
            );
            if (ok) await reload();
            return ok;
          })
        }
      />
    </section>
  );
}

function RenameForm({
  hmi,
  busy,
  onCancel,
  onSubmit,
}: {
  hmi: AdminHmi;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const [name, setName] = useState(hmi.name);
  return (
    <form
      className="admin-form"
      aria-label={t("admin.hmis.rename.label", { name: hmi.name })}
      aria-busy={busy}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void onSubmit(name);
      }}
    >
      <Field label={t("admin.hmis.rename.label", { name: hmi.name })}>
        <input
          className="ui-input"
          autoFocus
          maxLength={MAX_HMI_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="button-row">
        <button
          className="ui-btn ui-btn-sm"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          {t("admin.hmis.cancel")}
        </button>
        <button
          className="ui-btn ui-btn-sm ui-btn-primary"
          type="submit"
          disabled={busy}
        >
          {busy ? t("admin.saving") : t("admin.hmis.rename.submit")}
        </button>
      </div>
    </form>
  );
}

function CreateHmiForm({
  busy,
  onChange,
  onSubmit,
}: {
  busy: boolean;
  onChange: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  return (
    <form
      className="admin-form"
      aria-label={t("admin.hmis.create.heading")}
      aria-busy={busy}
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        if (await onSubmit(name)) setName("");
      }}
    >
      <h3 className="admin-subheading">{t("admin.hmis.create.heading")}</h3>
      <Field
        label={t("admin.hmis.create.name")}
        hint={t("admin.hmis.create.nameHint")}
      >
        <input
          className="ui-input"
          autoComplete="off"
          maxLength={MAX_HMI_NAME_LENGTH}
          value={name}
          onChange={(event) => {
            onChange();
            setName(event.target.value);
          }}
        />
      </Field>
      <div className="button-row">
        <button className="ui-btn ui-btn-primary" type="submit" disabled={busy}>
          {busy ? t("admin.saving") : t("admin.hmis.create.submit")}
        </button>
      </div>
    </form>
  );
}

/**
 * The one-time token display. The token lives only in this component's
 * props; closing the panel forgets it.
 */
function IssuedTokenPanel({
  issued,
  onClose,
}: {
  issued: IssuedHmiToken;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [serverUrl, setServerUrl] = useState(() => window.location.origin);
  const check = checkHmiServerUrl(serverUrl);
  return (
    <div
      className="admin-form admin-issued"
      role="region"
      aria-label={t("admin.hmis.issued.heading", { name: issued.hmi.name })}
    >
      <h3 className="admin-subheading">
        {t("admin.hmis.issued.heading", { name: issued.hmi.name })}
      </h3>
      <p className="fable-notice">{t("admin.hmis.issued.once")}</p>
      <Field
        label={t("admin.hmis.config.serverUrl")}
        hint={t("admin.hmis.config.serverUrlHint")}
      >
        <input
          className="ui-input"
          type="url"
          autoComplete="off"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
        />
      </Field>
      {!check.ok ? (
        <p role="alert" className="fable-notice">
          {t(check.message)}
        </p>
      ) : check.insecure ? (
        <p role="alert" className="fable-notice">
          {t("admin.hmis.config.insecure")}
        </p>
      ) : null}
      <Field label={t("admin.hmis.issued.token")}>
        <input
          className="ui-input admin-token"
          readOnly
          autoComplete="off"
          spellCheck={false}
          value={issued.token}
          onFocus={(event) => event.currentTarget.select()}
        />
      </Field>
      <div className="button-row">
        <button className="ui-btn" type="button" onClick={onClose}>
          {t("admin.hmis.issued.close")}
        </button>
        <button
          className="ui-btn ui-btn-primary"
          type="button"
          disabled={!check.ok}
          onClick={() => {
            if (!check.ok) return;
            const file = hmiConfigFile(check.serverUrl, issued);
            downloadText(file.text, file.fileName, "application/json");
          }}
        >
          {t("admin.hmis.config.download")}
        </button>
      </div>
    </div>
  );
}
