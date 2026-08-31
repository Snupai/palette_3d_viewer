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
import { MeasuredPlanField } from "~/features/planning-case/MeasuredPlanField";
import {
  clampPlanningStage,
  productionToolGate,
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

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--line)] py-1.5 last:border-b-0">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className="font-mono text-[11px] text-[var(--ink)]">{value}</dd>
    </div>
  );
}

export type PlanningCaseWorkbenchProps = {
  project: Project | null;
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
  const roboticsGate = productionToolGate("robotics", project, robotCycleCount);
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
              <section className="border border-[var(--line)] p-3">
                <h3 className="text-[13px] font-semibold text-[var(--ink)]">
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
              <p className="text-[13px] leading-5 text-[var(--muted)]">
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
              <details className="border-t border-[var(--line)] pt-2">
                <summary className="cursor-pointer text-[11px] font-semibold text-[var(--muted)]">
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
            className="border border-[var(--line)]"
            open={candidates.length === 0}
          >
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-[var(--muted)]">
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
          <p className="text-[13px] leading-5 text-[var(--muted)]">
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
            <section className="border border-[var(--line)] p-3">
              <h3 className="text-[13px] font-semibold text-[var(--ink)]">
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
          <section className="border border-[var(--line)] p-3">
            <h3 className="text-[13px] font-semibold text-[var(--ink)]">
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
          <button
            type="button"
            disabled={!project || !solverInput || candidateLayoutCount === 0}
            onClick={() => onOpenTool("stack")}
            className="ui-btn-primary"
          >
            Open stack composer
          </button>
          <button
            type="button"
            disabled={!currentPalletData || !roboticsGate.ready}
            title={roboticsGate.ready ? undefined : roboticsGate.missing}
            onClick={() => onOpenTool("robotics")}
            className="ui-btn"
          >
            Continue to robot materialization
          </button>
        </div>
      );
      break;
  }

  return (
    <div className="planner-workspace-content grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <header className="app-chrome grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 md:flex md:flex-nowrap md:gap-3 md:px-3 md:py-0">
        <button
          type="button"
          onClick={onOpenProjects}
          className="ui-btn h-7 shrink-0 px-2.5 text-[12px] whitespace-nowrap"
        >
          Projects
        </button>
        <div className="min-w-0 md:flex-1">
          <h1 className="truncate text-[13px] font-semibold text-[var(--ink)]">
            {loadingProject
              ? "Reopening project…"
              : project
                ? project.productNumber ||
                  project.projectNumber ||
                  "Untitled project"
                : "No project selected"}
          </h1>
          <p className="truncate font-mono text-[11px] text-[var(--muted)]">
            {project && packageDimensions
              ? `${project.productNumber || "NO PRODUCT"} · PKG ${packageDimensions.length}×${packageDimensions.width}×${packageDimensions.height} · ${project.pallet?.name ?? "NO PALLET"}`
              : "Open a .rob file or create a project"}
          </p>
        </div>
        <div className="hidden min-w-0 items-center gap-2 font-mono text-[11px] md:ml-auto md:flex">
          {hasUnsavedChanges ? (
            <span className="shrink-0 text-[var(--brand)]">Unsaved</span>
          ) : (
            <span className="shrink-0 text-[var(--muted)]">
              {project
                ? `Saved locally · ${new Date(project.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Saved locally"}
            </span>
          )}
          {sourceName ? (
            <span className="truncate text-[var(--measure)]" title={sourceName}>
              {sourceName}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project
            ? (
                [
                  ["editor", "Editor"],
                  ["robotics", "Robotics"],
                  ["simulation", "Simulation"],
                  ["report", "Report"],
                ] as const
              ).map(([tool, label]) => {
                const gate = productionToolGate(tool, project, robotCycleCount);
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => onOpenTool(tool)}
                    disabled={!gate.ready}
                    title={gate.ready ? undefined : gate.missing}
                    className="ui-btn h-7 px-2.5 text-[12px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {label}
                  </button>
                );
              })
            : null}
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 overflow-auto">
        <div className="planning-case-grid grid h-full min-h-0 min-w-[1040px] grid-cols-[minmax(240px,280px)_minmax(480px,1fr)_minmax(260px,300px)] grid-rows-[minmax(0,1fr)] gap-2 p-2">
          <aside className="app-chrome grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border border-[var(--line)] bg-[var(--surface)]">
            <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
              <h2 className="text-[13px] font-semibold text-[var(--ink)]">
                {stageLabel(resolvedStage, importedRob)}
              </h2>
              {stages.length > 1 ? (
                <p className="font-mono text-[12px] text-[var(--muted)]">
                  {stageIndex + 1}/{stages.length}
                </p>
              ) : null}
            </header>
            <div className="scrollbar-thin min-h-0 overflow-auto p-3">
              {context}
            </div>
            {project && (previousStage || nextStage) ? (
              <div
                className={`grid gap-2 border-t border-[var(--line)] p-2 ${
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

              <ValidationLedger rows={ledgerRows} />
            </>
          ) : (
            <section className="col-span-2 grid min-h-0 place-items-center border border-[var(--line)] bg-[var(--surface)]">
              <p className="max-w-sm text-center text-[13px] leading-5 text-[var(--muted)]">
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

      <footer className="app-chrome flex min-h-8 items-center gap-3 border-t border-[var(--line)] bg-[var(--surface)] px-3 font-mono text-[11px]">
        {error ? (
          <span
            role="alert"
            className="truncate text-[var(--danger)]"
            title={error}
          >
            {error}
          </span>
        ) : statusMessage ? (
          <span
            role="status"
            className="truncate text-[var(--muted)]"
            title={statusMessage}
          >
            {statusMessage}
          </span>
        ) : (
          <span className="text-[var(--muted)]">Ready</span>
        )}
        <span className="ml-auto text-[var(--muted)]">
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
