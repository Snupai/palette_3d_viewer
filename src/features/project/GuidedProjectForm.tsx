"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { z } from "zod";
import type { Project } from "~/domain/project/projectSchema";
import { useLocale, useT } from "~/i18n";
import { PlanRender } from "~/features/planner/PlanRender";
import {
  EXACT_COUNT_PATH,
  syncAutomaticStorage,
  displayedEdgeForPackageSide,
  geometryReviewChanges,
  fieldPathByValue,
  firstSectionWithError,
  formatNumber,
  overhangPerSideHint,
  fieldErrorMessage,
  guidedSectionOrder,
  guidedSectionTitle,
  loadAreaMm,
  packageDimensions,
  packageSideForDisplayedEdge,
  parseExactPackageCount,
  sectionForErrorPath,
  sectionSummary,
  simpleGridCount,
  solverInputChanges,
  validateProjectFormValues,
  type GuidedSectionId,
  type LabelEdge,
} from "~/features/project/guidedProjectFormModel";
import type { ProjectDialogSubmission } from "~/features/project/ProjectDialog";
import { applySheetToFormValues } from "~/features/project/sheetImport";
import { SheetPhotoImport } from "~/features/project/SheetPhotoImport";
import { aiFeaturesEnabled } from "~/lib/aiFeatures";
import type { PalletSheet } from "~/domain/sheetExtraction";
import {
  buildProjectFromForm,
  palletTemplateFormValues,
  projectToFormValues,
  zodFieldErrors,
  type ProjectFieldErrors,
  type ProjectFormValues,
} from "~/features/project/projectForm";

export type GuidedProjectFormProps = {
  project: Project | null;
  /** Section opened first; defaults to the package section. */
  initialSection?: GuidedSectionId;
  onClose: () => void;
  onSave: (
    submission: ProjectDialogSubmission,
  ) => Promise<"cancelled" | void> | "cancelled" | void;
  /**
   * True while the inputs differ from the opened project (or the blank new
   * form) or an exact count is entered; false after a successful save and on
   * unmount. The caller owns any discard confirmation.
   */
  onDirtyChange?: (dirty: boolean) => void;
};

