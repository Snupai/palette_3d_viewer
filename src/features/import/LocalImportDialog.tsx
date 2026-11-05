"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Project } from "~/domain/project/projectSchema";
import type {
  PlannerSession,
  SessionUser,
} from "~/features/auth/plannerAccessModel";
import { focusableWithin, wrapFocusIndex } from "~/components/ui/focusTrap";
import { ProjectConflictView } from "~/features/project/ProjectConflictView";
import { createProjectConflict } from "~/features/project/projectConflictModel";
import { useT, type Translate } from "~/i18n";
import { PLANNER_DATABASE_NAME } from "~/lib/plannerDatabase";
import { IndexedDbPlannerRecordStorage } from "~/lib/plannerRecordStorage";
import type { ProjectRepository } from "~/lib/projectRepository";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import type { PlannerStoreName } from "~/lib/plannerDatabase";
import {
  canStartImport,
  createLocalImportTarget,
  importableKeys,
  isImportable,
  localInventorySize,
  planLocalImport,
  readLocalImportInventory,
  resolveCatalogImportConflict,
  resolveProjectImportConflict,
  runLocalImport,
  type CatalogImportConflict,
  type ImportStatus,
  type LocalImportInventory,
  type LocalImportPlan,
  type LocalImportSource,
  type ProjectImportConflict,
} from "./localImportModel";
import type { ConflictChoice } from "~/features/project/projectConflictModel";

/** Key of the `saved_pallets_v1` list written before IndexedDB existed. */
const LEGACY_LOCAL_STORAGE_KEY = "saved_pallets_v1";
const DISMISSED_PREFIX = "palette.localImport.dismissed:";

/**
 * This browser's local planner data, opened only for reading (ADR 0002: the
 * server mode never switches its storage). A browser that never used local
 * mode has no planner database; it is not created just to find that out.
 */
export async function openBrowserLocalSource(): Promise<LocalImportSource> {
  const empty: LocalImportSource = { list: async () => [] };
  const indexedDb = globalThis.indexedDB;
  if (!indexedDb) return empty;
  if (typeof indexedDb.databases === "function") {
    const databases = await indexedDb.databases();
    if (!databases.some(({ name }) => name === PLANNER_DATABASE_NAME)) {
      return empty;
    }
  }
  const storage = new IndexedDbPlannerRecordStorage(indexedDb);
  return { list: (store) => storage.list(store) };
}

