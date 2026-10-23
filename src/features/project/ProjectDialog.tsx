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
  onSave: (submission: ProjectDialogSubmission) => Promise<void> | void;
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
    <label className="text-muted grid min-w-0 gap-1 text-xs">
      <span>{label}</span>
      {children}
      {error ? <span className="text-danger">{error}</span> : null}
    </label>
  );
}

const inputClass = "ui-input text-sm";

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

  useEffect(() => {
    if (!open) return;
    setValues(projectToFormValues(project));
    setExactPackageCount("");
    setFieldErrors({});
    setFailure(null);
    setSaving(false);
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
    setValues((current) => ({ ...current, [key]: value }));
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
          exactPackageCount: "Enter a positive whole number.",
        });
        setFailure(
          "Enter the exact packages per layer, or choose Save project.",
        );
        return;
      }

      const next = buildProjectFromForm(values, project);
      await onSave({
        project: next,
        generationIntent: shouldGenerate
          ? { exactPackageCount: packageCount }
          : null,
      });
      onClose();
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        setFieldErrors(zodFieldErrors(cause));
        setFailure("Correct the marked project fields before saving.");
      } else {
        console.error("Failed to save planner project", cause);
        setFailure(
          cause instanceof Error
            ? `Project save failed: ${cause.message}`
            : "Project save failed.",
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
              {project ? "Edit project" : "Create project"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="ui-btn px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Close
            </button>
          </header>

          <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto">
            <div className="grid gap-5 p-5">
              {failure ? (
                <div
                  role="alert"
                  className="border-danger bg-danger/10 text-danger border px-3 py-2 text-sm"
                >
                  {failure}
                </div>
              ) : null}

              <fieldset className="border-line grid gap-3 border p-4">
                <legend className="text-ink px-1 text-sm font-semibold">
                  Line and product
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Product number"
                    error={errorFor(fieldErrors, "productNumber")}
                  >
                    <input
                      ref={firstInputRef}
                      value={values.productNumber}
                      onChange={(event) =>
                        set("productNumber", event.target.value)
                      }
                      className={inputClass}
                      placeholder="1329-00004"
                    />
                  </Field>
                  <Field
                    label="Line number"
                    error={errorFor(fieldErrors, "projectNumber")}
                  >
                    <input
                      value={values.projectNumber}
                      onChange={(event) =>
                        set("projectNumber", event.target.value)
                      }
                      className={inputClass}
                      placeholder="AP-5006"
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="border-line grid gap-3 border p-4">
                <legend className="text-ink px-1 text-sm font-semibold">
                  Cuboid package
                </legend>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Field
                    label="Length (mm)"
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
                    label="Width (mm)"
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
                    label="Height (mm)"
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
                      label="Packages per layer"
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
                        placeholder="Required to generate"
                      />
                    </Field>
                  ) : null}
                  <Field
                    label="Clearance (mm)"
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
                <legend className="text-ink px-1 text-sm font-semibold">
                  Pallet and load envelope
                </legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Pallet template">
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
                            palletName: current.palletName || "Custom pallet",
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
                      <option value="euro">EURO pallet</option>
                      <option value="industrial">Industrial pallet</option>
                      <option value="custom">Custom pallet</option>
                    </select>
                  </Field>
                  <Field
                    label="Pallet name"
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
                    label="Pallet ID"
                    error={errorFor(fieldErrors, "pallet.id")}
                  >
                    <input
                      value={values.palletId}
                      onChange={(event) => set("palletId", event.target.value)}
                      disabled={values.palletKind !== "custom"}
                      className={`${inputClass} disabled:text-muted disabled:cursor-not-allowed`}
                      placeholder="Generated when saved"
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field
                    label="Pallet length (mm)"
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
                    label="Pallet width (mm)"
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
                    label="Pallet height (mm)"
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

              <details className="border-line border p-4">
                <summary className="text-ink cursor-pointer text-sm font-semibold">
                  Advanced settings
                </summary>
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field
                      label="Weight (kg)"
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
                        placeholder="Unknown"
                      />
                    </Field>
                    <Field
                      label="Overhang / underhang length per side (mm)"
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
                      label="Overhang / underhang width per side (mm)"
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
                      label="Pallet tare (kg)"
                      error={errorFor(fieldErrors, "pallet.tareKg")}
                    >
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values.tareKg}
                        onChange={(event) => set("tareKg", event.target.value)}
                        className={inputClass}
                        placeholder="Unknown"
                      />
                    </Field>
                    <Field
                      label="Maximum gross (kg)"
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
                        placeholder="Unknown"
                      />
                    </Field>
                  </div>
                  <label className="text-ink flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={values.hasStorageEnvelope}
                      onChange={(event) =>
                        set("hasStorageEnvelope", event.target.checked)
                      }
                      className="accent-brand h-4 w-4"
                    />
                    Limit the load with a storage envelope
                  </label>
                  {values.hasStorageEnvelope ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field
                        label="Envelope length (mm)"
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
                        label="Envelope width (mm)"
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
                        label="Envelope height (mm)"
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
                    <div className="text-muted grid min-w-0 gap-1 text-xs">
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
                    <label className="border-line text-ink flex items-center gap-2 self-end border px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={values.multiPickAllowed}
                        onChange={(event) =>
                          set("multiPickAllowed", event.target.checked)
                        }
                        className="accent-brand h-4 w-4"
                      />
                      Allow multipick
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
              className="ui-btn px-3 py-2 text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            {project === null ? (
              <button
                type="submit"
                name="creationAction"
                value="create-only"
                disabled={saving}
                className="ui-btn px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50"
              >
                Save project
              </button>
            ) : null}
            <button
              type="submit"
              name="creationAction"
              value={project ? "save" : "generate"}
              disabled={saving}
              className="ui-btn-primary px-3 py-2 text-sm disabled:cursor-wait"
            >
              {saving
                ? "Saving…"
                : project
                  ? "Save project"
                  : "Save and generate patterns"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
