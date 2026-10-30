"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "~/i18n";
import type { ProjectLibraryProps } from "~/features/project/ProjectLibrary";
import { projectNeedsGeometryReview } from "~/features/planning-case/planningCaseModel";
import { hasRobPlan } from "~/features/project/projectRobDownload";
import { PlanRender } from "./PlanRender";
import {
  emptyPlanFilters,
  filterPlanEntries,
  planLibraryEntry,
  type PlanFilters,
} from "./planLibraryModel";

export function PlanLibrary(
  p: ProjectLibraryProps & { onImportRob: (file: File) => void },
) {
  const { t, tag } = useLocale();
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => setFiltersOpen(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const [filters, setFilters] = useState<PlanFilters>({ ...emptyPlanFilters });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const robInput = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => p.projects.map(planLibraryEntry), [p.projects]);
  const shown = useMemo(
    () => filterPlanEntries(entries, filters),
    [entries, filters],
  );
  const set = (key: keyof PlanFilters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const filterCount = Object.keys(filters).filter(
    (k) =>
      filters[k as keyof PlanFilters] !==
      emptyPlanFilters[k as keyof PlanFilters],
  ).length;
  const range = (
    label: string,
    min: keyof PlanFilters,
    max: keyof PlanFilters,
    unit = "",
  ) => (
    <fieldset className="library-range">
      <legend>
        {label}
        {unit ? ` (${unit})` : ""}
      </legend>
      <label>
        <span className="sr-only">
          {t("planner.library.minimum", { label })}
        </span>
        <input
          type="number"
          min="0"
          placeholder={t("planner.library.from")}
          value={filters[min]}
          onChange={(e) => set(min, e.target.value)}
        />
      </label>
      <span>–</span>
      <label>
        <span className="sr-only">
          {t("planner.library.maximum", { label })}
        </span>
        <input
          type="number"
          min="0"
          placeholder={t("planner.library.to")}
          value={filters[max]}
          onChange={(e) => set(max, e.target.value)}
        />
      </label>
    </fieldset>
  );
  const hasSearch = Boolean(
    p.search || p.projectNumberFilter || p.productNumberFilter || filterCount,
  );
  const reset = () => {
    setFilters({ ...emptyPlanFilters });
    p.onSearchChange("");
    p.onProjectNumberFilterChange("");
    p.onProductNumberFilterChange("");
  };
  return (
    <section
      className="fable-page plan-library"
      aria-label={t("planner.library.label")}
    >
      <header className="page-intro library-intro">
        <div>
          <h1>{t("planner.library.title")}</h1>
        </div>
        <div className="button-row">
          <button className="ui-btn" onClick={() => robInput.current?.click()}>
            {t("planner.library.openRob")}
          </button>
          <button className="ui-btn-primary" onClick={p.onCreate}>
            {t("planner.library.newPlan")}
          </button>
        </div>
      </header>
      <input
        className="hidden"
        ref={robInput}
        type="file"
        accept=".rob,text/plain"
        aria-label={t("planner.library.importRobAria")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) p.onImportRob(f);
        }}
      />
      <div className="library-search">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label={t("planner.library.searchAria")}
            placeholder={t("planner.library.searchPlaceholder")}
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
          />
        </label>
        <label className="sort-field">
          <span className="sr-only">{t("planner.library.sort")}</span>
          <select
            value={`${p.sortBy}:${p.sortDirection}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split(":");
              p.onSortChange(
                f as ProjectLibraryProps["sortBy"],
                d as ProjectLibraryProps["sortDirection"],
              );
            }}
          >
            <option value="updatedAt:desc">
              {t("planner.library.sortUpdated")}
            </option>
            <option value="createdAt:desc">
              {t("planner.library.sortCreated")}
            </option>
            <option value="productNumber:asc">
              {t("planner.library.sortProduct")}
            </option>
            <option value="projectNumber:asc">
              {t("planner.library.sortProject")}
            </option>
            <option value="updatedAt:asc">
              {t("planner.library.sortOldest")}
            </option>
          </select>
        </label>
      </div>
      <div className="library-body">
        <details
          className="library-filters"
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>
            {t("planner.library.filter")}{" "}
            {filterCount ? `(${filterCount})` : ""}
          </summary>
          <div className="filter-content">
            {range(
              t("planner.library.packageLength"),
              "lengthMin",
              "lengthMax",
              "mm",
            )}
            {range(
              t("planner.library.packageWidth"),
              "widthMin",
              "widthMax",
              "mm",
            )}
            {range(
              t("planner.library.packageHeight"),
              "heightMin",
              "heightMax",
              "mm",
            )}
            {range(t("planner.library.layers"), "layersMin", "layersMax")}
            {range(
              t("planner.library.packagesPerLayer"),
              "boxesMin",
              "boxesMax",
            )}
            <label>
              {t("planner.library.pallet")}
              <select
                value={filters.pallet}
                onChange={(e) => set("pallet", e.target.value)}
              >
                <option value="all">{t("planner.library.allPallets")}</option>
                <option value="euro">{t("planner.library.palletEuro")}</option>
                <option value="industrial">
                  {t("planner.library.palletIndustrial")}
                </option>
                <option value="custom">
                  {t("planner.library.palletCustom")}
                </option>
              </select>
            </label>
            <label>
              {t("planner.library.origin")}
              <select
                value={filters.source}
                onChange={(e) => set("source", e.target.value)}
              >
                <option value="all">{t("planner.library.allPlans")}</option>
                <option value="new">{t("planner.library.sourceNew")}</option>
                <option value="rob-import">
                  {t("planner.library.sourceRob")}
                </option>
              </select>
            </label>
            <details className="library-extra">
              <summary>{t("planner.library.extraSummary")}</summary>
              <label>
                {t("planner.library.article")}
                <input
                  value={p.productNumberFilter}
                  onChange={(e) =>
                    p.onProductNumberFilterChange(e.target.value)
                  }
                />
              </label>
              <label>
                {t("planner.library.order")}
                <input
                  value={p.projectNumberFilter}
                  onChange={(e) =>
                    p.onProjectNumberFilterChange(e.target.value)
                  }
                />
              </label>
            </details>
            <button className="text-action" onClick={reset}>
              {t("planner.library.resetFilters")}
            </button>
          </div>
        </details>
        <div className="library-results">
          <p className="results-count" aria-live="polite">
            {p.loading
              ? t("planner.library.loading")
              : t("planner.library.count", { count: shown.length })}
          </p>
          {!p.loading && shown.length === 0 && (
            <div className="library-empty">
              <PlanRender />
              <h2>
                {p.projects.length || hasSearch
                  ? t("planner.library.noMatch")
                  : t("planner.library.emptyTitle")}
              </h2>
              <p>
                {p.projects.length || hasSearch
                  ? t("planner.library.noMatchText")
                  : t("planner.library.emptyText")}
              </p>
              <button
                className="ui-btn"
                onClick={p.projects.length || hasSearch ? reset : p.onCreate}
              >
                {p.projects.length || hasSearch
                  ? t("planner.library.showAll")
                  : t("planner.library.createPlan")}
              </button>
            </div>
          )}
          <div role="list" aria-label={t("planner.library.savedPlans")}>
            {shown.map(
              ({ project: pr, data, layerCount, total, perLayerLabel }) => {
                const d = pr.package.dimensionsMm;
                const title =
                  pr.productNumber ||
                  pr.projectNumber ||
                  t("planner.library.untitled");
                return (
                  <article key={pr.id} role="listitem" className="plan-row">
                    <button
                      className="plan-thumb"
                      onClick={() => p.onSelect(pr.id)}
                      aria-label={t("planner.library.openTitle", { title })}
                    >
                      <PlanRender
                        data={data}
                        emptyPackage={d}
                        palletSize={pr.pallet?.dimensionsMm}
                        title={t("planner.library.thumbTitle", {
                          title,
                          count: layerCount,
                        })}
                      />
                    </button>
                    <div className="plan-row-content">
                      <div className="plan-row-title">
                        <button onClick={() => p.onSelect(pr.id)}>
                          <h2>{title}</h2>
                        </button>
                        <span className="plan-origin">
                          {projectNeedsGeometryReview(pr)
                            ? t("planner.library.badgeReview")
                            : pr.source.kind === "rob-import"
                              ? t("planner.library.badgeRob")
                              : layerCount
                                ? t("planner.library.badgeStack")
                                : t("planner.library.badgeDraft")}
                        </span>
                      </div>
                      {(pr.projectNumber ||
                        pr.source.kind === "rob-import") && (
                        <p className="plan-subtitle">
                          {[
                            pr.projectNumber,
                            pr.source.kind === "rob-import"
                              ? pr.source.fileName
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      <dl className="plan-facts">
                        <div>
                          <dt>{t("planner.library.factPackage")}</dt>
                          <dd>
                            {d.length} × {d.width} × {d.height}{" "}
                            <small>mm</small>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("planner.library.layers")}</dt>
                          <dd>{layerCount || "–"}</dd>
                        </div>
                        <div>
                          <dt>{t("planner.library.factPackagesPerLayer")}</dt>
                          <dd>{perLayerLabel}</dd>
                        </div>
                        <div>
                          <dt>{t("planner.library.factTotal")}</dt>
                          <dd>{total || "–"}</dd>
                        </div>
                        <div>
                          <dt>{t("planner.library.pallet")}</dt>
                          <dd>
                            {pr.pallet
                              ? `${pr.pallet.dimensionsMm.length} × ${pr.pallet.dimensionsMm.width}`
                              : "–"}{" "}
                            <small>mm</small>
                          </dd>
                        </div>
                      </dl>
                      <div className="plan-row-bottom">
                        <span>
                          {new Date(pr.updatedAt).toLocaleDateString(tag)}
                        </span>
                        <details className="plan-actions">
                          <summary>{t("planner.library.moreActions")}</summary>
                          <div>
                            <button onClick={() => p.onEdit(pr.id)}>
                              {t("planner.library.editDetails")}
                            </button>
                            <button onClick={() => p.onDuplicate(pr.id)}>
                              {t("planner.library.duplicate")}
                            </button>
                            <button onClick={() => p.onSaveAs(pr.id)}>
                              {t("planner.library.saveCopy")}
                            </button>
                            <button onClick={() => p.onExportSelected(pr.id)}>
                              {t("planner.library.exportProject")}
                            </button>
                            <button
                              className="text-danger"
                              onClick={() => setPendingDelete(pr.id)}
                            >
                              {t("planner.library.delete")}
                            </button>
                          </div>
                        </details>
                        {hasRobPlan(pr) && (
                          <button
                            className="ui-btn"
                            onClick={() => p.onDownloadRob(pr.id)}
                          >
                            {t("planner.library.downloadRob")}
                          </button>
                        )}
                        <button
                          className="ui-btn-primary"
                          onClick={() => p.onSelect(pr.id)}
                        >
                          {t("planner.open")}
                        </button>
                      </div>
                      {pendingDelete === pr.id && (
                        <div className="inline-confirm" role="alert">
                          <span>
                            {t("planner.library.confirmDelete", { title })}
                          </span>
                          <button
                            className="ui-btn ui-btn-danger"
                            onClick={() => {
                              setPendingDelete(null);
                              p.onDelete(pr.id);
                            }}
                          >
                            {t("planner.library.delete")}
                          </button>
                          <button
                            className="ui-btn"
                            onClick={() => setPendingDelete(null)}
                          >
                            {t("planner.library.cancel")}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              },
            )}
          </div>
        </div>
      </div>
      <details className="library-transfer">
        <summary>{t("planner.library.transferSummary")}</summary>
        <div className="button-row">
          <button className="ui-btn" onClick={p.onExportAll}>
            {t("planner.library.exportAll")}
          </button>
          <button className="ui-btn" onClick={() => jsonInput.current?.click()}>
            {t("planner.library.importPackage")}
          </button>
        </div>
        <div className="filter-content">
          <label>
            {t("planner.library.projectConflict")}
            <select
              value={p.projectConflictPolicy}
              onChange={(e) =>
                p.onProjectConflictPolicyChange(
                  e.target
                    .value as ProjectLibraryProps["projectConflictPolicy"],
                )
              }
            >
              <option value="rename">
                {t("planner.library.policyRename")}
              </option>
              <option value="skip">{t("planner.library.policySkip")}</option>
              <option value="overwrite">
                {t("planner.library.policyOverwrite")}
              </option>
            </select>
          </label>
          <label>
            {t("planner.library.resourceConflict")}
            <select
              value={p.resourceConflictPolicy}
              onChange={(e) =>
                p.onResourceConflictPolicyChange(
                  e.target
                    .value as ProjectLibraryProps["resourceConflictPolicy"],
                )
              }
            >
              <option value="rename">
                {t("planner.library.policyRename")}
              </option>
              <option value="skip">{t("planner.library.policySkip")}</option>
              <option value="overwrite">
                {t("planner.library.policyOverwrite")}
              </option>
            </select>
          </label>
        </div>
        <input
          ref={jsonInput}
          className="hidden"
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) p.onImport(f);
          }}
        />
      </details>
    </section>
  );
}
