"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "~/i18n";
import { LanguageSwitcher } from "~/i18n/LanguageSwitcher";

import {
  hmiConnection,
  hmiLastSeenText,
  type AdminHmi,
} from "../admin/adminHmisModel";
import { loginHref } from "../auth/returnPath";
import {
  cancelHmiPageProposal,
  filterHmiPageFinals,
  HMI_PAGE_POLL_MS,
  loadHmiPage,
  loadHmiPageFinals,
  proposalStatusKey,
  sendHmiProposal,
  shouldPollHmiPage,
  type HmiPageFinal,
  type HmiPageProposal,
  type HmiPageState,
  type ProposalActionResult,
} from "./hmiProposalModel";

type Notice = { tone: "success" | "error"; text: string };

function isVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

/**
 * The QR page of one HMI (ADR 0013), laid out for phones: the HMI's
 * status, its latest Planvorschlag, and a searchable list of Fertigstände
 * with "An HMI vorschlagen". The HMI is re-read every few seconds while the
 * page is visible, so the proposal's answer shows up without reloading.
 */
export function HmiProposalScreen({
  hmiId,
  fetchImpl = fetch,
}: {
  hmiId: string;
  fetchImpl?: typeof fetch;
}) {
  const t = useT();
  const [state, setState] = useState<HmiPageState>({ status: "loading" });
  const [finals, setFinals] = useState<HmiPageFinal[] | null | "loading">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(isVisible);
  /** Bumped by every applied answer; older in-flight loads are dropped. */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const next = await loadHmiPage(fetchImpl, hmiId);
    if (current !== generation.current) return;
    setState(next);
    setNow(Date.now());
  }, [fetchImpl, hmiId]);

  const reloadFinals = useCallback(async () => {
    setFinals("loading");
    setFinals(await loadHmiPageFinals(fetchImpl));
  }, [fetchImpl]);

  // The HMI itself is loaded by the visibility effect below.
  useEffect(() => {
    void reloadFinals();
    return () => {
      generation.current += 1;
    };
  }, [reloadFinals]);

  useEffect(() => {
    const onChange = () => setVisible(isVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const polling = shouldPollHmiPage(state, visible);
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void refresh(), HMI_PAGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);
  // Loads on mount and, coming back to the tab, at once instead of after
  // one interval.
  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const applyAction = (result: ProposalActionResult, success: string) => {
    if (result.ok) {
      setNotice({ tone: "success", text: success });
      if (result.proposal && state.status === "ready") {
        generation.current += 1;
        setState({ ...state, proposal: result.proposal });
      }
      void refresh();
      return;
    }
    setNotice({ tone: "error", text: t(result.message) });
    if (result.state) setState(result.state);
    if (result.message === "hmi.error.finalGone") void reloadFinals();
  };

  const propose = async (hmi: AdminHmi) => {
    if (selected === null) {
      setNotice({ tone: "error", text: t("hmi.propose.pick") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      applyAction(
        await sendHmiProposal(fetchImpl, hmiId, selected),
        t("hmi.propose.success", { hmi: hmi.name }),
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (proposal: HmiPageProposal) => {
    setBusy(true);
    setNotice(null);
    try {
      applyAction(
        await cancelHmiPageProposal(fetchImpl, hmiId, proposal.id),
        t("hmi.proposal.cancelSuccess"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-screen hmi-screen">
      <header className="fable-header">
        <Link className="fable-logo" href="/" aria-label={t("shell.home")}>
          {t("shell.appName")}
        </Link>
        <span className="header-context">{t("hmi.title")}</span>
        <div className="header-actions">
          <LanguageSwitcher />
        </div>
      </header>
      <div className="fable-page hmi-page">
        {notice ? (
          <p
            className="fable-notice"
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}
        <Body
          hmiId={hmiId}
          state={state}
          now={now}
          finals={finals}
          query={query}
          selected={selected}
          busy={busy}
          onQuery={setQuery}
          onSelect={setSelected}
          onPropose={(hmi) => void propose(hmi)}
          onCancel={(proposal) => void cancel(proposal)}
          onRetry={() => {
            setState({ status: "loading" });
            void refresh();
            void reloadFinals();
          }}
          onRetryFinals={() => void reloadFinals()}
        />
      </div>
    </div>
  );
}

function Body({
  hmiId,
  state,
  now,
  finals,
  query,
  selected,
  busy,
  onQuery,
  onSelect,
  onPropose,
  onCancel,
  onRetry,
  onRetryFinals,
}: {
  hmiId: string;
  state: HmiPageState;
  now: number;
  finals: HmiPageFinal[] | null | "loading";
  query: string;
  selected: string | null;
  busy: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onPropose: (hmi: AdminHmi) => void;
  onCancel: (proposal: HmiPageProposal) => void;
  onRetry: () => void;
  onRetryFinals: () => void;
}) {
  const t = useT();
  switch (state.status) {
    case "loading":
      return (
        <p role="status" className="text-muted">
          {t("hmi.loading")}
        </p>
      );
    case "unavailable":
      return (
        <p role="status" className="fable-notice">
          {t("hmi.state.unavailable")}
        </p>
      );
    case "unauthenticated":
      return (
        <div className="admin-state">
          <p role="status" className="fable-notice">
            {t("hmi.state.unauthenticated")}
          </p>
          <Link
            className="ui-btn-primary hmi-signin"
            href={loginHref(`/hmi/${encodeURIComponent(hmiId)}`)}
          >
            {t("hmi.signIn")}
          </Link>
        </div>
      );
    case "not-found":
      return (
        <p role="status" className="fable-notice">
          {t("hmi.state.notFound")}
        </p>
      );
    case "error":
      return (
        <div className="admin-state">
          <p role="alert" className="fable-notice">
            {t("hmi.state.error")}
          </p>
          <button className="ui-btn" type="button" onClick={onRetry}>
            {t("hmi.retry")}
          </button>
        </div>
      );
    case "ready":
      break;
  }

  const { hmi, proposal } = state;
  const connection = hmiConnection(hmi, now);
  const seen = hmiLastSeenText(hmi, now);
  const running = hmi.activeFinal;
  const visibleFinals = Array.isArray(finals)
    ? filterHmiPageFinals(finals, query)
    : [];

  return (
    <>
      <header className="page-intro hmi-intro">
        <h1>{hmi.name}</h1>
        <p className="hmi-status">
          <span className={`hmi-connection hmi-connection--${connection}`}>
            {t(`admin.hmis.status.${connection}`)}
          </span>
          {connection === "revoked" ? null : (
            <span>{t("hmi.seen", { when: t(seen.key, seen.params) })}</span>
          )}
          <span>
            {running === null
              ? t("hmi.running.none")
              : t(running.withdrawn ? "hmi.running.withdrawn" : "hmi.running", {
                  name: running.name,
                })}
          </span>
        </p>
      </header>

      {connection === "revoked" ? (
        <p role="status" className="fable-notice">
          {t("hmi.revoked")}
        </p>
      ) : null}

      {proposal ? (
        <section
          className="admin-section hmi-proposal"
          aria-labelledby="hmi-proposal-heading"
        >
          <h2 id="hmi-proposal-heading" className="admin-heading">
            {t("hmi.proposal.heading")}
          </h2>
          <p className="hmi-proposal-name">
            {proposal.proposedBy === null
              ? t("hmi.proposal.byUnknown", { name: proposal.finalName })
              : t("hmi.proposal.by", {
                  name: proposal.finalName,
                  user: proposal.proposedBy,
                })}
          </p>
          <p
            role="status"
            className={`hmi-proposal-state hmi-proposal-state--${proposal.state}`}
          >
            {t(proposalStatusKey(proposal, connection))}
          </p>
          {proposal.state === "pending" ? (
            <button
              className="ui-btn"
              type="button"
              disabled={busy}
              onClick={() => onCancel(proposal)}
            >
              {t("hmi.proposal.cancel")}
            </button>
          ) : null}
        </section>
      ) : null}

      <section
        className="admin-section hmi-finals"
        aria-labelledby="hmi-finals-heading"
      >
        <h2 id="hmi-finals-heading" className="admin-heading">
          {t("hmi.finals.heading")}
        </h2>
        <input
          className="ui-input"
          type="search"
          aria-label={t("hmi.finals.search")}
          placeholder={t("hmi.finals.search")}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        {finals === "loading" ? (
          <p role="status" className="text-muted">
            {t("hmi.finals.loading")}
          </p>
        ) : finals === null ? (
          <div className="admin-state">
            <p role="alert" className="fable-notice">
              {t("hmi.finals.loadError")}
            </p>
            <button className="ui-btn" type="button" onClick={onRetryFinals}>
              {t("hmi.retry")}
            </button>
          </div>
        ) : finals.length === 0 ? (
          <p className="text-muted">{t("hmi.finals.empty")}</p>
        ) : visibleFinals.length === 0 ? (
          <p className="text-muted">{t("hmi.finals.noMatch")}</p>
        ) : (
          <ul className="hmi-final-list" aria-label={t("hmi.finals.heading")}>
            {visibleFinals.map((final) => (
              <li key={final.id}>
                <label className="hmi-final">
                  <input
                    type="radio"
                    name="hmi-final"
                    value={final.id}
                    checked={selected === final.id}
                    onChange={() => onSelect(final.id)}
                  />
                  <span className="hmi-final-name">{final.name}</span>
                  <span className="hmi-final-file">
                    {final.fileName}
                    {running?.id === final.id
                      ? ` · ${t("hmi.finals.running")}`
                      : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="hmi-propose">
          <button
            className="ui-btn-primary"
            type="button"
            disabled={busy || connection === "revoked" || selected === null}
            onClick={() => onPropose(hmi)}
          >
            {busy ? t("hmi.propose.sending") : t("hmi.propose.submit")}
          </button>
          <p className="text-muted">{t("hmi.propose.hint")}</p>
        </div>
      </section>
    </>
  );
}
