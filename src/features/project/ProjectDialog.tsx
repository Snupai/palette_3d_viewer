"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import { useT } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import { PackageLabelFacePicker } from "~/features/candidates/PackageLabelFacePicker";
import { GuidedProjectForm } from "~/features/project/GuidedProjectForm";
import type { GuidedSectionId } from "~/features/project/guidedProjectFormModel";
import {
  buildProjectFromForm,
  palletTemplateFormValues,
  projectToFormValues,
  zodFieldErrors,
  type ProjectFieldErrors,
  type ProjectFormValues,
} from "~/features/project/projectForm";
import { SheetPhotoImport } from "~/features/project/SheetPhotoImport";
import { applySheetToFormValues } from "~/features/project/sheetImport";

export type ProjectGenerationIntent = {
  exactPackageCount: number;
};

export type ProjectDialogSubmission = {
  project: Project;
  generationIntent: ProjectGenerationIntent | null;
};

export type ProjectDialogProps = {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (
    submission: ProjectDialogSubmission,
  ) => Promise<"cancelled" | void> | "cancelled" | void;
  /**
   * Renders the guided full-page form in the page flow instead of a modal.
   * Submission semantics are identical: save-only, or save and generate with
   * an exact package count (create mode only).
   */
  inline?: boolean;
  /** Inline mode only: section opened first, e.g. when editing from review. */
  initialSection?: GuidedSectionId;
  /**
   * Inline mode only: reports unsaved input changes (values or exact count);
   * false after a successful save and when the form closes.
   */
  onDirtyChange?: (dirty: boolean) => void;
};

type FieldProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

function Field({ label, error, children }: FieldProps) {
  return (
    <label className="text-muted text-micro grid min-w-0 gap-1">
      <span>{label}</span>
      {children}
      {error ? <span className="text-danger">{error}</span> : null}
    </label>
  );
}

const inputClass = "ui-input text-body";

function errorFor(
  errors: ProjectFieldErrors,
  path: string,
): string | undefined {
  return errors[path];
}

export function ProjectDialog({
  inline = false,
  initialSection,
  onDirtyChange,
  ...props
}: ProjectDialogProps) {
  if (!props.open) return null;
  if (inline) {
    return (
      <GuidedProjectForm
        project={props.project}
        initialSection={initialSection}
        onClose={props.onClose}
        onSave={props.onSave}
        onDirtyChange={onDirtyChange}
      />
    );
  }
  return <ModalProjectDialog {...props} />;
}

