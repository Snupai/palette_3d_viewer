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
  type GeneratorPackageInputs,
} from "~/features/candidates/SolverControls";
import {
  LayerStrips,
  PlanningCandidateIndex,
  PlanningWorkflowNav,
  ValidationLedger,
} from "~/features/planning-case/PlanningCaseChrome";
import {
  MeasuredPlanField,
  type PlanFieldMode,
} from "~/features/planning-case/MeasuredPlanField";
import type {
  PatternComparison,
  PlanningStage,
  ValidationLedgerRow,
} from "~/features/planning-case/planningCaseModel";

export type ProductionTool =
  | "candidate-browser"
  | "candidate-3d"
  | "stack"
  | "editor"
  | "robotics"
  | "simulation"
  | "report"
  | "mpb-inspector"
  | "legacy-rob";

function stageLabel(stage: PlanningStage): string {
  switch (stage) {
    case "inputs":
      return "Define the physical case";
    case "reference":
      return "Attach observed evidence";
    case "generate":
      return "Generate deterministic patterns";
    case "compare":
      return "Inspect physical footprint parity";
    case "stack":
      return "Compose the pallet sequence";
    case "validate":
      return "Resolve blocked production claims";
  }
}

const panelButton =
  "min-h-8 border border-[var(--steel-rule)] px-2.5 py-1.5 text-left text-[11px] font-medium text-[#B7C0C6] outline-none hover:bg-[#1A2024] hover:text-[var(--chalk-text)] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] disabled:cursor-not-allowed disabled:text-[#59636A] disabled:hover:bg-transparent";
const primaryButton =
  "min-h-8 border border-[var(--selection-amber)] bg-[rgba(214,166,74,0.12)] px-2.5 py-1.5 text-left text-[11px] font-semibold text-[var(--selection-amber)] outline-none hover:bg-[rgba(214,166,74,0.2)] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)]";

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--steel-rule)]/70 py-1.5 last:border-b-0">
      <dt className="text-[10px] text-[var(--muted-text)]">{label}</dt>
      <dd className="font-mono text-[10px] text-[#C5CDD2]">{value}</dd>
    </div>
  );
}

