import {
  createEffectivePalletEnvelope,
  symmetricSideAllowance,
} from "~/domain/geometry";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import {
  createProject,
  type ProjectFactoryDependencies,
} from "~/domain/project/projectFactory";
import {
  createCustomPallet,
  getPalletTemplate,
} from "~/domain/project/palletTemplates";
import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import { createLayerSolverInputFromProject } from "~/domain/solver";
import {
  createInitialStackWorkspaceState,
  projectWithPersistedStack,
  rebuildStackSequence,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";

export const MOBILE_PLAN_STEPS = ["package", "pallet", "pattern"] as const;
export type MobilePlanStep = (typeof MOBILE_PLAN_STEPS)[number];

export type MobilePlanPalletKind = "euro" | "industrial" | "custom";

/** All numeric fields stay strings until parsing, mirroring projectForm.ts. */
export type MobilePlanDraft = {
  lineNumber: string;
  productNumber: string;
  packageLengthMm: string;
  packageWidthMm: string;
  packageHeightMm: string;
  packageWeightKg: string;
  palletKind: MobilePlanPalletKind;
  palletLengthMm: string;
  palletWidthMm: string;
  palletHeightMm: string;
  packagesPerLayer: string;
  layerCount: string;
};

export type MobilePlanField =
  | "packageLengthMm"
  | "packageWidthMm"
  | "packageHeightMm"
  | "packageWeightKg"
  | "palletLengthMm"
  | "palletWidthMm"
  | "palletHeightMm"
  | "packagesPerLayer"
  | "layerCount";

export type MobilePlanFieldErrors = Partial<Record<MobilePlanField, string>>;

export const MOBILE_PACKAGE_STEP_FIELDS = [
  "packageLengthMm",
  "packageWidthMm",
  "packageHeightMm",
  "packageWeightKg",
] as const satisfies readonly MobilePlanField[];

export const MOBILE_PALLET_STEP_FIELDS = [
  "palletLengthMm",
  "palletWidthMm",
  "palletHeightMm",
  "packagesPerLayer",
  "layerCount",
] as const satisfies readonly MobilePlanField[];

export const MOBILE_PLAN_DEFAULT_LAYER_COUNT = 10;

export function createMobilePlanDraft(): MobilePlanDraft {
  return {
    lineNumber: "",
    productNumber: "",
    packageLengthMm: "400",
    packageWidthMm: "300",
    packageHeightMm: "200",
    packageWeightKg: "",
    palletKind: "euro",
    palletLengthMm: "1200",
    palletWidthMm: "800",
    palletHeightMm: "144",
    packagesPerLayer: "",
    layerCount: String(MOBILE_PLAN_DEFAULT_LAYER_COUNT),
  };
}

export type ParsedMobilePlan = {
  lineNumber: string;
  productNumber: string;
  packageDimensionsMm: { length: number; width: number; height: number };
  packageWeightKg: number | null;
  palletKind: MobilePlanPalletKind;
  palletDimensionsMm: { length: number; width: number; height: number };
  packagesPerLayer: number;
  layerCount: number;
};

function parsePositiveNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseMobilePlanDraft(draft: MobilePlanDraft): {
  plan: ParsedMobilePlan | null;
  errors: MobilePlanFieldErrors;
} {
  const errors: MobilePlanFieldErrors = {};

  const packageLengthMm = parsePositiveNumber(draft.packageLengthMm);
  if (packageLengthMm === null) {
    errors.packageLengthMm = "Package length must be a positive number.";
  }
  const packageWidthMm = parsePositiveNumber(draft.packageWidthMm);
  if (packageWidthMm === null) {
    errors.packageWidthMm = "Package width must be a positive number.";
  }
  const packageHeightMm = parsePositiveNumber(draft.packageHeightMm);
  if (packageHeightMm === null) {
    errors.packageHeightMm = "Package height must be a positive number.";
  }

  let packageWeightKg: number | null = null;
  if (draft.packageWeightKg.trim() !== "") {
    const parsed = Number(draft.packageWeightKg);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.packageWeightKg = "Package weight must be zero or more.";
    } else {
      packageWeightKg = parsed;
    }
  }

  let palletLengthMm: number | null = null;
  let palletWidthMm: number | null = null;
  let palletHeightMm: number | null = null;
  if (draft.palletKind === "custom") {
    palletLengthMm = parsePositiveNumber(draft.palletLengthMm);
    if (palletLengthMm === null) {
      errors.palletLengthMm = "Pallet length must be a positive number.";
    }
    palletWidthMm = parsePositiveNumber(draft.palletWidthMm);
    if (palletWidthMm === null) {
      errors.palletWidthMm = "Pallet width must be a positive number.";
    }
    palletHeightMm = parsePositiveNumber(draft.palletHeightMm);
    if (palletHeightMm === null) {
      errors.palletHeightMm = "Pallet height must be a positive number.";
    }
  }

  const packagesPerLayer = parsePositiveInteger(draft.packagesPerLayer);
  if (packagesPerLayer === null) {
    errors.packagesPerLayer =
      "Packages per layer must be a positive whole number.";
  }
  const layerCount = parsePositiveInteger(draft.layerCount);
  if (layerCount === null) {
    errors.layerCount = "Layers must be a positive whole number.";
  }

  if (Object.keys(errors).length > 0) {
    return { plan: null, errors };
  }

  const palletDimensionsMm =
    draft.palletKind === "custom"
      ? {
          length: palletLengthMm!,
          width: palletWidthMm!,
          height: palletHeightMm!,
        }
      : getPalletTemplate(draft.palletKind).dimensionsMm;

  return {
    plan: {
      lineNumber: draft.lineNumber.trim(),
      productNumber: draft.productNumber.trim(),
      packageDimensionsMm: {
        length: packageLengthMm!,
        width: packageWidthMm!,
        height: packageHeightMm!,
      },
      packageWeightKg,
      palletKind: draft.palletKind,
      palletDimensionsMm,
      packagesPerLayer: packagesPerLayer!,
      layerCount: layerCount!,
    },
    errors: {},
  };
}

