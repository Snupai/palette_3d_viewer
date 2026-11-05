"use client";

import { Fragment, useEffect, useId, useMemo, useRef } from "react";
import type { Project } from "~/domain/project/projectSchema";
import { useLocale, type MessageKey } from "~/i18n";
import { claimModalKeys } from "~/components/ui/focusTrap";
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
  /**
   * `draft` (default): a rejected save of the open plan (#36). `import`: a
   * local plan whose id the server already holds (#37, ADR 0007).
   */
  variant?: ConflictViewVariant;
  /**
   * Set when "keep mine" would replace a plan the user may not change: the
   * action is disabled and this text says why.
   */
  keepMineDisabledReason?: string | null;
};

export type ConflictViewVariant = "draft" | "import";

type VariantTexts = {
  title: MessageKey;
  intro: MessageKey;
  serverDeleted: MessageKey;
  mineHeading: MessageKey;
  mineCaption: MessageKey;
  keepMine: MessageKey;
  keepMineHint: MessageKey;
  keepServer: MessageKey;
  keepServerHint: MessageKey;
  keepServerDeleted: MessageKey;
  keepServerDeletedHint: MessageKey;
  saveCopy: MessageKey;
  saveCopyHint: MessageKey;
  later: MessageKey;
  laterHint: MessageKey;
};

const VARIANT_TEXTS: Record<ConflictViewVariant, VariantTexts> = {
  draft: {
    title: "conflict.title",
    intro: "conflict.intro",
    serverDeleted: "conflict.serverDeleted",
    mineHeading: "conflict.mine.heading",
    mineCaption: "conflict.mine.caption",
    keepMine: "conflict.action.keepMine",
    keepMineHint: "conflict.action.keepMineHint",
    keepServer: "conflict.action.keepServer",
    keepServerHint: "conflict.action.keepServerHint",
    keepServerDeleted: "conflict.action.keepServerDeleted",
    keepServerDeletedHint: "conflict.action.keepServerDeletedHint",
    saveCopy: "conflict.action.saveCopy",
    saveCopyHint: "conflict.action.saveCopyHint",
    later: "conflict.action.later",
    laterHint: "conflict.action.laterHint",
  },
  import: {
    title: "localImport.conflict.title",
    intro: "localImport.conflict.intro",
    serverDeleted: "localImport.conflict.serverDeleted",
    mineHeading: "localImport.conflict.mineHeading",
    mineCaption: "localImport.conflict.mineCaption",
    keepMine: "localImport.conflict.keepMine",
    keepMineHint: "localImport.conflict.keepMineHint",
    keepServer: "localImport.conflict.keepServer",
    keepServerHint: "localImport.conflict.keepServerHint",
    keepServerDeleted: "localImport.conflict.keepServerDeleted",
    keepServerDeletedHint: "localImport.conflict.keepServerDeletedHint",
    saveCopy: "localImport.conflict.saveCopy",
    saveCopyHint: "localImport.conflict.saveCopyHint",
    later: "localImport.conflict.later",
    laterHint: "localImport.conflict.laterHint",
  },
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
  variant = "draft",
  keepMineDisabledReason = null,
}: ProjectConflictViewProps) {
  const { t, tag } = useLocale();
  const texts = VARIANT_TEXTS[variant];
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const { mine, server } = conflict;
  const comparison = useMemo(
    () => compareConflictPlans(mine, server?.project ?? null, t),
    [mine, server, t],
  );

  useEffect(() => {
    // Focus the labelled dialog root (not the first action, which would be the
    // overwriting "keep mine" button) and hand focus back to the opener on
    // close, like Drawer and the project dialog do.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [conflict]);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onLaterRef = useRef(onLater);
  onLaterRef.current = onLater;
  useEffect(() => {
    // The view can open over a production-tool Drawer, whose document-level
    // keydown listener would close the tool (discarding the draft) on Escape
    // and pull Tab focus back into it. Claim both keys first, like the
    // document camera does over the project dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      claimModalKeys(event, dialog, () => {
        if (!busyRef.current) onLaterRef.current();
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
    disabled = false,
  ) => (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="ui-btn"
        disabled={busy || disabled}
        onClick={() => (choice === "later" ? onLater() : onChoose(choice))}
      >
        {label}
      </button>
      <span className="text-muted text-micro">{hint}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onLater();
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
        <header className="border-line flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 id={titleId} className="text-ink text-base font-semibold">
            {t(texts.title)}
          </h2>
          <button
            type="button"
            onClick={onLater}
            disabled={busy}
            className="ui-btn text-body px-2.5 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("components.drawer.close")}
          </button>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4">
            <p className="text-muted text-body">{t(texts.intro)}</p>
            {conflict.refreshed ? (
              <p
                role="status"
                className="border-caution text-ink text-body mt-2 border-l-2 pl-3"
              >
                {t("conflict.refreshed")}
              </p>
            ) : null}
            {server === null ? (
              <p className="border-danger text-ink text-body mt-2 border-l-2 pl-3">
                {t(texts.serverDeleted)}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <figure className="border-line m-0 border p-3">
              <figcaption className="mb-2">
                <span className="text-ink text-body block font-semibold">
                  {t(texts.mineHeading)}
                </span>
                <span className="text-muted text-micro">
                  {t(texts.mineCaption)}
                </span>
              </figcaption>
              <PlanThumb
                project={mine}
                title={t("conflict.thumbTitle", {
                  side: t(texts.mineHeading),
                  title: planTitle(mine),
                })}
              />
            </figure>
            <figure className="border-line m-0 border p-3">
              <figcaption className="mb-2">
                <span className="text-ink text-body block font-semibold">
                  {t("conflict.server.heading")}
                </span>
                <span className="text-muted text-micro">
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

          <p className="text-ink text-body mt-4 font-semibold" role="status">
            {summary}
          </p>
          <div className="border-line mt-2 overflow-auto border">
            <table className="ui-table min-w-[32rem]">
              <thead>
                <tr>
                  <th scope="col">{t("conflict.column.field")}</th>
                  <th scope="col">{t(texts.mineHeading)}</th>
                  <th scope="col">{t("conflict.server.heading")}</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr>
                      <th scope="colgroup" colSpan={3} className="pt-3 pb-1">
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
                                ? "border-l-caution text-ink border-l-2 bg-transparent pl-2.5 font-medium"
                                : "text-muted bg-transparent pl-3 font-normal"
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
                                ? "text-ink font-semibold"
                                : "text-ink"
                            }
                          >
                            {row.mine}
                          </td>
                          <td
                            className={
                              row.differs
                                ? "text-ink font-semibold"
                                : "text-ink"
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
            <p role="alert" className="text-danger text-body mb-3">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="text-muted text-body mb-3">
              {t("conflict.busy")}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {action(
              "keep-mine",
              t(texts.keepMine),
              keepMineDisabledReason ?? t(texts.keepMineHint),
              keepMineDisabledReason !== null,
            )}
            {server
              ? action(
                  "keep-server",
                  t(texts.keepServer),
                  t(texts.keepServerHint),
                )
              : action(
                  "keep-server",
                  t(texts.keepServerDeleted),
                  t(texts.keepServerDeletedHint),
                )}
            {action("save-copy", t(texts.saveCopy), t(texts.saveCopyHint))}
            {action("later", t(texts.later), t(texts.laterHint))}
          </div>
        </footer>
      </section>
    </div>
  );
}