function readLegacyLocalStorage(): string | null {
  try {
    return globalThis.localStorage?.getItem(LEGACY_LOCAL_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function wasDismissed(userId: string): boolean {
  try {
    return (
      globalThis.sessionStorage?.getItem(DISMISSED_PREFIX + userId) === "1"
    );
  } catch {
    return false;
  }
}

function rememberDismissed(userId: string): void {
  try {
    globalThis.sessionStorage?.setItem(DISMISSED_PREFIX + userId, "1");
  } catch {
    // Without session storage the overview may open again next time.
  }
}

function planName(project: Project, t: Translate): string {
  return (
    project.productNumber ||
    project.projectNumber ||
    (project.source.kind === "rob-import" ? project.source.fileName : "") ||
    t("project.untitledPlan")
  );
}

function messageOf(error: unknown, t: Translate): string {
  return error instanceof Error
    ? error.message
    : t("localImport.error.unknown");
}

function isSessionLoss(error: unknown): boolean {
  return (
    error instanceof ServerStorageError && error.kind === "unauthenticated"
  );
}

function plural(
  t: Translate,
  base:
    | "localImport.result.created"
    | "localImport.result.already"
    | "localImport.result.conflicts"
    | "localImport.outcome.postponed"
    | "localImport.unreadable",
  count: number,
): string {
  return t(count === 1 ? `${base}_one` : `${base}_other`, { count });
}

export type LocalImportControllerProps = {
  session: PlannerSession;
  repository: ProjectRepository;
  /** Creator the server reported with the last read of a record. */
  creatorOf: (store: PlannerStoreName, id: string) => string | null | undefined;
  /** Something was written to the server; reload the library. */
  onImported: () => void;
  /** The server answered 401; the session is gone. */
  onSessionLost: () => void;
  /** Default: this browser's IndexedDB and legacy localStorage list. */
  openLocalSource?: () => Promise<LocalImportSource>;
  readLegacyJson?: () => string | null;
  now?: () => number;
};

type Phase = "overview" | "running" | "done";

/**
 * Server mode only: offers this browser's local plans for import after
 * sign-in (#37, ADR 0007). Shows a header button while local data exists and
 * opens the overview once per sign-in when something can be imported.
 */
export function LocalImportController({
  session,
  repository,
  creatorOf,
  onImported,
  onSessionLost,
  openLocalSource = openBrowserLocalSource,
  readLegacyJson = readLegacyLocalStorage,
  now = Date.now,
}: LocalImportControllerProps) {
  const t = useT();
  const user: SessionUser | null =
    session.status === "signed-in" ? session.user : null;
  const userId = user?.id ?? null;
  const target = useMemo(
    () => createLocalImportTarget(repository, creatorOf),
    [repository, creatorOf],
  );

  const [inventory, setInventory] = useState<LocalImportInventory | null>(null);
  const [plan, setPlan] = useState<LocalImportPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("overview");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<ProjectImportConflict[]>([]);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [catalogConflicts, setCatalogConflicts] = useState<
    CatalogImportConflict[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const userRef = useRef(user);
  userRef.current = user;
  const tRef = useRef(t);
  tRef.current = t;

  const handleError = useCallback(
    (
      cause: unknown,
      key: "localImport.error.load" | "localImport.error.plan",
    ) => {
      if (isSessionLoss(cause)) {
        onSessionLost();
        setError(tRef.current("auth.error.sessionExpired"));
        return;
      }
      console.error("Local import failed", cause);
      setError(tRef.current(key, { message: messageOf(cause, tRef.current) }));
    },
    [onSessionLost],
  );

  const replan = useCallback(
    async (current: LocalImportInventory, autoOpen: boolean) => {
      const signedIn = userRef.current;
      if (!signedIn) return;
      setPlanning(true);
      try {
        const next = await planLocalImport(target, current, signedIn);
        if (userRef.current?.id !== signedIn.id) return;
        setPlan(next);
        setSelection(new Set(importableKeys(next)));
        setPhase("overview");
        if (
          autoOpen &&
          importableKeys(next).length > 0 &&
          !wasDismissed(signedIn.id)
        ) {
          setOpen(true);
        }
      } catch (cause) {
        handleError(cause, "localImport.error.plan");
      } finally {
        setPlanning(false);
      }
    },
    [handleError, target],
  );

  useEffect(() => {
    setInventory(null);
    setPlan(null);
    setOpen(false);
    setConflicts([]);
    setConflictsOpen(false);
    setCatalogConflicts([]);
    setLog([]);
    setError(null);
    setConfirmed(false);
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const source = await openLocalSource();
        const local = await readLocalImportInventory(source, readLegacyJson());
        if (!active) return;
        setInventory(local);
        if (localInventorySize(local) > 0) await replan(local, true);
      } catch (cause) {
        if (active) handleError(cause, "localImport.error.load");
      }
    })();
    return () => {
      active = false;
    };
    // Re-read only when another user signs in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const close = useCallback(() => {
    if (busy) return;
    if (userId) rememberDismissed(userId);
    setOpen(false);
  }, [busy, userId]);

  const start = async () => {
    if (!user || !plan || !canStartImport(plan, selection, confirmed)) return;
    setPhase("running");
    setError(null);
    setLog([]);
    try {
      const run = await runLocalImport(target, plan, selection, user, {
        isFatal: isSessionLoss,
      });
      const names = new Map<string, string>([
        ...plan.projects.map(
          (entry) => [entry.key, planName(entry.local.project, t)] as const,
        ),
        ...plan.catalog.map(
          (entry) => [entry.key, entry.local.resource.name] as const,
        ),
      ]);
      const lines: string[] = [];
      if (run.created.length > 0) {
        lines.push(plural(t, "localImport.result.created", run.created.length));
      }
      if (run.alreadyImported.length > 0) {
        lines.push(
          plural(t, "localImport.result.already", run.alreadyImported.length),
        );
      }
      for (const failure of run.failures) {
        lines.push(
          t("localImport.result.failed", {
            name: names.get(failure.key) ?? failure.key,
            message: messageOf(failure.error, t),
          }),
        );
      }
      const pending = run.conflicts.length + run.catalogConflicts.length;
      if (pending > 0) {
        lines.push(plural(t, "localImport.result.conflicts", pending));
      }
      if (run.aborted) {
        lines.push(t("localImport.result.aborted"));
        if (isSessionLoss(run.aborted)) {
          onSessionLost();
          setError(t("auth.error.sessionExpired"));
        } else {
          setError(messageOf(run.aborted, t));
        }
      }
      setLog(lines);
      setConflicts(run.conflicts);
      setConflictsOpen(run.conflicts.length > 0);
      setCatalogConflicts(run.catalogConflicts);
      if (run.created.length > 0) onImported();
    } catch (cause) {
      handleError(cause, "localImport.error.plan");
    } finally {
      setPhase("done");
    }
  };

  const currentConflict = conflictsOpen ? (conflicts[0] ?? null) : null;

  const chooseProject = async (choice: ConflictChoice) => {
    if (!user || !currentConflict || busy) return;
    setBusy(true);
    setConflictError(null);
    const name = planName(currentConflict.local, t);
    try {
      const { projectNumber } = currentConflict.local;
      const outcome = await resolveProjectImportConflict(
        target,
        currentConflict,
        choice,
        {
          user,
          now: now(),
          copyProjectNumber: projectNumber
            ? t("project.copySuffix", { number: projectNumber })
            : undefined,
        },
      );
      if (outcome.kind === "refreshed") {
        setConflicts((queue) => [outcome.conflict, ...queue.slice(1)]);
        return;
      }
      const line =
        outcome.kind === "kept-server"
          ? t("localImport.outcome.kept", { name })
          : outcome.kind === "replaced"
            ? t("localImport.outcome.replaced", { name })
            : outcome.kind === "created"
              ? t("localImport.outcome.created", { name })
              : outcome.kind === "copied"
                ? t("localImport.outcome.copied", {
                    name,
                    copy: planName(outcome.project, t),
                  })
                : outcome.kind === "copy-exists"
                  ? t("localImport.outcome.copyExists", { name })
                  : t("localImport.outcome.forbidden", { name });
      setLog((lines) => [...lines, line]);
      setConflicts((queue) => queue.slice(1));
      if (outcome.kind !== "kept-server" && outcome.kind !== "forbidden") {
        onImported();
      }
    } catch (cause) {
      if (isSessionLoss(cause)) {
        onSessionLost();
        setConflictsOpen(false);
        setError(t("auth.error.sessionExpired"));
        return;
      }
      setConflictError(t("conflict.error", { message: messageOf(cause, t) }));
    } finally {
      setBusy(false);
    }
  };

  const postponeConflicts = () => {
    if (conflicts.length > 0) {
      setLog((lines) => [
        ...lines,
        plural(t, "localImport.outcome.postponed", conflicts.length),
      ]);
    }
    setConflicts([]);
    setConflictsOpen(false);
    setConflictError(null);
  };

  const chooseCatalog = async (
    conflict: CatalogImportConflict,
    choice: ConflictChoice,
  ) => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    const name = conflict.local.name;
    try {
      const outcome = await resolveCatalogImportConflict(
        target,
        conflict,
        choice,
        {
          user,
          now: now(),
          copyName: t("localImport.catalogCopyName", { name }),
        },
      );
      if (outcome.kind === "refreshed") {
        setCatalogConflicts((list) =>
          list.map((entry) =>
            entry.key === conflict.key ? outcome.conflict : entry,
          ),
        );
        return;
      }
      const line =
        outcome.kind === "kept-server"
          ? t("localImport.outcome.kept", { name })
          : outcome.kind === "replaced"
            ? t("localImport.outcome.replaced", { name })
            : outcome.kind === "created"
              ? t("localImport.outcome.created", { name })
              : outcome.kind === "copied"
                ? t("localImport.outcome.copied", {
                    name,
                    copy: outcome.resource.name,
                  })
                : outcome.kind === "copy-exists"
                  ? t("localImport.outcome.copyExists", { name })
                  : t("localImport.outcome.forbidden", { name });
      setLog((lines) => [...lines, line]);
      setCatalogConflicts((list) =>
        list.filter(({ key }) => key !== conflict.key),
      );
    } catch (cause) {
      if (isSessionLoss(cause)) {
        onSessionLost();
        setError(t("auth.error.sessionExpired"));
        return;
      }
      setError(t("conflict.error", { message: messageOf(cause, t) }));
    } finally {
      setBusy(false);
    }
  };

  if (!user || !inventory || localInventorySize(inventory) === 0) return null;
  const importableCount = plan ? importableKeys(plan).length : 0;

  return (
    <>
      <button
        type="button"
        className="local-import-button"
        onClick={() => {
          setError(null);
          setOpen(true);
          if (phase !== "running") void replan(inventory, false);
        }}
      >
        {importableCount > 0
          ? t("localImport.openCount", { count: importableCount })
          : t("localImport.open")}
      </button>
      {open ? (
        <LocalImportOverview
          plan={plan}
          planning={planning}
          phase={phase}
          selection={selection}
          onToggle={(key) =>
            setSelection((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          confirmed={confirmed}
          onConfirm={setConfirmed}
          error={error}
          log={log}
          busy={busy}
          conflictOpen={currentConflict !== null}
          pendingConflicts={conflicts.length}
          onDecide={() => setConflictsOpen(true)}
          catalogConflicts={catalogConflicts}
          onChooseCatalog={(conflict, choice) =>
            void chooseCatalog(conflict, choice)
          }
          onStart={() => void start()}
          onRecheck={() => {
            setLog([]);
            setError(null);
            void replan(inventory, false);
          }}
          onClose={close}
        />
      ) : null}
      {open && currentConflict ? (
        <ProjectConflictView
          variant="import"
          conflict={createProjectConflict(
            currentConflict.local,
            currentConflict.server
              ? {
                  project: currentConflict.server.project,
                  version: currentConflict.server.version,
                }
              : null,
            currentConflict.refreshed,
          )}
          keepMineDisabledReason={
            currentConflict.canReplace
              ? null
              : t("localImport.conflict.keepMineForbidden")
          }
          busy={busy}
          error={conflictError}
          onChoose={(choice) => void chooseProject(choice)}
          onLater={postponeConflicts}
        />
      ) : null}
    </>
  );
}

const STATUS_CLASS: Record<ImportStatus, string> = {
  new: "text-ink",
  unchanged: "text-muted",
  copied: "text-muted",
  differs: "text-ink",
  "server-unreadable": "text-danger",
  "admin-only": "text-muted",
};

type OverviewProps = {
  plan: LocalImportPlan | null;
  planning: boolean;
  phase: Phase;
  selection: ReadonlySet<string>;
  onToggle: (key: string) => void;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
  error: string | null;
  log: string[];
  busy: boolean;
  conflictOpen: boolean;
  pendingConflicts: number;
  onDecide: () => void;
  catalogConflicts: CatalogImportConflict[];
  onChooseCatalog: (
    conflict: CatalogImportConflict,
    choice: ConflictChoice,
  ) => void;
  onStart: () => void;
  onRecheck: () => void;
  onClose: () => void;
};

function LocalImportOverview({
  plan,
  planning,
  phase,
  selection,
  onToggle,
  confirmed,
  onConfirm,
  error,
  log,
  busy,
  conflictOpen,
  pendingConflicts,
  onDecide,
  catalogConflicts,
  onChooseCatalog,
  onStart,
  onRecheck,
  onClose,
}: OverviewProps) {
  const t = useT();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const running = phase === "running";

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const stateRef = useRef({ conflictOpen, running, onClose });
  stateRef.current = { conflictOpen, running, onClose };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      // The conflict view on top handles its own keys.
      if (!dialog || stateRef.current.conflictOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!stateRef.current.running) stateRef.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableWithin(dialog);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const index = items.findIndex((item) => item === document.activeElement);
      const next = wrapFocusIndex(index, items.length, event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        items[next]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const importable = plan ? importableKeys(plan) : [];
  const selectedCount = importable.filter((key) => selection.has(key)).length;
  const canStart =
    plan !== null &&
    phase === "overview" &&
    canStartImport(plan, selection, confirmed);

  const row = (
    key: string,
    status: ImportStatus,
    title: string,
    detail: string | null,
  ) => {
    const selectable = phase === "overview" && isImportable(status);
    return (
      <li
        key={key}
        className="border-line flex items-start gap-3 border-b py-2"
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 cursor-pointer"
          aria-label={t("localImport.select", { name: title })}
          checked={isImportable(status) && selection.has(key)}
          disabled={!selectable}
          onChange={() => onToggle(key)}
        />
        <div className="min-w-0 flex-1">
          <span className="text-ink block truncate text-sm font-medium">
            {title}
          </span>
          {detail ? (
            <span className="text-muted block text-xs">{detail}</span>
          ) : null}
        </div>
        <span
          className={`shrink-0 text-right text-xs ${STATUS_CLASS[status]}`}
          data-status={status}
        >
          {t(`localImport.status.${status}`)}
        </span>
      </li>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={running || planning || busy}
        className="border-line bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden border shadow-[0_2px_8px_rgba(0,0,0,0.1)] outline-none"
      >
        <header className="border-line shrink-0 border-b px-5 py-4">
          <h2 id={titleId} className="text-ink text-base font-semibold">
            {t("localImport.title")}
          </h2>
          <p className="text-muted mt-1 text-sm">{t("localImport.intro")}</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {planning && !plan ? (
            <p role="status" className="text-muted text-sm">
              {t("localImport.loading")}
            </p>
          ) : null}
          {plan && plan.projects.length > 0 ? (
            <>
              <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
                {t("localImport.section.projects")}
              </h3>
              <ul className="mb-4">
                {plan.projects.map((entry) => {
                  const { project } = entry.local;
                  const dims = project.package.dimensionsMm;
                  const detail = [
                    project.projectNumber || null,
                    `${dims.length} × ${dims.width} × ${dims.height} mm`,
                    entry.local.source === "legacy-pallet"
                      ? t("localImport.source.legacy")
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return row(
                    entry.key,
                    entry.status,
                    planName(project, t),
                    detail,
                  );
                })}
              </ul>
            </>
          ) : null}
          {plan && plan.catalog.length > 0 ? (
            <>
              <h3 className="text-muted text-xs font-semibold tracking-wide uppercase">
                {t("localImport.section.catalog")}
              </h3>
              <ul className="mb-4">
                {plan.catalog.map((entry) =>
                  row(
                    entry.key,
                    entry.status,
                    entry.local.resource.name,
                    t(`localImport.catalogKind.${entry.local.resource.kind}`),
                  ),
                )}
              </ul>
            </>
          ) : null}
          {plan && plan.unreadable.length > 0 ? (
            <p className="text-muted text-xs">
              {plural(t, "localImport.unreadable", plan.unreadable.length)}
            </p>
          ) : null}
          {plan && phase === "overview" && importable.length === 0 ? (
            <p role="status" className="text-ink mt-2 text-sm">
              {t("localImport.nothingToImport")}
            </p>
          ) : null}

          {catalogConflicts.length > 0 ? (
            <section className="mt-4">
              <h3 className="text-ink text-sm font-semibold">
                {t("localImport.catalogConflict.heading")}
              </h3>
              <ul>
                {catalogConflicts.map((conflict) => (
                  <li
                    key={conflict.key}
                    className="border-line border-b py-2 text-sm"
                    data-catalog-conflict={conflict.local.id}
                  >
                    <p className="text-ink">
                      {t("localImport.catalogConflict.local", {
                        name: conflict.local.name,
                      })}
                    </p>
                    <p className="text-muted">
                      {conflict.server
                        ? t("localImport.catalogConflict.server", {
                            name: conflict.server.resource.name,
                            version: conflict.server.version,
                          })
                        : t("localImport.catalogConflict.serverDeleted")}
                    </p>
                    {conflict.refreshed ? (
                      <p className="border-caution text-ink border-l-4 pl-2 text-xs">
                        {t("localImport.catalogConflict.refreshed")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="ui-btn cursor-pointer"
                        disabled={busy}
                        onClick={() => onChooseCatalog(conflict, "keep-mine")}
                      >
                        {t("localImport.conflict.keepMine")}
                      </button>
                      <button
                        type="button"
                        className="ui-btn cursor-pointer"
                        disabled={busy}
                        onClick={() => onChooseCatalog(conflict, "keep-server")}
                      >
                        {t("localImport.conflict.keepServer")}
                      </button>
                      <button
                        type="button"
                        className="ui-btn cursor-pointer"
                        disabled={busy}
                        onClick={() => onChooseCatalog(conflict, "save-copy")}
                      >
                        {t("localImport.conflict.saveCopy")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {log.length > 0 ? (
            <ul role="status" className="mt-4 flex flex-col gap-1 text-sm">
              {log.map((line, index) => (
                <li key={index} className="text-ink">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <footer className="border-line shrink-0 border-t px-5 py-4">
          {error ? (
            <p role="alert" className="text-danger mb-3 text-sm">
              {error}
            </p>
          ) : null}
          {phase === "overview" && importable.length > 0 ? (
            <label className="text-ink mb-3 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 cursor-pointer"
                checked={confirmed}
                onChange={(event) => onConfirm(event.target.checked)}
              />
              <span>{t("localImport.confirmPublic")}</span>
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {phase === "done" && pendingConflicts > 0 ? (
              <button
                type="button"
                className="ui-btn-primary min-h-11 cursor-pointer"
                onClick={onDecide}
              >
                {t("localImport.result.decide")}
              </button>
            ) : null}
            {phase === "done" ? (
              <button
                type="button"
                className="ui-btn min-h-11 cursor-pointer"
                disabled={busy || planning}
                onClick={onRecheck}
              >
                {t("localImport.recheck")}
              </button>
            ) : null}
            {phase !== "done" && importable.length > 0 ? (
              <button
                type="button"
                className="ui-btn-primary min-h-11 cursor-pointer"
                disabled={!canStart}
                onClick={onStart}
              >
                {running
                  ? t("localImport.running")
                  : t("localImport.start", { count: selectedCount })}
              </button>
            ) : null}
            <button
              type="button"
              className="ui-btn min-h-11 cursor-pointer"
              disabled={running || busy}
              onClick={onClose}
            >
              {t("localImport.close")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