export function stepFieldErrors(
  errors: MobilePlanFieldErrors,
  fields: readonly MobilePlanField[],
): MobilePlanFieldErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) =>
      (fields as readonly string[]).includes(field),
    ),
  ) as MobilePlanFieldErrors;
}

/** Creates a solve-ready project (template or custom pallet, Multipack equipment). */
export function buildMobilePlanProject(
  plan: ParsedMobilePlan,
  options: { id?: string } = {},
  dependencies: ProjectFactoryDependencies = {},
): Project {
  const pallet =
    plan.palletKind === "custom"
      ? createCustomPallet({ dimensionsMm: plan.palletDimensionsMm })
      : getPalletTemplate(plan.palletKind);
  return createProject(
    {
      ...(options.id ? { id: options.id } : {}),
      projectNumber: plan.lineNumber,
      productNumber: plan.productNumber,
      package: {
        dimensionsMm: plan.packageDimensionsMm,
        weightKg: plan.packageWeightKg,
        clearanceMm: 0,
        multiPickAllowed: false,
        inletOrientation: "lengthwise",
      },
      pallet,
    },
    dependencies,
  );
}

/** Mirrors the desktop SolverControls input: exact count, single picks, mixed orientations. */
export function createMobilePlanSolverInput(
  project: Project,
  packagesPerLayer: number,
): LayerSolverInput {
  if (!project.pallet) {
    throw new Error("A pallet is required before generation.");
  }
  const overhang = project.pallet.allowedOverhangMm;
  const generationBoundsMm = createEffectivePalletEnvelope(
    project.pallet.dimensionsMm,
    symmetricSideAllowance(overhang),
  );
  const base = createLayerSolverInputFromProject(project, {
    minimumPackageCount: packagesPerLayer,
    maximumPackageCount: packagesPerLayer,
    maxCandidatesPerGenerator: 500,
    provisionalPackagesPerCycle: 1,
    allowMixedPackageOrientations: true,
    unrotatedPackageLabelSide: null,
    requiredShape: "any",
    rectangularBlockFootprintPolicy:
      overhang.length === 0 && overhang.width === 0
        ? "compact-centered"
        : "fill-generation-bounds",
  });
  return { ...base, generationBoundsMm };
}

