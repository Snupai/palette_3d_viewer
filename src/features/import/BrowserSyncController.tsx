"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "~/i18n";
import { ProjectConflictView } from "~/features/project/ProjectConflictView";
import {
  createProjectConflict,
  type ConflictChoice,
} from "~/features/project/projectConflictModel";
import {
  LocalImportController,
  type LocalImportControllerProps,
} from "./LocalImportDialog";
import { createLocalImportTarget } from "./localImportModel";
import {
  browserSyncAbortReason,
  canStartBrowserSync,
  browserSyncErrorMessage,
  planBrowserSync,
  resolveBrowserSyncConflict,
  runBrowserSync,
  type BrowserSyncContext,
  type BrowserSyncEntry,
  type BrowserSyncOutcome,
  type BrowserSyncPlan,
  type BrowserSyncSource,
} from "./browserSyncModel";
import { BrowserSyncOverview } from "./BrowserSyncOverview";

const DISMISSED_PREFIX = "palette.browserSync.dismissed:";
function dismissed(id: string): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_PREFIX + id) === "1";
  } catch {
    return false;
  }
}
function rememberDismissal(id: string) {
  try {
    sessionStorage.setItem(DISMISSED_PREFIX + id, "1");
  } catch {
    /* The header action remains available without sessionStorage. */
  }
}

