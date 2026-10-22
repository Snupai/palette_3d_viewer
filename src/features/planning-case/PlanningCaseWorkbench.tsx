"use client";

import { useRef, type ChangeEvent, type ReactNode } from "react";
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
import {
  LayerStrips,
  PlanningCandidateIndex,
  ValidationLedger,
} from "~/features/planning-case/PlanningCaseChrome";
import dynamic from "next/dynamic";
import { MeasuredPlanField } from "~/features/planning-case/MeasuredPlanField";

// WebGL viewer: client only, loaded once the plan is finished.
const FinishedStack3D = dynamic(
  () =>
    import("~/features/planning-case/FinishedStack3D").then(
      (module) => module.FinishedStack3D,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="border-line bg-viewport text-viewport-ink grid h-full min-h-[420px] place-items-center border text-xs">
        Loading 3D view…
      </div>
    ),
  },
);
import {
  clampPlanningStage,
  productionToolGate,
  stackLayerCount,
  workflowStages,
  type PatternComparison,
  type PlanningStage,
  type ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";

export type ProductionTool =
  | "candidate-browser"
  | "candidate-3d"
  | "stack"
  | "editor"
  | "robotics"
  | "simulation"
  | "report"
  | "legacy-rob";

function isImportedRob(project: Project | null): boolean {
  return project?.source.kind === "rob-import";
}

function stageLabel(stage: PlanningStage, importedRob: boolean): string {
  switch (stage) {
    case "inputs":
      return importedRob ? "Imported .rob plan" : "Project inputs";
    case "generate":
      return "Generate patterns";
    case "stack":
      return "Compose the pallet sequence";
  }
}

/**
 * Read-only progress ruler: one segment per step, filled up to the current
 * one. Deliberately not clickable — steps are sequential (docs/DESIGN.md).
 */
function StageRuler({
  stages,
  currentIndex,
}: {
  stages: readonly (readonly [string, string])[];
  currentIndex: number;
}) {
  return (
    <ol
      aria-label="Planning steps"
      className="border-line grid border-b px-3 pt-2 pb-1.5"
      style={{
        gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`,
      }}
    >
      {stages.map(([id, label], index) => {
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? "current"
              : "next";
        return (
          <li
            key={id}
            aria-current={state === "current" ? "step" : undefined}
            className="min-w-0"
          >
            <span
              aria-hidden="true"
              className={`relative block h-1.5 border-l ${
                state === "next"
                  ? "border-line bg-transparent"
                  : "border-brand bg-brand"
              } ${state === "current" ? "opacity-100" : state === "done" ? "opacity-45" : ""}`}
            >
              <span className="border-line absolute inset-x-0 bottom-0 border-b" />
            </span>
            <span
              className={`text-micro mt-1 block truncate font-mono ${
                state === "current" ? "text-ink font-semibold" : "text-muted"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="border-line grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-1.5 last:border-b-0">
      <dt className="text-micro text-muted">{label}</dt>
      <dd className="text-micro text-ink font-mono">{value}</dd>
    </div>
  );
}

export type PlanningCaseWorkbenchProps = {
  project: Project | null;
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
  currentLayerIndex: number;
  onCurrentLayerChange: (index: number) => void;
  hasUnsavedChanges: boolean;
  robotCycleCount?: number;
};

export function PlanningCaseWorkbench({
  project,
  loadingProject,
  error,
  statusMessage,
  activeStage,
  onStageChange,
  onOpenProjects,
  onCreateProject,
  onEditProject,
  onOpenTool,
  onImportRob,
  solverResult,
  solverInput,
  candidates,
  selectedCandidate,
  selectedCandidateId,
  generatorLaunchRequest,
  onGeneratorLaunchRequestConsumed,
  onApplyGeneratorPackageInputs,
  onSolverResult,
  onResetSolver,
  onCandidateChange,
  currentPreview,
  comparison,
  ledgerRows,
  currentPalletData,
  currentLayerIndex,
  onCurrentLayerChange,
  hasUnsavedChanges,
  robotCycleCount = 0,
  onDownloadRob,
}: PlanningCaseWorkbenchProps) {
  const robInputRef = useRef<HTMLInputElement>(null);
  const importedRob = isImportedRob(project);
  const stages = workflowStages(importedRob);
  const resolvedStage = clampPlanningStage(activeStage, importedRob);
  const stageIndex = Math.max(
    0,
    stages.findIndex(([stage]) => stage === resolvedStage),
  );
  const nextStage = stages[stageIndex + 1]?.[0] ?? null;
  const previousStage = stages[stageIndex - 1]?.[0] ?? null;
  const packageDimensions = project?.package.dimensionsMm;
  const palletDimensions = project?.pallet?.dimensionsMm;
  const generatedCandidateCount = solverResult?.statistics.candidateCount ?? 0;
  const candidateLayoutCount = candidates.length;
  const stackSaved = project !== null && stackLayerCount(project) > 0;
  const sourceName =
    project?.source.kind === "rob-import" ? project.source.fileName : null;

  const canContinue = (() => {
    if (!nextStage) return false;
    if (resolvedStage === "inputs") return project !== null;
    return true;
  })();

  const importRob = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportRob(file);
  };

  let context: ReactNode;
  switch (resolvedStage) {
    case "inputs":
      context = (
        <div className="grid gap-3">
          <input
            ref={robInputRef}
            type="file"
            accept=".rob,text/plain"
            onChange={importRob}
            className="hidden"
          />
          {project ? (
            <>
              <section className="border-line border p-3">
                <h3 className="text-body text-ink font-semibold">
                  {importedRob ? "Imported plan" : "Current project"}
                </h3>
                {packageDimensions ? (
                  <dl className="mt-2">
                    {sourceName ? (
                      <MetricRow label="File" value={sourceName} />
                    ) : null}
                    <MetricRow
                      label="Package L × W × H"
                      value={`${packageDimensions.length} × ${packageDimensions.width} × ${packageDimensions.height} mm`}
                    />
                    <MetricRow
                      label="Clearance"
                      value={`${project.package.clearanceMm} mm`}
                    />
                    <MetricRow
                      label="Inlet"
                      value={project.package.inletOrientation}
                    />
                    <MetricRow
                      label="Multipick policy"
                      value={
                        project.package.multiPickAllowed
                          ? "allowed"
                          : "disabled"
                      }
                    />
                    <MetricRow
                      label="Pallet L × W × H"
                      value={
                        palletDimensions
                          ? `${palletDimensions.length} × ${palletDimensions.width} × ${palletDimensions.height} mm`
                          : "Unknown"
                      }
                    />
                  </dl>
                ) : null}
              </section>
              {importedRob ? null : (
                <button
                  type="button"
                  onClick={() => robInputRef.current?.click()}
                  className="ui-btn-primary"
                >
                  Open .rob
                </button>
              )}
              <button
                type="button"
                onClick={onEditProject}
                className={importedRob ? "ui-btn-primary" : "ui-btn"}
              >
                Edit project
              </button>
              <button type="button" onClick={onOpenProjects} className="ui-btn">
                Open project drawer
              </button>
              <button
                type="button"
                onClick={() => onOpenTool("legacy-rob")}
                className="ui-btn"
              >
                Legacy .rob workspace
              </button>
            </>
          ) : (
            <>
              <p className="text-body text-muted leading-5">
                Start a new pallet plan or open an existing .rob plan.
              </p>
              <button
                type="button"
                onClick={onCreateProject}
                className="ui-btn-primary"
              >
                Create pallet plan
              </button>
              <button
                type="button"
                onClick={() => robInputRef.current?.click()}
                className="ui-btn"
              >
                Open .rob file
              </button>
              <details className="border-line border-t pt-2">
                <summary className="text-micro text-muted cursor-pointer font-semibold">
                  More
                </summary>
                <div className="mt-2 grid gap-2">
                  <button
                    type="button"
                    onClick={onOpenProjects}
                    className="ui-btn"
                  >
                    Open project drawer
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenTool("legacy-rob")}
                    className="ui-btn"
                  >
                    Legacy .rob workspace
                  </button>
                </div>
              </details>
            </>
          )}
        </div>
      );
      break;
    case "generate":
      context = project ? (
        <div className="grid min-h-0 gap-3">
          <PlanningCandidateIndex
            candidates={candidates}
            selectedCandidateId={selectedCandidateId}
            onSelect={onCandidateChange}
          />
          <details
            className="border-line border"
            open={candidates.length === 0}
          >
            <summary className="text-micro text-muted cursor-pointer px-3 py-2 font-semibold">
              {candidates.length === 0
                ? "Layer solver"
                : "Adjust inputs & re-run"}
            </summary>
            <SolverControls
              project={project}
              launchRequest={generatorLaunchRequest}
              onLaunchRequestConsumed={onGeneratorLaunchRequestConsumed}
              onApplyPackageInputs={onApplyGeneratorPackageInputs}
              onResult={(result, input) =>
                onSolverResult(project.id, result, input)
              }
              onReset={onResetSolver}
            />
          </details>
          {solverResult?.diagnostics.length ? (
            <button
              type="button"
              onClick={() => onOpenTool("candidate-browser")}
              className="ui-btn"
            >
              Open full diagnostics ({solverResult.diagnostics.length})
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-body text-muted leading-5">
            A project is required before the solver can run.
          </p>
          <button
            type="button"
            onClick={onCreateProject}
            className="ui-btn-primary"
          >
            Create project
          </button>
        </div>
      );
      break;
    case "stack":
      context = (
        <div className="grid gap-3">
          {selectedCandidate ? (
            <section className="border-line border p-3">
              <h3 className="text-body text-ink font-semibold">
                Selected layout
              </h3>
              <dl className="mt-2">
                <MetricRow
                  label="Candidate"
                  value={`#${selectedCandidate.rank}`}
                />
                <MetricRow
                  label="Packages per layer"
                  value={selectedCandidate.metrics.packageCount}
                />
                <MetricRow
                  label="Cycles per layer"
                  value={selectedCandidate.metrics.provisionalCycleCount}
                />
                <MetricRow
                  label="Utilization"
                  value={`${selectedCandidate.metrics.utilizationPercent.toFixed(1)}%`}
                />
                <MetricRow
                  label="Block L × W"
                  value={`${selectedCandidate.metrics.boundingBlockLengthMm} × ${selectedCandidate.metrics.boundingBlockWidthMm} mm`}
                />
              </dl>
            </section>
          ) : null}
          <section className="border-line border p-3">
            <h3 className="text-body text-ink font-semibold">
              Current sequence
            </h3>
            <dl className="mt-2">
              <MetricRow
                label="Visible layers"
                value={currentPalletData?.layer_count ?? 0}
              />
              <MetricRow
                label="Visible packages"
                value={currentPalletData?.total_boxes ?? 0}
              />
              <MetricRow
                label="Generated candidates"
                value={generatedCandidateCount}
              />
              <MetricRow
                label="Selectable layouts"
                value={candidateLayoutCount}
              />
            </dl>
          </section>
          {stackSaved ? (
            <section
              aria-label="Plan finished"
              className="border-ok bg-surface grid gap-2 border border-l-4 p-3"
            >
              <h3 className="text-body text-ink flex items-center gap-1.5 font-semibold">
                <span aria-hidden="true" className="text-ok">
                  ■
                </span>
                Pallet plan finished
              </h3>
              <p className="text-micro text-muted leading-4">
                The stack is saved. Download the .rob plan for the robot.
              </p>
              <button
                type="button"
                onClick={onDownloadRob}
                disabled={!onDownloadRob}
                className="ui-btn-primary"
              >
                Download .rob
              </button>
            </section>
          ) : null}
          <button
            type="button"
            disabled={!project || !solverInput || candidateLayoutCount === 0}
            onClick={() => onOpenTool("stack")}
            className={stackSaved ? "ui-btn" : "ui-btn-primary"}
          >
            {stackSaved ? "Edit stack" : "Open stack composer"}
          </button>
        </div>
      );
      break;
  }

  return (
    <div className="planner-workspace-content bg-canvas text-ink flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="app-chrome border-line bg-surface grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b px-2 py-1.5 md:flex md:flex-nowrap md:gap-3 md:px-3 md:py-0">
        <button
          type="button"
          onClick={onOpenProjects}
          className="ui-btn ui-btn-sm shrink-0 whitespace-nowrap"
        >
          Projects
        </button>
        <div className="min-w-0 md:flex-1">
          <h1 className="text-body text-ink truncate font-semibold">
            {loadingProject
              ? "Reopening project…"
              : project
                ? project.productNumber ||
                  project.projectNumber ||
                  "Untitled project"
                : "No project selected"}
          </h1>
          <p className="text-micro text-muted truncate font-mono">
            {project && packageDimensions
              ? `${project.productNumber || "NO PRODUCT"} · PKG ${packageDimensions.length}×${packageDimensions.width}×${packageDimensions.height} · ${project.pallet?.name ?? "NO PALLET"}`
              : "Open a .rob file or create a project"}
          </p>
        </div>
        <div className="text-micro hidden min-w-0 items-center gap-2 font-mono md:ml-auto md:flex">
          {hasUnsavedChanges ? (
            <span className="text-brand shrink-0">Unsaved</span>
          ) : (
            <span className="text-muted shrink-0">
              {project
                ? `Saved locally · ${new Date(project.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Saved locally"}
            </span>
          )}
          {sourceName ? (
            <span className="text-measure truncate" title={sourceName}>
              {sourceName}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project ? (
            <>
              {/* Technical tools stay behind Advanced; normal users finish
                  with the saved stack and its .rob download. */}
              <details className="relative">
                <summary className="ui-btn ui-btn-sm flex list-none items-center gap-1 whitespace-nowrap [&::-webkit-details-marker]:hidden">
                  Advanced
                  <span aria-hidden="true" className="text-muted">
                    ▾
                  </span>
                </summary>
                <div className="border-line bg-surface absolute right-0 z-30 mt-1 grid w-56 gap-1 border p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
                  <p className="text-micro text-muted px-1.5 pb-1">
                    For technical users: robot setup, layer editing and motion
                    preview.
                  </p>
                  {(
                    [
                      ["editor", "Editor"],
                      ["robotics", "Robotics"],
                      ["simulation", "Simulation"],
                    ] as const
                  ).map(([tool, label]) => {
                    const gate = productionToolGate(
                      tool,
                      project,
                      robotCycleCount,
                    );
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => onOpenTool(tool)}
                        disabled={!gate.ready}
                        title={gate.ready ? undefined : gate.missing}
                        className="ui-btn ui-btn-sm ui-btn-ghost justify-start text-left disabled:opacity-50"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </details>
              <button
                type="button"
                onClick={() => onOpenTool("report")}
                className="ui-btn ui-btn-sm whitespace-nowrap"
              >
                Report
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <div className="planning-case-grid grid h-full min-h-0 min-w-[1090px] grid-cols-[minmax(290px,340px)_minmax(480px,1fr)_minmax(260px,300px)] grid-rows-[minmax(0,1fr)] gap-2 p-2">
          <aside className="app-chrome border-line bg-surface flex min-h-0 flex-col border">
            <header className="border-line flex items-center justify-between gap-2 border-b px-3 py-2">
              <h2 className="text-body text-ink font-semibold">
                {stageLabel(resolvedStage, importedRob)}
              </h2>
              {stages.length > 1 ? (
                <p className="text-muted font-mono text-xs">
                  {stageIndex + 1}/{stages.length}
                </p>
              ) : null}
            </header>
            {stages.length > 1 ? (
              <StageRuler stages={stages} currentIndex={stageIndex} />
            ) : null}
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
              {context}
            </div>
            {project && (previousStage || nextStage) ? (
              <div
                className={`border-line grid gap-2 border-t p-2 ${
                  previousStage && nextStage ? "grid-cols-2" : ""
                }`}
              >
                {previousStage ? (
                  <button
                    type="button"
                    onClick={() => onStageChange(previousStage)}
                    className="ui-btn"
                  >
                    Back
                  </button>
                ) : null}
                {nextStage ? (
                  <button
                    type="button"
                    disabled={!canContinue}
                    onClick={() => onStageChange(nextStage)}
                    className="ui-btn-primary"
                  >
                    Continue
                  </button>
                ) : null}
              </div>
            ) : null}
          </aside>

          {project ? (
            <>
              {resolvedStage === "stack" && stackSaved && currentPalletData ? (
                <FinishedStack3D
                  data={currentPalletData}
                  resetKey={`${project.id}:${project.updatedAt}`}
                />
              ) : (
                <MeasuredPlanField
                  reference={null}
                  current={currentPreview}
                  comparison={comparison}
                  mode="overlay"
                  currentLabel={
                    selectedCandidate
                      ? `Candidate ${selectedCandidate.rank}`
                      : importedRob
                        ? "Imported plan"
                        : "Current plan"
                  }
                />
              )}

              <ValidationLedger rows={ledgerRows} />
            </>
          ) : (
            <section className="border-line bg-surface col-span-2 grid min-h-0 place-items-center border">
              <p className="text-body text-muted max-w-sm text-center leading-5">
                Create a pallet plan or open a .rob file to see the plan field,
                layer strips, and inspection ledger.
              </p>
            </section>
          )}
        </div>
      </div>

      {project ? (
        <div className="px-2 pb-2">
          <LayerStrips
            reference={null}
            current={currentPalletData}
            referenceLayerIndex={0}
            currentLayerIndex={currentLayerIndex}
            onReferenceLayerChange={() => undefined}
            onCurrentLayerChange={onCurrentLayerChange}
          />
        </div>
      ) : null}

      <footer className="app-chrome border-line bg-surface text-micro flex min-h-8 items-center gap-3 border-t px-3 font-mono">
        {error ? (
          <span role="alert" className="text-danger truncate" title={error}>
            {error}
          </span>
        ) : statusMessage ? (
          <span
            role="status"
            className="text-muted truncate"
            title={statusMessage}
          >
            {statusMessage}
          </span>
        ) : (
          <span className="text-muted">Ready</span>
        )}
        <span className="text-muted ml-auto">
          {selectedCandidate
            ? `Candidate #${selectedCandidate.rank} · ${selectedCandidate.metrics.packageCount} pkgs`
            : currentPalletData
              ? `${currentPalletData.layer_count} layers`
              : "No geometry"}
        </span>
      </footer>
    </div>
  );
}
