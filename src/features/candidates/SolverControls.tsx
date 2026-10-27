"use client";

import { resolveAutomaticSuctionGroupLimit } from "~/domain/project/equipmentProfiles";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createEffectivePalletEnvelope,
  symmetricSideAllowance,
} from "~/domain/geometry";
import type { Project } from "~/domain/project/projectSchema";
import type { Side } from "~/domain/palletTypes";
import { useT, type Translate } from "~/i18n";
import {
  createLayerSolverInputFromProject,
  validateAndNormalizeSolverInput,
  type LayerSolverInput,
  type SolverProgress,
  type SolverResult,
} from "~/domain/solver";
import {
  PackageLabelFacePicker,
  type PackageInletOrientation,
} from "~/features/candidates/PackageLabelFacePicker";
import { selectDistinctCandidateLayouts } from "~/features/candidates/candidateListModel";
import {
  createLayerSolverClient,
  SolverRunCancelledError,
  type LayerSolverClient,
  type SolverRunHandle,
} from "~/workers/solverClient";

export type GeneratorPackageInputs = {
  dimensionsMm: Project["package"]["dimensionsMm"];
  inletOrientation: PackageInletOrientation;
  multiPickAllowed: boolean;
};

export type GeneratorLaunchRequest = {
  requestId: string;
  projectId: string;
  exactPackageCount: number;
};

export type SolverControlsProps = {
  project: Project;
  guided?: boolean;
  initialPackageCount?: number;
  launchRequest?: GeneratorLaunchRequest | null;
  onLaunchRequestConsumed?: (requestId: string) => void;
  onApplyPackageInputs: (inputs: GeneratorPackageInputs) => Promise<Project>;
  onResult: (result: SolverResult, input: LayerSolverInput) => void;
  onReset: () => void;
};

type RunStatus = "idle" | "running" | "completed" | "cancelled" | "rejected";

type SolverDraft = {
  packageLength: string;
  packageWidth: string;
  packageHeight: string;
  inletOrientation: PackageInletOrientation;
  multiPickAllowed: boolean;
  lengthAllowanceTotal: string;
  widthAllowanceTotal: string;
  packageCount: string;
  unrotatedPackageLabelSide: "" | Side;
  maxCandidatesPerGenerator: string;
  provisionalPackagesPerCycle: string;
  groupLimitEdited: boolean;
};

type PreparedSolverInput = {
  input: LayerSolverInput | null;
  validation: ReturnType<typeof validateAndNormalizeSolverInput> | null;
  packageInputs: GeneratorPackageInputs | null;
  error: string | null;
};

const inputClass = "ui-input min-w-0 font-mono text-micro";

function configuredLabelSide(project: Project): "" | Side {
  return project.package.labelSidesAtPickup.length === 1
    ? project.package.labelSidesAtPickup[0]!
    : "";
}

function solverProjectKey(project: Project): string {
  const selectedGripper =
    project.selectedGripperId === null
      ? null
      : (project.grippers.find(({ id }) => id === project.selectedGripperId) ??
        null);
  try {
    const input = createLayerSolverInputFromProject(project);
    return JSON.stringify([
      project.id,
      project.package.shape,
      project.package.clearanceMm,
      project.package.labelSidesAtPickup,
      input.physicalPalletBoundsMm,
      input.envelopeMm,
      input.constraints?.allowedRotations,
      selectedGripper?.id ?? null,
      selectedGripper?.maxPickupLengthMm ?? null,
    ]);
  } catch {
    return JSON.stringify([
      project.id,
      project.package.shape,
      project.package.clearanceMm,
      project.package.labelSidesAtPickup,
      project.pallet,
      selectedGripper,
    ]);
  }
}

function automaticGroupLimit(project: Project, draft?: SolverDraft): string {
  const selected =
    project.grippers.find((g) => g.id === project.selectedGripperId) ?? null;
  return String(
    resolveAutomaticSuctionGroupLimit(
      draft
        ? {
            dimensionsMm: {
              length: Number(draft.packageLength),
              width: Number(draft.packageWidth),
              height: Number(draft.packageHeight),
            },
            inletOrientation: draft.inletOrientation,
            multiPickAllowed: draft.multiPickAllowed,
          }
        : project.package,
      selected,
    ),
  );
}

function initialDraft(project: Project): SolverDraft {
  return {
    packageLength: String(project.package.dimensionsMm.length),
    packageWidth: String(project.package.dimensionsMm.width),
    packageHeight: String(project.package.dimensionsMm.height),
    inletOrientation: project.package.inletOrientation,
    multiPickAllowed: project.package.multiPickAllowed,
    lengthAllowanceTotal: String(
      2 * (project.pallet?.allowedOverhangMm.length ?? 0),
    ),
    widthAllowanceTotal: String(
      2 * (project.pallet?.allowedOverhangMm.width ?? 0),
    ),
    packageCount: "",
    unrotatedPackageLabelSide: configuredLabelSide(project),
    maxCandidatesPerGenerator: "500",
    provisionalPackagesPerCycle: automaticGroupLimit(project),
    groupLimitEdited: false,
  };
}

