"use client";
import { projectNeedsGeometryReview } from "~/features/planning-case/planningCaseModel";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import type { Project } from "~/domain/project/projectSchema";
import type { PalletData } from "~/domain/palletTypes";
import type {
  LayerSolverInput,
  SolverCandidate,
  SolverResult,
} from "~/domain/solver";
import {
  SolverControls,
  type GeneratorLaunchRequest,
  type GeneratorPackageInputs,
} from "~/features/candidates/SolverControls";
import { ValidationLedger } from "./PlanningCaseChrome";
import { PatternResults } from "~/features/planner/PatternResults";
import { PlanRender } from "~/features/planner/PlanRender";
import {
  stackLayerCount,
  type PatternComparison,
  type PlanningStage,
  type ValidationLedgerRow,
} from "./planningCaseModel";
const FinishedStack3D = dynamic(
  () => import("./FinishedStack3D").then((m) => m.FinishedStack3D),
  {
    ssr: false,
    loading: () => <div className="fable-panel">3D-Ansicht wird geladen …</div>,
  },
);
export type ProductionTool =
  | "candidate-browser"
  | "candidate-3d"
  | "stack"
  | "editor"
  | "robotics"
  | "simulation"
  | "report";
export type PlanningCaseWorkbenchProps = {
  project: Project | null;
  stackContent?: ReactNode;
  /** Downloads the saved plan's .rob file (shown once a stack is saved). */
  onDownloadRob?: () => void;
  loadingProject: boolean;
  error: string | null;
  statusMessage: string | null;
  activeStage: PlanningStage;
  onStageChange: (stage: PlanningStage) => void;
  onOpenProjects: () => void;
  onCreateProject: () => void;
  onEditProject: () => void;
  onOpenTool: (tool: ProductionTool) => void;
  onImportRob: (file: File) => void;
  solverResult: SolverResult | null;
  solverInput: LayerSolverInput | null;
  candidates: readonly SolverCandidate[];
  selectedCandidate: SolverCandidate | null;
  selectedCandidateId: string | null;
  generatorLaunchRequest?: GeneratorLaunchRequest | null;
  onGeneratorLaunchRequestConsumed?: (requestId: string) => void;
  onApplyGeneratorPackageInputs: (
    inputs: GeneratorPackageInputs,
  ) => Promise<Project>;
  onSolverResult: (
    projectId: string,
    result: SolverResult,
    input: LayerSolverInput,
  ) => void;
  onResetSolver: () => void;
  onCandidateChange: (candidateId: string) => void;
  currentPreview: LayerPatternPreview | null;
  comparison: PatternComparison;
  ledgerRows: ValidationLedgerRow[];
  currentPalletData: PalletData | null;
  /** The project's saved stack, independent of the current candidate preview. */
  savedPalletData?: PalletData | null;
  currentLayerIndex: number;
  onCurrentLayerChange: (index: number) => void;
  hasUnsavedChanges: boolean;
  robotCycleCount?: number;
};

