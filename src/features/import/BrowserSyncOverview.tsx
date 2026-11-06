"use client";

import { useEffect, useId, useRef } from "react";
import { claimModalKeys } from "~/components/ui/focusTrap";
import { useT } from "~/i18n";

export type BrowserSyncRow = {
  key: string;
  name: string;
  detail: string;
  classification: string;
  selectable: boolean;
  result?: string;
};

type Props = {
  rows: BrowserSyncRow[];
  selection: ReadonlySet<string>;
  confirmed: boolean;
  loading: boolean;
  busy: boolean;
  phase: "overview" | "running" | "done";
  canStart: boolean;
  error: string | null;
  summary: string | null;
  progress: string | null;
  pendingConflicts: number;
  unreadableCount: number;
  signedIn: boolean;
  onToggle: (key: string) => void;
  onConfirm: (confirmed: boolean) => void;
  onStart: () => void;
  onRetry: () => void;
  onDecide: () => void;
  onClose: () => void;
};

/** Rendering only: eligibility, outcomes and conflict decisions belong to #70. */
export function BrowserSyncOverview(props: Props) {
  const t = useT();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const state = useRef(props);
  state.current = props;
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogRef.current)
        claimModalKeys(event, dialogRef.current, () => {
          if (!state.current.busy) state.current.onClose();
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const selected = props.rows.filter(
    (row) => row.selectable && props.selection.has(row.key),
  ).length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.busy)
          props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={props.busy || props.loading}
        className="border-line bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden border shadow-[0_2px_8px_rgba(0,0,0,0.1)] outline-none"
      >
        <header className="border-line flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4">
          <h2 id={titleId} className="text-ink text-base font-semibold">
            {t("browserSync.title")}
          </h2>
          <button
            type="button"
            className="ui-btn"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {t("browserSync.close")}
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-muted text-body mb-2">{t("browserSync.intro")}</p>
          <p className="text-muted text-body mb-4">
            {t("browserSync.retention")}
          </p>
          {props.loading ? (
            <p role="status">{t("browserSync.loading")}</p>
          ) : null}
          {!props.loading && !props.error && props.rows.length === 0 ? (
            <p>{t("browserSync.empty")}</p>
          ) : null}
          <ul>
            {props.rows.map((row) => (
              <li
                key={row.key}
                className="border-line flex items-start gap-3 border-b py-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                  aria-label={t("browserSync.select", { name: row.name })}
                  checked={props.selection.has(row.key)}
                  disabled={
                    !row.selectable ||
                    props.phase !== "overview" ||
                    props.loading ||
                    props.busy ||
                    !props.signedIn
                  }
                  onChange={() => props.onToggle(row.key)}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-ink text-body block font-medium break-words">
                    {row.name}
                  </span>
                  <span className="text-muted text-micro block">
                    {row.detail}
                  </span>
                  <span className="text-muted text-body block">
                    {row.classification}
                  </span>
                  {row.result ? (
                    <span className="text-ink text-body block">
                      {row.result}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {props.unreadableCount > 0 ? (
            <p className="text-muted text-body mt-3">
              {t("browserSync.unreadable", { count: props.unreadableCount })}
            </p>
          ) : null}
          {props.phase === "overview" &&
          props.rows.some((row) => row.selectable) ? (
            <label className="text-ink text-body mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                checked={props.confirmed}
                disabled={props.busy || props.loading || !props.signedIn}
                onChange={(event) => props.onConfirm(event.target.checked)}
              />
              <span>{t("localImport.confirmPublic")}</span>
            </label>
          ) : null}
          {props.progress ? (
            <p role="status" className="text-ink text-body mt-4">
              {props.progress}
            </p>
          ) : null}
          {props.summary ? (
            <p role="status" className="text-ink text-body mt-4 font-medium">
              {props.summary}
            </p>
          ) : null}
          {props.pendingConflicts > 0 ? (
            <p className="text-ink text-body mt-3">
              {t("browserSync.pending", { count: props.pendingConflicts })}
            </p>
          ) : null}
          {props.error ? (
            <p role="alert" className="text-danger text-body mt-3">
              {props.error}
            </p>
          ) : null}
          <p className="text-muted text-micro mt-4">
            {t("browserSync.dismissal")}
          </p>
        </div>
        <footer className="border-line flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            className="ui-btn"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {t("browserSync.later")}
          </button>
          {props.phase === "done" ? (
            <button
              type="button"
              className="ui-btn"
              disabled={props.busy || props.loading || !props.signedIn}
              onClick={props.onRetry}
            >
              {t("browserSync.retry")}
            </button>
          ) : null}
          {props.pendingConflicts > 0 ? (
            <button
              type="button"
              className="ui-btn-primary"
              disabled={props.busy || !props.signedIn}
              onClick={props.onDecide}
            >
              {t("browserSync.decide")}
            </button>
          ) : null}
          {props.phase === "overview" ? (
            <button
              type="button"
              className="ui-btn-primary"
              disabled={
                !props.canStart ||
                props.busy ||
                props.loading ||
                !props.signedIn
              }
              onClick={props.onStart}
            >
              {t("browserSync.start", { count: selected })}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