function finitePositive(t: Translate, value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(t("candidates.solver.error.positive", { label }));
  }
  return parsed;
}

function finiteNumber(t: Translate, value: string, label: string): number {
  if (value.trim() === "") {
    throw new Error(t("candidates.solver.error.required", { label }));
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(t("candidates.solver.error.finite", { label }));
  }
  return parsed;
}

function positiveInteger(t: Translate, value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(t("candidates.solver.error.integer", { label }));
  }
  return parsed;
}

function prepareSolverInput(
  t: Translate,
  project: Project,
  draft: SolverDraft,
  allowMixedPackageOrientations: boolean,
): PreparedSolverInput {
  try {
    const packageDimensionsMm = {
      length: finitePositive(
        t,
        draft.packageLength,
        t("candidates.solver.packageLength"),
      ),
      width: finitePositive(
        t,
        draft.packageWidth,
        t("candidates.solver.packageWidth"),
      ),
      height: finitePositive(
        t,
        draft.packageHeight,
        t("candidates.solver.packageHeight"),
      ),
    };
    const lengthAllowanceTotal = finiteNumber(
      t,
      draft.lengthAllowanceTotal,
      t("candidates.solver.lengthTotal"),
    );
    const widthAllowanceTotal = finiteNumber(
      t,
      draft.widthAllowanceTotal,
      t("candidates.solver.widthTotal"),
    );
    const rectangularBlockFootprintPolicy =
      lengthAllowanceTotal === 0 && widthAllowanceTotal === 0
        ? "compact-centered"
        : "fill-generation-bounds";
    const packageCount = positiveInteger(
      t,
      draft.packageCount,
      t("candidates.solver.packagesPerLayer"),
    );
    const maxCandidatesPerGenerator = positiveInteger(
      t,
      draft.maxCandidatesPerGenerator,
      t("candidates.solver.candidatesPerGenerator"),
    );
    const requestedAutomaticGroupLimit = draft.multiPickAllowed
      ? positiveInteger(
          t,
          draft.provisionalPackagesPerCycle,
          t("candidates.solver.automaticGroupLimit"),
        )
      : 1;
    const selectedGripper =
      project.selectedGripperId === null
        ? null
        : (project.grippers.find(
            ({ id }) => id === project.selectedGripperId,
          ) ?? null);
    const pickupPackageSpan =
      draft.inletOrientation === "lengthwise"
        ? packageDimensionsMm.length
        : packageDimensionsMm.width;
    const pickupLengthLimitedMaximum =
      selectedGripper?.maxPickupLengthMm === null ||
      selectedGripper?.maxPickupLengthMm === undefined
        ? requestedAutomaticGroupLimit
        : Math.max(
            1,
            Math.floor(selectedGripper.maxPickupLengthMm / pickupPackageSpan),
          );
    const provisionalPackagesPerCycle = draft.multiPickAllowed
      ? Math.min(requestedAutomaticGroupLimit, pickupLengthLimitedMaximum)
      : 1;
    const baseInput = createLayerSolverInputFromProject(project);
    if (!project.pallet) {
      throw new Error(t("candidates.solver.error.palletRequired"));
    }
    const generationBoundsMm = createEffectivePalletEnvelope(
      project.pallet.dimensionsMm,
      symmetricSideAllowance({
        length: lengthAllowanceTotal / 2,
        width: widthAllowanceTotal / 2,
      }),
    );
    const input: LayerSolverInput = {
      ...baseInput,
    // A positive allowance typed here authorizes that overhang for this run;
    // the saved pallet policy stays unchanged.
    const envelopeMm = {
      minX: Math.min(baseInput.envelopeMm.minX, generationBoundsMm.minX),
      minY: Math.min(baseInput.envelopeMm.minY, generationBoundsMm.minY),
      maxX: Math.max(baseInput.envelopeMm.maxX, generationBoundsMm.maxX),
      maxY: Math.max(baseInput.envelopeMm.maxY, generationBoundsMm.maxY),
    };
      package: {
        ...baseInput.package,
      envelopeMm,
        dimensionsMm: {
          length: packageDimensionsMm.length,
          width: packageDimensionsMm.width,
        },
      },
      generationBoundsMm,
      constraints: {
        ...baseInput.constraints,
        minimumPackageCount: packageCount,
        maximumPackageCount: packageCount,
        maxCandidatesPerGenerator,
        provisionalPackagesPerCycle,
        allowMixedPackageOrientations,
        unrotatedPackageLabelSide: draft.unrotatedPackageLabelSide || null,
        requiredShape: "any",
        rectangularBlockFootprintPolicy,
      },
    };
    return {
      input,
      validation: validateAndNormalizeSolverInput(input),
      packageInputs: {
        dimensionsMm: packageDimensionsMm,
        inletOrientation: draft.inletOrientation,
        multiPickAllowed: draft.multiPickAllowed,
      },
      error: null,
    };
  } catch (cause) {
    return {
      input: null,
      validation: null,
      packageInputs: null,
      error:
        cause instanceof Error
          ? cause.message
          : t("candidates.solver.error.prepare"),
    };
  }
}

