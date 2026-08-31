"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import type { Project } from "~/domain/project/projectSchema";
import {
  validateAndNormalizeSolverInput,
  type LayerSolverInput,
  type SolverCandidate,
  type SolverProgress,
} from "~/domain/solver";
import {
  candidateRankReason,
  selectDistinctCandidateLayouts,
} from "~/features/candidates/candidateListModel";
import {
  buildMobilePlanProject,
  createMobilePlanDraft,
  createMobilePlanSolverInput,
  MOBILE_PACKAGE_STEP_FIELDS,
  MOBILE_PLAN_STEPS,
  parseMobilePlanDraft,
  projectWithMobilePlanStack,
  savedProjectPatternPreview,
  stepFieldErrors,
  summarizeMobilePlan,
  summarizeSavedProject,
  type MobilePlanDraft,
  type MobilePlanFieldErrors,
  type MobilePlanStep,
  type ParsedMobilePlan,
} from "~/features/mobile/mobilePlannerModel";
import { exportProjectRobDownload } from "~/features/robotics/robotWorkspaceModel";
import { solverCandidateToPatternPreview } from "~/lib/previewAdapters";
import {
  createProjectRepository,
  type ProjectRepository,
} from "~/lib/projectRepository";
import {
  createLayerSolverClient,
  SolverRunCancelledError,
  type LayerSolverClient,
  type SolverRunHandle,
} from "~/workers/solverClient";

const MAX_DISPLAYED_CANDIDATES = 12;

const STEP_TITLES: Record<MobilePlanStep, string> = {
  package: "Package",
  pallet: "Pallet & count",
  pattern: "Pattern",
};

const STEP_SUBTITLES: Record<MobilePlanStep, string> = {
  package: "Dimensions of one carton in millimetres.",
  pallet: "Choose the pallet and how full each layer gets.",
  pattern: "Pick a layout and save the plan.",
};

const PALLET_CHOICES: {
  kind: MobilePlanDraft["palletKind"];
  label: string;
  dims: string;
}[] = [
  { kind: "euro", label: "EURO", dims: "1200 × 800" },
  { kind: "industrial", label: "Industrial", dims: "1200 × 1000" },
  { kind: "custom", label: "Custom", dims: "your size" },
];

type RunStatus = "idle" | "running" | "completed" | "failed";
type SaveStatus = "idle" | "saving" | "saved" | "failed";
type ExportStatus = "idle" | "failed";
type Screen = "library" | "detail" | MobilePlanStep;
type LibraryStatus = "loading" | "ready" | "failed";