export type BrowserSyncControllerProps = LocalImportControllerProps & {
  source: BrowserSyncSource;
  server: string;
  /** Confirmed local cleanup: follow its durable publication link. */
  onSynced?: (localId: string, serverId: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
  blockedReason?: string | null;
};

/** Browser publication takes precedence over the separate legacy import (#37). */
export function BrowserSyncController({
  source,
  server,
  onSynced,
  onBusyChange,
  blockedReason,
  ...legacy
}: BrowserSyncControllerProps) {
  const t = useT();
  const { session, repository, creatorOf, onImported, onSessionLost } = legacy;
  const user = session.status === "signed-in" ? session.user : null;
  const userId = user?.id ?? null;
  const live = useRef({ userId, generation: 0 });
  if (live.current.userId !== userId)
    live.current = { userId, generation: live.current.generation + 1 };
  const owner = useRef<string | null>(null);
  const paused = useRef(false);
  const target = useMemo(
    () => createLocalImportTarget(repository, creatorOf),
    [repository, creatorOf],
  );
  const [plan, setPlan] = useState<BrowserSyncPlan | null>(null);
  const [entries, setEntries] = useState<BrowserSyncEntry[]>([]);
  const [outcomes, setOutcomes] = useState<Map<string, BrowserSyncOutcome>>(
    new Map(),
  );
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"overview" | "running" | "done">(
    "overview",
  );
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<BrowserSyncEntry[]>([]);
  const [comparing, setComparing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const context: BrowserSyncContext | null = user ? { server, user } : null;
  const propsRef = useRef({ context, t, onSessionLost, onSynced });
  propsRef.current = { context, t, onSessionLost, onSynced };

  const stop = useCallback((cause: unknown) => {
    const current = propsRef.current;
    const reason = browserSyncAbortReason(cause);
    setError(
      reason === "unauthenticated"
        ? current.t("browserSync.sessionLost")
        : reason === "network"
          ? current.t("browserSync.networkLost")
          : browserSyncErrorMessage(cause, current.t),
    );
    if (reason === "unauthenticated") {
      paused.current = true;
      current.onSessionLost();
    }
    if (reason) setComparing(false);
  }, []);

  const replan = useCallback(
    async (autoOpen: boolean) => {
      const current = propsRef.current.context;
      if (!current) return;
      const generation = live.current.generation;
      setLoading(true);
      try {
        const next = await planBrowserSync(source, target, current);
        if (generation !== live.current.generation) return;
        setPlan(next);
        setEntries((previous) => {
          const merged = new Map(previous.map((entry) => [entry.key, entry]));
          next.projects.forEach((entry) => merged.set(entry.key, entry));
          return [...merged.values()];
        });
        setSelection(
          new Set(
            next.projects
              .filter((entry) => entry.selectable)
              .map((entry) => entry.key),
          ),
        );
        setConflicts([]);
        setComparing(false);
        setRefreshed(false);
        setConfirmed(false);
        setPhase("overview");
        if (
          paused.current ||
          (autoOpen && next.projects.length > 0 && !dismissed(current.user.id))
        )
          setOpen(true);
        paused.current = false;
        setError(null);
      } catch (cause) {
        if (generation === live.current.generation) {
          stop(cause);
          // A failed inventory read does not prove that browser plans exist.
          // Keep its retry available in the header without opening a popup.
        }
      } finally {
        if (generation === live.current.generation) {
          setLoading(false);
          setReady(true);
        }
      }
    },
    [source, target, stop],
  );

  useEffect(() => {
    setReady(false);
    if (!userId) {
      setConfirmed(false);
      setComparing(false);
      return;
    }
    if (owner.current !== userId) {
      owner.current = userId;
      paused.current = false;
      setPlan(null);
      setEntries([]);
      setOutcomes(new Map());
      setProgress(null);
      setOpen(false);
    }
    void replan(true);
  }, [userId, replan]);

  const record = (outcome: BrowserSyncOutcome, accountId: string) => {
    if (owner.current !== accountId) return;
    setOutcomes((previous) => new Map(previous).set(outcome.key, outcome));
  };
  const options = () => {
    const generation = live.current.generation;
    return {
      publicConfirmed: confirmed,
      now: legacy.now?.() ?? Date.now(),
      isSessionLive: () =>
        generation === live.current.generation &&
        live.current.userId === userId,
    };
  };
  const notifySynced = async (
    entry: BrowserSyncEntry,
    outcome: BrowserSyncOutcome,
    current: BrowserSyncContext,
  ) => {
    if (
      outcome.kind !== "synced" ||
      outcome.localRetained ||
      !propsRef.current.onSynced
    )
      return;
    const metadata = await source.getMetadata(entry.project.id);
    const link = metadata?.links.find(
      (link) =>
        link.server === current.server && link.userId === current.user.id,
    );
    if (link && live.current.userId === current.user.id) {
      const acceptedDeletion =
        entry.status === "server-deleted" &&
        link.serverId === entry.link?.serverId;
      propsRef.current.onSynced?.(
        entry.project.id,
        acceptedDeletion ? null : link.serverId,
      );
    }
  };
  const start = async () => {
    if (
      !context ||
      !plan ||
      blockedReason ||
      busy ||
      !canStartBrowserSync(plan, selection, confirmed)
    )
      return;
    const accountId = context.user.id;
    setBusy(true);
    setPhase("running");
    setError(null);
    setProgress({ done: 0, total: selection.size });
    for (const entry of plan.projects) {
      if (!selection.has(entry.key))
        record({ key: entry.key, kind: "kept-local" }, accountId);
    }
    try {
      const run = await runBrowserSync(
        source,
        target,
        plan,
        selection,
        context,
        {
          ...options(),
          onProgress: (outcome) => {
            record(outcome, accountId);
            if (owner.current === accountId)
              setProgress((current) =>
                current ? { ...current, done: current.done + 1 } : null,
              );
          },
        },
      );
      if (owner.current !== accountId) return;
      setConflicts(run.conflicts);
      setComparing(
        run.conflicts.length > 0 &&
          !run.aborted &&
          live.current.userId === accountId,
      );
      if (run.aborted) {
        const failure = [...run.outcomes]
          .reverse()
          .find((outcome) => browserSyncAbortReason(outcome.error));
        if (failure) stop(failure.error);
        const processed = new Set(run.outcomes.map((outcome) => outcome.key));
        for (const entry of plan.projects)
          if (selection.has(entry.key) && !processed.has(entry.key))
            record({ key: entry.key, kind: "kept-local" }, accountId);
      }
      for (const outcome of run.outcomes) {
        const entry = plan.projects.find((entry) => entry.key === outcome.key);
        if (entry) await notifySynced(entry, outcome, context);
      }
      if (run.outcomes.some((outcome) => outcome.kind === "synced"))
        onImported();
    } catch (cause) {
      if (owner.current === accountId) stop(cause);
    } finally {
      setBusy(false);
      if (owner.current === accountId) setPhase("done");
    }
  };
  const conflict = comparing ? conflicts[0] : undefined;
  const choose = async (choice: ConflictChoice) => {
    if (!context || !conflict || busy) return;
    const accountId = context.user.id;
    setBusy(true);
    setError(null);
    try {
      const outcome = await resolveBrowserSyncConflict(
        source,
        target,
        conflict,
        choice,
        context,
        options(),
      );
      if (owner.current !== accountId) return;
      record(outcome, accountId);
      if (outcome.kind === "refreshed" && outcome.entry) {
        setConflicts((queue) => [outcome.entry!, ...queue.slice(1)]);
        setRefreshed(true);
      } else if (outcome.kind === "failed") stop(outcome.error);
      else {
        setConflicts((queue) => queue.slice(1));
        setRefreshed(false);
        if (outcome.kind === "synced") {
          await notifySynced(conflict, outcome, context);
          onImported();
        }
      }
    } catch (cause) {
      if (owner.current === accountId) stop(cause);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    if (owner.current) rememberDismissal(owner.current);
    setOpen(false);
    setConfirmed(false);
    if (phase === "done" && userId) void replan(false);
  };
  const results = [...outcomes.values()];
  const count = (kind: BrowserSyncOutcome["kind"]) =>
    results.filter((outcome) => outcome.kind === kind).length;
  const nameOf = (entry: BrowserSyncEntry) =>
    entry.project.productNumber ||
    entry.project.projectNumber ||
    (entry.project.source.kind === "rob-import"
      ? entry.project.source.fileName
      : "") ||
    t("project.untitledPlan");
  return (
    <>
      {userId && (plan?.projects.length || error) ? (
        <button
          type="button"
          className="ui-btn"
          disabled={legacyOpen || loading || busy || !!blockedReason}
          title={blockedReason ?? undefined}
          onClick={() => {
            setOpen(true);
            void replan(false);
          }}
        >
          {t("browserSync.open", { count: plan?.projects.length ?? 0 })}
        </button>
      ) : null}
      {open && conflict ? (
        <ProjectConflictView
          variant="import"
          conflict={createProjectConflict(
            conflict.project,
            conflict.server
              ? {
                  project: conflict.server.project,
                  version: conflict.server.version,
                }
              : null,
            refreshed,
          )}
          keepMineDisabledReason={
            conflict.canReplace && conflict.server
              ? null
              : t(
                  conflict.server
                    ? "localImport.conflict.keepMineForbidden"
                    : "browserSync.deletedNoReplace",
                )
          }
          busy={busy}
          error={error}
          onChoose={(choice) => void choose(choice)}
          onLater={() => {
            if (!busy) {
              setComparing(false);
              setError(null);
            }
          }}
        />
      ) : open ? (
        <BrowserSyncOverview
          rows={entries.map((entry) => {
            const outcome = outcomes.get(entry.key);
            const result =
              outcome?.kind === "failed"
                ? t("browserSync.result.failed", {
                    reason: browserSyncErrorMessage(outcome.error, t),
                  })
                : outcome?.kind === "synced"
                  ? t(
                      outcome.localRetained
                        ? "browserSync.result.retained"
                        : "browserSync.result.synced",
                    )
                  : outcome?.kind === "kept-local"
                    ? t("browserSync.result.kept-local")
                    : outcome
                      ? t("browserSync.result.conflict")
                      : undefined;
            const dims = entry.project.package.dimensionsMm;
            return {
              key: entry.key,
              name: nameOf(entry),
              detail: `${dims.length} × ${dims.width} × ${dims.height} mm`,
              classification: t(`browserSync.status.${entry.status}`),
              selectable:
                plan?.projects.some(
                  (current) => current.key === entry.key && current.selectable,
                ) ?? false,
              result,
            };
          })}
          selection={selection}
          confirmed={confirmed}
          loading={loading}
          busy={busy}
          phase={phase}
          signedIn={!!userId}
          canStart={
            !blockedReason &&
            !!plan &&
            canStartBrowserSync(plan, selection, confirmed)
          }
          error={
            !userId ? t("browserSync.sessionLost") : (blockedReason ?? error)
          }
          summary={
            results.length
              ? t("browserSync.summary", {
                  synced: count("synced"),
                  local: count("kept-local"),
                  failed: count("failed"),
                })
              : null
          }
          progress={progress ? t("browserSync.progress", progress) : null}
          pendingConflicts={conflicts.length}
          catalogCount={plan?.catalog.length ?? 0}
          unreadableCount={plan?.unreadable.length ?? 0}
          onToggle={(key) =>
            setSelection((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onConfirm={setConfirmed}
          onStart={() => void start()}
          onRetry={() => void replan(false)}
          onDecide={() => setComparing(true)}
          onClose={close}
        />
      ) : null}
      <LocalImportController
        {...legacy}
        enabled={ready && !!userId && !open}
        onOpenChange={setLegacyOpen}
      />
    </>
  );
}