function domId(base: string, path: string): string {
  return `${base}-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

type NumberFieldProps = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  hint?: ReactNode;
  error?: string;
  big?: boolean;
  min?: string;
  step?: string;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  onBlur: () => void;
};

function NumberField({
  id,
  label,
  value,
  unit,
  hint,
  error,
  big = false,
  min,
  step = "any",
  inputMode = "decimal",
  placeholder,
  disabled,
  inputRef,
  onChange,
  onBlur,
}: NumberFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className={`fw-field${big ? "fw-field-big" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="fw-ctl" data-invalid={error ? "true" : undefined}>
        <input
          ref={inputRef}
          id={id}
          type="number"
          inputMode={inputMode}
          min={min}
          step={step}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {unit ? <span className="fw-unit">{unit}</span> : null}
      </div>
      {error ? (
        <span id={hintId} className="fw-hint fw-hint-bad">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="fw-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  hint?: ReactNode;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

function TextField({
  id,
  label,
  value,
  hint,
  error,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: TextFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="fw-field">
      <label htmlFor={id}>{label}</label>
      <div className="fw-ctl" data-invalid={error ? "true" : undefined}>
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      </div>
      {error ? (
        <span id={hintId} className="fw-hint fw-hint-bad">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="fw-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

type SectionStatus = "ok" | "error" | "todo";

function SectionMark({
  status,
  index,
}: {
  status: SectionStatus;
  index: number;
}) {
  if (status === "ok") {
    return (
      <span className="fw-sec-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className="fw-sec-mark" aria-hidden="true">
      {status === "error" ? "!" : index}
    </span>
  );
}

type SectionProps = {
  id: string;
  index: number;
  title: string;
  summary: string;
  status: SectionStatus;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** Collapsed sections keep their fields mounted so typing never rebuilds them. */
function Section({
  id,
  index,
  title,
  summary,
  status,
  open,
  onToggle,
  children,
}: SectionProps) {
  const t = useT();
  const bodyId = `${id}-body`;
  const statusText =
    status === "error"
      ? t("projectForm.sectionStatus.error")
      : status === "ok"
        ? t("projectForm.sectionStatus.ok")
        : t("projectForm.sectionStatus.todo");
  return (
    <section
      className="fw-sec"
      data-open={open ? "true" : "false"}
      data-status={status}
    >
      <h2 className="fw-sec-h">
        <button
          type="button"
          id={id}
          className="fw-sec-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <SectionMark status={status} index={index} />
          <span className="fw-sec-text">
            <span className="fw-sec-title">{title}</span>
            <span className="fw-sec-sum">
              <span className="sr-only">{statusText}: </span>
              {summary}
            </span>
          </span>
          <span className="fw-sec-act">
            {open ? t("projectForm.collapse") : t("projectForm.change")}
          </span>
        </button>
      </h2>
      <div
        id={bodyId}
        role="region"
        aria-labelledby={id}
        className="fw-sec-body"
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}

const edgeLabelKeys = {
  top: "projectForm.side.top",
  right: "projectForm.side.right",
  bottom: "projectForm.side.bottom",
  left: "projectForm.side.left",
} as const satisfies Record<LabelEdge, string>;

/** Label edge as seen at the infeed; stores the package side like the classic picker. */
function LabelEdgePicker({
  values,
  disabled,
  onChange,
}: {
  values: ProjectFormValues;
  disabled: boolean;
  onChange: (side: ProjectFormValues["labelSideAtPickup"]) => void;
}) {
  const t = useT();
  const box = packageDimensions(values);
  const lengthwise = values.inletOrientation === "lengthwise";
  const along = box ? (lengthwise ? box.length : box.width) : 4;
  const across = box ? (lengthwise ? box.width : box.length) : 3;
  const scale = Math.min(150 / along, 90 / across);
  const width = Math.max(60, along * scale);
  const height = Math.max(40, across * scale);
  const selectedEdge = values.labelSideAtPickup
    ? displayedEdgeForPackageSide(
        values.inletOrientation,
        values.labelSideAtPickup,
      )
    : null;
  return (
    <div className="fw-label-picker">
      <div
        className="fw-label-box"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {(["top", "right", "bottom", "left"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            className={`fw-label-edge fw-label-edge-${edge}`}
            aria-pressed={selectedEdge === edge}
            aria-label={t("projectForm.labelEdgeAria", {
              side: t(edgeLabelKeys[edge]),
            })}
            disabled={disabled}
            onClick={() =>
              onChange(
                selectedEdge === edge
                  ? ""
                  : packageSideForDisplayedEdge(values.inletOrientation, edge),
              )
            }
          >
            <span className="fw-label-edge-text" aria-hidden="true">
              {t(edgeLabelKeys[edge])}
            </span>
          </button>
        ))}
      </div>
      <div className="fw-label-flow" aria-hidden="true">
        {t("projectForm.infeed")}
        <svg viewBox="0 0 24 12" width="24" height="12">
          <path d="M0 6h20M15 1l6 5-6 5" fill="none" stroke="currentColor" />
        </svg>
      </div>
      <p className="fw-hint">
        {t("projectForm.labelEdgeHint")}{" "}
        {selectedEdge ? (
          <button
            type="button"
            className="fw-link"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            {t("projectForm.noPreferenceButton")}
          </button>
        ) : (
          t("projectForm.noPreferenceCurrent")
        )}
      </p>
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="fw-seg-field" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="fw-seg">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function GuidedProjectForm({
  project,
  initialSection = "meta",
  onClose,
  onSave,
  onDirtyChange,
}: GuidedProjectFormProps) {
  const t = useT();
  const { tag } = useLocale();
  const baseId = useId().replace(/:/g, "");
  const id = (path: string) => domId(baseId, path);
  const creating = project === null;
  const [values, setValues] = useState<ProjectFormValues>(() =>
    projectToFormValues(project),
  );
  const [baseline, setBaseline] = useState<ProjectFormValues>(() =>
    projectToFormValues(project),
  );
  const [openSection, setOpenSection] = useState<GuidedSectionId | null>(
    initialSection,
  );
  const [exactPackageCount, setExactPackageCount] = useState("");
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [submitted, setSubmitted] = useState(false);
  const [saveErrors, setSaveErrors] = useState<ProjectFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [readingSheet, setReadingSheet] = useState(false);
  const [stageExpanded, setStageExpanded] = useState(false);
  const saveGeneration = useRef(0);
  useEffect(() => {
    saveGeneration.current += 1;
    return () => {
      saveGeneration.current += 1;
    };
  }, [project?.id]);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const initial = projectToFormValues(project);
    setValues(initial);
    setBaseline(initial);
    setExactPackageCount("");
    setEdited(new Set());
    setRevealed(new Set());
    setSubmitted(false);
    setSaveErrors({});
    setFailure(null);
    setSaving(false);
    setReadingSheet(false);
  }, [project]);

  const dirty =
    exactPackageCount.trim() !== "" ||
    JSON.stringify(values) !== JSON.stringify(baseline);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const reportedDirty = useRef(false);
  useEffect(() => {
    if (reportedDirty.current === dirty) return;
    reportedDirty.current = dirty;
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      if (reportedDirty.current) dirtyCallback.current?.(false);
      reportedDirty.current = false;
    },
    [],
  );

  useEffect(() => {
    // A new plan starts with the sheet-photo import above the sections; an
    // auto-focused field would raise the phone keyboard and scroll past it.
    if (creating) return;
    // Lands the cursor in the first field of the section that opened first.
    const body = document.getElementById(`${id(initialSection)}-body`);
    body?.querySelector<HTMLElement>("input, select, button")?.focus();
    // Runs once per mount; later section changes manage focus explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    document.getElementById(target)?.focus();
  });

  const schemaErrors = useMemo(
    () => validateProjectFormValues(values, project, t),
    [values, project, t],
  );
  const parsedCount = parseExactPackageCount(exactPackageCount);
  const countError =
    exactPackageCount.trim() !== "" && parsedCount === null
      ? t("projectForm.error.wholeNumber")
      : null;

  const visibleError = (path: string): string | undefined => {
    const message =
      saveErrors[path] ??
      (submitted || revealed.has(path) ? schemaErrors[path] : undefined);
    return message ? fieldErrorMessage(message, t) : undefined;
  };

  const explicitStorage = new Set(edited);
  if (!values.automaticStorageLength)
    explicitStorage.add("pallet.storageEnvelopeMm.length");
  if (!values.automaticStorageWidth)
    explicitStorage.add("pallet.storageEnvelopeMm.width");
  const set = <Key extends keyof ProjectFormValues>(
    key: Key,
    value: ProjectFormValues[Key],
  ) => {
    const path = fieldPathByValue[key];
    const explicit = new Set(explicitStorage);
    if (path) explicit.add(path);
    setValues((current) =>
      syncAutomaticStorage(
        {
          ...current,
          [key]: value,
          ...(key === "storageLengthMm"
            ? { automaticStorageLength: false }
            : {}),
          ...(key === "storageWidthMm" ? { automaticStorageWidth: false } : {}),
        },
        explicit,
      ),
    );
    if (path) {
      setEdited((current) =>
        current.has(path) ? current : new Set(current).add(path),
      );
    }
    setSaveErrors((current) =>
      Object.keys(current).length === 0 ? current : {},
    );
  };

  /** Pre-fills the form from a photographed pallet sheet; every value stays editable. */
  const applySheet = (sheet: PalletSheet) => {
    const patch = applySheetToFormValues(values, sheet);
    const changedPaths = (
      Object.keys(patch.values) as (keyof ProjectFormValues)[]
    )
      .filter((key) => patch.values[key] !== values[key])
      .map((key) => fieldPathByValue[key])
      .filter((path): path is string => path !== undefined);
    const explicit = new Set(explicitStorage);
    for (const path of changedPaths) explicit.add(path);
    setValues(syncAutomaticStorage(patch.values, explicit));
    setExactPackageCount(patch.exactPackageCount);
    setEdited((current) => {
      const next = new Set(current);
      for (const path of changedPaths) next.add(path);
      return next;
    });
    setSaveErrors({});
    setFailure(null);
  };

  const reveal = (key: keyof ProjectFormValues) => () => {
    const path = fieldPathByValue[key];
    if (!path || !edited.has(path)) return;
    setRevealed((current) =>
      current.has(path) ? current : new Set(current).add(path),
    );
  };

  const sectionErrors = (section: GuidedSectionId) =>
    Object.keys({ ...schemaErrors, ...saveErrors }).filter(
      (path) =>
        sectionForErrorPath(path) === section &&
        visibleError(path) !== undefined,
    );

  const sectionStatus = (section: GuidedSectionId): SectionStatus => {
    if (sectionErrors(section).length > 0) return "error";
    if (section === "package") {
      return packageDimensions(values) &&
        !Object.keys(schemaErrors).some(
          (path) => sectionForErrorPath(path) === "package",
        )
        ? "ok"
        : "todo";
    }
    return Object.keys(schemaErrors).some(
      (path) => sectionForErrorPath(path) === section,
    )
      ? "todo"
      : "ok";
  };

  const firstFocusableId = (section: GuidedSectionId): string | null => {
    const body = document.getElementById(`${id(section)}-body`);
    return (
      body?.querySelector<HTMLElement>("input:not(:disabled), select")?.id ??
      null
    );
  };

  const openAndFocus = (section: GuidedSectionId, elementId?: string) => {
    setOpenSection(section);
    pendingFocus.current =
      elementId ?? firstFocusableId(section) ?? id(section);
  };

  const toggle = (section: GuidedSectionId) => {
    setOpenSection((current) => (current === section ? null : section));
  };

  const nextSection = (section: GuidedSectionId) => {
    const index = guidedSectionOrder.indexOf(section);
    const next = guidedSectionOrder[index + 1];
    if (next) openAndFocus(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const shouldGenerate =
      creating &&
      (!(submitter instanceof HTMLButtonElement) ||
        submitter.value !== "create-only");
    setSubmitted(true);
    setFailure(null);
    setSaveErrors({});

    const firstSection = firstSectionWithError(schemaErrors);
    const missingCount = shouldGenerate && parsedCount === null;
    if (firstSection) {
      const firstPath = Object.keys(schemaErrors).find(
        (path) => sectionForErrorPath(path) === firstSection,
      );
      openAndFocus(firstSection, firstPath ? id(firstPath) : undefined);
      setFailure(
        missingCount
          ? t("projectForm.failure.fixAndCount")
          : t("projectForm.failure.fix"),
      );
      return;
    }
    if (missingCount) {
      pendingFocus.current = id(EXACT_COUNT_PATH);
      setFailure(t("projectForm.failure.countRequired"));
      return;
    }

    setSaving(true);
    const generation = saveGeneration.current;
    try {
      const next = buildProjectFromForm(values, project);
      const outcome = await onSave({
        project: next,
        generationIntent:
          shouldGenerate && parsedCount !== null
            ? { exactPackageCount: parsedCount }
            : null,
      });
      if (outcome === "cancelled" || generation !== saveGeneration.current)
        return;
      // Saved: report clean before the caller closes and guards navigation.
      setBaseline(values);
      setExactPackageCount("");
      if (reportedDirty.current) {
        reportedDirty.current = false;
        dirtyCallback.current?.(false);
      }
      onClose();
    } catch (cause) {
      if (generation !== saveGeneration.current) return;
      if (cause instanceof z.ZodError) {
        const errors = zodFieldErrors(cause);
        setSaveErrors(errors);
        const section = firstSectionWithError(errors);
        if (section) openAndFocus(section);
        setFailure(t("projectForm.failure.fix"));
      } else {
        console.error("Failed to save planner project", cause);
        setFailure(
          cause instanceof Error
            ? t("projectForm.failure.saveWithReason", {
                reason: cause.message,
              })
            : t("projectForm.failure.save"),
        );
      }
    } finally {
      if (generation === saveGeneration.current) setSaving(false);
    }
  };

  const box = packageDimensions(values);
  const area = loadAreaMm(values);
  const gridCount = simpleGridCount(values);
  const palletHeight = Number(values.palletHeightMm);
  const palletLength = Number(values.palletLengthMm);
  const palletWidth = Number(values.palletWidthMm);
  const changesPatterns = project ? solverInputChanges(project, values) : null;
  const changesGeometry = project
    ? geometryReviewChanges(project, values)
    : null;
  const openErrorCount = Object.keys(schemaErrors).length;

  const footerHint = (() => {
    if (failure) return null;
    if (!creating) {
      if (changesPatterns === true) {
        return t("projectForm.footer.patternsDiscarded");
      }
      if (changesPatterns === false && changesGeometry === true) {
        return t("projectForm.footer.geometryReview");
      }
      if (changesPatterns === false) {
        return t("projectForm.footer.patternsKept");
      }
      return t("projectForm.footer.notAllValid");
    }
    if (!box) return t("projectForm.footer.enterDimensions");
    if (openErrorCount > 0) return t("projectForm.footer.someInvalid");
    if (parsedCount === null) {
      return t("projectForm.footer.enterCount");
    }
    return t("projectForm.footer.allValid");
  })();

  const field = (
    key: keyof ProjectFormValues,
  ): { id: string; error?: string; onBlur: () => void } => {
    const path = fieldPathByValue[key] ?? key;
    return { id: id(path), error: visibleError(path), onBlur: reveal(key) };
  };

  return (
    <form
      className="fw fw-inputs"
      noValidate
      aria-busy={saving}
      aria-labelledby={`${baseId}-title`}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || saving || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="fw-layout">
        <div className="fw-main">
          <header className="fw-intro">
            <h1 id={`${baseId}-title`}>
              {creating
                ? t("projectForm.titleCreate")
                : t("projectForm.titleEdit")}
            </h1>
          </header>

          {failure ? (
            <div role="alert" className="fw-alert">
              {failure}
            </div>
          ) : null}

          {creating && aiFeaturesEnabled ? (
            <SheetPhotoImport
              disabled={saving}
              onBusyChange={setReadingSheet}
              onExtracted={({ sheet }) => applySheet(sheet)}
            />
          ) : null}

          <div className="fw-sections">
            <Section
              id={id("meta")}
              index={1}
              title={guidedSectionTitle("meta", t)}
              summary={sectionSummary("meta", values, t, tag)}
              status={sectionStatus("meta")}
              open={openSection === "meta"}
              onToggle={() => toggle("meta")}
            >
              <div className="fw-grid2">
                <TextField
                  {...field("productNumber")}
                  label={t("projectForm.productNumber")}
                  placeholder={t("projectForm.productNumberPlaceholder")}
                  value={values.productNumber}
                  onChange={(value) => set("productNumber", value)}
                />
                <TextField
                  {...field("projectNumber")}
                  label={t("projectForm.projectNumber")}
                  placeholder={t("projectForm.projectNumberPlaceholder")}
                  value={values.projectNumber}
                  onChange={(value) => set("projectNumber", value)}
                />
              </div>
              <div className="fw-sec-foot">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => nextSection("meta")}
                >
                  {t("projectForm.next.package")}
                </button>
              </div>
            </Section>

            <Section
              id={id("package")}
              index={2}
              title={guidedSectionTitle("package", t)}
              summary={sectionSummary("package", values, t, tag)}
              status={sectionStatus("package")}
              open={openSection === "package"}
              onToggle={() => toggle("package")}
            >
              <div className="fw-grid3">
                <NumberField
                  {...field("packageLengthMm")}
                  big
                  label={t("projectForm.length")}
                  unit="mm"
                  min="0"
                  value={values.packageLengthMm}
                  onChange={(value) => set("packageLengthMm", value)}
                />
                <NumberField
                  {...field("packageWidthMm")}
                  big
                  label={t("projectForm.width")}
                  unit="mm"
                  min="0"
                  value={values.packageWidthMm}
                  onChange={(value) => set("packageWidthMm", value)}
                />
                <NumberField
                  {...field("packageHeightMm")}
                  big
                  label={t("projectForm.height")}
                  unit="mm"
                  min="0"
                  value={values.packageHeightMm}
                  onChange={(value) => set("packageHeightMm", value)}
                />
              </div>
              <div className="fw-grid2">
                <NumberField
                  {...field("packageWeightKg")}
                  label={t("projectForm.packageWeight")}
                  unit="kg"
                  min="0"
                  placeholder={t("projectForm.unknown")}
                  value={values.packageWeightKg}
                  onChange={(value) => set("packageWeightKg", value)}
                />
                <NumberField
                  {...field("packageClearanceMm")}
                  label={t("projectForm.packageClearance")}
                  unit="mm"
                  min="0"
                  value={values.packageClearanceMm}
                  onChange={(value) => set("packageClearanceMm", value)}
                />
              </div>
              <div className="fw-sec-foot">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => nextSection("package")}
                >
                  {t("projectForm.next.pallet")}
                </button>
              </div>
            </Section>

            <Section
              id={id("pallet")}
              index={3}
              title={guidedSectionTitle("pallet", t)}
              summary={sectionSummary("pallet", values, t, tag)}
              status={sectionStatus("pallet")}
              open={openSection === "pallet"}
              onToggle={() => toggle("pallet")}
            >
              <div className="fw-grid2">
                <div className="fw-field">
                  <label htmlFor={id("palletKind")}>
                    {t("projectForm.palletType")}
                  </label>
                  <div className="fw-ctl">
                    <select
                      id={id("palletKind")}
                      value={values.palletKind}
                      disabled={saving}
                      onChange={(event) => {
                        const kind = event.target
                          .value as ProjectFormValues["palletKind"];
                        if (kind === "custom") {
                          setValues((current) => ({
                            ...current,
                            palletKind: "custom",
                            palletId: current.palletId.startsWith("pallet-")
                              ? ""
                              : current.palletId,
                            palletName:
                              current.palletName ||
                              t("projectForm.palletKind.custom"),
                          }));
                        } else {
                          setValues((current) =>
                            syncAutomaticStorage(
                              {
                                ...palletTemplateFormValues(kind, current),
                                storageLengthMm: current.storageLengthMm,
                                storageWidthMm: current.storageWidthMm,
                              },
                              explicitStorage,
                            ),
                          );
                        }
                        setSaveErrors({});
                      }}
                    >
                      <option value="euro">
                        {t("projectForm.palletKind.euro")}
                      </option>
                      <option value="industrial">
                        {t("projectForm.palletKind.industrial")}
                      </option>
                      <option value="custom">
                        {t("projectForm.palletKind.custom")}
                      </option>
                    </select>
                  </div>
                </div>
                <TextField
                  {...field("palletName")}
                  label={t("projectForm.palletName")}
                  value={values.palletName}
                  onChange={(value) => set("palletName", value)}
                />
              </div>
              {values.palletKind === "custom" ? (
                <TextField
                  {...field("palletId")}
                  label={t("projectForm.palletId")}
                  placeholder={t("projectForm.palletIdPlaceholder")}
                  value={values.palletId}
                  onChange={(value) => set("palletId", value)}
                />
              ) : null}
              <div className="fw-grid3">
                <NumberField
                  {...field("palletLengthMm")}
                  label={t("projectForm.palletLength")}
                  unit="mm"
                  value={values.palletLengthMm}
                  onChange={(value) => set("palletLengthMm", value)}
                />
                <NumberField
                  {...field("palletWidthMm")}
                  label={t("projectForm.palletWidth")}
                  unit="mm"
                  value={values.palletWidthMm}
                  onChange={(value) => set("palletWidthMm", value)}
                />
                <NumberField
                  {...field("palletHeightMm")}
                  label={t("projectForm.palletHeight")}
                  unit="mm"
                  value={values.palletHeightMm}
                  onChange={(value) => set("palletHeightMm", value)}
                />
              </div>
              <div className="fw-grid2">
                <NumberField
                  {...field("overhangLengthMm")}
                  label={t("projectForm.overhangLength")}
                  unit="mm"
                  hint={overhangPerSideHint(values.overhangLengthMm, t, tag)}
                  value={values.overhangLengthMm}
                  onChange={(value) => set("overhangLengthMm", value)}
                />
                <NumberField
                  {...field("overhangWidthMm")}
                  label={t("projectForm.overhangWidth")}
                  unit="mm"
                  hint={overhangPerSideHint(values.overhangWidthMm, t, tag)}
                  value={values.overhangWidthMm}
                  onChange={(value) => set("overhangWidthMm", value)}
                />
              </div>
              <div className="fw-sec-foot">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => nextSection("pallet")}
                >
                  {t("projectForm.next.limits")}
                </button>
              </div>
            </Section>

            <Section
              id={id("limits")}
              index={4}
              title={guidedSectionTitle("limits", t)}
              summary={sectionSummary("limits", values, t, tag)}
              status={sectionStatus("limits")}
              open={openSection === "limits"}
              onToggle={() => toggle("limits")}
            >
              <label className="fw-check">
                <input
                  type="checkbox"
                  checked={values.hasStorageEnvelope}
                  disabled={saving}
                  onChange={(event) =>
                    set("hasStorageEnvelope", event.target.checked)
                  }
                />
                {t("projectForm.limitStorage")}
              </label>
              {values.hasStorageEnvelope ? (
                <>
                  <NumberField
                    {...field("storageHeightMm")}
                    label={t("projectForm.storageHeight")}
                    unit="mm"
                    value={values.storageHeightMm}
                    onChange={(value) => set("storageHeightMm", value)}
                  />
                  <details
                    className="fw-more"
                    open={
                      Boolean(
                        visibleError("pallet.storageEnvelopeMm.length"),
                      ) ||
                      Boolean(visibleError("pallet.storageEnvelopeMm.width")) ||
                      undefined
                    }
                  >
                    <summary>{t("projectForm.storageArea")}</summary>
                    <div className="fw-grid2">
                      <NumberField
                        {...field("storageLengthMm")}
                        label={t("projectForm.storageLength")}
                        unit="mm"
                        value={values.storageLengthMm}
                        onChange={(value) => set("storageLengthMm", value)}
                      />
                      <NumberField
                        {...field("storageWidthMm")}
                        label={t("projectForm.storageWidth")}
                        unit="mm"
                        value={values.storageWidthMm}
                        onChange={(value) => set("storageWidthMm", value)}
                      />
                    </div>
                  </details>
                </>
              ) : null}
              <div className="fw-grid2">
                <NumberField
                  {...field("tareKg")}
                  label={t("projectForm.tare")}
                  unit="kg"
                  min="0"
                  placeholder={t("projectForm.unknown")}
                  value={values.tareKg}
                  onChange={(value) => set("tareKg", value)}
                />
                <NumberField
                  {...field("maxGrossKg")}
                  label={t("projectForm.maxGross")}
                  unit="kg"
                  min="0"
                  placeholder={t("projectForm.noLimit")}
                  value={values.maxGrossKg}
                  onChange={(value) => set("maxGrossKg", value)}
                />
              </div>
              <div className="fw-sec-foot">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => nextSection("limits")}
                >
                  {t("projectForm.next.handling")}
                </button>
              </div>
            </Section>

            <Section
              id={id("handling")}
              index={5}
              title={guidedSectionTitle("handling", t)}
              summary={sectionSummary("handling", values, t, tag)}
              status={sectionStatus("handling")}
              open={openSection === "handling"}
              onToggle={() => toggle("handling")}
            >
              <div className="fw-grid2 fw-handling">
                <div className="fw-stack-gap">
                  <Segmented
                    legend={t("projectForm.infeed")}
                    name={id("inletOrientation")}
                    value={values.inletOrientation}
                    disabled={saving}
                    options={[
                      {
                        value: "lengthwise",
                        label: t("projectForm.lengthwise"),
                      },
                      {
                        value: "crosswise",
                        label: t("projectForm.crosswise"),
                      },
                    ]}
                    onChange={(value) => set("inletOrientation", value)}
                  />
                  <label className="fw-check">
                    <input
                      type="checkbox"
                      checked={values.multiPickAllowed}
                      disabled={saving}
                      onChange={(event) =>
                        set("multiPickAllowed", event.target.checked)
                      }
                    />
                    {t("projectForm.allowMultiGrip")}
                  </label>
                  {visibleError("package.inletOrientation") ? (
                    <span className="fw-hint fw-hint-bad">
                      {visibleError("package.inletOrientation")}
                    </span>
                  ) : null}
                </div>
                <fieldset className="fw-seg-field" disabled={saving}>
                  <legend>{t("projectForm.label")}</legend>
                  <LabelEdgePicker
                    values={values}
                    disabled={saving}
                    onChange={(side) => set("labelSideAtPickup", side)}
                  />
                </fieldset>
              </div>
            </Section>
          </div>

          {creating ? (
            <section className="fw-count" aria-labelledby={`${baseId}-count`}>
              <div className="fw-count-text">
                <h2 id={`${baseId}-count`}>{t("projectForm.countTitle")}</h2>
              </div>
              <div className="fw-count-ctl">
                <NumberField
                  id={id(EXACT_COUNT_PATH)}
                  label={t("projectForm.exactCount")}
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={exactPackageCount}
                  error={
                    countError ??
                    (submitted && parsedCount === null && box
                      ? t("projectForm.countRequiredField")
                      : undefined)
                  }
                  onChange={(value) => {
                    setExactPackageCount(value);
                    setFailure(null);
                  }}
                  onBlur={() => undefined}
                />
                {gridCount !== null && gridCount > 0 ? (
                  <button
                    type="button"
                    className="fw-chip"
                    aria-pressed={parsedCount === gridCount}
                    onClick={() => {
                      setExactPackageCount(String(gridCount));
                      setFailure(null);
                    }}
                  >
                    {t("projectForm.fromSimpleGrid", { count: gridCount })}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <aside
          className="fw-stage"
          data-expanded={stageExpanded ? "true" : "false"}
          aria-label={t("projectForm.preview")}
        >
          <div className="fw-stage-head">
            <h2>
              {box
                ? t("projectForm.onePackageOnPallet")
                : t("projectForm.emptyPallet")}
            </h2>
            <button
              type="button"
              className="fw-link fw-stage-toggle"
              aria-expanded={stageExpanded}
              onClick={() => setStageExpanded((current) => !current)}
            >
              {stageExpanded
                ? t("projectForm.smaller")
                : t("projectForm.larger")}
            </button>
          </div>
          <div className="fw-stage-scene">
            <PlanRender
              title={
                box
                  ? t("projectForm.packageOnPallet", {
                      dims: `${formatNumber(box.length, tag)} × ${formatNumber(box.width, tag)} × ${formatNumber(box.height, tag)}`,
                    })
                  : t("projectForm.emptyPallet")
              }
              emptyPackage={box ?? undefined}
              palletSize={
                palletLength > 0 && palletWidth > 0
                  ? { length: palletLength, width: palletWidth }
                  : undefined
              }
              palletHeight={palletHeight > 0 ? palletHeight : undefined}
            />
          </div>
          <dl className="fw-facts">
            <div>
              <dt>{t("projectForm.factPackage")}</dt>
              <dd>
                {box
                  ? `${formatNumber(box.length, tag)}×${formatNumber(box.width, tag)}×${formatNumber(box.height, tag)}`
                  : "–"}
              </dd>
            </div>
            <div>
              <dt>{t("projectForm.factLoadArea")}</dt>
              <dd>
                {area
                  ? `${formatNumber(area.length, tag)}×${formatNumber(area.width, tag)}`
                  : "–"}
              </dd>
            </div>
            <div>
              <dt>{t("projectForm.factSimpleGrid")}</dt>
              <dd>{gridCount ?? "–"}</dd>
            </div>
          </dl>
        </aside>
      </div>

      <footer className="fw-footer">
        <p className="fw-footer-hint" aria-live="polite">
          {footerHint}
        </p>
        <div className="fw-footer-actions">
          <button
            type="button"
            className="ui-btn fw-quiet"
            disabled={saving}
            onClick={onClose}
          >
            {t("projectForm.cancel")}
          </button>
          {creating ? (
            <button
              type="submit"
              name="creationAction"
              value="create-only"
              className="ui-btn"
              disabled={saving || readingSheet}
            >
              {t("projectForm.saveOnly")}
            </button>
          ) : null}
          <button
            type="submit"
            name="creationAction"
            value={creating ? "generate" : "save"}
            className="ui-btn-primary"
            disabled={saving || readingSheet}
          >
            {saving
              ? t("projectForm.saving")
              : creating
                ? t("projectForm.generate")
                : t("projectForm.saveChanges")}
          </button>
        </div>
      </footer>
    </form>
  );
}
