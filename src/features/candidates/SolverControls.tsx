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

const labelFaceDescription: Record<Side, string> = {
  top: "+Y face — edge parallel to package length",
  right: "+X face — edge parallel to package width",
  bottom: "−Y face — edge parallel to package length",
  left: "−X face — edge parallel to package width",
};

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

function finitePositive(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a finite positive number.`);
  }
  return parsed;
}

function finiteNumber(value: string, label: string): number {
  if (value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return parsed;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function prepareSolverInput(
  project: Project,
  draft: SolverDraft,
  allowMixedPackageOrientations: boolean,
): PreparedSolverInput {
  try {
    const packageDimensionsMm = {
      length: finitePositive(draft.packageLength, "Package length"),
      width: finitePositive(draft.packageWidth, "Package width"),
      height: finitePositive(draft.packageHeight, "Package height"),
    };
    const lengthAllowanceTotal = finiteNumber(
      draft.lengthAllowanceTotal,
      "Length total overhang / underhang",
    );
    const widthAllowanceTotal = finiteNumber(
      draft.widthAllowanceTotal,
      "Width total overhang / underhang",
    );
    const rectangularBlockFootprintPolicy =
      lengthAllowanceTotal === 0 && widthAllowanceTotal === 0
        ? "compact-centered"
        : "fill-generation-bounds";
    const packageCount = positiveInteger(
      draft.packageCount,
      "Packages per layer",
    );
    const maxCandidatesPerGenerator = positiveInteger(
      draft.maxCandidatesPerGenerator,
      "Candidates per generator",
    );
    const requestedAutomaticGroupLimit = draft.multiPickAllowed
      ? positiveInteger(
          draft.provisionalPackagesPerCycle,
          "Automatic group limit",
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
      throw new Error("A pallet is required before generation.");
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
      package: {
        ...baseInput.package,
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
          : "Unable to prepare solver input.",
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
        <span className="text-body font-semibold">Generating patterns…</span>
        <span className="text-body text-brand font-mono font-semibold">
          {percent === null ? progress.completed : `${percent}%`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Pattern generation progress"
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
      hadRun
        ? "The previous solver run was discarded because generator inputs changed."
        : current,
    );
    onReset();
  }, [currentRunKey, onReset]);

  const prepared = useMemo(
    () => prepareSolverInput(project, draft, allowMixedPackageOrientations),
    [allowMixedPackageOrientations, draft, project],
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
      message: "Applying package inputs before generation.",
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
          ? `Package input update failed: ${cause.message}`
          : "Package input update failed.",
      );
      return;
    }
    if (generationRef.current !== generation || runKeyRef.current !== runKey) {
      return;
    }

    const applied = prepareSolverInput(
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
          "The applied generator inputs are invalid.",
      );
      return;
    }

    setProgress({
      phase: "input-validation",
      completed: 0,
      total: 1,
      message: "Starting solver worker.",
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
          setFailure(
            "Solver run cancelled. No partial candidates were applied.",
          );
          return;
        }
        console.error("Solver worker failed", cause);
        setStatus("rejected");
        setFailure(
          cause instanceof Error
            ? `Solver failed: ${cause.message}`
            : "Solver failed with an unknown worker error.",
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
    setFailure("Solver run cancelled. No partial candidates were applied.");
  };

  const inputsDisabled = status === "running";

  if (guided)
    return (
      <section
        className="fable-generator"
        data-completed={Boolean(resultSummary) && !showSearchSettings}
        aria-label="Mustersuche"
      >
        <div className="generator-heading">
          <div>
            <h2>
              {status === "running"
                ? "Passende Muster werden gesucht"
                : resultSummary
                  ? "Suche abgeschlossen"
                  : "Muster berechnen"}
            </h2>
            <p>
              {project.package.dimensionsMm.length} ×{" "}
              {project.package.dimensionsMm.width} mm auf{" "}
              {project.pallet?.name ?? "Palette"}
            </p>
          </div>
          <span className="generator-state">
            {status === "running"
              ? "Berechnung läuft"
              : status === "cancelled"
                ? "Abgebrochen"
                : resultSummary
                  ? `${distinctCandidateLayoutCount} unterschiedliche Muster`
                  : "Bereit"}
          </span>
        </div>
        {progress && (
          <div className="generator-progress" role="status" aria-live="polite">
            <progress
              aria-label="Fortschritt der Mustersuche"
              value={progress.total ? progress.completed : undefined}
              max={progress.total ?? 1}
            />
            <p>
              {(
                {
                  generation: "Muster erzeugen",
                  validation: "Geometrie prüfen",
                  ranking: "Muster sortieren",
                  complete: "Abgeschlossen",
                  normalization: "Eingaben prüfen",
                } as Record<string, string>
              )[progress.phase] ?? "Muster berechnen"}
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
            Suche anpassen
          </button>
        )}
        <div hidden={Boolean(resultSummary) && !showSearchSettings}>
          <div className="generator-main">
            <label>
              Pakete je Lage
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
                ? "Berechnung abbrechen"
                : resultSummary
                  ? "Neu berechnen"
                  : "Muster erzeugen"}
            </button>
          </div>
          <details className="generator-options">
            <summary>Suchparameter anpassen</summary>
            <div className="generator-option-fields">
              <DimensionInput
                label="Paketlänge (mm)"
                value={draft.packageLength}
                disabled={inputsDisabled}
                onChange={(packageLength) => updateDraft({ packageLength })}
              />
              <DimensionInput
                label="Paketbreite (mm)"
                value={draft.packageWidth}
                disabled={inputsDisabled}
                onChange={(packageWidth) => updateDraft({ packageWidth })}
              />
              <DimensionInput
                label="Pakethöhe (mm)"
                value={draft.packageHeight}
                disabled={inputsDisabled}
                onChange={(packageHeight) => updateDraft({ packageHeight })}
              />
              <DimensionInput
                label="Über-/Unterstand Länge gesamt (mm)"
                value={draft.lengthAllowanceTotal}
                signed
                disabled={inputsDisabled}
                onChange={(lengthAllowanceTotal) =>
                  updateDraft({ lengthAllowanceTotal })
                }
              />
              <DimensionInput
                label="Über-/Unterstand Breite gesamt (mm)"
                value={draft.widthAllowanceTotal}
                signed
                disabled={inputsDisabled}
                onChange={(widthAllowanceTotal) =>
                  updateDraft({ widthAllowanceTotal })
                }
              />
              <label>
                Max. Kandidaten je Generator
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
                Max. Pakete je Griff
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
                Längs und quer kombinieren
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
                Mehrfachgriff erlauben
              </label>
              <label className="generator-check">
                <input
                  type="checkbox"
                  checked={includeSymmetryVariants}
                  disabled={inputsDisabled}
                  onChange={(e) => setIncludeSymmetryVariants(e.target.checked)}
                />
                Gespiegelte Varianten einbeziehen
              </label>
            </div>
            <p>
              Der Über-/Unterstand wird gleichmäßig auf beide Seiten verteilt.
              Die Suchparameter ändern die gespeicherte Palettenfreigabe nicht.
            </p>
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
              ? "Geben Sie die gewünschte Anzahl Pakete je Lage ein."
              : preflightIssues.join(" ")}
          </p>
        )}
        {failure && (
          <p role="alert" className="fable-notice">
            {status === "cancelled"
              ? "Berechnung abgebrochen. Es wurden keine unvollständigen Muster übernommen."
              : failure}
          </p>
        )}
        {staleNotice && (
          <p role="status" className="generator-hint">
            Die Suchparameter wurden geändert. Bitte berechnen Sie die Muster
            erneut.
          </p>
        )}
        {resultSummary?.candidates.length === 0 && (
          <p role="status" className="fable-notice">
            Kein passendes Muster gefunden. Ändern Sie die Paketanzahl oder die
            Suchparameter.
          </p>
        )}
      </section>
    );

  return (
    <section className="border-line bg-surface border">
      <header className="border-line border-b p-3">
        <h2 className="text-body text-ink font-semibold">Layer solver</h2>
      </header>

      <div className="grid gap-3 p-3">
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="text-muted col-span-3 mb-1 text-[10px] font-semibold">
            Package dimensions · mm
          </legend>
          <DimensionInput
            label="Package length"
            value={draft.packageLength}
            disabled={inputsDisabled}
            onChange={(packageLength) => updateDraft({ packageLength })}
          />
          <DimensionInput
            label="Package width"
            value={draft.packageWidth}
            disabled={inputsDisabled}
            onChange={(packageWidth) => updateDraft({ packageWidth })}
          />
          <DimensionInput
            label="Package height"
            value={draft.packageHeight}
            disabled={inputsDisabled}
            onChange={(packageHeight) => updateDraft({ packageHeight })}
          />
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="text-muted col-span-2 mb-1 text-[10px] font-semibold">
            Total pallet allowance · mm
          </legend>
          <DimensionInput
            label="Length total overhang / underhang"
            value={draft.lengthAllowanceTotal}
            disabled={inputsDisabled}
            signed
            onChange={(lengthAllowanceTotal) =>
              updateDraft({ lengthAllowanceTotal })
            }
          />
          <DimensionInput
            label="Width total overhang / underhang"
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
              Effective frame:{" "}
              {prepared.input.generationBoundsMm.maxX -
                prepared.input.generationBoundsMm.minX}{" "}
              ×{" "}
              {prepared.input.generationBoundsMm.maxY -
                prepared.input.generationBoundsMm.minY}{" "}
              mm
            </p>
          ) : null}
        </fieldset>

        <label className="text-muted grid gap-1 text-[10px] font-semibold">
          Packages per layer
          <input
            type="number"
            min="1"
            step="1"
            value={draft.packageCount}
            disabled={inputsDisabled}
            onChange={(event) =>
              updateDraft({ packageCount: event.target.value })
            }
            placeholder="Required"
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
            No gripper is selected, so all four orthogonal place yaws are
            provisionally available. Select a gripper to enforce its exact yaw
            limits.
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
            Allow mixed lengthwise / crosswise orientations
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
            Allow multipick
          </label>
        </div>

        <details className="border-line border-t pt-2">
          <summary className="text-muted cursor-pointer text-[10px] font-semibold">
            Advanced generation
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-muted grid gap-1 text-[10px]">
              Candidates / generator
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
              Automatic group limit
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
              Include block symmetries
            </label>
          </div>
        </details>

        {status === "running" ? (
          <button
            type="button"
            onClick={cancel}
            className="ui-btn border-danger text-micro text-danger h-9 px-3 font-medium"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canSolve}
            className="ui-btn-primary text-micro h-9 px-3"
          >
            Apply inputs & solve
          </button>
        )}
      </div>

      <div className="border-line text-micro grid gap-2 border-t p-3">
        {preflightIssues.length > 0 ? (
          <div
            role="alert"
            className="border-danger text-danger border bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2"
          >
            <strong className="font-semibold">Preflight failed.</strong>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {preflightIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted">
            Ready: {draft.packageLength} × {draft.packageWidth} ×{" "}
            {draft.packageHeight} mm package · {draft.inletOrientation} infeed
            left to right · L {draft.lengthAllowanceTotal}/W{" "}
            {draft.widthAllowanceTotal} mm total · {draft.packageCount} packages
            · label{" "}
            {draft.unrotatedPackageLabelSide
              ? labelFaceDescription[draft.unrotatedPackageLabelSide]
              : "not constrained"}{" "}
            · mixed orientations{" "}
            {allowMixedPackageOrientations ? "allowed" : "disabled"} · automatic
            grouping{" "}
            {draft.multiPickAllowed
              ? `enabled up to ${effectiveAutomaticGroupLimit}`
              : "disabled; singleton picks only"}
            .
          </p>
        )}

        {progress ? <SolverProgressPanel progress={progress} /> : null}

        {resultSummary ? (
          <div
            role="status"
            className="border-line bg-canvas text-ink border px-3 py-2"
          >
            {resultSummary.status === "completed" ? "Completed" : "Cancelled"}:{" "}
            {resultSummary.statistics.candidateCount} candidates (
            {distinctCandidateLayoutCount} distinct layouts) from{" "}
            {resultSummary.statistics.generatedDraftCount} drafts;{" "}
            {resultSummary.statistics.invalidDraftCount} invalid and{" "}
            {resultSummary.statistics.geometricDuplicateCount} equivalent layout
            variants merged.
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
