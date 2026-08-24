import type { ZodError } from "zod";
import {
  createProject,
  updateProject,
  type ProjectFactoryDependencies,
} from "~/domain/project/projectFactory";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import type { Project } from "~/domain/project/projectSchema";
import type { Side } from "~/domain/palletTypes";

export type ProjectFormValues = {
  projectNumber: string;
  productNumber: string;
  packageLengthMm: string;
  packageWidthMm: string;
  packageHeightMm: string;
  packageWeightKg: string;
  packageClearanceMm: string;
  inletOrientation: "lengthwise" | "crosswise";
  labelSideAtPickup: "" | Side;
  multiPickAllowed: boolean;
  palletKind: "euro" | "industrial" | "custom";
  palletId: string;
  palletName: string;
  palletLengthMm: string;
  palletWidthMm: string;
  palletHeightMm: string;
  overhangLengthMm: string;
  overhangWidthMm: string;
  hasStorageEnvelope: boolean;
  storageLengthMm: string;
  storageWidthMm: string;
  storageHeightMm: string;
  tareKg: string;
  maxGrossKg: string;
};

export type ProjectFieldErrors = Record<string, string>;

function text(value: number | null): string {
  return value === null ? "" : String(value);
}

export function projectToFormValues(
  project: Project | null,
): ProjectFormValues {
  const pallet = project?.pallet ?? getPalletTemplate("euro");
  return {
    projectNumber: project?.projectNumber ?? "",
    productNumber: project?.productNumber ?? "",
    packageLengthMm: project ? String(project.package.dimensionsMm.length) : "",
    packageWidthMm: project ? String(project.package.dimensionsMm.width) : "",
    packageHeightMm: project ? String(project.package.dimensionsMm.height) : "",
    packageWeightKg: text(project?.package.weightKg ?? null),
    packageClearanceMm: String(project?.package.clearanceMm ?? 0),
    inletOrientation: project?.package.inletOrientation ?? "lengthwise",
    labelSideAtPickup:
      project?.package.labelSidesAtPickup.length === 1
        ? project.package.labelSidesAtPickup[0]!
        : "",
    multiPickAllowed: project?.package.multiPickAllowed ?? false,
    palletKind: pallet.kind,
    palletId: pallet.id,
    palletName: pallet.name,
    palletLengthMm: String(pallet.dimensionsMm.length),
    palletWidthMm: String(pallet.dimensionsMm.width),
    palletHeightMm: String(pallet.dimensionsMm.height),
    overhangLengthMm: String(pallet.allowedOverhangMm.length),
    overhangWidthMm: String(pallet.allowedOverhangMm.width),
    hasStorageEnvelope: pallet.storageEnvelopeMm !== null,
    storageLengthMm: String(
      pallet.storageEnvelopeMm?.length ?? pallet.dimensionsMm.length,
    ),
    storageWidthMm: String(
      pallet.storageEnvelopeMm?.width ?? pallet.dimensionsMm.width,
    ),
    storageHeightMm: String(pallet.storageEnvelopeMm?.height ?? 1800),
    tareKg: text(pallet.tareKg),
    maxGrossKg: text(pallet.maxGrossKg),
  };
}

export function palletTemplateFormValues(
  kind: "euro" | "industrial",
  current: ProjectFormValues,
): ProjectFormValues {
  const pallet = getPalletTemplate(kind);
  return {
    ...current,
    palletKind: kind,
    palletId: pallet.id,
    palletName: pallet.name,
    palletLengthMm: String(pallet.dimensionsMm.length),
    palletWidthMm: String(pallet.dimensionsMm.width),
    palletHeightMm: String(pallet.dimensionsMm.height),
    overhangLengthMm: String(pallet.allowedOverhangMm.length),
    overhangWidthMm: String(pallet.allowedOverhangMm.width),
    tareKg: text(pallet.tareKg),
    maxGrossKg: text(pallet.maxGrossKg),
    storageLengthMm: String(pallet.dimensionsMm.length),
    storageWidthMm: String(pallet.dimensionsMm.width),
  };
}

function requiredNumber(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function buildProjectFromForm(
  values: ProjectFormValues,
  existingProject: Project | null,
  dependencies: ProjectFactoryDependencies = {},
): Project {
  const palletId =
    values.palletKind === "custom"
      ? values.palletId.trim() ||
        `pallet-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`
      : getPalletTemplate(values.palletKind).id;
  const existingLabelSides = existingProject?.package.labelSidesAtPickup ?? [];
  const packageSpec = {
    shape: "cuboid" as const,
    dimensionsMm: {
      length: requiredNumber(values.packageLengthMm),
      width: requiredNumber(values.packageWidthMm),
      height: requiredNumber(values.packageHeightMm),
    },
    weightKg: optionalNumber(values.packageWeightKg),
    clearanceMm: requiredNumber(values.packageClearanceMm),
    multiPickAllowed: values.multiPickAllowed,
    inletOrientation: values.inletOrientation,
    palletizingDirection: existingProject?.package.palletizingDirection ?? null,
    labelSidesAtPickup: values.labelSideAtPickup
      ? [values.labelSideAtPickup]
      : // The picker can only express zero or one face, so a legacy multi-face
        // selection is preserved instead of being silently cleared.
        existingLabelSides.length > 1
        ? existingLabelSides
        : [],
  };
  const pallet = {
    id: palletId,
    name: values.palletName,
    kind: values.palletKind,
    dimensionsMm: {
      length: requiredNumber(values.palletLengthMm),
      width: requiredNumber(values.palletWidthMm),
      height: requiredNumber(values.palletHeightMm),
    },
    storageEnvelopeMm: values.hasStorageEnvelope
      ? {
          length: requiredNumber(values.storageLengthMm),
          width: requiredNumber(values.storageWidthMm),
          height: requiredNumber(values.storageHeightMm),
        }
      : null,
    allowedOverhangMm: {
      length: requiredNumber(values.overhangLengthMm),
      width: requiredNumber(values.overhangWidthMm),
    },
    tareKg: optionalNumber(values.tareKg),
    maxGrossKg: optionalNumber(values.maxGrossKg),
    subPalletPattern: existingProject?.pallet?.subPalletPattern ?? "none",
  };

  return existingProject
    ? updateProject(
        existingProject,
        {
          projectNumber: values.projectNumber,
          productNumber: values.productNumber,
          package: packageSpec,
          pallet,
        },
        dependencies,
      )
    : createProject(
        {
          projectNumber: values.projectNumber,
          productNumber: values.productNumber,
          package: packageSpec,
          pallet,
        },
        dependencies,
      );
}

export function zodFieldErrors(error: ZodError): ProjectFieldErrors {
  const fields: ProjectFieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!(path in fields)) fields[path || "form"] = issue.message;
  }
  return fields;
}