export function PlanningCaseWorkbench(p: PlanningCaseWorkbenchProps) {
  const { project, activeStage: stage } = p;
  const imported =
    project?.source.kind === "rob-import" &&
    !projectNeedsGeometryReview(project);
  const stackSaved =
    project !== null &&
    !projectNeedsGeometryReview(project) &&
    stackLayerCount(project) > 0;
  const d = project?.package.dimensionsMm;
  const physicalBounds = project?.pallet
    ? {
        minX: 0,
        minY: 0,
        maxX: project.pallet.dimensionsMm.length,
        maxY: project.pallet.dimensionsMm.width,
      }
    : undefined;
  const selected = p.selectedCandidate;
  // "Gespeicherten Plan ansehen" shows the saved stack even while a new
  // candidate is selected; "Stapel aufbauen" returns to the composer.
  const [savedView, setSavedView] = useState(false);
  const composerVisible =
    stage === "stack" &&
    Boolean(p.stackContent) &&
    (!stackSaved || selected !== null) &&
    !savedView;
  const savedPalletData = p.savedPalletData ?? p.currentPalletData;
  const preview = (
    <aside className="fable-stage">
      <h3>{stage === "generate" ? "Ihre Lage" : "Paket & Palette"}</h3>
      <PlanRender
        data={stage === "generate" ? p.currentPalletData : null}
        emptyPackage={d}
        palletSize={project?.pallet?.dimensionsMm}
        title="Vorschau des aktuellen Plans"
      />
      <dl className="workflow-metrics">
        <div>
          <dt>{selected ? "Pakete / Lage" : "Länge"}</dt>
          <dd>
            {selected?.metrics.packageCount ?? d?.length ?? "–"}
            {!selected && <small> mm</small>}
          </dd>
        </div>
        <div>
          <dt>{selected ? "Fläche" : "Breite"}</dt>
          <dd>
            {selected
              ? selected.metrics.utilizationPercent.toFixed(1)
              : (d?.width ?? "–")}
            <small>{selected ? " %" : " mm"}</small>
          </dd>
        </div>
        <div>
          <dt>{selected ? "Zyklen" : "Höhe"}</dt>
          <dd>
            {selected?.metrics.provisionalCycleCount ?? d?.height ?? "–"}
            {!selected && <small> mm</small>}
          </dd>
        </div>
      </dl>
    </aside>
  );
  if (p.loadingProject)
    return (
      <div className="fable-page" role="status">
        Plan wird geöffnet …
      </div>
    );
  return (
    <div
      className={`fable-page planning-case-grid ${stage === "generate" ? "is-generating" : ""}`}
    >
      {!imported && (
        <ol className="fable-steps" aria-label="Planungsschritte">
          {[
            ["inputs", "Paket & Palette"],
            ["generate", "Muster auswählen"],
            ["stack", stackSaved ? "Fertiger Plan" : "Stapel aufbauen"],
          ].map(([id, label], i) => (
            <li key={id} aria-current={stage === id ? "step" : undefined}>
              <span className="step-number">{i + 1}</span>
              <span className="step-name">{label}</span>
            </li>
          ))}
        </ol>
      )}
      {p.error && (
        <div role="alert" className="fable-notice">
          {p.error}
        </div>
      )}
      {project && !imported ? (
        <div hidden={stage !== "generate"}>
          <div className="fable-two-column">
            <div>
              <SolverControls
                guided
                project={project}
                initialPackageCount={
                  p.solverInput?.constraints?.maximumPackageCount ??
                  p.currentPalletData?.layers[0]?.boxes.length
                }
                launchRequest={p.generatorLaunchRequest}
                onLaunchRequestConsumed={p.onGeneratorLaunchRequestConsumed}
                onApplyPackageInputs={p.onApplyGeneratorPackageInputs}
                onResult={(result, input) =>
                  p.onSolverResult(project.id, result, input)
                }
                onReset={p.onResetSolver}
              />
              {p.solverInput && p.candidates.length > 0 && (
                <PatternResults
                  candidates={p.candidates}
                  input={p.solverInput}
                  physicalBounds={physicalBounds}
                  selectedId={p.selectedCandidateId}
                  onSelect={p.onCandidateChange}
                />
              )}
              <details className="ranking-note">
                <summary>Diagnosen und weitere Ansichten</summary>
                <div className="button-row">
                  <button
                    className="ui-btn"
                    disabled={!p.solverResult}
                    onClick={() => p.onOpenTool("candidate-browser")}
                  >
                    Suchdiagnosen
                  </button>
                  <button
                    className="ui-btn"
                    disabled={!selected}
                    onClick={() => p.onOpenTool("candidate-3d")}
                  >
                    Lage in 3D ansehen
                  </button>
                </div>
              </details>
            </div>
            {preview}
          </div>
          <div className="fable-actions generation-actions">
            <p>
              {selected
                ? `Muster ${selected.rank} wird die erste Lage Ihres Stapels.`
                : "Wählen Sie nach der Berechnung ein Muster aus."}
            </p>
            <div className="button-row">
              {stackSaved && (
                <button
                  className="ui-btn"
                  onClick={() => {
                    setSavedView(true);
                    p.onStageChange("stack");
                  }}
                >
                  Gespeicherten Plan ansehen
                </button>
              )}
              <button className="ui-btn" onClick={p.onEditProject}>
                Eingaben ändern
              </button>
              <button
                className="ui-btn-primary"
                disabled={!selected}
                onClick={() => {
                  setSavedView(false);
                  p.onStageChange("stack");
                }}
              >
                Stapel aufbauen
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {p.stackContent && <div hidden={!composerVisible}>{p.stackContent}</div>}
      {stage === "generate" || composerVisible ? null : (imported ||
          stage === "stack") &&
        savedPalletData ? (
        <>
          <div className="viewer-heading">
            <div>
              <h1>
                {[project?.productNumber, project?.projectNumber].find(
                  (value) => value?.trim(),
                ) ?? "Ihr Palettenplan"}
              </h1>
              <p>{imported ? "Importierter Plan" : "Stapel gespeichert"}</p>
            </div>
            <button className="ui-btn-primary" onClick={p.onDownloadRob}>
              .rob herunterladen
            </button>
          </div>
          <div className="fable-two-column">
            <div className="viewer-main">
              <FinishedStack3D
                data={savedPalletData}
                resetKey={`${project?.id}:${project?.updatedAt}`}
              />
              <p className="generator-hint">
                Paket anklicken, um nur die Lagen bis zu diesem Paket zu zeigen.
                Ziehen zum Drehen, Scrollen zum Zoomen.
              </p>
            </div>
            <aside className="fable-panel">
              <h2>Plan im Überblick</h2>
              <dl className="viewer-summary">
                <div>
                  <dt>Paket L × B × H</dt>
                  <dd>
                    {d?.length} × {d?.width} × {d?.height} mm
                  </dd>
                </div>
                <div>
                  <dt>Palette</dt>
                  <dd>
                    {project?.pallet?.dimensionsMm.length} ×{" "}
                    {project?.pallet?.dimensionsMm.width} mm
                  </dd>
                </div>
                <div>
                  <dt>Lagen</dt>
                  <dd>{savedPalletData.layer_count}</dd>
                </div>
                <div>
                  <dt>Pakete gesamt</dt>
                  <dd>{savedPalletData.total_boxes}</dd>
                </div>
                <div>
                  <dt>Pakete je Lage</dt>
                  <dd>
                    {[
                      ...new Set(
                        savedPalletData.layers.map((l) => l.boxes.length),
                      ),
                    ].join(" / ")}
                  </dd>
                </div>
                <div>
                  <dt>Herkunft</dt>
                  <dd>{imported ? ".rob-Datei" : "Planung"}</dd>
                </div>
              </dl>
              <div className="viewer-buttons">
                <button
                  className="ui-btn"
                  onClick={() => p.onOpenTool("editor")}
                >
                  Muster bearbeiten
                </button>
                <button
                  className="ui-btn"
                  onClick={() => p.onOpenTool("report")}
                >
                  Palettierblatt ansehen
                </button>
                {!imported && (
                  <button
                    className="ui-btn"
                    onClick={() => p.onStageChange("generate")}
                  >
                    Weitere Muster erzeugen
                  </button>
                )}
                <button className="text-action" onClick={p.onEditProject}>
                  Planangaben bearbeiten
                </button>
              </div>
            </aside>
          </div>
          <details className="ranking-note">
            <summary>Prüfungen und Originaldatei</summary>
            <ValidationLedger rows={p.ledgerRows} />
          </details>
        </>
      ) : (
        <div className="fable-two-column">
          <section className="fable-panel">
            <h1>{project ? "Paket & Palette" : "Neuer Palettenplan"}</h1>
            <p className="generator-hint">
              {project
                ? "Prüfen Sie die Angaben oder passen Sie sie an, bevor Sie Muster berechnen."
                : "Beginnen Sie mit Paketmaßen und Palette."}
            </p>
            {project && (
              <dl className="viewer-summary">
                <div>
                  <dt>Paket</dt>
                  <dd>
                    {d?.length} × {d?.width} × {d?.height} mm
                  </dd>
                </div>
                <div>
                  <dt>Palette</dt>
                  <dd>{project.pallet?.name}</dd>
                </div>
              </dl>
            )}
            <div className="fable-actions">
              <button
                className="ui-btn"
                onClick={project ? p.onEditProject : p.onCreateProject}
              >
                {project ? "Angaben bearbeiten" : "Neuen Plan erstellen"}
              </button>
              {project && (
                <button
                  className="ui-btn-primary"
                  onClick={() => p.onStageChange("generate")}
                >
                  Weiter zu den Mustern
                </button>
              )}
            </div>
          </section>
          {preview}
        </div>
      )}
      {p.statusMessage && (
        <p className="fable-status" role="status">
          {p.statusMessage}
        </p>
      )}
    </div>
  );
}
