"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  lengthAllowancePerSide: string;
  widthAllowancePerSide: string;
  packageCount: string;
  unrotatedPackageLabelSide: "" | Side;
  maxCandidatesPerGenerator: string;
  provisionalPackagesPerCycle: string;
};

type PreparedSolverInput = {
  input: LayerSolverInput | null;
  validation: ReturnType<typeof validateAndNormalizeSolverInput> | null;
  packageInputs: GeneratorPackageInputs | null;
  error: string | null;
};

const inputClass = "ui-input min-w-0 font-mono text-xs";

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

function initialDraft(project: Project): SolverDraft {
  return {
    packageLength: String(project.package.dimensionsMm.length),
    packageWidth: String(project.package.dimensionsMm.width),
    packageHeight: String(project.package.dimensionsMm.height),
    inletOrientation: project.package.inletOrientation,
    multiPickAllowed: project.package.multiPickAllowed,
    lengthAllowancePerSide: String(
      project.pallet?.allowedOverhangMm.length ?? 0,
    ),
    widthAllowancePerSide: String(project.pallet?.allowedOverhangMm.width ?? 0),
    packageCount: "",
    unrotatedPackageLabelSide: configuredLabelSide(project),
    maxCandidatesPerGenerator: "500",
    provisionalPackagesPerCycle: project.package.multiPickAllowed ? "2" : "1",
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
    const lengthAllowancePerSide = finiteNumber(
      draft.lengthAllowancePerSide,
      "Length overhang / underhang per side",
    );
    const widthAllowancePerSide = finiteNumber(
      draft.widthAllowancePerSide,
      "Width overhang / underhang per side",
    );
    const rectangularBlockFootprintPolicy =
      lengthAllowancePerSide === 0 && widthAllowancePerSide === 0
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
        length: lengthAllowancePerSide,
        width: widthAllowancePerSide,
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
    <label className="grid min-w-0 gap-1 text-[10px] text-[var(--muted)]">
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

export function SolverControls({
  project,
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
  const [draft, setDraft] = useState<SolverDraft>(() => initialDraft(project));
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
    setDraft((current) => ({
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
      provisionalPackagesPerCycle: multiPickAllowedChanged
        ? project.package.multiPickAllowed
          ? "2"
          : "1"
        : current.provisionalPackagesPerCycle,
      unrotatedPackageLabelSide: labelMetadataChanged
        ? configuredLabelSide(project)
        : current.unrotatedPackageLabelSide,
    }));
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
    setDraft((current) => ({ ...current, ...update }));
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
      !launchRequest ||
      launchRequest.projectId !== project.id ||
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
      !pendingLaunchRequest ||
      pendingLaunchRequest.projectId !== project.id ||
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

  return (
    <section className="border border-[var(--line)] bg-[var(--surface)]">
      <header className="border-b border-[var(--line)] p-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">
          Layer solver
        </h2>
        <p className="mt-1 text-xs leading-4 text-[var(--muted)]">
          Enter the package, signed pallet allowance, and exact package count
          for this layer.
        </p>
      </header>

      <div className="grid gap-3 p-3">
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="col-span-3 mb-1 text-[10px] font-semibold text-[var(--muted)]">
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
          <legend className="col-span-2 mb-1 text-[10px] font-semibold text-[var(--muted)]">
            Pallet allowance per side · mm
          </legend>
          <DimensionInput
            label="Length overhang / underhang per side"
            value={draft.lengthAllowancePerSide}
            disabled={inputsDisabled}
            signed
            onChange={(lengthAllowancePerSide) =>
              updateDraft({ lengthAllowancePerSide })
            }
          />
          <DimensionInput
            label="Width overhang / underhang per side"
            value={draft.widthAllowancePerSide}
            disabled={inputsDisabled}
            signed
            onChange={(widthAllowancePerSide) =>
              updateDraft({ widthAllowancePerSide })
            }
          />
          <p className="col-span-2 text-[10px] leading-4 text-[var(--muted)]">
            Zero on both axes creates a tight centered footprint. Any positive
            or negative value defines the requested frame and may distribute
            bounded spacing to reach it. The saved pallet policy remains
            unchanged.
          </p>
        </fieldset>

        <label className="grid gap-1 text-[10px] font-semibold text-[var(--muted)]">
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
        <p className="text-[10px] leading-4 text-[var(--muted)]">
          The infeed reference always runs left to right. Changing lengthwise or
          crosswise rotates only the package view and preserves the selected
          physical face. The solver keeps the generated footprint and rotates a
          package by 180° only when the opposite authorized yaw points that face
          toward the nearer physical pallet edge.
        </p>
        {draft.unrotatedPackageLabelSide &&
        project.selectedGripperId === null ? (
          <p className="border border-[var(--brand)] bg-[var(--plan-fill)] px-2 py-1.5 text-[10px] leading-4 text-[var(--ink)]">
            No gripper is selected, so all four orthogonal place yaws are
            provisionally available. Select a gripper to enforce its exact yaw
            limits.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex min-h-9 items-center gap-2 border border-[var(--line)] px-2.5 text-xs text-[var(--ink)]">
            <input
              type="checkbox"
              checked={allowMixedPackageOrientations}
              disabled={inputsDisabled}
              onChange={(event) =>
                setAllowMixedPackageOrientations(event.target.checked)
              }
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Allow mixed lengthwise / crosswise orientations
          </label>
          <label className="flex min-h-9 items-center gap-2 border border-[var(--line)] px-2.5 text-xs text-[var(--ink)]">
            <input
              type="checkbox"
              checked={draft.multiPickAllowed}
              disabled={inputsDisabled}
              onChange={(event) =>
                updateDraft({
                  multiPickAllowed: event.target.checked,
                  provisionalPackagesPerCycle: event.target.checked ? "2" : "1",
                })
              }
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Allow multipick
          </label>
        </div>
        <p className="text-[10px] leading-4 text-[var(--muted)]">
          Valid results may include compact rectangles, pinwheels, and mosaics.
          Multipick groups only equal-yaw packages that are directly adjacent
          along their package length; incompatible packages remain single picks.
        </p>

        <details className="border-t border-[var(--line)] pt-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-[var(--muted)]">
            Advanced generation
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[10px] text-[var(--muted)]">
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
            <label className="grid gap-1 text-[10px] text-[var(--muted)]">
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
            <label className="col-span-2 flex h-8 items-center gap-2 border border-[var(--line)] px-2.5 text-xs text-[var(--ink)]">
              <input
                type="checkbox"
                checked={includeSymmetryVariants}
                disabled={inputsDisabled}
                onChange={(event) =>
                  setIncludeSymmetryVariants(event.target.checked)
                }
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Include block symmetries
            </label>
          </div>
        </details>

        {status === "running" ? (
          <button
            type="button"
            onClick={cancel}
            className="ui-btn h-9 border-[var(--danger)] px-3 text-xs font-medium text-[var(--danger)]"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={!canSolve}
            className="ui-btn-primary h-9 px-3 text-xs"
          >
            Apply inputs & solve
          </button>
        )}
      </div>

      <div className="grid gap-2 border-t border-[var(--line)] p-3 text-xs">
        {preflightIssues.length > 0 ? (
          <div
            role="alert"
            className="border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-[var(--danger)]"
          >
            <strong className="font-semibold">Preflight failed.</strong>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {preflightIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[var(--muted)]">
            Ready: {draft.packageLength} × {draft.packageWidth} ×{" "}
            {draft.packageHeight} mm package · {draft.inletOrientation} infeed
            left to right · L {draft.lengthAllowancePerSide}/W{" "}
            {draft.widthAllowancePerSide} mm per side · {draft.packageCount}{" "}
            packages · label{" "}
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

        {progress ? (
          <div aria-live="polite" className="grid gap-1 text-[var(--ink)]">
            <div className="flex items-center justify-between gap-3">
              <span>
                {progress.phase}
                {progress.generator ? ` · ${progress.generator}` : ""}
              </span>
              <span className="font-mono text-[var(--muted)]">
                {progress.completed}
                {progress.total === null ? "" : ` / ${progress.total}`}
              </span>
            </div>
            <progress
              max={progress.total ?? Math.max(1, progress.completed + 1)}
              value={progress.completed}
              className="h-1.5 w-full accent-[var(--brand)]"
            />
            <span className="text-[var(--muted)]">{progress.message}</span>
          </div>
        ) : null}

        {resultSummary ? (
          <div
            role="status"
            className="border border-[var(--line)] bg-[var(--canvas)] px-3 py-2 text-[var(--ink)]"
          >
            {resultSummary.status === "completed" ? "Completed" : "Cancelled"}:{" "}
            {resultSummary.statistics.candidateCount} candidates from{" "}
            {resultSummary.statistics.generatedDraftCount} drafts;{" "}
            {resultSummary.statistics.invalidDraftCount} invalid and{" "}
            {resultSummary.statistics.geometricDuplicateCount} equivalent layout
            variants merged.
          </div>
        ) : null}
        {failure ? (
          <div
            role="alert"
            className="border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-[var(--danger)]"
          >
            {failure}
          </div>
        ) : null}
        {staleNotice ? (
          <div
            role="status"
            className="border border-[var(--brand)] bg-[var(--plan-fill)] px-3 py-2 text-[var(--ink)]"
          >
            {staleNotice}
          </div>
        ) : null}
      </div>
    </section>
  );
}
