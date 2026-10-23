import { z } from "zod";
import type { Project } from "~/domain/project/projectSchema";
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
  "package",
  "pallet",
  "limits",
  "handling",
  "meta",
];

export const guidedSectionTitles: Record<GuidedSectionId, string> = {
  package: "Paket",
  pallet: "Palette",
  limits: "Grenzen",
  handling: "Einlauf, Etikett, Griff",
  meta: "Artikel und Linie",
};

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

const germanMessages: readonly [RegExp, string][] = [
  [/^Expected number, received nan$/i, "Bitte eine Zahl eingeben."],
  [/^Number must be greater than 0$/i, "Muss größer als 0 sein."],
  [/^Number must be greater than or equal to 0$/i, "Darf nicht negativ sein."],
  [/^Expected number/i, "Bitte eine Zahl eingeben."],
  [/^Number must be finite$/i, "Bitte eine endliche Zahl eingeben."],
  [/^String must contain at least 1 character/i, "Darf nicht leer sein."],
  [/^String must contain at most/i, "Ist zu lang."],
  [
    /^must be greater than or equal to tareKg$/i,
    "Muss mindestens so groß wie das Leergewicht sein.",
  ],
  [
    /^underhang leaves no usable load length$/i,
    "Der Unterstand lässt keine nutzbare Ladelänge übrig.",
  ],
  [
    /^underhang leaves no usable load width$/i,
    "Der Unterstand lässt keine nutzbare Ladebreite übrig.",
  ],
  [
    /^must contain the allowed load length$/i,
    "Muss die zulässige Ladelänge (Palette plus Überstand) aufnehmen.",
  ],
  [
    /^must contain the allowed load width$/i,
    "Muss die zulässige Ladebreite (Palette plus Überstand) aufnehmen.",
  ],
  [
    /^must be at least the pallet height$/i,
    "Muss mindestens so hoch wie die Palette sein.",
  ],
];

export function germanFieldError(message: string): string {
  return (
    germanMessages.find(([pattern]) => pattern.test(message))?.[1] ?? message
  );
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
): ProjectFieldErrors {
  try {
    buildProjectFromForm(values, project, validationDependencies);
    return {};
  } catch (cause) {
    if (cause instanceof z.ZodError) return zodFieldErrors(cause);
    return { form: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Null when the text is not a positive whole number. */
export function parseExactPackageCount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const numberFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 2,
});

/** Hint under a total-overhang field: the per-side share of the entered value. */
export function overhangPerSideHint(value: string): string {
  const total = finite(value);
  return total === null
    ? "Gesamt über beide Seiten, je Seite die Hälfte. Negativ für Unterstand."
    : `Je Seite ${formatNumber(total / 2)} mm. Negativ für Unterstand.`;
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
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

const palletKindLabels: Record<ProjectFormValues["palletKind"], string> = {
  euro: "Euro-Palette",
  industrial: "Industriepalette",
  custom: "Eigene Palette",
};

export function palletKindLabel(kind: ProjectFormValues["palletKind"]): string {
  return palletKindLabels[kind];
}

const sideLabels = {
  top: "oben",
  right: "rechts",
  bottom: "unten",
  left: "links",
} as const;

/** Label position as seen in the infeed view, which is what the picker shows. */
export function labelSideLabel(
  side: ProjectFormValues["labelSideAtPickup"],
  orientation: ProjectFormValues["inletOrientation"] = "lengthwise",
): string {
  return side
    ? sideLabels[displayedEdgeForPackageSide(orientation, side)]
    : "ohne Vorgabe";
}

function overhangText(values: ProjectFormValues): string {
  const length = finite(values.overhangLengthMm) ?? 0;
  const width = finite(values.overhangWidthMm) ?? 0;
  if (length === 0 && width === 0) return "ohne Überstand";
  const signed = (value: number) =>
    `${value > 0 ? "+" : ""}${formatNumber(value)}`;
  return `Überstand ${signed(length)} / ${signed(width)} mm gesamt`;
}

/** One-line summary shown on a collapsed section. */
export function sectionSummary(
  section: GuidedSectionId,
  values: ProjectFormValues,
): string {
  switch (section) {
    case "package": {
      const box = packageDimensions(values);
      if (!box) return "Länge, Breite und Höhe fehlen noch";
      const weight = positive(values.packageWeightKg);
      return `${formatNumber(box.length)} × ${formatNumber(box.width)} × ${formatNumber(box.height)} mm${
        weight === null ? ", Gewicht offen" : `, ${formatNumber(weight)} kg`
      }`;
    }
    case "pallet": {
      const length = positive(values.palletLengthMm);
      const width = positive(values.palletWidthMm);
      const name =
        values.palletKind === "custom"
          ? values.palletName.trim() || palletKindLabel("custom")
          : palletKindLabel(values.palletKind);
      return `${name}${
        length !== null && width !== null
          ? ` ${formatNumber(length)} × ${formatNumber(width)} mm`
          : ""
      }, ${overhangText(values)}`;
    }
    case "limits": {
      const height = positive(values.storageHeightMm);
      const gross = positive(values.maxGrossKg);
      const storage =
        values.hasStorageEnvelope && height !== null
          ? `Lagerhöhe ${formatNumber(height)} mm`
          : "Keine Lagerhöhe";
      return `${storage}, ${
        gross === null
          ? "kein Gewichtslimit"
          : `max. ${formatNumber(gross)} kg brutto`
      }`;
    }
    case "handling":
      return `Einlauf ${values.inletOrientation === "lengthwise" ? "längs" : "quer"}, Etikett ${labelSideLabel(values.labelSideAtPickup, values.inletOrientation)}, ${
        values.multiPickAllowed ? "Mehrfachgriff" : "Einzelgriff"
      }`;
    case "meta": {
      const parts = [
        values.productNumber.trim() && `Artikel ${values.productNumber.trim()}`,
        values.projectNumber.trim() && `Linie ${values.projectNumber.trim()}`,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(", ") : "Optional";
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
