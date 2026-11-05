"use client";

import { Fragment, useEffect, useId, useMemo, useRef } from "react";
import type { Project } from "~/domain/project/projectSchema";
import { useLocale } from "~/i18n";
import { PlanRender } from "~/features/planner/PlanRender";
import { planLibraryEntry } from "~/features/planner/planLibraryModel";
import {
  compareConflictPlans,
  type ConflictChoice,
  type ConflictRowGroup,
  type ProjectConflict,
} from "./projectConflictModel";

export type ProjectConflictViewProps = {
  conflict: ProjectConflict;
  busy: boolean;
  error: string | null;
  onChoose: (choice: ConflictChoice) => void;
  /** Close without deciding; the draft stays open and unsaved. */
  onLater: () => void;
};

const GROUPS: readonly ConflictRowGroup[] = [
  "details",
  "package",
  "pallet",
  "stack",
];

function PlanThumb({ project, title }: { project: Project; title: string }) {
  const entry = useMemo(() => planLibraryEntry(project), [project]);
  return (
    <PlanRender
      data={entry.data}
      emptyPackage={project.package.dimensionsMm}
      palletSize={project.pallet?.dimensionsMm}
      title={title}
      // Small enough that the field comparison stays in view.
      className="mx-auto block h-40 w-full max-w-xs sm:h-48"
    />
  );
}

/**
 * Version conflict (ADR 0006): own draft left, current server state right,
 * differing fields highlighted. Choices are whole plan states or a copy.
 */
export function ProjectConflictView({
  conflict,
  busy,
  error,
  onChoose,
  onLater,
}: ProjectConflictViewProps) {
  const { t, tag } = useLocale();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const { mine, server } = conflict;
  const comparison = useMemo(
    () => compareConflictPlans(mine, server?.project ?? null, t),
    [mine, server, t],
  );

  useEffect(() => {
    dialogRef.current?.focus();
  }, [conflict]);

  const planTitle = (project: Project) =>
    project.productNumber || project.projectNumber || t("project.untitledPlan");
  const summary =
    comparison.differingCount === 1
      ? t("conflict.differencesOne")
      : comparison.differingCount > 0
        ? t("conflict.differences", { count: comparison.differingCount })
        : comparison.hasUnlistedDifferences
          ? t("conflict.noListedDifferences")
          : t("conflict.identical");
  const groupLabels: Record<ConflictRowGroup, string> = {
    details: t("conflict.group.details"),
    package: t("conflict.group.package"),
    pallet: t("conflict.group.pallet"),
    stack: t("conflict.group.stack"),
  };

  const action = (
    choice: ConflictChoice | "later",
    label: string,
    hint: string,
  ) => (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="ui-btn min-h-11 cursor-pointer"
        disabled={busy}
        onClick={() => (choice === "later" ? onLater() : onChoose(choice))}
      >
        {label}
      </button>
      <span className="text-muted text-xs">{hint}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || busy) return;
        event.preventDefault();
        onLater();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className="border-line bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden border shadow-[0_2px_8px_rgba(0,0,0,0.1)] outline-none"
      >
        <header className="border-line shrink-0 border-b px-5 py-4">
          <h2 id={titleId} className="text-ink text-base font-semibold">
            {t("conflict.title")}
          </h2>
          <p className="text-muted mt-1 text-sm">{t("conflict.intro")}</p>
          {conflict.refreshed ? (
            <p
              role="status"
              className="border-caution text-ink mt-2 border-l-4 pl-3 text-sm"
            >
              {t("conflict.refreshed")}
            </p>
          ) : null}
          {server === null ? (
            <p className="border-danger text-ink mt-2 border-l-4 pl-3 text-sm">
              {t("conflict.serverDeleted")}
            </p>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <figure className="border-line m-0 border p-3">
              <figcaption className="mb-2">
                <span className="text-ink block text-sm font-semibold">
                  {t("conflict.mine.heading")}
                </span>
                <span className="text-muted text-xs">
                  {t("conflict.mine.caption")}
                </span>
              </figcaption>
              <PlanThumb
                project={mine}
                title={t("conflict.thumbTitle", {
                  side: t("conflict.mine.heading"),
                  title: planTitle(mine),
                })}
              />
            </figure>
            <figure className="border-line m-0 border p-3">
              <figcaption className="mb-2">
                <span className="text-ink block text-sm font-semibold">
                  {t("conflict.server.heading")}
                </span>
                <span className="text-muted text-xs">
                  {server
                    ? t("conflict.server.caption", {
                        version: server.version,
                        date: new Date(server.project.updatedAt).toLocaleString(
                          tag,
                        ),
                      })
                    : t("conflict.server.deletedCaption")}
                </span>
              </figcaption>
              {server ? (
                <PlanThumb
                  project={server.project}
                  title={t("conflict.thumbTitle", {
                    side: t("conflict.server.heading"),
                    title: planTitle(server.project),
                  })}
                />
              ) : null}
            </figure>
          </div>

          <p className="text-ink mt-4 text-sm font-semibold" role="status">
            {summary}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-line text-muted border-b text-left text-xs">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("conflict.column.field")}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t("conflict.mine.heading")}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t("conflict.server.heading")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={3}
                        className="text-muted pt-3 pb-1 text-left text-xs font-semibold tracking-wide uppercase"
                      >
                        {groupLabels[group]}
                      </th>
                    </tr>
                    {comparison.rows
                      .filter((row) => row.group === group)
                      .map((row) => (
                        <tr
                          key={row.id}
                          data-row={row.id}
                          data-differs={row.differs || undefined}
                          className={
                            row.differs
                              ? "border-line bg-caution/10 border-b"
                              : "border-line border-b"
                          }
                        >
                          <th
                            scope="row"
                            className={
                              row.differs
                                ? "border-caution text-ink border-l-4 py-1.5 pr-3 pl-2 text-left font-medium"
                                : "text-muted py-1.5 pr-3 pl-3 text-left font-normal"
                            }
                          >
                            {row.label}
                            {row.differs ? (
                              <span className="sr-only">
                                {" "}
                                ({t("conflict.differsMarker")})
                              </span>
                            ) : null}
                          </th>
                          <td
                            className={
                              row.differs
                                ? "text-ink py-1.5 pr-3 font-semibold"
                                : "text-ink py-1.5 pr-3"
                            }
                          >
                            {row.mine}
                          </td>
                          <td
                            className={
                              row.differs
                                ? "text-ink py-1.5 font-semibold"
                                : "text-ink py-1.5"
                            }
                          >
                            {row.server}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="border-line shrink-0 border-t px-5 py-4">
          {error ? (
            <p role="alert" className="text-danger mb-3 text-sm">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="text-muted mb-3 text-sm">
              {t("conflict.busy")}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {action(
              "keep-mine",
              t("conflict.action.keepMine"),
              t("conflict.action.keepMineHint"),
            )}
            {server
              ? action(
                  "keep-server",
                  t("conflict.action.keepServer"),
                  t("conflict.action.keepServerHint"),
                )
              : action(
                  "keep-server",
                  t("conflict.action.keepServerDeleted"),
                  t("conflict.action.keepServerDeletedHint"),
                )}
            {action(
              "save-copy",
              t("conflict.action.saveCopy"),
              t("conflict.action.saveCopyHint"),
            )}
            {action(
              "later",
              t("conflict.action.later"),
              t("conflict.action.laterHint"),
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