function hasErrors(errors: MobilePlanFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? `${fallback} ${cause.message}` : fallback;
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MobilePatternThumbnail({
  preview,
  className = "h-40 w-full",
}: {
  preview: LayerPatternPreview;
  className?: string;
}) {
  const pallet = preview.palletBoundsMm;
  const width = Math.max(1, pallet.maxX - pallet.minX);
  const height = Math.max(1, pallet.maxY - pallet.minY);
  const padding = Math.max(width, height) * 0.025;
  const toSvgY = (y: number) => pallet.minY + pallet.maxY - y;

  return (
    <svg
      viewBox={`${pallet.minX - padding} ${pallet.minY - padding} ${width + padding * 2} ${height + padding * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={preview.label}
      className={className}
    >
      <title>{preview.label}</title>
      <rect
        x={pallet.minX}
        y={toSvgY(pallet.maxY)}
        width={width}
        height={height}
        fill="var(--canvas)"
        stroke="var(--line)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {preview.items.map((item) => {
        const y = toSvgY(item.centerMm.y);
        return (
          <rect
            key={item.id}
            x={item.centerMm.x - item.sizeMm.x / 2}
            y={y - item.sizeMm.y / 2}
            width={item.sizeMm.x}
            height={item.sizeMm.y}
            fill="var(--plan-fill)"
            stroke="var(--plan-stroke)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error,
  integer = false,
  optional = false,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  integer?: boolean;
  optional?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[11px] font-medium text-[var(--muted)]">
      {label}
      {optional ? " (optional)" : ""}
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        min={integer ? "1" : "0"}
        step={integer ? "1" : "any"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="ui-input min-h-[44px] font-mono text-base"
      />
      {error ? (
        <span className="text-[11px] text-[var(--danger)]">{error}</span>
      ) : null}
    </label>
  );
}

function Panel({
  step,
  children,
}: {
  step: MobilePlanStep;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--line)] bg-[var(--surface)]">
      <header className="border-b border-[var(--line)] px-3 py-2">
        <h2 className="text-[13px] font-semibold text-[var(--ink)]">
          {STEP_TITLES[step]}
        </h2>
        <p className="text-[11px] text-[var(--muted)]">
          {STEP_SUBTITLES[step]}
        </p>
      </header>
      <div className="grid gap-3 p-3">{children}</div>
    </section>
  );
}

export function MobilePlanner() {
  const [screen, setScreen] = useState<Screen>("library");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("loading");
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<MobilePlanDraft>(createMobilePlanDraft);
  const [fieldErrors, setFieldErrors] = useState<MobilePlanFieldErrors>({});
  const [plan, setPlan] = useState<ParsedMobilePlan | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [solverInput, setSolverInput] = useState<LayerSolverInput | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [progress, setProgress] = useState<SolverProgress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SolverCandidate[] | null>(null);
  const [totalLayoutCount, setTotalLayoutCount] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [savedCandidateRank, setSavedCandidateRank] = useState<number | null>(
    null,
  );

  const clientRef = useRef<LayerSolverClient | null>(null);
  const handleRef = useRef<SolverRunHandle | null>(null);
  const generationRef = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const repositoryRef = useRef<ProjectRepository | null>(null);

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

  const loadLibrary = async () => {
    setLibraryStatus("loading");
    try {
      repositoryRef.current ??= createProjectRepository();
      const result = await repositoryRef.current.listProjects({
        sortBy: "updatedAt",
        sortDirection: "desc",
      });
      setProjects(result.projects);
      setLibraryStatus("ready");
    } catch (cause) {
      console.error("Loading the project library failed", cause);
      setProjects(null);
      setLibraryStatus("failed");
    }
  };

  useEffect(() => {
    if (screen === "library") void loadLibrary();
  }, [screen]);

  const openDetail = (entry: Project) => {
    setDetailProject(entry);
    setExportStatus("idle");
    setExportError(null);
    setScreen("detail");
  };

  const updateDraft = (update: Partial<MobilePlanDraft>) => {
    setDraft((current) => ({ ...current, ...update }));
  };

  const continueFromPackage = () => {
    const { errors } = parseMobilePlanDraft(draft);
    const stepErrors = stepFieldErrors(errors, MOBILE_PACKAGE_STEP_FIELDS);
    setFieldErrors(stepErrors);
    if (hasErrors(stepErrors)) return;
    setScreen("pallet");
  };

  const startGeneration = () => {
    const parsed = parseMobilePlanDraft(draft);
    setFieldErrors(parsed.errors);
    if (!parsed.plan) {
      if (
        hasErrors(stepFieldErrors(parsed.errors, MOBILE_PACKAGE_STEP_FIELDS))
      ) {
        setScreen("package");
      }
      return;
    }

    let nextProject: Project;
    let input: LayerSolverInput;
    try {
      nextProject = buildMobilePlanProject(parsed.plan, {
        id: projectIdRef.current ?? undefined,
      });
      input = createMobilePlanSolverInput(
        nextProject,
        parsed.plan.packagesPerLayer,
      );
    } catch (cause) {
      setFailure(errorMessage(cause, "The plan inputs are invalid."));
      return;
    }
    projectIdRef.current = nextProject.id;

    const validation = validateAndNormalizeSolverInput(input);
    setPlan(parsed.plan);
    setProject(nextProject);
    setSolverInput(input);
    setCandidates(null);
    setTotalLayoutCount(0);
    setSelectedCandidateId(null);
    setSaveStatus("idle");
    setSaveError(null);
    setSavedCandidateRank(null);
    setFailure(null);
    setScreen("pattern");

    if (!validation.valid) {
      setRunStatus("failed");
      setFailure(
        validation.issues.map(({ message }) => message).join(" ") ||
          "The plan inputs are invalid.",
      );
      return;
    }

    const client = clientRef.current;
    if (!client) {
      setRunStatus("failed");
      setFailure("The solver is not available yet. Try again.");
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    setRunStatus("running");
    setProgress(null);
    const handle = client.run(input, {
      includeSymmetryVariants: true,
      progressBatchSize: 25,
      onProgress: ({ runId, progress: nextProgress }) => {
        if (
          generationRef.current !== generation ||
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
          handleRef.current?.runId !== handle.runId
        ) {
          return;
        }
        handleRef.current = null;
        setProgress(null);
        const distinct = selectDistinctCandidateLayouts(
          result.candidates,
          input.package.dimensionsMm,
        );
        setTotalLayoutCount(distinct.length);
        const displayed = distinct.slice(0, MAX_DISPLAYED_CANDIDATES);
        setCandidates(displayed);
        setSelectedCandidateId(displayed[0]?.id ?? null);
        setRunStatus("completed");
      })
      .catch((cause: unknown) => {
        if (generationRef.current !== generation) return;
        handleRef.current = null;
        setProgress(null);
        if (cause instanceof SolverRunCancelledError) {
          setRunStatus("idle");
          return;
        }
        console.error("Solver worker failed", cause);
        setRunStatus("failed");
        setFailure(errorMessage(cause, "Solver failed:"));
      });
  };

  const cancelGeneration = () => {
    generationRef.current += 1;
    handleRef.current?.cancel();
    handleRef.current = null;
    setRunStatus("idle");
    setProgress(null);
    setScreen("pallet");
  };

  const savePlan = async () => {
    const candidate = candidates?.find(({ id }) => id === selectedCandidateId);
    if (!project || !solverInput || !plan || !candidate) return;

    setSaveStatus("saving");
    setSaveError(null);
    try {
      const persisted = projectWithMobilePlanStack(
        project,
        candidate,
        solverInput,
        plan.layerCount,
      );
      repositoryRef.current ??= createProjectRepository();
      await repositoryRef.current.saveProject(persisted);
      setProject(persisted);
      setSavedCandidateRank(candidate.rank);
      setSaveStatus("saved");
      setExportStatus("idle");
      setExportError(null);
    } catch (cause) {
      console.error("Saving the plan failed", cause);
      setSaveStatus("failed");
      setSaveError(errorMessage(cause, "Saving failed:"));
    }
  };

  const startOver = () => {
    generationRef.current += 1;
    handleRef.current?.cancel();
    handleRef.current = null;
    projectIdRef.current = null;
    setDraft(createMobilePlanDraft());
    setFieldErrors({});
    setPlan(null);
    setProject(null);
    setSolverInput(null);
    setRunStatus("idle");
    setProgress(null);
    setFailure(null);
    setCandidates(null);
    setTotalLayoutCount(0);
    setSelectedCandidateId(null);
    setSaveStatus("idle");
    setSaveError(null);
    setSavedCandidateRank(null);
    setExportStatus("idle");
    setExportError(null);
    setScreen("package");
  };

  const exportRob = (source: Project) => {
    setExportStatus("idle");
    setExportError(null);
    const result = exportProjectRobDownload(source);
    if (!result.ok || !result.text) {
      setExportStatus("failed");
      setExportError(
        result.diagnostics.map(({ message }) => message).join(" ") ||
          "The .rob file could not be exported.",
      );
      return;
    }
    downloadText(result.fileName, result.text);
  };

  const summary = useMemo(
    () => (plan && project ? summarizeMobilePlan(plan, project) : null),
    [plan, project],
  );

  const selectedCandidate =
    candidates?.find(({ id }) => id === selectedCandidateId) ?? null;
  const selectedIndex =
    candidates && selectedCandidate
      ? candidates.findIndex(({ id }) => id === selectedCandidate.id)
      : -1;
  const candidateCarouselRef = useRef<HTMLDivElement>(null);
  const selectCandidateAt = (index: number) => {
    const next = candidates?.[index];
    if (!next) return;
    setSelectedCandidateId(next.id);
    const card = candidateCarouselRef.current?.children[index];
    if (card instanceof HTMLElement) {
      card.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  };

  const stepIndex = (MOBILE_PLAN_STEPS as readonly string[]).indexOf(screen);
  const detailSummary = detailProject
    ? summarizeSavedProject(detailProject)
    : null;
  const detailPreview = detailProject
    ? savedProjectPatternPreview(detailProject)
    : null;
  const headerSubtitle =
    screen === "library"
      ? "Saved plans"
      : screen === "detail"
        ? (detailSummary?.title ?? "Plan")
        : STEP_TITLES[screen];

  const goBack = () => {
    if (screen === "pallet") setScreen("package");
    else if (screen === "pattern") setScreen("pallet");
    else setScreen("library");
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <header
        className="app-chrome flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-4 pt-3 pb-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div>
          <h1 className="text-sm font-semibold">Pallet planner</h1>
          <p className="text-[11px] text-[var(--muted)]">{headerSubtitle}</p>
        </div>
        {screen === "library" ? (
          projects ? (
            <span className="font-mono text-xs text-[var(--muted)]">
              {projects.length}
            </span>
          ) : null
        ) : stepIndex >= 0 ? (
          <span className="font-mono text-xs text-[var(--muted)]">
            {stepIndex + 1}/{MOBILE_PLAN_STEPS.length}
          </span>
        ) : null}
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {screen === "library" ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={startOver}
              className="ui-btn-primary h-11 text-sm"
            >
              Create new plan
            </button>
            {libraryStatus === "loading" ? (
              <p className="text-xs text-[var(--muted)]">
                Loading saved plans…
              </p>
            ) : null}
            {libraryStatus === "failed" ? (
              <div
                role="alert"
                className="grid gap-2 border border-[var(--danger)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--danger)]"
              >
                The project library could not be loaded.
                <button
                  type="button"
                  onClick={() => void loadLibrary()}
                  className="ui-btn h-11 text-xs text-[var(--ink)]"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {libraryStatus === "ready" && projects && projects.length === 0 ? (
              <p className="border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--muted)]">
                No saved plans yet. Create your first plan above.
              </p>
            ) : null}
            {libraryStatus === "ready" && projects
              ? projects.map((entry) => {
                  const item = summarizeSavedProject(entry);
                  const preview = savedProjectPatternPreview(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => openDetail(entry)}
                      className="flex w-full items-center gap-3 border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-left"
                    >
                      {preview ? (
                        <MobilePatternThumbnail
                          preview={preview}
                          className="h-16 w-20 shrink-0"
                        />
                      ) : null}
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-[var(--ink)]">
                            {item.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-[var(--muted)]">
                            {new Date(entry.updatedAt).toLocaleDateString()}
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-[var(--muted)]">
                          {item.packageLabel} · {item.palletLabel}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--muted)]">
                          {item.packagesPerLayer !== null
                            ? `${item.packagesPerLayer}/layer · ${item.layerCount} layers · ${item.totalPackages} packages`
                            : "No pattern yet"}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="shrink-0 text-lg text-[var(--muted)]"
                      >
                        ›
                      </span>
                    </button>
                  );
                })
              : null}
          </div>
        ) : null}

        {screen === "detail" && detailProject && detailSummary ? (
          <section className="grid gap-3 border border-[var(--line)] bg-[var(--surface)] p-3">
            <header className="grid gap-0.5">
              <h2 className="text-[13px] font-semibold text-[var(--ink)]">
                {detailSummary.title}
              </h2>
              <p className="font-mono text-[11px] text-[var(--muted)]">
                {detailSummary.packageLabel} · {detailSummary.palletLabel}
              </p>
              <p className="font-mono text-[11px] text-[var(--muted)]">
                {detailSummary.packagesPerLayer !== null
                  ? `${detailSummary.packagesPerLayer}/layer · ${detailSummary.layerCount} layers · ${detailSummary.totalPackages} packages`
                  : "No pattern saved yet"}
              </p>
              {detailProject.projectNumber.trim() ? (
                <p className="font-mono text-[11px] text-[var(--muted)]">
                  Line {detailProject.projectNumber}
                </p>
              ) : null}
            </header>
            {detailPreview ? (
              <MobilePatternThumbnail
                preview={detailPreview}
                className="h-56 w-full"
              />
            ) : (
              <p className="border border-[var(--line)] px-3 py-3 text-xs text-[var(--muted)]">
                This plan has no saved pattern yet. Open it in the desktop
                workspace to generate one.
              </p>
            )}
            {exportStatus === "failed" && exportError ? (
              <div
                role="alert"
                className="border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]"
              >
                {exportError}
              </div>
            ) : null}
          </section>
        ) : null}

        {screen === "package" ? (
          <Panel step="package">
            <label className="grid gap-1 text-[11px] font-medium text-[var(--muted)]">
              Product number (optional)
              <input
                type="text"
                value={draft.productNumber}
                placeholder="1329-00004"
                onChange={(event) =>
                  updateDraft({ productNumber: event.target.value })
                }
                className="ui-input min-h-[44px] text-base"
              />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-[var(--muted)]">
              Line number (optional)
              <input
                type="text"
                value={draft.lineNumber}
                placeholder="AP-5006"
                onChange={(event) =>
                  updateDraft({ lineNumber: event.target.value })
                }
                className="ui-input min-h-[44px] text-base"
              />
            </label>
            <fieldset className="grid grid-cols-3 gap-2">
              <legend className="col-span-3 mb-1 text-[10px] font-semibold text-[var(--muted)]">
                Package dimensions · mm
              </legend>
              <NumberField
                label="Length"
                value={draft.packageLengthMm}
                error={fieldErrors.packageLengthMm}
                onChange={(packageLengthMm) => updateDraft({ packageLengthMm })}
              />
              <NumberField
                label="Width"
                value={draft.packageWidthMm}
                error={fieldErrors.packageWidthMm}
                onChange={(packageWidthMm) => updateDraft({ packageWidthMm })}
              />
              <NumberField
                label="Height"
                value={draft.packageHeightMm}
                error={fieldErrors.packageHeightMm}
                onChange={(packageHeightMm) => updateDraft({ packageHeightMm })}
              />
            </fieldset>
            <NumberField
              label="Weight per package · kg"
              value={draft.packageWeightKg}
              error={fieldErrors.packageWeightKg}
              optional
              placeholder="e.g. 8.5"
              onChange={(packageWeightKg) => updateDraft({ packageWeightKg })}
            />
          </Panel>
        ) : null}

        {screen === "pallet" ? (
          <Panel step="pallet">
            <div className="grid grid-cols-3 gap-2">
              {PALLET_CHOICES.map(({ kind, label, dims }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => updateDraft({ palletKind: kind })}
                  aria-pressed={draft.palletKind === kind}
                  className={`grid min-h-[44px] gap-0.5 border px-2 py-2 text-center ${
                    draft.palletKind === kind
                      ? "border-[var(--brand)] bg-[var(--plan-fill)]"
                      : "border-[var(--line)] bg-[var(--surface)]"
                  }`}
                >
                  <span className="text-xs font-semibold text-[var(--ink)]">
                    {label}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--muted)]">
                    {dims}
                  </span>
                </button>
              ))}
            </div>
            {draft.palletKind === "custom" ? (
              <fieldset className="grid grid-cols-3 gap-2">
                <legend className="col-span-3 mb-1 text-[10px] font-semibold text-[var(--muted)]">
                  Pallet dimensions · mm
                </legend>
                <NumberField
                  label="Length"
                  value={draft.palletLengthMm}
                  error={fieldErrors.palletLengthMm}
                  onChange={(palletLengthMm) => updateDraft({ palletLengthMm })}
                />
                <NumberField
                  label="Width"
                  value={draft.palletWidthMm}
                  error={fieldErrors.palletWidthMm}
                  onChange={(palletWidthMm) => updateDraft({ palletWidthMm })}
                />
                <NumberField
                  label="Height"
                  value={draft.palletHeightMm}
                  error={fieldErrors.palletHeightMm}
                  onChange={(palletHeightMm) => updateDraft({ palletHeightMm })}
                />
              </fieldset>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Packages per layer"
                value={draft.packagesPerLayer}
                error={fieldErrors.packagesPerLayer}
                integer
                placeholder="Required"
                onChange={(packagesPerLayer) =>
                  updateDraft({ packagesPerLayer })
                }
              />
              <NumberField
                label="Layers"
                value={draft.layerCount}
                error={fieldErrors.layerCount}
                integer
                onChange={(layerCount) => updateDraft({ layerCount })}
              />
            </div>
            {failure ? (
              <div
                role="alert"
                className="border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]"
              >
                {failure}
              </div>
            ) : null}
          </Panel>
        ) : null}

        {screen === "pattern" ? (
          <div className="grid gap-3">
            {summary ? (
              <p className="font-mono text-[11px] text-[var(--muted)]">
                {summary.packageLabel} · {summary.palletLabel} ·{" "}
                {summary.packagesPerLayer}/layer · {summary.layerCount} layers ·{" "}
                {summary.totalPackages} packages
              </p>
            ) : null}

            {runStatus === "running" ? (
              <div
                aria-live="polite"
                className="grid gap-2 border border-[var(--line)] bg-[var(--surface)] p-3"
              >
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink)]">
                  <span>
                    {progress?.phase ?? "starting"}
                    {progress?.generator ? ` · ${progress.generator}` : ""}
                  </span>
                  <span className="font-mono text-[var(--muted)]">
                    {progress?.completed ?? 0}
                    {progress?.total == null ? "" : ` / ${progress.total}`}
                  </span>
                </div>
                <progress
                  max={
                    progress?.total ??
                    Math.max(1, (progress?.completed ?? 0) + 1)
                  }
                  value={progress?.completed ?? 0}
                  className="h-1.5 w-full accent-[var(--brand)]"
                />
                <span className="text-[11px] text-[var(--muted)]">
                  {progress?.message ?? "Starting solver worker."}
                </span>
                <button
                  type="button"
                  onClick={cancelGeneration}
                  className="ui-btn h-11 border-[var(--danger)] text-xs font-medium text-[var(--danger)]"
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {failure ? (
              <div
                role="alert"
                className="grid gap-2 border border-[var(--danger)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--danger)]"
              >
                {failure}
                <button
                  type="button"
                  onClick={() => setScreen("pallet")}
                  className="ui-btn h-11 text-xs text-[var(--ink)]"
                >
                  Adjust inputs
                </button>
              </div>
            ) : null}

            {runStatus === "completed" && candidates ? (
              candidates.length === 0 ? (
                <div className="grid gap-2 border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-xs text-[var(--ink)]">
                  No layout fits {summary?.packagesPerLayer} packages on this
                  pallet. Try fewer packages per layer or a larger pallet.
                  <button
                    type="button"
                    onClick={() => setScreen("pallet")}
                    className="ui-btn h-11 text-xs"
                  >
                    Adjust inputs
                  </button>
                </div>
              ) : saveStatus === "saved" ? (
                <section className="grid gap-3 border border-[var(--line)] bg-[var(--surface)] p-3">
                  <p className="text-[13px] font-semibold text-[var(--ok)]">
                    Plan saved to the project library.
                  </p>
                  <p className="font-mono text-[11px] text-[var(--muted)]">
                    {summary?.packageLabel} · pattern #{savedCandidateRank} ·{" "}
                    {summary?.packagesPerLayer}
                    /layer · {summary?.layerCount} layers ·{" "}
                    {summary?.totalPackages} packages
                  </p>
                  {exportStatus === "failed" && exportError ? (
                    <div
                      role="alert"
                      className="border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]"
                    >
                      {exportError}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (project) exportRob(project);
                    }}
                    className="ui-btn-primary h-11 text-sm"
                  >
                    Export .rob
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (project) openDetail(project);
                    }}
                    className="ui-btn h-11 text-sm"
                  >
                    Open plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setScreen("library")}
                    className="ui-btn h-11 text-sm"
                  >
                    Project library
                  </button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="ui-btn h-11 text-sm"
                  >
                    Create another plan
                  </button>
                  <Link
                    href="/?layout=desktop"
                    onClick={(event) => {
                      event.preventDefault();
                      window.location.assign("/?layout=desktop");
                    }}
                    className="ui-btn flex h-11 items-center justify-center text-sm"
                  >
                    Advanced workspace · desktop recommended
                  </Link>
                </section>
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-[var(--muted)]">
                      {totalLayoutCount > candidates.length
                        ? `Best ${candidates.length} of ${totalLayoutCount} layouts`
                        : `${candidates.length} layouts, best first`}
                    </span>
                    <span className="font-mono text-xs text-[var(--muted)]">
                      {selectedIndex + 1}/{candidates.length}
                    </span>
                  </div>
                  <p aria-live="polite" className="sr-only">
                    {selectedCandidate
                      ? `Layout ${selectedIndex + 1} of ${candidates.length} selected. ${
                          candidateRankReason(
                            selectedCandidate,
                            candidates[selectedIndex + 1] ?? null,
                          ) ?? ""
                        }`
                      : ""}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={selectedIndex <= 0}
                      onClick={() => selectCandidateAt(selectedIndex - 1)}
                      className="ui-btn h-11 text-sm"
                    >
                      ‹ Previous
                    </button>
                    <button
                      type="button"
                      disabled={
                        selectedIndex < 0 ||
                        selectedIndex >= candidates.length - 1
                      }
                      onClick={() => selectCandidateAt(selectedIndex + 1)}
                      className="ui-btn h-11 text-sm"
                    >
                      Next ›
                    </button>
                  </div>
                  <div
                    ref={candidateCarouselRef}
                    className="flex snap-x gap-3 overflow-x-auto pb-1"
                  >
                    {candidates.map((candidate, index) => {
                      const selected = candidate.id === selectedCandidateId;
                      const rankReason = candidateRankReason(
                        candidate,
                        candidates[index + 1] ?? null,
                      );
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => setSelectedCandidateId(candidate.id)}
                          aria-pressed={selected}
                          disabled={saveStatus === "saving"}
                          className={`w-[70vw] max-w-[280px] shrink-0 snap-center border p-2 text-left ${
                            selected
                              ? "border-[var(--brand)] bg-[var(--plan-fill)]"
                              : "border-[var(--line)] bg-[var(--surface)]"
                          }`}
                        >
                          <MobilePatternThumbnail
                            preview={solverCandidateToPatternPreview(
                              candidate,
                              solverInput!,
                              {
                                physicalPalletBoundsMm:
                                  solverInput!.physicalPalletBoundsMm,
                              },
                            )}
                          />
                          <span className="mt-2 flex items-center justify-between font-mono text-[11px] text-[var(--ink)]">
                            <span>#{candidate.rank}</span>
                            <span>
                              {candidate.metrics.utilizationPercent.toFixed(1)}%
                            </span>
                            <span>
                              {candidate.metrics.provisionalCycleCount} cycles
                            </span>
                          </span>
                          {rankReason ? (
                            <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
                              {rankReason}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {saveStatus === "failed" && saveError ? (
                    <div
                      role="alert"
                      className="border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]"
                    >
                      {saveError}
                    </div>
                  ) : null}
                </>
              )
            ) : null}
          </div>
        ) : null}
      </main>

      {screen !== "library" &&
      !(screen === "pattern" && saveStatus === "saved") ? (
        <footer
          className="app-chrome flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 pt-3 pb-3"
          style={{
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <button
            type="button"
            onClick={goBack}
            disabled={runStatus === "running"}
            className="ui-btn h-11 px-4 text-sm"
          >
            Back
          </button>
          {screen === "package" ? (
            <button
              type="button"
              onClick={continueFromPackage}
              className="ui-btn-primary h-11 flex-1 text-sm"
            >
              Continue
            </button>
          ) : null}
          {screen === "pallet" ? (
            <button
              type="button"
              onClick={startGeneration}
              className="ui-btn-primary h-11 flex-1 text-sm"
            >
              Generate pattern
            </button>
          ) : null}
          {screen === "pattern" ? (
            <button
              type="button"
              onClick={() => void savePlan()}
              disabled={
                runStatus !== "completed" ||
                !selectedCandidate ||
                saveStatus === "saving"
              }
              className="ui-btn-primary h-11 flex-1 text-sm"
            >
              {saveStatus === "saving" ? "Saving…" : "Save plan"}
            </button>
          ) : null}
          {screen === "detail" ? (
            <button
              type="button"
              onClick={() => {
                if (detailProject) exportRob(detailProject);
              }}
              disabled={!detailPreview}
              className="ui-btn-primary h-11 flex-1 text-sm"
            >
              Export .rob
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
