"use client";
import { projectNeedsGeometryReview } from "~/features/planning-case/planningCaseModel";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { useT } from "~/i18n";
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
function StackLoading() {
  const t = useT();
  return <div className="fable-panel">{t("planningCase.loading3d")}</div>;
}
const FinishedStack3D = dynamic(
  () => import("./FinishedStack3D").then((m) => m.FinishedStack3D),
  {
    ssr: false,
    loading: () => <StackLoading />,
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
    appended?: boolean,
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
  const t = useT();
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
      <h3>
        {stage === "generate"
          ? t("planningCase.yourLayer")
          : t("planningCase.packageAndPallet")}
      </h3>
      <PlanRender
        data={stage === "generate" ? p.currentPalletData : null}
        emptyPackage={d}
        palletSize={project?.pallet?.dimensionsMm}
        title={t("planningCase.previewTitle")}
      />
      <dl className="workflow-metrics">
        <div>
          <dt>
            {selected
              ? t("planningCase.packagesPerLayerShort")
              : t("planningCase.length")}
          </dt>
          <dd>
            {selected?.metrics.packageCount ?? d?.length ?? "–"}
            {!selected && <small> mm</small>}
          </dd>
        </div>
        <div>
          <dt>{selected ? t("planningCase.area") : t("planningCase.width")}</dt>
          <dd>
            {selected
              ? selected.metrics.utilizationPercent.toFixed(1)
              : (d?.width ?? "–")}
            <small>{selected ? " %" : " mm"}</small>
          </dd>
        </div>
        <div>
          <dt>
            {selected ? t("planningCase.cycles") : t("planningCase.height")}
          </dt>
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
        {t("planningCase.opening")}
      </div>
    );
  return (
    <div
      className={`fable-page planning-case-grid ${stage === "generate" ? "is-generating" : ""}`}
    >
      {!imported && (
        <ol className="fable-steps" aria-label={t("planningCase.stepsLabel")}>
          {[
            ["inputs", t("planningCase.packageAndPallet")],
            ["generate", t("planningCase.stepSelectPattern")],
            [
              "stack",
              stackSaved
                ? t("planningCase.stepFinishedPlan")
                : t("planningCase.buildStack"),
            ],
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
                onResult={(result, input, appended) =>
                  p.onSolverResult(project.id, result, input, appended)
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
                <summary>{t("planningCase.diagnosticsSummary")}</summary>
                <div className="button-row">
                  <button
                    className="ui-btn"
                    disabled={!p.solverResult}
                    onClick={() => p.onOpenTool("candidate-browser")}
                  >
                    {t("planningCase.searchDiagnostics")}
                  </button>
                  <button
                    className="ui-btn"
                    disabled={!selected}
                    onClick={() => p.onOpenTool("candidate-3d")}
                  >
                    {t("planningCase.viewLayer3d")}
                  </button>
                </div>
              </details>
            </div>
            {preview}
          </div>
          <div className="fable-actions generation-actions">
            <div className="button-row">
              {stackSaved && (
                <button
                  className="ui-btn"
                  onClick={() => {
                    setSavedView(true);
                    p.onStageChange("stack");
                  }}
                >
                  {t("planningCase.viewSavedPlan")}
                </button>
              )}
              <button className="ui-btn" onClick={p.onEditProject}>
                {t("planningCase.changeInputs")}
              </button>
              <button
                className="ui-btn-primary"
                disabled={!selected}
                onClick={() => {
                  setSavedView(false);
                  p.onStageChange("stack");
                }}
              >
                {t("planningCase.buildStack")}
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
                ) ?? t("planningCase.yourPalletPlan")}
              </h1>
            </div>
            <button className="ui-btn-primary" onClick={p.onDownloadRob}>
              {t("planningCase.downloadRob")}
            </button>
          </div>
          <div className="fable-two-column">
            <div className="viewer-main">
              <FinishedStack3D
                data={savedPalletData}
                resetKey={`${project?.id}:${project?.updatedAt}`}
              />
            </div>
            <aside className="fable-panel">
              <h2>{t("planningCase.overview")}</h2>
              <dl className="viewer-summary">
                <div>
                  <dt>{t("planningCase.packageLwh")}</dt>
                  <dd>
                    {d?.length} × {d?.width} × {d?.height} mm
                  </dd>
                </div>
                <div>
                  <dt>{t("planningCase.pallet")}</dt>
                  <dd>
                    {project?.pallet?.dimensionsMm.length} ×{" "}
                    {project?.pallet?.dimensionsMm.width} mm
                  </dd>
                </div>
                <div>
                  <dt>{t("planningCase.layers")}</dt>
                  <dd>{savedPalletData.layer_count}</dd>
                </div>
                <div>
                  <dt>{t("planningCase.packagesTotal")}</dt>
                  <dd>{savedPalletData.total_boxes}</dd>
                </div>
                <div>
                  <dt>{t("planningCase.packagesPerLayer")}</dt>
                  <dd>
                    {[
                      ...new Set(
                        savedPalletData.layers.map((l) => l.boxes.length),
                      ),
                    ].join(" / ")}
                  </dd>
                </div>
                <div>
                  <dt>{t("planningCase.origin")}</dt>
                  <dd>
                    {imported
                      ? t("planningCase.robFile")
                      : t("planningCase.planning")}
                  </dd>
                </div>
              </dl>
              <div className="viewer-buttons">
                <button
                  className="ui-btn"
                  onClick={() => p.onOpenTool("editor")}
                >
                  {t("planningCase.editPattern")}
                </button>
                <button
                  className="ui-btn"
                  onClick={() => p.onOpenTool("report")}
                >
                  {t("planningCase.viewPalletSheet")}
                </button>
                {!imported && (
                  <button
                    className="ui-btn"
                    onClick={() => p.onStageChange("generate")}
                  >
                    {t("planningCase.morePatterns")}
                  </button>
                )}
                <button className="text-action" onClick={p.onEditProject}>
                  {t("planningCase.editPlanData")}
                </button>
              </div>
            </aside>
          </div>
          <details className="ranking-note">
            <summary>{t("planningCase.checksSummary")}</summary>
            <ValidationLedger rows={p.ledgerRows} />
          </details>
        </>
      ) : (
        <div className="fable-two-column">
          <section className="fable-panel">
            <h1>
              {project
                ? t("planningCase.packageAndPallet")
                : t("planningCase.newPalletPlan")}
            </h1>
            {project && (
              <dl className="viewer-summary">
                <div>
                  <dt>{t("planningCase.package")}</dt>
                  <dd>
                    {d?.length} × {d?.width} × {d?.height} mm
                  </dd>
                </div>
                <div>
                  <dt>{t("planningCase.pallet")}</dt>
                  <dd>{project.pallet?.name}</dd>
                </div>
              </dl>
            )}
            <div className="fable-actions">
              <button
                className="ui-btn"
                onClick={project ? p.onEditProject : p.onCreateProject}
              >
                {project
                  ? t("planningCase.editDetails")
                  : t("planningCase.createNewPlan")}
              </button>
              {project && (
                <button
                  className="ui-btn-primary"
                  onClick={() => p.onStageChange("generate")}
                >
                  {t("planningCase.continueToPatterns")}
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
