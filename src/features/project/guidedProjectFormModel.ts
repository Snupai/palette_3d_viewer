import { z } from "zod";
import type { Translate } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import { geometryReviewSignature } from "~/domain/project/geometryReview";
import { createLayerSolverInputFromProject } from "~/domain/solver/projectInput";
import {
  buildProjectFromForm,
  zodFieldErrors,
  type ProjectFieldErrors,
  type ProjectFormValues,
} from "~/features/project/projectForm";

export type GuidedSectionId =
  | "package"
  | "pallet"
  | "limits"
  | "handling"
  | "meta";

export const guidedSectionOrder: readonly GuidedSectionId[] = [
  "meta",
  "package",
  "pallet",
  "limits",
  "handling",
];

const guidedSectionTitleKeys = {
  package: "projectForm.section.package",
  pallet: "projectForm.section.pallet",
  limits: "projectForm.section.limits",
  handling: "projectForm.section.handling",
  meta: "projectForm.section.meta",
} as const satisfies Record<GuidedSectionId, string>;

export function guidedSectionTitle(
  section: GuidedSectionId,
  t: Translate,
): string {
  return t(guidedSectionTitleKeys[section]);
}

/** Schema path reported by `buildProjectFromForm` for each form value. */
export const fieldPathByValue: Partial<
  Record<keyof ProjectFormValues, string>
> = {
  productNumber: "productNumber",
  projectNumber: "projectNumber",
  packageLengthMm: "package.dimensionsMm.length",
  packageWidthMm: "package.dimensionsMm.width",
  packageHeightMm: "package.dimensionsMm.height",
  packageWeightKg: "package.weightKg",
  packageClearanceMm: "package.clearanceMm",
  inletOrientation: "package.inletOrientation",
  palletName: "pallet.name",
  palletId: "pallet.id",
  palletLengthMm: "pallet.dimensionsMm.length",
  palletWidthMm: "pallet.dimensionsMm.width",
  palletHeightMm: "pallet.dimensionsMm.height",
  overhangLengthMm: "pallet.allowedOverhangMm.length",
  overhangWidthMm: "pallet.allowedOverhangMm.width",
  storageLengthMm: "pallet.storageEnvelopeMm.length",
  storageWidthMm: "pallet.storageEnvelopeMm.width",
  storageHeightMm: "pallet.storageEnvelopeMm.height",
  tareKg: "pallet.tareKg",
  maxGrossKg: "pallet.maxGrossKg",
};

export const EXACT_COUNT_PATH = "exactPackageCount";

export function sectionForErrorPath(path: string): GuidedSectionId {
  if (path === "productNumber" || path === "projectNumber") return "meta";
  if (path === EXACT_COUNT_PATH) return "package";
  if (
    path.startsWith("package.dimensionsMm") ||
    path === "package.weightKg" ||
    path === "package.clearanceMm"
  ) {
    return "package";
  }
  if (path.startsWith("package.")) return "handling";
  if (
    path.startsWith("pallet.storageEnvelopeMm") ||
    path === "pallet.tareKg" ||
    path === "pallet.maxGrossKg"
  ) {
    return "limits";
  }
  if (path.startsWith("pallet")) return "pallet";
  return "package";
}

/** First section, in form order, that holds one of the given error paths. */
export function firstSectionWithError(
  errors: ProjectFieldErrors,
): GuidedSectionId | null {
  const sections = new Set(Object.keys(errors).map(sectionForErrorPath));
  return guidedSectionOrder.find((section) => sections.has(section)) ?? null;
}

const fieldErrorMessages = [
  [/^Expected number, received nan$/i, "projectForm.error.number"],
  [/^Number must be greater than 0$/i, "projectForm.error.greaterThanZero"],
  [
    /^Number must be greater than or equal to 0$/i,
    "projectForm.error.notNegative",
  ],
  [/^Expected number/i, "projectForm.error.number"],
  [/^Number must be finite$/i, "projectForm.error.finite"],
  [/^String must contain at least 1 character/i, "projectForm.error.empty"],
  [/^String must contain at most/i, "projectForm.error.tooLong"],
  [
    /^must be greater than or equal to tareKg$/i,
    "projectForm.error.grossBelowTare",
  ],
  [
    /^underhang leaves no usable load length$/i,
    "projectForm.error.underhangLength",
  ],
  [
    /^underhang leaves no usable load width$/i,
    "projectForm.error.underhangWidth",
  ],
  [
    /^must contain the allowed load length$/i,
    "projectForm.error.storageLength",
  ],
  [/^must contain the allowed load width$/i, "projectForm.error.storageWidth"],
  [/^must be at least the pallet height$/i, "projectForm.error.storageHeight"],
] as const satisfies readonly (readonly [RegExp, string])[];

export function fieldErrorMessage(message: string, t: Translate): string {
  const match = fieldErrorMessages.find(([pattern]) => pattern.test(message));
  return match ? t(match[1]) : message;
}

