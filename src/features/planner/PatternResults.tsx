"use client";
import { useMemo, useState } from "react";
import { LayerPattern } from "~/components/LayerPattern";
import type { RectangleBoundsMm } from "~/domain/geometry";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import { candidateRankReason } from "~/features/candidates/candidateListModel";
import { solverCandidateToPatternPreview } from "~/lib/previewAdapters";

function reason(candidate: SolverCandidate, next: SolverCandidate | null) {
  const text = candidateRankReason(candidate, next);
  return text
    ?.replace("More packages per layer", "Mehr Pakete je Lage")
    .replace("Higher area utilization", "Höhere Flächennutzung")
    .replace("Fewer robot cycles", "Weniger vorläufige Roboterzyklen")
    .replace("Smaller bounding block", "Kleineres Blockmaß")
    .replace("Tighter bounding block perimeter", "Kleinerer Blockumfang")
    .replaceAll(" vs ", " gegenüber ")
    .replace(
      "Equivalent score — ranked ahead by the deterministic identity tie-break",
      "Gleiche Kennzahlen; die feste Geometrie-Reihenfolge entscheidet.",
    );
}
export function PatternResults({
  candidates,
  input,
  physicalBounds,
  selectedId,
  onSelect,
}: {
  candidates: readonly SolverCandidate[];
  input: LayerSolverInput;
  physicalBounds?: RectangleBoundsMm;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all"),
    [exact, setExact] = useState(""),
    [compareId, setCompareId] = useState<string | null>(null),
    [limit, setLimit] = useState(12);
  const selection = candidates.find((c) => c.id === selectedId);
  const selected = selection ?? candidates[0];
  const compare = candidates.find(
    (c) => c.id === compareId && c.id !== selected?.id,
  );
  const maximum = Math.max(0, ...candidates.map((c) => c.metrics.packageCount));
  const shown = useMemo(
    () =>
      candidates.filter((c) =>
        filter === "maximum"
          ? c.metrics.packageCount === maximum
          : filter === "exact" && exact.trim() !== ""
            ? c.metrics.packageCount === Number(exact)
            : true,
      ),
    [candidates, exact, filter, maximum],
  );
  const drawing = (c: SolverCandidate, large = false) => (
    <LayerPattern
      preview={solverCandidateToPatternPreview(c, input, {
        physicalPalletBoundsMm: physicalBounds,
      })}
      showGroupLabels={false}
      showGrid={false}
      className={large ? "pattern-large" : "pattern-small"}
    />
  );
  const metrics = (c: SolverCandidate) => (
    <dl className="pattern-metrics">
      <div>
        <dt>Pakete je Lage</dt>
        <dd>{c.metrics.packageCount}</dd>
      </div>
      <div>
        <dt>Flächennutzung</dt>
        <dd>{c.metrics.utilizationPercent.toFixed(1)} %</dd>
      </div>
      <div>
        <dt>Vorläufige Zyklen</dt>
        <dd>{c.metrics.provisionalCycleCount}</dd>
      </div>
      <div>
        <dt>Blockmaß</dt>
        <dd>
          {c.metrics.boundingBlockLengthMm} × {c.metrics.boundingBlockWidthMm}{" "}
          <small>mm</small>
        </dd>
      </div>
    </dl>
  );
  if (!selected)
    return (
      <div className="fable-panel">
        <h2>Kein passendes Muster gefunden</h2>
        <p>
          Ändern Sie die gewünschte Paketanzahl, die Maße oder den zulässigen
          Überstand und berechnen Sie erneut.
        </p>
      </div>
    );
  return (
    <section className="pattern-results" aria-label="Muster auswählen">
      {!selection && (
        <p role="status">
          Noch kein Muster ausgewählt. Bitte ein Muster übernehmen.
        </p>
      )}
      {compare && selection ? (
        <div className="pattern-comparison">
          <header>
            <div>
              <p className="muted">Direktvergleich</p>
              <h2>Gewählt gegen Muster {compare.rank}</h2>
            </div>
            <button className="ui-btn" onClick={() => setCompareId(null)}>
              Vergleich schließen
            </button>
          </header>
          <div className="comparison-columns">
            {[selected, compare].map((c, i) => (
              <section key={c.id}>
                <h3>{i === 0 ? "Ihre Auswahl" : `Alternative ${c.rank}`}</h3>
                {drawing(c, true)}
                {metrics(c)}
                {i === 1 && (
                  <button
                    className="ui-btn-primary"
                    onClick={() => {
                      onSelect(c.id);
                      setCompareId(null);
                    }}
                  >
                    Dieses Muster übernehmen
                  </button>
                )}
              </section>
            ))}
          </div>
          <p className="pattern-reason">
            {reason(
              selected.rank < compare.rank ? selected : compare,
              selected.rank < compare.rank ? compare : selected,
            )}
          </p>
        </div>
      ) : (
        <div className="pattern-featured">
          <header>
            <span className="selection-tag">
              {selected.id === candidates[0]?.id
                ? "Empfehlung"
                : "Ihre Auswahl"}
            </span>
            <span>
              Muster {selected.rank} von {candidates.length}
            </span>
          </header>
          <div className="pattern-featured-body">
            {drawing(selected, true)}
            <div>
              <h2>{selected.metrics.packageCount} Pakete auf einer Lage</h2>
              {metrics(selected)}
              <p className="pattern-reason">
                {reason(
                  selected,
                  candidates[
                    candidates.findIndex((c) => c.id === selected.id) + 1
                  ] ?? null,
                ) ?? "Dieses Muster passt zu den vorgegebenen Maßen."}
              </p>
              {!selection && (
                <button
                  className="ui-btn-primary"
                  onClick={() => onSelect(selected.id)}
                >
                  Dieses Muster übernehmen
                </button>
              )}
              {selected.id !== candidates[0]?.id && (
                <button
                  className="text-action"
                  onClick={() => onSelect(candidates[0]!.id)}
                >
                  Empfehlung ansehen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="pattern-filter">
        <h2>
          Weitere Muster <small>({shown.length})</small>
        </h2>
        <div className="button-row">
          <button
            className="ui-btn"
            aria-pressed={filter === "all"}
            onClick={() => {
              setFilter("all");
              setLimit(12);
            }}
          >
            Alle
          </button>
          <button
            className="ui-btn"
            aria-pressed={filter === "maximum"}
            onClick={() => {
              setFilter("maximum");
              setLimit(12);
            }}
          >
            Nur Maximum ({maximum})
          </button>
          <label className="exact-filter">
            <span>Genau</span>
            <input
              type="number"
              min="1"
              aria-label="Genau Pakete je Lage"
              value={exact}
              onChange={(e) => {
                setExact(e.target.value);
                setFilter("exact");
                setLimit(12);
              }}
            />
            <span>Pakete</span>
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="fable-panel">
          <h3>Kein Muster mit {exact} Paketen</h3>
          <p>Die Suche hat andere Belegungen gefunden.</p>
          <button
            className="text-action"
            onClick={() => {
              setFilter("all");
              setExact("");
            }}
          >
            Alle Muster anzeigen
          </button>
        </div>
      ) : (
        <div className="pattern-alternatives">
          {shown.slice(0, limit).map((c) => (
            <article
              key={c.id}
              className={`pattern-card ${selectedId === c.id ? "is-selected" : ""}`}
            >
              <button
                className="pattern-pick"
                onClick={() => onSelect(c.id)}
                aria-pressed={selectedId === c.id}
                aria-label={`Muster ${c.rank} mit ${c.metrics.packageCount} Paketen wählen`}
              >
                <div className="pattern-card-heading">
                  <h3>Muster {c.rank}</h3>
                  <span>
                    {selectedId === c.id
                      ? "✓ Gewählt"
                      : `${c.metrics.packageCount} Pakete`}
                  </span>
                </div>
                {drawing(c)}
                <div className="pattern-card-facts">
                  <span>
                    {c.metrics.utilizationPercent.toFixed(1)} % Fläche
                  </span>
                  <span>{c.metrics.provisionalCycleCount} Zyklen</span>
                </div>
              </button>
              <footer>
                <span>
                  {c.id === selectedId
                    ? "Aktuelles Muster"
                    : !selection
                      ? "Noch keine Auswahl"
                      : `${c.metrics.provisionalCycleCount - selected.metrics.provisionalCycleCount > 0 ? "+" : ""}${c.metrics.provisionalCycleCount - selected.metrics.provisionalCycleCount} Zyklen zur Auswahl`}
                </span>
                <button
                  className="text-action"
                  disabled={!selection || c.id === selectedId}
                  onClick={() => setCompareId(c.id)}
                >
                  Vergleichen
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {shown.length > limit && (
        <button className="ui-btn" onClick={() => setLimit((n) => n + 12)}>
          Weitere {Math.min(12, shown.length - limit)} Muster anzeigen
        </button>
      )}
      <details className="ranking-note">
        <summary>Wie entsteht die Empfehlung?</summary>
        <p>
          Die feste Rangfolge bevorzugt mehr Pakete, dann höhere Flächennutzung,
          weniger vorläufige Roboterzyklen und ein kleineres Blockmaß. Bei
          Gleichstand entscheidet die Geometrie-Kennung. Eine mechanische
          Stabilitätsprüfung ist damit nicht verbunden.
        </p>
      </details>
    </section>
  );
}