function DimensionInput({
  label,
  value,
  disabled,
  signed = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  signed?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-muted grid min-w-0 gap-1 text-[10px]">
      {label}
      <input
        type="number"
        min={signed ? undefined : "0.001"}
        step="0.001"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function SolverProgressPanel({ progress }: { progress: SolverProgress }) {
  const t = useT();
  const percent =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : null;
  // Floats at the top centre of the window while a run is active, so it is
  // seen regardless of where the long controls column is scrolled.
  return createPortal(
    <div
      aria-live="polite"
      className="border-brand bg-surface text-ink fixed top-14 left-1/2 z-30 grid w-[min(440px,calc(100vw-32px))] -translate-x-1/2 gap-2 border border-l-4 px-4 py-3 shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold">
          {t("candidates.solver.progressTitle")}
        </span>
        <span className="text-body text-brand font-mono font-semibold">
          {percent === null ? progress.completed : `${percent}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("candidates.solver.progressAria")}
        aria-valuemin={0}
        aria-valuemax={progress.total ?? undefined}
        aria-valuenow={progress.total === null ? undefined : progress.completed}
        className="border-line bg-surface h-2.5 w-full overflow-hidden border"
      >
        <div
          className={`bg-brand h-full transition-[width] duration-200 ${
            percent === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="text-micro flex items-center justify-between gap-3">
        <span className="truncate">
          {progress.phase}
          {progress.generator ? ` · ${progress.generator}` : ""}
        </span>
        <span className="text-muted shrink-0 font-mono">
          {progress.completed}
          {progress.total === null ? "" : ` / ${progress.total}`}
        </span>
      </div>
      {progress.message ? (
        <span className="text-micro text-muted">{progress.message}</span>
      ) : null}
    </div>,
    document.body,
  );
}

export function SolverControls({
  project,
  guided = false,
  initialPackageCount,
  launchRequest = null,
  onLaunchRequestConsumed,
  onApplyPackageInputs,
  onResult,
  onReset,
}: SolverControlsProps) {
  const t = useT();
  const clientRef = useRef<LayerSolverClient | null>(null);
  const handleRef = useRef<SolverRunHandle | null>(null);
  const generationRef = useRef(0);
  const hasRunRef = useRef(false);
  const claimedLaunchRequestIdsRef = useRef(new Set<string>());
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const previousProjectIdRef = useRef(project.id);
  const previousPackageDimensionsRef = useRef(
    JSON.stringify(project.package.dimensionsMm),
  );
  const previousInletOrientationRef = useRef(project.package.inletOrientation);
  const previousMultiPickAllowedRef = useRef(project.package.multiPickAllowed);
  const previousLabelMetadataRef = useRef(
    JSON.stringify(project.package.labelSidesAtPickup),
  );
  const currentProjectKey = useMemo(() => solverProjectKey(project), [project]);
  const [draft, setDraft] = useState<SolverDraft>(() => ({
    ...initialDraft(project),
    packageCount: initialPackageCount ? String(initialPackageCount) : "",
  }));
  const [allowMixedPackageOrientations, setAllowMixedPackageOrientations] =
    useState(true);
  const [includeSymmetryVariants, setIncludeSymmetryVariants] = useState(true);
  const currentRunKey = useMemo(
    () =>
      JSON.stringify([
        currentProjectKey,
        draft,
        allowMixedPackageOrientations,
        includeSymmetryVariants,
      ]),
    [
      allowMixedPackageOrientations,
      currentProjectKey,
      draft,
      includeSymmetryVariants,
    ],
  );
  const runKeyRef = useRef(currentRunKey);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [showSearchSettings, setShowSearchSettings] = useState(false);
  const [progress, setProgress] = useState<SolverProgress | null>(null);
  const [resultSummary, setResultSummary] = useState<SolverResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [pendingLaunchRequest, setPendingLaunchRequest] =
    useState<GeneratorLaunchRequest | null>(null);

  useEffect(() => {
    const client = createLayerSolverClient();
    clientRef.current = client;
    return () => {
      generationRef.current += 1;
      handleRef.current = null;
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const projectChanged = previousProjectIdRef.current !== project.id;
    const packageDimensions = JSON.stringify(project.package.dimensionsMm);
    const packageDimensionsChanged =
      previousPackageDimensionsRef.current !== packageDimensions;
    const inletOrientationChanged =
      previousInletOrientationRef.current !== project.package.inletOrientation;
    const multiPickAllowedChanged =
      previousMultiPickAllowedRef.current !== project.package.multiPickAllowed;
    const labelMetadata = JSON.stringify(project.package.labelSidesAtPickup);
    const labelMetadataChanged =
      previousLabelMetadataRef.current !== labelMetadata;
    if (
      !projectChanged &&
      !packageDimensionsChanged &&
      !inletOrientationChanged &&
      !multiPickAllowedChanged &&
      !labelMetadataChanged
    ) {
      return;
    }

    previousProjectIdRef.current = project.id;
    previousPackageDimensionsRef.current = packageDimensions;
    previousInletOrientationRef.current = project.package.inletOrientation;
    previousMultiPickAllowedRef.current = project.package.multiPickAllowed;
    previousLabelMetadataRef.current = labelMetadata;
    if (projectChanged) {
      setDraft(initialDraft(project));
      setAllowMixedPackageOrientations(true);
      setIncludeSymmetryVariants(true);
      setPendingLaunchRequest(null);
      return;
    }
    setDraft((current) => {
      const next = {
        ...current,
        packageLength: packageDimensionsChanged
          ? String(project.package.dimensionsMm.length)
          : current.packageLength,
        packageWidth: packageDimensionsChanged
          ? String(project.package.dimensionsMm.width)
          : current.packageWidth,
        packageHeight: packageDimensionsChanged
          ? String(project.package.dimensionsMm.height)
          : current.packageHeight,
        inletOrientation: inletOrientationChanged
          ? project.package.inletOrientation
          : current.inletOrientation,
        multiPickAllowed: multiPickAllowedChanged
          ? project.package.multiPickAllowed
          : current.multiPickAllowed,
        groupLimitEdited: multiPickAllowedChanged
          ? false
          : current.groupLimitEdited,
        unrotatedPackageLabelSide: labelMetadataChanged
          ? configuredLabelSide(project)
          : current.unrotatedPackageLabelSide,
      };
      if (!next.groupLimitEdited)
        next.provisionalPackagesPerCycle = automaticGroupLimit(project, next);
      return next;
    });
  }, [project]);

  useEffect(() => {
    if (runKeyRef.current === currentRunKey) return;

    const hadRun = hasRunRef.current;
    generationRef.current += 1;
    handleRef.current?.cancel();
    handleRef.current = null;
    hasRunRef.current = false;
    runKeyRef.current = currentRunKey;
    setStatus("idle");
    setProgress(null);
    setResultSummary(null);
    setFailure(null);
    setStaleNotice((current) =>
      hadRun ? t("candidates.solver.stale") : current,
    );
    onReset();
  }, [currentRunKey, onReset, t]);

  const prepared = useMemo(
    () => prepareSolverInput(t, project, draft, allowMixedPackageOrientations),
    [allowMixedPackageOrientations, draft, project, t],
  );
  const distinctCandidateLayoutCount = useMemo(
    () =>
      resultSummary && prepared.input
        ? selectDistinctCandidateLayouts(
            resultSummary.candidates,
            prepared.input.package.dimensionsMm,
          ).length
        : 0,
    [prepared.input, resultSummary],
  );
  const preflightIssues = prepared.error
    ? [prepared.error]
    : (prepared.validation?.issues.map(({ message }) => message) ?? []);
  const canSolve =
    status !== "running" &&
    prepared.input !== null &&
    prepared.packageInputs !== null &&
    prepared.validation?.valid === true;
  const effectiveAutomaticGroupLimit =
    prepared.input?.constraints?.provisionalPackagesPerCycle ?? 1;

  const updateDraft = (update: Partial<SolverDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...update };
      if (update.provisionalPackagesPerCycle !== undefined)
        next.groupLimitEdited = true;
      if (update.multiPickAllowed !== undefined) next.groupLimitEdited = false;
      if (!next.groupLimitEdited)
        next.provisionalPackagesPerCycle = automaticGroupLimit(project, next);
      return next;
    });
  };

  const start = async () => {
    const client = clientRef.current;
    const initialInput = prepared.input;
    const packageInputs = prepared.packageInputs;
    if (
      !client ||
      !initialInput ||
      !packageInputs ||
      !prepared.validation?.valid
    ) {
      return;
    }

    generationRef.current += 1;
    hasRunRef.current = true;
    const generation = generationRef.current;
    const runKey = runKeyRef.current;
    setStatus("running");
    setProgress({
      phase: "input-validation",
      completed: 0,
      total: 1,
      message: t("candidates.solver.progress.applying"),
    });
    setResultSummary(null);
    setFailure(null);
    setStaleNotice(null);
    onReset();

    let appliedProject: Project;
    try {
      appliedProject = await onApplyPackageInputs(packageInputs);
    } catch (cause) {
      if (
        generationRef.current !== generation ||
        runKeyRef.current !== runKey
      ) {
        return;
      }
      setProgress(null);
      setStatus("rejected");
      setFailure(
        cause instanceof Error
          ? t("candidates.solver.error.applyFailed", { message: cause.message })
          : t("candidates.solver.error.applyFailedUnknown"),
      );
      return;
    }
    if (generationRef.current !== generation || runKeyRef.current !== runKey) {
      return;
    }

    const applied = prepareSolverInput(
      t,
      appliedProject,
      draft,
      allowMixedPackageOrientations,
    );
    const input = applied.input;
    if (!input || !applied.validation?.valid) {
      setProgress(null);
      setStatus("rejected");
      setFailure(
        applied.error ??
          applied.validation?.issues.map(({ message }) => message).join(" ") ??
          t("candidates.solver.error.appliedInvalid"),
      );
      return;
    }

    setProgress({
      phase: "input-validation",
      completed: 0,
      total: 1,
      message: t("candidates.solver.progress.starting"),
    });
    const handle = client.run(input, {
      includeSymmetryVariants,
      progressBatchSize: 25,
      onProgress: ({ runId, progress: nextProgress }) => {
        if (
          generationRef.current !== generation ||
          runKeyRef.current !== runKey ||
          handleRef.current?.runId !== runId
        ) {
          return;
        }
        setProgress(nextProgress);
      },
    });
    handleRef.current = handle;

    void handle.result
      .then((result) => {
        if (
          generationRef.current !== generation ||
          runKeyRef.current !== runKey ||
          handleRef.current?.runId !== handle.runId
        ) {
          return;
        }
        handleRef.current = null;
        setResultSummary(result);
        setProgress(null);
        setStatus(result.status === "cancelled" ? "cancelled" : "completed");
        onResult(result, input);
      })
      .catch((cause: unknown) => {
        if (
          generationRef.current !== generation ||
          runKeyRef.current !== runKey
        ) {
          return;
        }
        handleRef.current = null;
        setProgress(null);
        if (cause instanceof SolverRunCancelledError) {
          setStatus("cancelled");
          setFailure(t("candidates.solver.error.cancelled"));
          return;
        }
        console.error("Solver worker failed", cause);
        setStatus("rejected");
        setFailure(
          cause instanceof Error
            ? t("candidates.solver.error.failed", { message: cause.message })
            : t("candidates.solver.error.workerUnknown"),
        );
      });
  };

  useEffect(() => {
    startRef.current = start;
  });

  useEffect(() => {
    if (
      launchRequest?.projectId !== project.id ||
      claimedLaunchRequestIdsRef.current.has(launchRequest.requestId)
    ) {
      return;
    }

    claimedLaunchRequestIdsRef.current.add(launchRequest.requestId);
    setDraft((current) => ({
      ...current,
      packageCount: String(launchRequest.exactPackageCount),
    }));
    setPendingLaunchRequest(launchRequest);
  }, [launchRequest, project.id]);

  useEffect(() => {
    if (
      pendingLaunchRequest?.projectId !== project.id ||
      draft.packageCount !== String(pendingLaunchRequest.exactPackageCount) ||
      !canSolve
    ) {
      return;
    }

    setPendingLaunchRequest(null);
    onLaunchRequestConsumed?.(pendingLaunchRequest.requestId);
    void startRef.current();
  }, [
    canSolve,
    draft.packageCount,
    onLaunchRequestConsumed,
    pendingLaunchRequest,
    project.id,
  ]);

  const cancel = () => {
    if (status !== "running") return;
    generationRef.current += 1;
    handleRef.current?.cancel();
    handleRef.current = null;
    setProgress(null);
    setStatus("cancelled");
    setFailure(t("candidates.solver.error.cancelled"));
  };

  const inputsDisabled = status === "running";

  if (guided)
    return (
      <section
        className="fable-generator"
        data-completed={Boolean(resultSummary) && !showSearchSettings}
        aria-label={t("candidates.solver.guided.aria")}
      >
        <div className="generator-heading">
          <div>
            <h2>
              {status === "running"
                ? t("candidates.solver.guided.titleRunning")
                : resultSummary
                  ? t("candidates.solver.guided.titleDone")
                  : t("candidates.solver.guided.titleIdle")}
            </h2>
            <p>
              {t("candidates.solver.guided.subtitle", {
                length: project.package.dimensionsMm.length,
                width: project.package.dimensionsMm.width,
                pallet:
                  project.pallet?.name ??
                  t("candidates.solver.guided.palletFallback"),
              })}
            </p>
          </div>
          <span className="generator-state">
            {status === "running"
              ? t("candidates.solver.guided.stateRunning")
              : status === "cancelled"
                ? t("candidates.solver.cancelled")
                : resultSummary
                  ? t("candidates.solver.guided.stateDistinct", {
                      count: distinctCandidateLayoutCount,
                    })
                  : t("candidates.solver.guided.stateReady")}
          </span>
        </div>
        {progress && (
          <div className="generator-progress" role="status" aria-live="polite">
            <progress
              aria-label={t("candidates.solver.progressAria")}
              value={progress.total ? progress.completed : undefined}
              max={progress.total ?? 1}
            />
            <p>
              {(
                {
                  generation: t("candidates.solver.guided.phase.generation"),
                  validation: t("candidates.solver.guided.phase.validation"),
                  ranking: t("candidates.solver.guided.phase.ranking"),
                  complete: t("candidates.solver.guided.phase.complete"),
                  normalization: t(
                    "candidates.solver.guided.phase.normalization",
                  ),
                } as Record<string, string>
              )[progress.phase] ?? t("candidates.solver.guided.phase.default")}
              {progress.generator ? `: ${progress.generator}` : ""}{" "}
              <span>
                {progress.completed}
                {progress.total ? ` / ${progress.total}` : ""}
              </span>
            </p>
          </div>
        )}
        {resultSummary && !showSearchSettings && (
          <button
            type="button"
            className="text-action"
            onClick={() => setShowSearchSettings(true)}
          >
            {t("candidates.solver.guided.adjust")}
          </button>
        )}
        <div hidden={Boolean(resultSummary) && !showSearchSettings}>
          <div className="generator-main">
            <label>
              {t("candidates.solver.packagesPerLayer")}
              <input
                className="ui-input"
                type="number"
                min="1"
                step="1"
                value={draft.packageCount}
                disabled={inputsDisabled}
                onChange={(e) => updateDraft({ packageCount: e.target.value })}
              />
            </label>
            <button
              type="button"
              className={status === "running" ? "ui-btn" : "ui-btn-primary"}
              disabled={status !== "running" && !canSolve}
              onClick={() => (status === "running" ? cancel() : void start())}
            >
              {status === "running"
                ? t("candidates.solver.guided.cancelRun")
                : resultSummary
                  ? t("candidates.solver.guided.recalculate")
                  : t("candidates.solver.guided.generate")}
            </button>
          </div>
          <details className="generator-options">
            <summary>{t("candidates.solver.guided.adjustParams")}</summary>
            <div className="generator-option-fields">
              <DimensionInput
                label={t("candidates.solver.guided.packageLengthMm")}
                value={draft.packageLength}
                disabled={inputsDisabled}
                onChange={(packageLength) => updateDraft({ packageLength })}
              />
              <DimensionInput
                label={t("candidates.solver.guided.packageWidthMm")}
                value={draft.packageWidth}
                disabled={inputsDisabled}
                onChange={(packageWidth) => updateDraft({ packageWidth })}
              />
              <DimensionInput
                label={t("candidates.solver.guided.packageHeightMm")}
                value={draft.packageHeight}
                disabled={inputsDisabled}
                onChange={(packageHeight) => updateDraft({ packageHeight })}
              />
              <DimensionInput
                label={t("candidates.solver.guided.lengthTotalMm")}
                value={draft.lengthAllowanceTotal}
                signed
                disabled={inputsDisabled}
                onChange={(lengthAllowanceTotal) =>
                  updateDraft({ lengthAllowanceTotal })
                }
              />
              <DimensionInput
                label={t("candidates.solver.guided.widthTotalMm")}
                value={draft.widthAllowanceTotal}
                signed
                disabled={inputsDisabled}
                onChange={(widthAllowanceTotal) =>
                  updateDraft({ widthAllowanceTotal })
                }
              />
              <label>
                {t("candidates.solver.guided.maxCandidates")}
                <input
                  className="ui-input"
                  type="number"
                  min="1"
                  value={draft.maxCandidatesPerGenerator}
                  disabled={inputsDisabled}
                  onChange={(e) =>
                    updateDraft({ maxCandidatesPerGenerator: e.target.value })
                  }
                />
              </label>
              <label>
                {t("candidates.solver.guided.maxPerGrip")}
                <input
                  className="ui-input"
                  type="number"
                  min="1"
                  value={draft.provisionalPackagesPerCycle}
                  disabled={inputsDisabled || !draft.multiPickAllowed}
                  onChange={(e) =>
                    updateDraft({ provisionalPackagesPerCycle: e.target.value })
                  }
                />
              </label>
              <label className="generator-check">
                <input
                  type="checkbox"
                  checked={allowMixedPackageOrientations}
                  disabled={inputsDisabled}
                  onChange={(e) =>
                    setAllowMixedPackageOrientations(e.target.checked)
                  }
                />
                {t("candidates.solver.guided.mixOrientations")}
              </label>
              <label className="generator-check">
                <input
                  type="checkbox"
                  checked={draft.multiPickAllowed}
                  disabled={inputsDisabled}
                  onChange={(e) =>
                    updateDraft({ multiPickAllowed: e.target.checked })
                  }
                />
                {t("candidates.solver.multipick")}
              </label>
              <label className="generator-check">
                <input
                  type="checkbox"
                  checked={includeSymmetryVariants}
                  disabled={inputsDisabled}
                  onChange={(e) => setIncludeSymmetryVariants(e.target.checked)}
                />
                {t("candidates.solver.guided.symmetry")}
              </label>
            </div>
            <p>{t("candidates.solver.guided.allowanceHint")}</p>
            <PackageLabelFacePicker
              packageLengthMm={Number(draft.packageLength)}
              packageWidthMm={Number(draft.packageWidth)}
              inletOrientation={draft.inletOrientation}
              selectedPackageSide={draft.unrotatedPackageLabelSide || null}
              disabled={inputsDisabled}
              onInletOrientationChange={(inletOrientation) =>
                updateDraft({ inletOrientation })
              }
              onPackageSideChange={(side) =>
                updateDraft({ unrotatedPackageLabelSide: side ?? "" })
              }
            />
          </details>
        </div>
        {preflightIssues.length > 0 && (
          <p className="generator-hint">
            {draft.packageCount.trim() === ""
              ? t("candidates.solver.guided.enterCount")
              : preflightIssues.join(" ")}
          </p>
        )}
        {failure && (
          <p role="alert" className="fable-notice">
            {status === "cancelled"
              ? t("candidates.solver.guided.cancelledNotice")
              : failure}
          </p>
        )}
        {staleNotice && (
          <p role="status" className="generator-hint">
            {t("candidates.solver.guided.stale")}
          </p>
        )}
        {resultSummary?.candidates.length === 0 && (
          <p role="status" className="fable-notice">
            {t("candidates.solver.guided.noMatch")}
          </p>
        )}
      </section>
    );

  return (
    <section className="border-line bg-surface border">
      <header className="border-line border-b p-3">
        <h2 className="text-body text-ink font-semibold">
          {t("candidates.solver.title")}
        </h2>
      </header>

      <div className="grid gap-3 p-3">
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="text-muted col-span-3 mb-1 text-[10px] font-semibold">
            {t("candidates.solver.packageDimensions")}
          </legend>
          <DimensionInput
            label={t("candidates.solver.packageLength")}
            value={draft.packageLength}
            disabled={inputsDisabled}
            onChange={(packageLength) => updateDraft({ packageLength })}
          />
          <DimensionInput
            label={t("candidates.solver.packageWidth")}
            value={draft.packageWidth}
            disabled={inputsDisabled}
            onChange={(packageWidth) => updateDraft({ packageWidth })}
          />
          <DimensionInput
            label={t("candidates.solver.packageHeight")}
            value={draft.packageHeight}
            disabled={inputsDisabled}
            onChange={(packageHeight) => updateDraft({ packageHeight })}
          />
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="text-muted col-span-2 mb-1 text-[10px] font-semibold">
            {t("candidates.solver.palletAllowance")}
          </legend>
          <DimensionInput
            label={t("candidates.solver.lengthTotal")}
            value={draft.lengthAllowanceTotal}
            disabled={inputsDisabled}
            signed
            onChange={(lengthAllowanceTotal) =>
              updateDraft({ lengthAllowanceTotal })
            }
          />
          <DimensionInput
            label={t("candidates.solver.widthTotal")}
            value={draft.widthAllowanceTotal}
            disabled={inputsDisabled}
            signed
            onChange={(widthAllowanceTotal) =>
              updateDraft({ widthAllowanceTotal })
            }
          />
          {prepared.input?.generationBoundsMm ? (
            <p
              className="text-ink col-span-2 font-mono text-[11px]"
              aria-live="polite"
            >
              {t("candidates.solver.effectiveFrame", {
                length:
                  prepared.input.generationBoundsMm.maxX -
                  prepared.input.generationBoundsMm.minX,
                width:
                  prepared.input.generationBoundsMm.maxY -
                  prepared.input.generationBoundsMm.minY,
              })}
            </p>
          ) : null}
        </fieldset>

        <label className="text-muted grid gap-1 text-[10px] font-semibold">
          {t("candidates.solver.packagesPerLayer")}
          <input
            type="number"
            min="1"
            step="1"
            value={draft.packageCount}
            disabled={inputsDisabled}
            onChange={(event) =>
              updateDraft({ packageCount: event.target.value })
            }
            placeholder={t("candidates.solver.required")}
            className={`${inputClass} tracking-normal normal-case`}
          />
        </label>

        <PackageLabelFacePicker
          packageLengthMm={Number(draft.packageLength)}
          packageWidthMm={Number(draft.packageWidth)}
          inletOrientation={draft.inletOrientation}
          selectedPackageSide={draft.unrotatedPackageLabelSide || null}
          disabled={inputsDisabled}
          onInletOrientationChange={(inletOrientation) =>
            updateDraft({ inletOrientation })
          }
          onPackageSideChange={(unrotatedPackageLabelSide) =>
            updateDraft({
              unrotatedPackageLabelSide: unrotatedPackageLabelSide ?? "",
            })
          }
        />
        {draft.unrotatedPackageLabelSide &&
        project.selectedGripperId === null ? (
          <p className="border-brand bg-plan-fill text-ink border px-2 py-1.5 text-[10px] leading-4">
            {t("candidates.solver.noGripper")}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <label className="border-line text-micro text-ink flex min-h-9 items-center gap-2 border px-2.5">
            <input
              type="checkbox"
              checked={allowMixedPackageOrientations}
              disabled={inputsDisabled}
              onChange={(event) =>
                setAllowMixedPackageOrientations(event.target.checked)
              }
              className="accent-brand h-4 w-4"
            />
            {t("candidates.solver.allowMixed")}
          </label>
          <label className="border-line text-micro text-ink flex min-h-9 items-center gap-2 border px-2.5">
            <input
              type="checkbox"
              checked={draft.multiPickAllowed}
              disabled={inputsDisabled}
              onChange={(event) =>
                updateDraft({
                  multiPickAllowed: event.target.checked,
                })
              }
              className="accent-brand h-4 w-4"
            />
            {t("candidates.solver.multipick")}
          </label>
        </div>

        <details className="border-line border-t pt-2">
          <summary className="text-muted cursor-pointer text-[10px] font-semibold">
            {t("candidates.solver.advanced")}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-muted grid gap-1 text-[10px]">
              {t("candidates.solver.candidatesSlash")}
              <input
                type="number"
                min="1"
                step="1"
                value={draft.maxCandidatesPerGenerator}
                disabled={inputsDisabled}
                onChange={(event) =>
                  updateDraft({
                    maxCandidatesPerGenerator: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="text-muted grid gap-1 text-[10px]">
              {t("candidates.solver.automaticGroupLimit")}
              <input
                type="number"
                min="1"
                step="1"
                value={draft.provisionalPackagesPerCycle}
                disabled={inputsDisabled || !draft.multiPickAllowed}
                onChange={(event) =>
                  updateDraft({
                    provisionalPackagesPerCycle: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="border-line text-micro text-ink col-span-2 flex h-8 items-center gap-2 border px-2.5">
              <input
                type="checkbox"
                checked={includeSymmetryVariants}
                disabled={inputsDisabled}
                onChange={(event) =>
                  setIncludeSymmetryVariants(event.target.checked)
                }
                className="accent-brand h-4 w-4"
              />
              {t("candidates.solver.blockSymmetries")}
            </label>
          </div>
        </details>

        {status === "running" ? (
          <button
            type="button"
            onClick={cancel}
            className="ui-btn border-danger text-micro text-danger h-9 px-3 font-medium"
          >
            {t("candidates.solver.cancel")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canSolve}
            className="ui-btn-primary text-micro h-9 px-3"
          >
            {t("candidates.solver.applyAndSolve")}
          </button>
        )}
      </div>

      <div className="border-line text-micro grid gap-2 border-t p-3">
        {preflightIssues.length > 0 ? (
          <div
            role="alert"
            className="border-danger text-danger border bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2"
          >
            <strong className="font-semibold">
              {t("candidates.solver.preflightFailed")}
            </strong>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {preflightIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted">
            {t("candidates.solver.ready", {
              length: draft.packageLength,
              width: draft.packageWidth,
              height: draft.packageHeight,
              orientation: t(
                `candidates.solver.orientation.${draft.inletOrientation}`,
              ),
              lengthTotal: draft.lengthAllowanceTotal,
              widthTotal: draft.widthAllowanceTotal,
              count: draft.packageCount,
              label: draft.unrotatedPackageLabelSide
                ? t(
                    `candidates.solver.labelFace.${draft.unrotatedPackageLabelSide}`,
                  )
                : t("candidates.solver.labelUnconstrained"),
              mixed: allowMixedPackageOrientations
                ? t("candidates.solver.allowed")
                : t("candidates.solver.disabled"),
              grouping: draft.multiPickAllowed
                ? t("candidates.solver.groupingEnabled", {
                    limit: effectiveAutomaticGroupLimit,
                  })
                : t("candidates.solver.groupingDisabled"),
            })}
          </p>
        )}

        {progress ? <SolverProgressPanel progress={progress} /> : null}

        {resultSummary ? (
          <div
            role="status"
            className="border-line bg-canvas text-ink border px-3 py-2"
          >
            {t("candidates.solver.resultSummary", {
              status:
                resultSummary.status === "completed"
                  ? t("candidates.solver.resultCompleted")
                  : t("candidates.solver.cancelled"),
              candidates: resultSummary.statistics.candidateCount,
              distinct: distinctCandidateLayoutCount,
              drafts: resultSummary.statistics.generatedDraftCount,
              invalid: resultSummary.statistics.invalidDraftCount,
              merged: resultSummary.statistics.geometricDuplicateCount,
            })}
          </div>
        ) : null}
        {failure ? (
          <div
            role="alert"
            className="border-danger text-danger border bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2"
          >
            {failure}
          </div>
        ) : null}
        {staleNotice ? (
          <div
            role="status"
            className="border-brand bg-plan-fill text-ink border px-3 py-2"
          >
            {staleNotice}
          </div>
        ) : null}
      </div>
    </section>
  );
}