function ToolButton({
  label,
  detail,
  onClick,
  disabled = false,
}: {
  label: string;
  detail: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`${panelButton} grid gap-0.5`}
    >
      <span>{label}</span>
      <span className="text-[9px] leading-4 font-normal text-[var(--muted-text)]">
        {detail}
      </span>
    </button>
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
  referenceFileName: string | null;
  referenceData: PalletData | null;
  onAttachReference: (file: File) => void;
  onDetachReference: () => void;
  onApplyReferenceInputs: () => void;
  referenceInputsMatch: boolean;
  referenceInputDetail: string;
  solverResult: SolverResult | null;
  solverInput: LayerSolverInput | null;
  selectedCandidate: SolverCandidate | null;
  selectedCandidateId: string | null;
  onApplyGeneratorPackageInputs: (
    inputs: GeneratorPackageInputs,
  ) => Promise<Project>;
  onSolverResult: (result: SolverResult, input: LayerSolverInput) => void;
  onResetSolver: () => void;
  onCandidateChange: (candidateId: string) => void;
  referencePreview: LayerPatternPreview | null;
  currentPreview: LayerPatternPreview | null;
  comparison: PatternComparison;
  ledgerRows: ValidationLedgerRow[];
  planFieldMode: PlanFieldMode;
  onPlanFieldModeChange: (mode: PlanFieldMode) => void;
  currentPalletData: PalletData | null;
  referenceLayerIndex: number;
  currentLayerIndex: number;
  onReferenceLayerChange: (index: number) => void;
  onCurrentLayerChange: (index: number) => void;
  hasUnsavedChanges: boolean;
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
  referenceFileName,
  referenceData,
  onAttachReference,
  onDetachReference,
  onApplyReferenceInputs,
  referenceInputsMatch,
  referenceInputDetail,
  solverResult,
  solverInput,
  selectedCandidate,
  selectedCandidateId,
  onApplyGeneratorPackageInputs,
  onSolverResult,
  onResetSolver,
  onCandidateChange,
  referencePreview,
  currentPreview,
  comparison,
  ledgerRows,
  planFieldMode,
  onPlanFieldModeChange,
  currentPalletData,
  referenceLayerIndex,
  currentLayerIndex,
  onReferenceLayerChange,
  onCurrentLayerChange,
  hasUnsavedChanges,
}: PlanningCaseWorkbenchProps) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const changeReference = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onAttachReference(file);
  };
  const packageDimensions = project?.package.dimensionsMm;
  const palletDimensions = project?.pallet?.dimensionsMm;
  const candidateCount = solverResult?.candidates.length ?? 0;

  let context: ReactNode;
  switch (activeStage) {
    case "inputs":
      context = (
        <div className="grid gap-3">
          <section className="border border-[var(--steel-rule)] p-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
              Current project inputs
            </h3>
            {project && packageDimensions ? (
              <dl className="mt-2">
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
                    project.package.multiPickAllowed ? "allowed" : "disabled"
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
            ) : (
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted-text)]">
                Create or select a project before generating a current plan.
              </p>
            )}
          </section>
          <button
            type="button"
            onClick={project ? onEditProject : onCreateProject}
            className={primaryButton}
          >
            {project ? "Edit encoded inputs" : "Create manual project"}
          </button>
          <button
            type="button"
            onClick={onOpenProjects}
            className={panelButton}
          >
            Open project drawer
          </button>
          <p className="text-[10px] leading-4 text-[#758087]">
            Clearance, overhang, multipick eligibility, weight, robot resources,
            and station assumptions are project policies. A reference `.rob`
            does not prove them.
          </p>
        </div>
      );
      break;
    case "reference":
      context = (
        <div className="grid gap-3">
          <input
            ref={referenceInputRef}
            type="file"
            accept=".rob,text/plain"
            onChange={changeReference}
            className="hidden"
          />
          <section className="border border-[var(--steel-rule)] p-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
              Session reference
            </h3>
            {referenceData ? (
              <dl className="mt-2">
                <MetricRow label="File" value={referenceFileName ?? ".rob"} />
                <MetricRow
                  label="Package W × L × H"
                  value={`${referenceData.package.width} × ${referenceData.package.length} × ${referenceData.package.height} mm`}
                />
                <MetricRow
                  label="Pallet W × L × H"
                  value={
                    referenceData.pallet
                      ? `${referenceData.pallet.width} × ${referenceData.pallet.length} × ${referenceData.pallet.height} mm`
                      : "Unknown"
                  }
                />
                <MetricRow
                  label="Physical layers"
                  value={referenceData.layer_count}
                />
                <MetricRow label="Packages" value={referenceData.total_boxes} />
                <MetricRow
                  label="Input direction"
                  value={
                    referenceData.inputDirectionExplicit
                      ? String(referenceData.inputDirection)
                      : "Not encoded"
                  }
                />
              </dl>
            ) : (
              <p className="mt-2 text-[11px] leading-5 text-[var(--muted-text)]">
                Attach a real plan as observed evidence. The raw file remains
                session-scoped and is not copied into the project repository.
              </p>
            )}
          </section>
          <button
            type="button"
            onClick={() => referenceInputRef.current?.click()}
            className={primaryButton}
          >
            {referenceData ? "Replace .rob reference" : "Attach .rob reference"}
          </button>
          {referenceData && project ? (
            <button
              type="button"
              onClick={onApplyReferenceInputs}
              disabled={referenceInputsMatch}
              className={panelButton}
            >
              {referenceInputsMatch
                ? "Encoded inputs already match"
                : "Apply encoded dimensions + inlet"}
            </button>
          ) : null}
          {referenceData ? (
            <button
              type="button"
              onClick={onDetachReference}
              className={panelButton}
            >
              Detach session reference
            </button>
          ) : null}
          <p className="font-mono text-[9px] leading-4 whitespace-pre-wrap text-[#758087]">
            {referenceInputDetail}
          </p>
        </div>
      );
      break;
    case "generate":
      context = project ? (
        <div className="grid min-h-0 gap-3">
          <SolverControls
            project={project}
            onApplyPackageInputs={onApplyGeneratorPackageInputs}
            onResult={onSolverResult}
            onReset={onResetSolver}
          />
          <PlanningCandidateIndex
            candidates={solverResult?.candidates ?? []}
            selectedCandidateId={selectedCandidateId}
            onSelect={onCandidateChange}
          />
          {solverResult?.diagnostics.length ? (
            <button
              type="button"
              onClick={() => onOpenTool("candidate-browser")}
              className={panelButton}
            >
              Open full diagnostics ({solverResult.diagnostics.length})
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-[11px] leading-5 text-[var(--muted-text)]">
            A current project is required before the deterministic solver can
            run.
          </p>
          <button
            type="button"
            onClick={onCreateProject}
            className={primaryButton}
          >
            Create manual project
          </button>
        </div>
      );
      break;
    case "compare":
      context = (
        <div className="grid gap-3">
          <section className="border border-[var(--steel-rule)] p-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
              Footprint result
            </h3>
            <dl className="mt-2">
              <MetricRow label="Status" value={comparison.status} />
              <MetricRow
                label="Reference packages"
                value={comparison.referenceCount}
              />
              <MetricRow
                label="Current packages"
                value={comparison.currentCount}
              />
              <MetricRow
                label="Missing / extra"
                value={`${comparison.missingCount} / ${comparison.extraCount}`}
              />
              <MetricRow
                label="Accepted symmetry"
                value={comparison.acceptedSymmetry ?? "None"}
              />
              <MetricRow
                label="Maximum axis delta"
                value={
                  comparison.maximumAxisDisplacementMm === null
                    ? "Unknown"
                    : `${comparison.maximumAxisDisplacementMm.toFixed(3)} mm`
                }
              />
            </dl>
          </section>
          <div className="grid grid-cols-2">
            {(["overlay", "split"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={planFieldMode === mode}
                onClick={() => onPlanFieldModeChange(mode)}
                className={`${panelButton} ${
                  planFieldMode === mode
                    ? "border-[var(--selection-amber)] text-[var(--selection-amber)]"
                    : ""
                }`}
              >
                {mode === "overlay" ? "Overlay" : "Split"}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-4 text-[#758087]">
            Exact matching checks physical package footprints across only
            pallet-envelope-preserving symmetries. The compatibility pass uses
            the legacy ±0.500001 mm tolerance.
          </p>
          <button
            type="button"
            disabled={!selectedCandidate}
            onClick={() => onOpenTool("candidate-3d")}
            className={panelButton}
          >
            Open selected candidate in 3D
          </button>
        </div>
      );
      break;
    case "stack":
      context = (
        <div className="grid gap-3">
          <section className="border border-[var(--steel-rule)] p-3">
            <h3 className="text-[10px] font-semibold tracking-[0.12em] text-[var(--chalk-text)] uppercase">
              Current sequence
            </h3>
            <dl className="mt-2">
              <MetricRow
                label="Visible current layers"
                value={currentPalletData?.layer_count ?? 0}
              />
              <MetricRow
                label="Visible current packages"
                value={currentPalletData?.total_boxes ?? 0}
              />
              <MetricRow label="Generated candidates" value={candidateCount} />
            </dl>
          </section>
          <button
            type="button"
            disabled={!project || !solverInput || candidateCount === 0}
            onClick={() => onOpenTool("stack")}
            className={primaryButton}
          >
            Open stack composer
          </button>
          <button
            type="button"
            disabled={!currentPalletData}
            onClick={() => onOpenTool("robotics")}
            className={panelButton}
          >
            Continue to robot materialization
          </button>
          <p className="text-[10px] leading-4 text-[#758087]">
            Reference and current layer strips remain visible below the plan
            field. Sequence visibility is evidence, not automatic stack parity.
          </p>
        </div>
      );
      break;
    case "validate":
      context = (
        <div className="grid gap-2">
          <p className="mb-1 text-[10px] leading-4 text-[#758087]">
            Open only the production surface needed to resolve a blocked claim.
            The inspection ledger remains claim-specific.
          </p>
          <ToolButton
            label="Pattern editor"
            detail="Edit placements, labels, groups, and flow."
            disabled={!project}
            onClick={() => onOpenTool("editor")}
          />
          <ToolButton
            label="Robotics"
            detail="Materialize cycles and validate resources."
            disabled={!project}
            onClick={() => onOpenTool("robotics")}
          />
          <ToolButton
            label="Simulation"
            detail="Inspect cycle timing and collisions."
            disabled={!project}
            onClick={() => onOpenTool("simulation")}
          />
          <ToolButton
            label="Report"
            detail="Review evidence and export readiness."
            disabled={!project}
            onClick={() => onOpenTool("report")}
          />
          <ToolButton
            label="Full candidate browser"
            detail="Filters, exclusions, provenance, and diagnostics."
            disabled={!solverInput || candidateCount === 0}
            onClick={() => onOpenTool("candidate-browser")}
          />
          <ToolButton
            label="Legacy .rob workspace"
            detail="Open the complete compatibility editor."
            onClick={() => onOpenTool("legacy-rob")}
          />
          <ToolButton
            label="Legacy .mpb inspector"
            detail="Inspect legacy MultiPack documents."
            onClick={() => onOpenTool("mpb-inspector")}
          />
        </div>
      );
      break;
  }

  return (
    <div className="planner-workspace-content grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] overflow-hidden bg-[var(--deck-black)] text-[var(--chalk-text)]">
      <header className="app-chrome grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--steel-rule)] bg-[var(--graphite-surface)] px-2 py-1.5 md:flex md:flex-nowrap md:gap-3 md:px-3 md:py-0">
        <button
          type="button"
          onClick={onOpenProjects}
          className="h-7 shrink-0 border border-[var(--steel-rule)] px-2.5 text-[10px] font-semibold tracking-[0.08em] whitespace-nowrap text-[#B7C0C6] uppercase hover:bg-[#1A2024] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:outline-none"
        >
          Projects
        </button>
        <div className="min-w-0 md:flex-1">
          <h1 className="truncate text-xs font-semibold text-[var(--chalk-text)]">
            {loadingProject
              ? "Reopening project…"
              : project
                ? project.projectNumber ||
                  project.productNumber ||
                  "Untitled project"
                : "Unassigned planning case"}
          </h1>
          <p className="truncate font-mono text-[9px] text-[var(--muted-text)]">
            {project && packageDimensions
              ? `${project.productNumber || "NO PRODUCT"} · PKG ${packageDimensions.length}×${packageDimensions.width}×${packageDimensions.height} · ${project.pallet?.name ?? "NO PALLET"}`
              : "Attach reference evidence or create a manual project"}
          </p>
        </div>
        <div className="hidden min-w-0 items-center gap-2 font-mono text-[9px] md:ml-auto md:flex">
          {hasUnsavedChanges ? (
            <span className="shrink-0 text-[var(--selection-amber)]">
              ● UNSAVED
            </span>
          ) : (
            <span className="shrink-0 text-[#68747C]">○ STORED</span>
          )}
          <span
            className={`truncate ${referenceData ? "text-[var(--measured-blue)]" : "text-[#68747C]"}`}
            title={referenceData ? (referenceFileName ?? undefined) : undefined}
          >
            {referenceData ? `O ${referenceFileName}` : "? NO REFERENCE"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenTool("editor")}
            disabled={!project}
            className="h-7 border border-[var(--steel-rule)] px-2.5 text-[10px] whitespace-nowrap text-[#B7C0C6] hover:bg-[#1A2024] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:outline-none disabled:text-[#59636A]"
          >
            Editor
          </button>
          <button
            type="button"
            onClick={() => onOpenTool("robotics")}
            disabled={!project}
            className="h-7 border border-[var(--steel-rule)] px-2.5 text-[10px] whitespace-nowrap text-[#B7C0C6] hover:bg-[#1A2024] focus-visible:ring-2 focus-visible:ring-[var(--selection-amber)] focus-visible:outline-none disabled:text-[#59636A]"
          >
            Production tools
          </button>
        </div>
      </header>

      <PlanningWorkflowNav activeStage={activeStage} onChange={onStageChange} />

      <div className="scrollbar-thin min-h-0 overflow-auto">
        <div className="planning-case-grid grid h-full min-h-0 min-w-[1040px] grid-cols-[minmax(240px,280px)_minmax(480px,1fr)_minmax(260px,300px)] grid-rows-[minmax(0,1fr)] gap-2 p-2">
          <aside className="app-chrome grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--steel-rule)] bg-[var(--graphite-surface)]">
            <header className="border-b border-[var(--steel-rule)] px-3 py-2">
              <p className="font-mono text-[9px] text-[var(--selection-amber)]">
                {activeStage.toUpperCase()}
              </p>
              <h2 className="text-xs font-semibold text-[var(--chalk-text)]">
                {stageLabel(activeStage)}
              </h2>
            </header>
            <div className="scrollbar-thin min-h-0 overflow-auto p-3">
              {context}
            </div>
          </aside>

          <MeasuredPlanField
            reference={referencePreview}
            current={currentPreview}
            comparison={comparison}
            mode={planFieldMode}
            referenceLabel={referenceFileName ?? "Reference"}
            currentLabel={
              selectedCandidate
                ? `Candidate ${selectedCandidate.rank}`
                : "Saved current"
            }
          />

          <ValidationLedger rows={ledgerRows} />
        </div>
      </div>

      <div className="px-2 pb-2">
        <LayerStrips
          reference={referenceData}
          current={currentPalletData}
          referenceLayerIndex={referenceLayerIndex}
          currentLayerIndex={currentLayerIndex}
          onReferenceLayerChange={onReferenceLayerChange}
          onCurrentLayerChange={onCurrentLayerChange}
        />
      </div>

      <footer className="app-chrome flex min-h-8 items-center gap-3 border-t border-[var(--steel-rule)] bg-[var(--graphite-surface)] px-3 font-mono text-[9px]">
        {error ? (
          <span
            role="alert"
            className="truncate text-[var(--inspection-fail)]"
            title={error}
          >
            FAIL · {error}
          </span>
        ) : statusMessage ? (
          <span
            role="status"
            className="truncate text-[#AEB7BD]"
            title={statusMessage}
          >
            {statusMessage}
          </span>
        ) : (
          <span className="text-[#68747C]">
            READY · claim statuses update from current evidence
          </span>
        )}
        <span className="ml-auto text-[#68747C]">
          {selectedCandidate
            ? `CURRENT CANDIDATE #${selectedCandidate.rank} · ${selectedCandidate.metrics.packageCount} PKGS`
            : currentPalletData
              ? `SAVED STACK · ${currentPalletData.layer_count} LAYERS`
              : "NO CURRENT GEOMETRY"}
        </span>
      </footer>
    </div>
  );
}
