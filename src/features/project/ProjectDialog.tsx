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
};

type FieldProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

function Field({ label, error, children }: FieldProps) {
  return (
    <label className="grid min-w-0 gap-1 text-xs text-[var(--muted)]">
      <span>{label}</span>
      {children}
      {error ? <span className="text-[var(--danger)]">{error}</span> : null}
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
  open,
  project,
  onClose,
  onSave,
}: ProjectDialogProps) {
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
          "Enter the exact packages per layer, or choose Create only.",
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
        className="max-h-[calc(100vh-2rem)] w-full max-w-4xl overflow-auto border border-[var(--line)] bg-[var(--surface)] shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <form onSubmit={(event) => void submit(event)}>
          <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <h2
              id={titleId}
              className="text-base font-semibold text-[var(--ink)]"
            >
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

          <div className="grid gap-5 p-5">
            {failure ? (
              <div
                role="alert"
                className="border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-2 text-sm text-[var(--danger)]"
              >
                {failure}
              </div>
            ) : null}

            <fieldset className="grid gap-3 border border-[var(--line)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
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

            <fieldset className="grid gap-3 border border-[var(--line)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-1 text-xs text-[var(--muted)]">
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
                    <span className="text-[var(--danger)]">
                      {errorFor(fieldErrors, "package.inletOrientation")}
                    </span>
                  ) : null}
                </div>
                <label className="flex items-center gap-2 self-end border border-[var(--line)] px-3 py-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={values.multiPickAllowed}
                    onChange={(event) =>
                      set("multiPickAllowed", event.target.checked)
                    }
                    className="h-4 w-4 accent-[var(--brand)]"
                  />
                  Allow multipick
                </label>
              </div>
            </fieldset>

            <fieldset className="grid gap-3 border border-[var(--line)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
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
                    onChange={(event) => set("palletName", event.target.value)}
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
                    className={`${inputClass} disabled:cursor-not-allowed disabled:text-[var(--muted)]`}
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                    onChange={(event) => set("maxGrossKg", event.target.value)}
                    className={inputClass}
                    placeholder="Unknown"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={values.hasStorageEnvelope}
                  onChange={(event) =>
                    set("hasStorageEnvelope", event.target.checked)
                  }
                  className="h-4 w-4 accent-[var(--brand)]"
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
            </fieldset>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-4">
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
                Create only
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
                  : "Create & generate"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