/** Single-pattern tower stack with the requested layer count, matching desktop defaults. */
export function createMobilePlanStackState(
  candidate: SolverCandidate,
  layerCount: number,
): StackWorkspaceState {
  return rebuildStackSequence({
    ...createInitialStackWorkspaceState([candidate]),
    requestedLayerCount: layerCount,
  });
}

/** Writes the selected candidate as pattern + stack into the active solution. */
export function projectWithMobilePlanStack(
  project: Project,
  candidate: SolverCandidate,
  solverInput: LayerSolverInput,
  layerCount: number,
): Project {
  return projectWithPersistedStack(
    project,
    [candidate],
    solverInput,
    createMobilePlanStackState(candidate, layerCount),
  );
}

export type MobilePlanSummary = {
  packageLabel: string;
  palletLabel: string;
  packagesPerLayer: number;
  layerCount: number;
  totalPackages: number;
};

export function summarizeMobilePlan(
  plan: ParsedMobilePlan,
  project: Project,
): MobilePlanSummary {
  const pallet = project.pallet;
  return {
    packageLabel: `${plan.packageDimensionsMm.length} × ${plan.packageDimensionsMm.width} × ${plan.packageDimensionsMm.height} mm`,
    palletLabel: pallet
      ? `${pallet.name} · ${pallet.dimensionsMm.length} × ${pallet.dimensionsMm.width} mm`
      : "No pallet",
    packagesPerLayer: plan.packagesPerLayer,
    layerCount: plan.layerCount,
    totalPackages: plan.packagesPerLayer * plan.layerCount,
  };
}

function activeSolution(project: Project) {
  return (
    project.solutions.find(({ id }) => id === project.activeSolutionId) ??
    project.solutions[0] ??
    null
  );
}

/** Pattern shown for a saved plan: the first stacked layer's pattern, else the first pattern. */
function primaryPattern(project: Project) {
  const solution = activeSolution(project);
  if (!solution) return null;
  const firstLayerRef = solution.stack.layers[0]?.patternId;
  return (
    solution.patterns.find(({ id }) => id === firstLayerRef) ??
    solution.patterns[0] ??
    null
  );
}

export type SavedPlanSummary = {
  title: string;
  packageLabel: string;
  palletLabel: string;
  packagesPerLayer: number | null;
  layerCount: number;
  totalPackages: number | null;
};

export function summarizeSavedProject(project: Project): SavedPlanSummary {
  const solution = activeSolution(project);
  const pattern = primaryPattern(project);
  const packagesPerLayer = pattern ? pattern.placements.length : null;
  const layerCount = solution?.stack.layers.length ?? 0;
  const { length, width, height } = project.package.dimensionsMm;
  return {
    title:
      project.productNumber.trim() ||
      project.projectNumber.trim() ||
      "Untitled project",
    packageLabel: `${length} × ${width} × ${height} mm`,
    palletLabel: project.pallet?.name ?? "No pallet",
    packagesPerLayer,
    layerCount,
    totalPackages:
      packagesPerLayer === null ? null : packagesPerLayer * layerCount,
  };
}

/** Token-friendly preview of a saved pattern; positions are package centers. */
export function savedProjectPatternPreview(
  project: Project,
): LayerPatternPreview | null {
  const pattern = primaryPattern(project);
  if (!pattern || !project.pallet) return null;
  const { length, width } = project.package.dimensionsMm;
  const items = pattern.placements.map((placement, index) => {
    const rotated = placement.rotation === 90 || placement.rotation === 270;
    return {
      id: `${pattern.id}:placement-${index + 1}`,
      centerMm: { ...placement.positionMm },
      sizeMm: {
        x: rotated ? width : length,
        y: rotated ? length : width,
      },
      rotation: placement.rotation,
      labelSide: placement.labelSide,
      groupLabel: null,
    };
  });
  return {
    id: pattern.id,
    label: pattern.name || "Saved pattern",
    palletBoundsMm: {
      minX: 0,
      minY: 0,
      maxX: project.pallet.dimensionsMm.length,
      maxY: project.pallet.dimensionsMm.width,
    },
    items,
    metadata: {
      source: "pallet-layer",
      sourceId: pattern.id,
      layerIndex: 0,
      patternRef: null,
      candidateId: null,
      packageCount: pattern.placements.length,
      cycleCount: pattern.grips.length,
    },
  };
}