function ModalProjectDialog({
  open,
  project,
  onClose,
  onSave,
}: Omit<ProjectDialogProps, "inline" | "initialSection" | "onDirtyChange">) {
  const t = useT();
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [values, setValues] = useState<ProjectFormValues>(() =>
    projectToFormValues(project),
  );
  const [exactPackageCount, setExactPackageCount] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProjectFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [readingSheet, setReadingSheet] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(projectToFormValues(project));
    setExactPackageCount("");
    setFieldErrors({});
    setFailure(null);
    setSaving(false);
    setAdvancedOpen(false);
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    firstInputRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const set = <Key extends keyof ProjectFormValues>(
    key: Key,
    value: ProjectFormValues[Key],
  ) => {
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === "storageLengthMm" ? { automaticStorageLength: false } : {}),
      ...(key === "storageWidthMm" ? { automaticStorageWidth: false } : {}),
    }));
    setFieldErrors((current) => {
      if (Object.keys(current).length === 0) return current;
      return {};
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setFailure(null);
    setSaving(true);
    try {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const shouldGenerate =
        project === null &&
        (!(submitter instanceof HTMLButtonElement) ||
          submitter.value !== "create-only");
      const packageCount = Number(exactPackageCount);
      if (
        shouldGenerate &&
        (!Number.isInteger(packageCount) || packageCount <= 0)
      ) {
        setFieldErrors({
          exactPackageCount: t("projectForm.dialog.positiveWholeNumber"),
        });
        setFailure(t("projectForm.dialog.enterExactCount"));
        return;
      }

      const next = buildProjectFromForm(values, project);
      const outcome = await onSave({
        project: next,
        generationIntent: shouldGenerate
          ? { exactPackageCount: packageCount }
          : null,
      });
      if (outcome !== "cancelled") onClose();
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        setFieldErrors(zodFieldErrors(cause));
        setFailure(t("projectForm.dialog.correctFields"));
      } else {
        console.error("Failed to save planner project", cause);
        setFailure(
          cause instanceof Error
            ? t("projectForm.dialog.saveFailedWithReason", {
                reason: cause.message,
              })
            : t("projectForm.dialog.saveFailed"),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || saving) return;
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={saving}
        className="border-line bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden border shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => void submit(event)}
        >
          <header className="border-line bg-surface flex shrink-0 items-center justify-between border-b px-5 py-4">
            <h2 id={titleId} className="text-ink text-base font-semibold">
              {project
                ? t("projectForm.dialog.editProject")
                : t("projectForm.dialog.createProject")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-btn text-body px-2.5 py-1.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("projectForm.dialog.close")}
            </button>
          </header>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-5 p-5">
              {failure ? (
                <div
                  role="alert"
                  className="border-danger bg-danger/10 text-danger text-body border px-3 py-2"
                >
                  {failure}
                </div>
              ) : null}

              {project === null && open ? (
                <SheetPhotoImport
                  disabled={saving}
                  onBusyChange={setReadingSheet}
                  onExtracted={({ sheet }) => {
                    const patch = applySheetToFormValues(values, sheet);
                    setValues(patch.values);
                    setExactPackageCount(patch.exactPackageCount);
                    setFieldErrors({});
                    setFailure(null);
                    // Show the filled overhang/underhang fields.
                    setAdvancedOpen(true);
                  }}
                />
              ) : null}

              <fieldset className="border-line grid gap-3 border p-4">
                <legend className="text-ink text-body px-1 font-semibold">
                  {t("projectForm.dialog.legendLineProduct")}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("projectForm.dialog.productNumber")}
                    error={errorFor(fieldErrors, "productNumber")}
                  >
                    <input
                      ref={firstInputRef}
                      value={values.productNumber}
                      onChange={(event) =>
                        set("productNumber", event.target.value)
                      }
                      className={inputClass}
                      placeholder={t("projectForm.dialog.productPlaceholder")}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.lineNumber")}
                    error={errorFor(fieldErrors, "projectNumber")}
                  >
                    <input
                      value={values.projectNumber}
                      onChange={(event) =>
                        set("projectNumber", event.target.value)
                      }
                      className={inputClass}
                      placeholder={t("projectForm.dialog.linePlaceholder")}
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="border-line grid gap-3 border p-4">
                <legend className="text-ink text-body px-1 font-semibold">
                  {t("projectForm.dialog.legendCuboid")}
                </legend>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Field
                    label={t("projectForm.dialog.lengthMm")}
                    error={errorFor(fieldErrors, "package.dimensionsMm.length")}
                  >
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={values.packageLengthMm}
                      onChange={(event) =>
                        set("packageLengthMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.widthMm")}
                    error={errorFor(fieldErrors, "package.dimensionsMm.width")}
                  >
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={values.packageWidthMm}
                      onChange={(event) =>
                        set("packageWidthMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.heightMm")}
                    error={errorFor(fieldErrors, "package.dimensionsMm.height")}
                  >
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={values.packageHeightMm}
                      onChange={(event) =>
                        set("packageHeightMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  {project === null ? (
                    <Field
                      label={t("projectForm.dialog.packagesPerLayer")}
                      error={errorFor(fieldErrors, "exactPackageCount")}
                    >
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={exactPackageCount}
                        onChange={(event) => {
                          setExactPackageCount(event.target.value);
                          setFieldErrors({});
                        }}
                        className={inputClass}
                        placeholder={t("projectForm.dialog.requiredToGenerate")}
                      />
                    </Field>
                  ) : null}
                  <Field
                    label={t("projectForm.dialog.clearanceMm")}
                    error={errorFor(fieldErrors, "package.clearanceMm")}
                  >
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={values.packageClearanceMm}
                      onChange={(event) =>
                        set("packageClearanceMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="border-line grid gap-3 border p-4">
                <legend className="text-ink text-body px-1 font-semibold">
                  {t("projectForm.dialog.legendPallet")}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={t("projectForm.dialog.palletTemplate")}>
                    <select
                      value={values.palletKind}
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
                              t("projectForm.dialog.customPallet"),
                          }));
                        } else {
                          setValues((current) =>
                            palletTemplateFormValues(kind, current),
                          );
                        }
                        setFieldErrors({});
                      }}
                      className={inputClass}
                    >
                      <option value="euro">
                        {t("projectForm.dialog.euroPallet")}
                      </option>
                      <option value="industrial">
                        {t("projectForm.dialog.industrialPallet")}
                      </option>
                      <option value="custom">
                        {t("projectForm.dialog.customPallet")}
                      </option>
                    </select>
                  </Field>
                  <Field
                    label={t("projectForm.dialog.palletName")}
                    error={errorFor(fieldErrors, "pallet.name")}
                  >
                    <input
                      value={values.palletName}
                      onChange={(event) =>
                        set("palletName", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.palletId")}
                    error={errorFor(fieldErrors, "pallet.id")}
                  >
                    <input
                      value={values.palletId}
                      onChange={(event) => set("palletId", event.target.value)}
                      disabled={values.palletKind !== "custom"}
                      className={`${inputClass} disabled:text-muted disabled:cursor-not-allowed`}
                      placeholder={t("projectForm.dialog.generatedWhenSaved")}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label={t("projectForm.dialog.palletLengthMm")}
                    error={errorFor(fieldErrors, "pallet.dimensionsMm.length")}
                  >
                    <input
                      type="number"
                      step="any"
                      value={values.palletLengthMm}
                      onChange={(event) =>
                        set("palletLengthMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.palletWidthMm")}
                    error={errorFor(fieldErrors, "pallet.dimensionsMm.width")}
                  >
                    <input
                      type="number"
                      step="any"
                      value={values.palletWidthMm}
                      onChange={(event) =>
                        set("palletWidthMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("projectForm.dialog.palletHeightMm")}
                    error={errorFor(fieldErrors, "pallet.dimensionsMm.height")}
                  >
                    <input
                      type="number"
                      step="any"
                      value={values.palletHeightMm}
                      onChange={(event) =>
                        set("palletHeightMm", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                </div>
              </fieldset>

              <details
                open={advancedOpen}
                onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                className="border-line border p-4"
              >
                <summary className="text-ink text-body cursor-pointer font-semibold">
                  {t("projectForm.dialog.advanced")}
                </summary>
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field
                      label={t("projectForm.dialog.weightKg")}
                      error={errorFor(fieldErrors, "package.weightKg")}
                    >
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values.packageWeightKg}
                        onChange={(event) =>
                          set("packageWeightKg", event.target.value)
                        }
                        className={inputClass}
                        placeholder={t("projectForm.dialog.unknown")}
                      />
                    </Field>
                    <Field
                      label={t("projectForm.dialog.overhangLengthTotalMm")}
                      error={errorFor(
                        fieldErrors,
                        "pallet.allowedOverhangMm.length",
                      )}
                    >
                      <input
                        type="number"
                        step="any"
                        value={values.overhangLengthMm}
                        onChange={(event) =>
                          set("overhangLengthMm", event.target.value)
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label={t("projectForm.dialog.overhangWidthTotalMm")}
                      error={errorFor(
                        fieldErrors,
                        "pallet.allowedOverhangMm.width",
                      )}
                    >
                      <input
                        type="number"
                        step="any"
                        value={values.overhangWidthMm}
                        onChange={(event) =>
                          set("overhangWidthMm", event.target.value)
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label={t("projectForm.dialog.tareKg")}
                      error={errorFor(fieldErrors, "pallet.tareKg")}
                    >
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values.tareKg}
                        onChange={(event) => set("tareKg", event.target.value)}
                        className={inputClass}
                        placeholder={t("projectForm.dialog.unknown")}
                      />
                    </Field>
                    <Field
                      label={t("projectForm.dialog.maxGrossKg")}
                      error={errorFor(fieldErrors, "pallet.maxGrossKg")}
                    >
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values.maxGrossKg}
                        onChange={(event) =>
                          set("maxGrossKg", event.target.value)
                        }
                        className={inputClass}
                        placeholder={t("projectForm.dialog.unknown")}
                      />
                    </Field>
                  </div>
                  <label className="text-ink text-body flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={values.hasStorageEnvelope}
                      onChange={(event) =>
                        set("hasStorageEnvelope", event.target.checked)
                      }
                      className="accent-brand h-4 w-4"
                    />
                    {t("projectForm.dialog.limitEnvelope")}
                  </label>
                  {values.hasStorageEnvelope ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field
                        label={t("projectForm.dialog.envelopeLengthMm")}
                        error={errorFor(
                          fieldErrors,
                          "pallet.storageEnvelopeMm.length",
                        )}
                      >
                        <input
                          type="number"
                          step="any"
                          value={values.storageLengthMm}
                          onChange={(event) =>
                            set("storageLengthMm", event.target.value)
                          }
                          className={inputClass}
                        />
                      </Field>
                      <Field
                        label={t("projectForm.dialog.envelopeWidthMm")}
                        error={errorFor(
                          fieldErrors,
                          "pallet.storageEnvelopeMm.width",
                        )}
                      >
                        <input
                          type="number"
                          step="any"
                          value={values.storageWidthMm}
                          onChange={(event) =>
                            set("storageWidthMm", event.target.value)
                          }
                          className={inputClass}
                        />
                      </Field>
                      <Field
                        label={t("projectForm.dialog.envelopeHeightMm")}
                        error={errorFor(
                          fieldErrors,
                          "pallet.storageEnvelopeMm.height",
                        )}
                      >
                        <input
                          type="number"
                          step="any"
                          value={values.storageHeightMm}
                          onChange={(event) =>
                            set("storageHeightMm", event.target.value)
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="text-muted text-micro grid min-w-0 gap-1">
                      <PackageLabelFacePicker
                        packageLengthMm={Number(values.packageLengthMm)}
                        packageWidthMm={Number(values.packageWidthMm)}
                        inletOrientation={values.inletOrientation}
                        selectedPackageSide={values.labelSideAtPickup || null}
                        disabled={saving}
                        onInletOrientationChange={(inletOrientation) =>
                          set("inletOrientation", inletOrientation)
                        }
                        onPackageSideChange={(side) =>
                          set("labelSideAtPickup", side ?? "")
                        }
                      />
                      {errorFor(fieldErrors, "package.inletOrientation") ? (
                        <span className="text-danger">
                          {errorFor(fieldErrors, "package.inletOrientation")}
                        </span>
                      ) : null}
                    </div>
                    <label className="border-line text-ink text-body flex items-center gap-2 self-end border px-3 py-2">
                      <input
                        type="checkbox"
                        checked={values.multiPickAllowed}
                        onChange={(event) =>
                          set("multiPickAllowed", event.target.checked)
                        }
                        className="accent-brand h-4 w-4"
                      />
                      {t("projectForm.dialog.allowMultipick")}
                    </label>
                  </div>
                </div>
              </details>
            </div>
          </div>

          <footer className="border-line bg-surface flex shrink-0 items-center justify-end gap-2 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-btn text-body px-3 py-2 disabled:opacity-50"
            >
              {t("projectForm.dialog.cancel")}
            </button>
            {project === null ? (
              <button
                type="submit"
                name="creationAction"
                value="create-only"
                disabled={saving || readingSheet}
                className="ui-btn text-body px-3 py-2 disabled:cursor-wait disabled:opacity-50"
              >
                {t("projectForm.dialog.saveProject")}
              </button>
            ) : null}
            <button
              type="submit"
              name="creationAction"
              value={project ? "save" : "generate"}
              disabled={saving || readingSheet}
              className="ui-btn-primary text-body px-3 py-2 disabled:cursor-wait"
            >
              {saving
                ? t("projectForm.dialog.saving")
                : project
                  ? t("projectForm.dialog.saveProject")
                  : t("projectForm.dialog.saveAndGenerate")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
