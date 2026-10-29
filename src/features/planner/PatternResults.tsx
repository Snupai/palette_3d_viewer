"use client";
import { useMemo, useState } from "react";
import { useT, type Translate } from "~/i18n";
import { LayerPattern } from "~/components/LayerPattern";
import type { RectangleBoundsMm } from "~/domain/geometry";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import { candidateRankReason } from "~/features/candidates/candidateListModel";
import { solverCandidateToPatternPreview } from "~/lib/previewAdapters";

function reason(
  t: Translate,
  candidate: SolverCandidate,
  next: SolverCandidate | null,
) {
  return candidateRankReason(candidate, next, t);
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
  const t = useT();
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
        <dt>{t("planner.results.packagesPerLayer")}</dt>
        <dd>{c.metrics.packageCount}</dd>
      </div>
      <div>
        <dt>{t("planner.results.utilization")}</dt>
        <dd>{c.metrics.utilizationPercent.toFixed(1)} %</dd>
      </div>
      <div>
        <dt>{t("planner.results.provisionalCycles")}</dt>
        <dd>{c.metrics.provisionalCycleCount}</dd>
      </div>
      <div>
        <dt>{t("planner.results.blockSize")}</dt>
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
        <h2>{t("planner.results.noneTitle")}</h2>
        <p>{t("planner.results.noneText")}</p>
      </div>
    );
  return (
    <section
      className="pattern-results"
      aria-label={t("planner.results.label")}
    >
      {!selection && <p role="status">{t("planner.results.noneSelected")}</p>}
      {compare && selection ? (
        <div className="pattern-comparison">
          <header>
            <div>
              <p className="muted">{t("planner.results.directCompare")}</p>
              <h2>{t("planner.results.selectedVs", { rank: compare.rank })}</h2>
            </div>
            <button className="ui-btn" onClick={() => setCompareId(null)}>
              {t("planner.results.closeCompare")}
            </button>
          </header>
          <div className="comparison-columns">
            {[selected, compare].map((c, i) => (
              <section key={c.id}>
                <h3>
                  {i === 0
                    ? t("planner.results.yourChoice")
                    : t("planner.results.alternative", { rank: c.rank })}
                </h3>
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
                    {t("planner.results.accept")}
                  </button>
                )}
              </section>
            ))}
          </div>
          <p className="pattern-reason">
            {reason(
              t,
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
                ? t("planner.results.recommendation")
                : t("planner.results.yourChoice")}
            </span>
            <span>
              {t("planner.results.patternOf", {
                rank: selected.rank,
                total: candidates.length,
              })}
            </span>
          </header>
          <div className="pattern-featured-body">
            {drawing(selected, true)}
            <div>
              <h2>
                {t("planner.results.packagesOnLayer", {
                  count: selected.metrics.packageCount,
                })}
              </h2>
              {metrics(selected)}
              <p className="pattern-reason">
                {reason(
                  t,
                  selected,
                  candidates[
                    candidates.findIndex((c) => c.id === selected.id) + 1
                  ] ?? null,
                ) ?? t("planner.results.fitsDefault")}
              </p>
              {!selection && (
                <button
                  className="ui-btn-primary"
                  onClick={() => onSelect(selected.id)}
                >
                  {t("planner.results.accept")}
                </button>
              )}
              {selected.id !== candidates[0]?.id && (
                <button
                  className="text-action"
                  onClick={() => onSelect(candidates[0]!.id)}
                >
                  {t("planner.results.viewRecommendation")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="pattern-filter">
        <h2>
          {t("planner.results.morePatterns")} <small>({shown.length})</small>
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
            {t("planner.results.all")}
          </button>
          <button
            className="ui-btn"
            aria-pressed={filter === "maximum"}
            onClick={() => {
              setFilter("maximum");
              setLimit(12);
            }}
          >
            {t("planner.results.onlyMaximum", { max: maximum })}
          </button>
          <label className="exact-filter">
            <span>{t("planner.results.exact")}</span>
            <input
              type="number"
              min="1"
              aria-label={t("planner.results.exactAria")}
              value={exact}
              onChange={(e) => {
                setExact(e.target.value);
                setFilter("exact");
                setLimit(12);
              }}
            />
            <span>{t("planner.results.packagesUnit")}</span>
          </label>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="fable-panel">
          <h3>{t("planner.results.noPatternWith", { exact })}</h3>
          <p>{t("planner.results.searchFoundOthers")}</p>
          <button
            className="text-action"
            onClick={() => {
              setFilter("all");
              setExact("");
            }}
          >
            {t("planner.results.showAll")}
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
                aria-label={t("planner.results.pickAria", {
                  rank: c.rank,
                  count: c.metrics.packageCount,
                })}
              >
                <div className="pattern-card-heading">
                  <h3>{t("planner.results.cardTitle", { rank: c.rank })}</h3>
                  <span>
                    {selectedId === c.id
                      ? t("planner.results.chosen")
                      : t("planner.results.cardPackages", {
                          count: c.metrics.packageCount,
                        })}
                  </span>
                </div>
                {drawing(c)}
                <div className="pattern-card-facts">
                  <span>
                    {t("planner.results.cardArea", {
                      percent: c.metrics.utilizationPercent.toFixed(1),
                    })}
                  </span>
                  <span>
                    {t("planner.results.cardCycles", {
                      count: c.metrics.provisionalCycleCount,
                    })}
                  </span>
                </div>
              </button>
              <footer>
                <span>
                  {c.id === selectedId
                    ? t("planner.results.currentPattern")
                    : !selection
                      ? t("planner.results.noSelectionYet")
                      : t("planner.results.cycleDelta", {
                          delta: `${c.metrics.provisionalCycleCount - selected.metrics.provisionalCycleCount > 0 ? "+" : ""}${c.metrics.provisionalCycleCount - selected.metrics.provisionalCycleCount}`,
                        })}
                </span>
                <button
                  className="text-action"
                  disabled={!selection || c.id === selectedId}
                  onClick={() => setCompareId(c.id)}
                >
                  {t("planner.results.compare")}
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
      {shown.length > limit && (
        <button className="ui-btn" onClick={() => setLimit((n) => n + 12)}>
          {t("planner.results.showMore", {
            count: Math.min(12, shown.length - limit),
          })}
        </button>
      )}
      <details className="ranking-note">
        <summary>{t("planner.results.rankingSummary")}</summary>
        <p>{t("planner.results.rankingNote")}</p>
      </details>
    </section>
  );
}