const validationDependencies = {
  now: () => 0,
  createId: (kind: string) => `${kind}-validation`,
};

/**
 * Runs the same schema the save path uses, without side effects, so field
 * errors on blur match exactly what a submit would report.
 */
export function validateProjectFormValues(
  values: ProjectFormValues,
  project: Project | null,
  t: Translate,
): ProjectFieldErrors {
  // The project schema allows an empty article number (imported .rob files
  // have none), but a planned project needs one for the plan list.
  const required: ProjectFieldErrors =
    values.productNumber.trim() === ""
      ? { productNumber: t("projectForm.error.empty") }
      : {};
  try {
    buildProjectFromForm(values, project, validationDependencies);
    return required;
  } catch (cause) {
    if (cause instanceof z.ZodError)
      return { ...zodFieldErrors(cause), ...required };
    return {
      form: cause instanceof Error ? cause.message : String(cause),
      ...required,
    };
  }
}

/** Null when the text is not a positive whole number. */
export function parseExactPackageCount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Hint under a total-overhang field: the per-side share of the entered value. */
export function overhangPerSideHint(
  value: string,
  t: Translate,
  tag: string,
): string {
  const total = finite(value);
  return total === null
    ? t("projectForm.overhangTotalHint")
    : t("projectForm.overhangPerSideHint", {
        value: formatNumber(total / 2, tag),
      });
}

export function formatNumber(value: number, tag: string): string {
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(value);
}

