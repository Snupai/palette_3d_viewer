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
  germanFieldError,
  guidedSectionOrder,
  guidedSectionTitles,
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
  const bodyId = `${id}-body`;
  const statusText =
    status === "error"
      ? "Bitte prüfen"
      : status === "ok"
        ? "Vollständig"
        : "Noch offen";
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
          <span className="fw-sec-act">{open ? "Zuklappen" : "Ändern"}</span>
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

const edgeLabels: Record<LabelEdge, string> = {
  top: "oben",
  right: "rechts",
  bottom: "unten",
  left: "links",
};

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
            aria-label={`Etikett ${edgeLabels[edge]}`}
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
              {edgeLabels[edge]}
            </span>
          </button>
        ))}
      </div>
      <div className="fw-label-flow" aria-hidden="true">
        Einlauf
        <svg viewBox="0 0 24 12" width="24" height="12">
          <path d="M0 6h20M15 1l6 5-6 5" fill="none" stroke="currentColor" />
        </svg>
      </div>
      <p className="fw-hint">
        Kante antippen, an der das Etikett am Einlauf sitzt.{" "}
        {selectedEdge ? (
          <button
            type="button"
            className="fw-link"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            Ohne Vorgabe
          </button>
        ) : (
          "Aktuell ohne Vorgabe."
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
    () => validateProjectFormValues(values, project),
    [values, project],
  );
  const parsedCount = parseExactPackageCount(exactPackageCount);
  const countError =
    exactPackageCount.trim() !== "" && parsedCount === null
      ? "Bitte eine ganze Zahl größer als 0 eingeben."
      : null;

  const visibleError = (path: string): string | undefined => {
    const message =
      saveErrors[path] ??
      (submitted || revealed.has(path) ? schemaErrors[path] : undefined);
    return message ? germanFieldError(message) : undefined;
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
          ? "Bitte die markierten Angaben korrigieren und die Pakete je Schicht eintragen."
          : "Bitte die markierten Angaben korrigieren.",
      );
      return;
    }
    if (missingCount) {
      pendingFocus.current = id(EXACT_COUNT_PATH);
      setFailure(
        "Für die Mustererzeugung die genaue Anzahl Pakete je Schicht eintragen – oder nur speichern.",
      );
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
        setFailure("Bitte die markierten Angaben korrigieren.");
      } else {
        console.error("Failed to save planner project", cause);
        setFailure(
          cause instanceof Error
            ? `Speichern fehlgeschlagen: ${cause.message}`
            : "Speichern fehlgeschlagen.",
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
        return "Geänderte Maße oder Einlaufangaben: erzeugte Muster werden verworfen. Gespeicherte Lösungen bleiben zur Prüfung erhalten und sind bis zum Neuaufbau für Robotik und Export gesperrt.";
      }
      if (changesPatterns === false && changesGeometry === true) {
        return "Geänderte Höhe oder Handhabung: Muster bleiben erhalten. Gespeicherte Lösungen sind bis zum Neuaufbau für Robotik und Export gesperrt.";
      }
      if (changesPatterns === false) {
        return "Diese Änderungen betreffen die Muster nicht; sie bleiben erhalten.";
      }
      return "Noch nicht alle Angaben sind gültig.";
    }
    if (!box) return "Länge, Breite und Höhe des Pakets eintragen.";
    if (openErrorCount > 0) return "Einige Angaben sind noch ungültig.";
    if (parsedCount === null) {
      return "Pakete je Schicht eintragen, dann Muster erzeugen.";
    }
    return "Alle Angaben gültig.";
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
              {creating ? "Paket und Palette" : "Plan bearbeiten"}
            </h1>
            <p>
              {creating
                ? "Artikelnummer und drei Maße genügen für den Anfang. Alles Weitere hat Vorgaben, die Sie hier anpassen können."
                : "Angaben ändern und speichern. Nur Maße, Überstand, Abstand und Einlauf verwerfen erzeugte Muster."}
            </p>
          </header>

          {failure ? (
            <div role="alert" className="fw-alert">
              {failure}
            </div>
          ) : null}

          {creating ? (
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
              title={guidedSectionTitles.meta}
              summary={sectionSummary("meta", values)}
              status={sectionStatus("meta")}
              open={openSection === "meta"}
              onToggle={() => toggle("meta")}
            >
              <div className="fw-grid2">
                <TextField
                  {...field("productNumber")}
                  label="Artikelnummer"
                  placeholder="z. B. 1329-00004"
                  value={values.productNumber}
                  onChange={(value) => set("productNumber", value)}
                />
                <TextField
                  {...field("projectNumber")}
                  label="Linie / Auftrag"
                  placeholder="z. B. AP-5006"
                  value={values.projectNumber}
                  onChange={(value) => set("projectNumber", value)}
                />
              </div>
              <p className="fw-note">
                Die Artikelnummer benennt den Plan in der Planliste; die Linie
                ist optional. Beides ändert weder Muster noch Stapel.
              </p>
              <div className="fw-sec-foot">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => nextSection("meta")}
                >
                  Weiter zum Paket
                </button>
              </div>
            </Section>

            <Section
              id={id("package")}
              index={2}
              title={guidedSectionTitles.package}
              summary={sectionSummary("package", values)}
              status={sectionStatus("package")}
              open={openSection === "package"}
              onToggle={() => toggle("package")}
            >
              <div className="fw-grid3">
                <NumberField
                  {...field("packageLengthMm")}
                  big
                  label="Länge"
                  unit="mm"
                  min="0"
                  value={values.packageLengthMm}
                  onChange={(value) => set("packageLengthMm", value)}
                />
                <NumberField
                  {...field("packageWidthMm")}
                  big
                  label="Breite"
                  unit="mm"
                  min="0"
                  value={values.packageWidthMm}
                  onChange={(value) => set("packageWidthMm", value)}
                />
                <NumberField
                  {...field("packageHeightMm")}
                  big
                  label="Höhe"
                  unit="mm"
                  min="0"
                  value={values.packageHeightMm}
                  onChange={(value) => set("packageHeightMm", value)}
                />
              </div>
              <p className="fw-note">
                Außenmaße so, wie das Paket am Einlauf ankommt.
              </p>
              <div className="fw-grid2">
                <NumberField
                  {...field("packageWeightKg")}
                  label="Gewicht je Paket"
                  unit="kg"
                  min="0"
                  placeholder="unbekannt"
                  hint="Optional, für die Bruttogewichts-Prüfung des Stapels."
                  value={values.packageWeightKg}
                  onChange={(value) => set("packageWeightKg", value)}
                />
                <NumberField
                  {...field("packageClearanceMm")}
                  label="Abstand zwischen Paketen"
                  unit="mm"
                  min="0"
                  hint="0, wenn die Pakete dicht an dicht stehen."
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
                  Weiter zur Palette
                </button>
              </div>
            </Section>

            <Section
              id={id("pallet")}
              index={3}
              title={guidedSectionTitles.pallet}
              summary={sectionSummary("pallet", values)}
              status={sectionStatus("pallet")}
              open={openSection === "pallet"}
              onToggle={() => toggle("pallet")}
            >
              <div className="fw-grid2">
                <div className="fw-field">
                  <label htmlFor={id("palletKind")}>Palettentyp</label>
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
                            palletName: current.palletName || "Eigene Palette",
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
                      <option value="euro">Euro-Palette</option>
                      <option value="industrial">Industriepalette</option>
                      <option value="custom">Eigene Palette</option>
                    </select>
                  </div>
                </div>
                <TextField
                  {...field("palletName")}
                  label="Bezeichnung"
                  value={values.palletName}
                  onChange={(value) => set("palletName", value)}
                />
              </div>
              {values.palletKind === "custom" ? (
                <TextField
                  {...field("palletId")}
                  label="Paletten-ID"
                  placeholder="wird beim Speichern vergeben"
                  value={values.palletId}
                  onChange={(value) => set("palletId", value)}
                />
              ) : null}
              <div className="fw-grid3">
                <NumberField
                  {...field("palletLengthMm")}
                  label="Palettenlänge"
                  unit="mm"
                  value={values.palletLengthMm}
                  onChange={(value) => set("palletLengthMm", value)}
                />
                <NumberField
                  {...field("palletWidthMm")}
                  label="Palettenbreite"
                  unit="mm"
                  value={values.palletWidthMm}
                  onChange={(value) => set("palletWidthMm", value)}
                />
                <NumberField
                  {...field("palletHeightMm")}
                  label="Palettenhöhe"
                  unit="mm"
                  value={values.palletHeightMm}
                  onChange={(value) => set("palletHeightMm", value)}
                />
              </div>
              <div className="fw-grid2">
                <NumberField
                  {...field("overhangLengthMm")}
                  label="Überstand Länge"
                  unit="mm"
                  hint={overhangPerSideHint(values.overhangLengthMm)}
                  value={values.overhangLengthMm}
                  onChange={(value) => set("overhangLengthMm", value)}
                />
                <NumberField
                  {...field("overhangWidthMm")}
                  label="Überstand Breite"
                  unit="mm"
                  hint={overhangPerSideHint(values.overhangWidthMm)}
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
                  Weiter zu den Grenzen
                </button>
              </div>
            </Section>

            <Section
              id={id("limits")}
              index={4}
              title={guidedSectionTitles.limits}
              summary={sectionSummary("limits", values)}
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
                Lagermaße begrenzen (Länge, Breite, Höhe)
              </label>
              {values.hasStorageEnvelope ? (
                <>
                  <NumberField
                    {...field("storageHeightMm")}
                    label="Lagerhöhe"
                    unit="mm"
                    hint="Der Stapel vergleicht seine Ladehöhe ohne Palette mit diesem Wert."
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
                    <summary>Lagerfläche</summary>
                    <div className="fw-grid2">
                      <NumberField
                        {...field("storageLengthMm")}
                        label="Lagerlänge"
                        unit="mm"
                        value={values.storageLengthMm}
                        onChange={(value) => set("storageLengthMm", value)}
                      />
                      <NumberField
                        {...field("storageWidthMm")}
                        label="Lagerbreite"
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
                  label="Leergewicht Palette"
                  unit="kg"
                  min="0"
                  placeholder="unbekannt"
                  value={values.tareKg}
                  onChange={(value) => set("tareKg", value)}
                />
                <NumberField
                  {...field("maxGrossKg")}
                  label="Max. Bruttogewicht"
                  unit="kg"
                  min="0"
                  placeholder="ohne Limit"
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
                  Weiter zu Einlauf und Etikett
                </button>
              </div>
            </Section>

            <Section
              id={id("handling")}
              index={5}
              title={guidedSectionTitles.handling}
              summary={sectionSummary("handling", values)}
              status={sectionStatus("handling")}
              open={openSection === "handling"}
              onToggle={() => toggle("handling")}
            >
              <div className="fw-grid2 fw-handling">
                <div className="fw-stack-gap">
                  <Segmented
                    legend="Einlauf"
                    name={id("inletOrientation")}
                    value={values.inletOrientation}
                    disabled={saving}
                    options={[
                      { value: "lengthwise", label: "Längs" },
                      { value: "crosswise", label: "Quer" },
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
                    Mehrfachgriff erlauben
                  </label>
                  {visibleError("package.inletOrientation") ? (
                    <span className="fw-hint fw-hint-bad">
                      {visibleError("package.inletOrientation")}
                    </span>
                  ) : null}
                </div>
                <fieldset className="fw-seg-field" disabled={saving}>
                  <legend>Etikett</legend>
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
                <h2 id={`${baseId}-count`}>Pakete je Schicht</h2>
                <p>
                  Der Generator sucht Muster mit genau dieser Anzahl. Eine
                  automatische Suche nach dem Maximum gibt es noch nicht.
                </p>
              </div>
              <div className="fw-count-ctl">
                <NumberField
                  id={id(EXACT_COUNT_PATH)}
                  label="Genaue Anzahl"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={exactPackageCount}
                  error={
                    countError ??
                    (submitted && parsedCount === null && box
                      ? "Für „Muster erzeugen“ erforderlich."
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
                    {gridCount} aus dem einfachen Raster
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <aside
          className="fw-stage"
          data-expanded={stageExpanded ? "true" : "false"}
          aria-label="Vorschau"
        >
          <div className="fw-stage-head">
            <h2>{box ? "Ein Paket auf der Palette" : "Leere Palette"}</h2>
            <button
              type="button"
              className="fw-link fw-stage-toggle"
              aria-expanded={stageExpanded}
              onClick={() => setStageExpanded((current) => !current)}
            >
              {stageExpanded ? "Kleiner" : "Größer"}
            </button>
          </div>
          <div className="fw-stage-scene">
            <PlanRender
              title={
                box
                  ? `Paket ${formatNumber(box.length)} × ${formatNumber(box.width)} × ${formatNumber(box.height)} mm auf der Palette`
                  : "Leere Palette"
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
              <dt>Paket mm</dt>
              <dd>
                {box
                  ? `${formatNumber(box.length)}×${formatNumber(box.width)}×${formatNumber(box.height)}`
                  : "–"}
              </dd>
            </div>
            <div>
              <dt>Ladefläche mm</dt>
              <dd>
                {area
                  ? `${formatNumber(area.length)}×${formatNumber(area.width)}`
                  : "–"}
              </dd>
            </div>
            <div>
              <dt>im einfachen Raster</dt>
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
            Abbrechen
          </button>
          {creating ? (
            <button
              type="submit"
              name="creationAction"
              value="create-only"
              className="ui-btn"
              disabled={saving || readingSheet}
            >
              Nur speichern
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
              ? "Wird gespeichert …"
              : creating
                ? "Muster erzeugen"
                : "Änderungen speichern"}
          </button>
        </div>
      </footer>
    </form>
  );
}
