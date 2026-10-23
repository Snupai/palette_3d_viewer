"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectLibraryProps } from "~/features/project/ProjectLibrary";
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
        <span className="sr-only">{label} mindestens</span>
        <input
          type="number"
          min="0"
          placeholder="Von"
          value={filters[min]}
          onChange={(e) => set(min, e.target.value)}
        />
      </label>
      <span>–</span>
      <label>
        <span className="sr-only">{label} höchstens</span>
        <input
          type="number"
          min="0"
          placeholder="Bis"
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
    <section className="fable-page plan-library" aria-label="Planbibliothek">
      <header className="page-intro library-intro">
        <div>
          <h1>Vorhandene Pläne</h1>
          <p>Der richtige Plan beginnt mit einem Blick auf die Palette.</p>
        </div>
        <div className="button-row">
          <button className="ui-btn" onClick={() => robInput.current?.click()}>
            .rob öffnen
          </button>
          <button className="ui-btn-primary" onClick={p.onCreate}>
            ＋ Neuer Plan
          </button>
        </div>
      </header>
      <input
        className="hidden"
        ref={robInput}
        type="file"
        accept=".rob,text/plain"
        aria-label=".rob-Datei importieren"
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
            aria-label="Pläne durchsuchen"
            placeholder="Artikel, Auftrag oder Dateiname suchen"
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
          />
        </label>
        <label className="sort-field">
          <span className="sr-only">Sortieren</span>
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
            <option value="updatedAt:desc">Zuletzt geändert</option>
            <option value="createdAt:desc">Zuletzt erstellt</option>
            <option value="productNumber:asc">Artikel A–Z</option>
            <option value="projectNumber:asc">Auftrag A–Z</option>
            <option value="updatedAt:asc">Älteste zuerst</option>
          </select>
        </label>
      </div>
      <div className="library-body">
        <details
          className="library-filters"
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>Filter {filterCount ? `(${filterCount})` : ""}</summary>
          <div className="filter-content">
            {range("Paketlänge", "lengthMin", "lengthMax", "mm")}
            {range("Paketbreite", "widthMin", "widthMax", "mm")}
            {range("Pakethöhe", "heightMin", "heightMax", "mm")}
            {range("Lagen", "layersMin", "layersMax")}
            {range("Pakete je Lage", "boxesMin", "boxesMax")}
            <label>
              Palette
              <select
                value={filters.pallet}
                onChange={(e) => set("pallet", e.target.value)}
              >
                <option value="all">Alle Paletten</option>
                <option value="euro">Euro</option>
                <option value="industrial">Industrie</option>
                <option value="custom">Eigene</option>
              </select>
            </label>
            <label>
              Herkunft
              <select
                value={filters.source}
                onChange={(e) => set("source", e.target.value)}
              >
                <option value="all">Alle Pläne</option>
                <option value="new">Neu geplant</option>
                <option value="rob-import">.rob importiert</option>
              </select>
            </label>
            <details className="library-extra">
              <summary>Artikel und Auftrag</summary>
              <label>
                Artikel
                <input
                  value={p.productNumberFilter}
                  onChange={(e) =>
                    p.onProductNumberFilterChange(e.target.value)
                  }
                />
              </label>
              <label>
                Auftrag
                <input
                  value={p.projectNumberFilter}
                  onChange={(e) =>
                    p.onProjectNumberFilterChange(e.target.value)
                  }
                />
              </label>
            </details>
            <button className="text-action" onClick={reset}>
              Filter zurücksetzen
            </button>
          </div>
        </details>
        <div className="library-results">
          <p className="results-count" aria-live="polite">
            {p.loading
              ? "Pläne werden geladen …"
              : `${shown.length} ${shown.length === 1 ? "Plan" : "Pläne"}`}
          </p>
          {!p.loading && shown.length === 0 && (
            <div className="library-empty">
              <PlanRender />
              <h2>
                {p.projects.length || hasSearch
                  ? "Kein passender Plan"
                  : "Hier finden Ihre Pläne Platz"}
              </h2>
              <p>
                {p.projects.length || hasSearch
                  ? "Passen Sie die Filter an oder suchen Sie nach einem anderen Artikel."
                  : "Erstellen Sie einen Plan oder öffnen Sie eine vorhandene .rob-Datei."}
              </p>
              <button
                className="ui-btn"
                onClick={p.projects.length || hasSearch ? reset : p.onCreate}
              >
                {p.projects.length || hasSearch
                  ? "Alle Pläne anzeigen"
                  : "Neuen Plan erstellen"}
              </button>
            </div>
          )}
          <div role="list" aria-label="Gespeicherte Pläne">
            {shown.map(
              ({ project: pr, data, layerCount, total, perLayerLabel }) => {
                const d = pr.package.dimensionsMm;
                const title =
                  pr.productNumber || pr.projectNumber || "Unbenannter Plan";
                return (
                  <article key={pr.id} role="listitem" className="plan-row">
                    <button
                      className="plan-thumb"
                      onClick={() => p.onSelect(pr.id)}
                      aria-label={`${title} öffnen`}
                    >
                      <PlanRender
                        data={data}
                        emptyPackage={d}
                        palletSize={pr.pallet?.dimensionsMm}
                        title={`${title}, ${layerCount} Lagen`}
                      />
                    </button>
                    <div className="plan-row-content">
                      <div className="plan-row-title">
                        <button onClick={() => p.onSelect(pr.id)}>
                          <h2>{title}</h2>
                        </button>
                        <span className="plan-origin">
                          {pr.source.kind === "rob-import"
                            ? ".rob"
                            : layerCount
                              ? "Stapel"
                              : "Entwurf"}
                        </span>
                      </div>
                      <p className="plan-subtitle">
                        {pr.projectNumber || "Ohne Auftrag"}
                        {pr.source.kind === "rob-import"
                          ? ` · ${pr.source.fileName}`
                          : ""}
                      </p>
                      <dl className="plan-facts">
                        <div>
                          <dt>Paket · L × B × H</dt>
                          <dd>
                            {d.length} × {d.width} × {d.height}{" "}
                            <small>mm</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Lagen</dt>
                          <dd>{layerCount || "–"}</dd>
                        </div>
                        <div>
                          <dt>Pakete / Lage</dt>
                          <dd>{perLayerLabel}</dd>
                        </div>
                        <div>
                          <dt>Gesamt</dt>
                          <dd>{total || "–"}</dd>
                        </div>
                        <div>
                          <dt>Palette</dt>
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
                          {new Date(pr.updatedAt).toLocaleDateString("de-DE")}
                        </span>
                        <details className="plan-actions">
                          <summary>Weitere Aktionen</summary>
                          <div>
                            <button onClick={() => p.onEdit(pr.id)}>
                              Angaben bearbeiten
                            </button>
                            <button onClick={() => p.onDuplicate(pr.id)}>
                              Duplizieren
                            </button>
                            <button onClick={() => p.onSaveAs(pr.id)}>
                              Als Kopie speichern
                            </button>
                            <button onClick={() => p.onExportSelected(pr.id)}>
                              Projekt exportieren
                            </button>
                            {hasRobPlan(pr) && (
                              <button onClick={() => p.onDownloadRob(pr.id)}>
                                .rob herunterladen
                              </button>
                            )}
                            <button
                              className="text-danger"
                              onClick={() => setPendingDelete(pr.id)}
                            >
                              Löschen
                            </button>
                          </div>
                        </details>
                        <button
                          className="ui-btn"
                          onClick={() => p.onSelect(pr.id)}
                        >
                          Öffnen
                        </button>
                      </div>
                      {pendingDelete === pr.id && (
                        <div className="inline-confirm" role="alert">
                          <span>„{title}“ löschen?</span>
                          <button
                            className="ui-btn ui-btn-danger"
                            onClick={() => {
                              setPendingDelete(null);
                              p.onDelete(pr.id);
                            }}
                          >
                            Löschen
                          </button>
                          <button
                            className="ui-btn"
                            onClick={() => setPendingDelete(null)}
                          >
                            Abbrechen
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
        <summary>Projekte importieren und sichern</summary>
        <div className="button-row">
          <button className="ui-btn" onClick={p.onExportAll}>
            Alle Projekte exportieren
          </button>
          <button className="ui-btn" onClick={() => jsonInput.current?.click()}>
            Projektpaket importieren
          </button>
        </div>
        <div className="filter-content">
          <label>
            Bei gleichem Projekt
            <select
              value={p.projectConflictPolicy}
              onChange={(e) =>
                p.onProjectConflictPolicyChange(
                  e.target
                    .value as ProjectLibraryProps["projectConflictPolicy"],
                )
              }
            >
              <option value="rename">Import umbenennen</option>
              <option value="skip">Überspringen</option>
              <option value="overwrite">Ersetzen</option>
            </select>
          </label>
          <label>
            Bei gleichen Ressourcen
            <select
              value={p.resourceConflictPolicy}
              onChange={(e) =>
                p.onResourceConflictPolicyChange(
                  e.target
                    .value as ProjectLibraryProps["resourceConflictPolicy"],
                )
              }
            >
              <option value="rename">Import umbenennen</option>
              <option value="skip">Überspringen</option>
              <option value="overwrite">Ersetzen</option>
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