function positive(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function finite(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function packageDimensions(
  values: ProjectFormValues,
): { length: number; width: number; height: number } | null {
  const length = positive(values.packageLengthMm);
  const width = positive(values.packageWidthMm);
  const height = positive(values.packageHeightMm);
  return length !== null && width !== null && height !== null
    ? { length, width, height }
    : null;
}

/** Pallet plus the signed total overhang, as the solver envelope uses it. */
export function loadAreaMm(
  values: ProjectFormValues,
): { length: number; width: number } | null {
  const palletLength = positive(values.palletLengthMm);
  const palletWidth = positive(values.palletWidthMm);
  const overhangLength = finite(values.overhangLengthMm);
  const overhangWidth = finite(values.overhangWidthMm);
  if (
    palletLength === null ||
    palletWidth === null ||
    overhangLength === null ||
    overhangWidth === null
  ) {
    return null;
  }
  const length = palletLength + overhangLength;
  const width = palletWidth + overhangWidth;
  return length > 0 && width > 0 ? { length, width } : null;
}

/**
 * Packages in the best single-orientation grid on the load area. Shown as a
 * reference value for the exact count; it is not a solver result.
 */
export function simpleGridCount(values: ProjectFormValues): number | null {
  const box = packageDimensions(values);
  const area = loadAreaMm(values);
  if (!box || !area) return null;
  const clearance = Math.max(0, finite(values.packageClearanceMm) ?? 0);
  const fit = (span: number, size: number) =>
    Math.max(0, Math.floor((span + clearance) / (size + clearance)));
  return Math.max(
    fit(area.length, box.length) * fit(area.width, box.width),
    fit(area.length, box.width) * fit(area.width, box.length),
  );
}

const palletKindLabelKeys = {
  euro: "projectForm.palletKind.euro",
  industrial: "projectForm.palletKind.industrial",
  custom: "projectForm.palletKind.custom",
} as const satisfies Record<ProjectFormValues["palletKind"], string>;

export function palletKindLabel(
  kind: ProjectFormValues["palletKind"],
  t: Translate,
): string {
  return t(palletKindLabelKeys[kind]);
}

const sideLabelKeys = {
  top: "projectForm.side.top",
  right: "projectForm.side.right",
  bottom: "projectForm.side.bottom",
  left: "projectForm.side.left",
} as const satisfies Record<LabelEdge, string>;

/** Label position as seen in the infeed view, which is what the picker shows. */
export function labelSideLabel(
  side: ProjectFormValues["labelSideAtPickup"],
  orientation: ProjectFormValues["inletOrientation"],
  t: Translate,
): string {
  return side
    ? t(sideLabelKeys[displayedEdgeForPackageSide(orientation, side)])
    : t("projectForm.noPreference");
}

function overhangText(
  values: ProjectFormValues,
  t: Translate,
  tag: string,
): string {
  const length = finite(values.overhangLengthMm) ?? 0;
  const width = finite(values.overhangWidthMm) ?? 0;
  if (length === 0 && width === 0) return t("projectForm.noOverhang");
  const signed = (value: number) =>
    `${value > 0 ? "+" : ""}${formatNumber(value, tag)}`;
  return t("projectForm.overhangSummary", {
    length: signed(length),
    width: signed(width),
  });
}

/** One-line summary shown on a collapsed section. */
export function sectionSummary(
  section: GuidedSectionId,
  values: ProjectFormValues,
  t: Translate,
  tag: string,
): string {
  const fmt = (value: number) => formatNumber(value, tag);
  switch (section) {
    case "package": {
      const box = packageDimensions(values);
      if (!box) return t("projectForm.summary.packageMissing");
      const weight = positive(values.packageWeightKg);
      return `${fmt(box.length)} × ${fmt(box.width)} × ${fmt(box.height)} mm${
        weight === null
          ? t("projectForm.summary.weightOpen")
          : t("projectForm.summary.weight", { value: fmt(weight) })
      }`;
    }
    case "pallet": {
      const length = positive(values.palletLengthMm);
      const width = positive(values.palletWidthMm);
      const name =
        values.palletKind === "custom"
          ? values.palletName.trim() || palletKindLabel("custom", t)
          : palletKindLabel(values.palletKind, t);
      return `${name}${
        length !== null && width !== null
          ? ` ${fmt(length)} × ${fmt(width)} mm`
          : ""
      }, ${overhangText(values, t, tag)}`;
    }
    case "limits": {
      const height = positive(values.storageHeightMm);
      const gross = positive(values.maxGrossKg);
      const storage =
        values.hasStorageEnvelope && height !== null
          ? t("projectForm.summary.storageHeight", { value: fmt(height) })
          : t("projectForm.summary.noStorageHeight");
      return `${storage}, ${
        gross === null
          ? t("projectForm.summary.noWeightLimit")
          : t("projectForm.summary.maxGross", { value: fmt(gross) })
      }`;
    }
    case "handling":
      return t("projectForm.summary.handling", {
        orientation:
          values.inletOrientation === "lengthwise"
            ? t("projectForm.summary.lengthwise")
            : t("projectForm.summary.crosswise"),
        label: labelSideLabel(
          values.labelSideAtPickup,
          values.inletOrientation,
          t,
        ),
        grip: values.multiPickAllowed
          ? t("projectForm.summary.multiGrip")
          : t("projectForm.summary.singleGrip"),
      });
    case "meta": {
      const product = values.productNumber.trim();
      const line = values.projectNumber.trim();
      if (!product) return t("projectForm.summary.productMissing");
      return line
        ? t("projectForm.summary.productLine", { product, line })
        : t("projectForm.summary.product", { product });
    }
  }
}

/**
 * Whether saving these values would change what the solver consumes. The
 * planner discards generated patterns exactly when this signature changes.
 * Null when the values do not build a valid project yet.
 */
export function solverInputChanges(
  project: Project,
  values: ProjectFormValues,
): boolean | null {
  try {
    const next = buildProjectFromForm(values, project, validationDependencies);
    return (
      JSON.stringify(createLayerSolverInputFromProject(project)) !==
      JSON.stringify(createLayerSolverInputFromProject(next))
    );
  } catch {
    return null;
  }
}

/**
 * Whether saving these values marks saved solutions for geometry review. Uses
 * the same canonical signature as `updateProject`, so the footer hint and the
 * persisted flag can never disagree. Null when the values are not valid yet.
 */
export function geometryReviewChanges(
  project: Project,
  values: ProjectFormValues,
): boolean | null {
  try {
    const next = buildProjectFromForm(values, project, validationDependencies);
    return geometryReviewSignature(project) !== geometryReviewSignature(next);
  } catch {
    return null;
  }
}

export type LabelEdge = "top" | "right" | "bottom" | "left";

/** Package side shown at each edge of the infeed view (matches the label picker). */
const packageSideByDisplayedEdge: Record<
  ProjectFormValues["inletOrientation"],
  Record<LabelEdge, LabelEdge>
> = {
  lengthwise: { top: "top", right: "right", bottom: "bottom", left: "left" },
  crosswise: { top: "right", right: "bottom", bottom: "left", left: "top" },
};

export function packageSideForDisplayedEdge(
  orientation: ProjectFormValues["inletOrientation"],
  edge: LabelEdge,
): LabelEdge {
  return packageSideByDisplayedEdge[orientation][edge];
}

export function displayedEdgeForPackageSide(
  orientation: ProjectFormValues["inletOrientation"],
  side: LabelEdge,
): LabelEdge {
  const edges: LabelEdge[] = ["top", "right", "bottom", "left"];
  return edges.find(
    (edge) => packageSideByDisplayedEdge[orientation][edge] === side,
  )!;
}

/** Keep automatic footprint limits in step with the allowed load area. */
export function syncAutomaticStorage(
  values: ProjectFormValues,
  explicit: ReadonlySet<string>,
): ProjectFormValues {
  const area = loadAreaMm(values);
  if (!area) return values;
  return {
    ...values,
    storageLengthMm: explicit.has("pallet.storageEnvelopeMm.length")
      ? values.storageLengthMm
      : String(area.length),
    storageWidthMm: explicit.has("pallet.storageEnvelopeMm.width")
      ? values.storageWidthMm
      : String(area.width),
  };
}
