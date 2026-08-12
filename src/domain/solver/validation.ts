import {
  assertRectangleBounds,
  insetRectangleBounds,
  ORTHOGONAL_ROTATIONS,
  placementClearanceBounds,
  placementRectangleBounds,
  rectangleBoundsContain,
  rectangleSizeForRotation,
} from "~/domain/geometry";
import {
  SOLVER_GEOMETRY_EPSILON_MM,
  solverRectangleBoundsOverlap,
} from "~/domain/solver/geometryPolicy";
import { placementsUseMixedPackageOrientations } from "~/domain/solver/orientationPolicy";
import { assessRectangularBlockPlacements } from "~/domain/solver/rectangularBlock";
import type { Rotation, Side } from "~/domain/palletTypes";
import type {
  CandidateValidation,
  GeneratedPlacement,
  LayerSolverInput,
  NormalizedLayerSolverInput,
  RectangularBlockFootprintPolicy,
  RequiredCandidateShape,
  SolverIssue,
} from "~/domain/solver/types";

const DEFAULT_MAX_PLACEMENTS = 10_000;
const DEFAULT_MAX_BANDS = 64;
const DEFAULT_MAX_CANDIDATES_PER_GENERATOR = 5_000;
const rotations = new Set<number>(ORTHOGONAL_ROTATIONS);
const packageLabelSides = new Set<string>(["top", "right", "bottom", "left"]);
const rectangularBlockFootprintPolicies = new Set<string>([
  "fill-generation-bounds",
  "compact-centered",
]);

function isPackageLabelSide(value: unknown): value is Side {
  return typeof value === "string" && packageLabelSides.has(value);
}

function isRectangularBlockFootprintPolicy(
  value: unknown,
): value is RectangularBlockFootprintPolicy {
  return (
    typeof value === "string" && rectangularBlockFootprintPolicies.has(value)
  );
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export type SolverInputValidation = {
  valid: boolean;
  issues: readonly SolverIssue[];
  normalized: NormalizedLayerSolverInput | null;
};

export function validateAndNormalizeSolverInput(
  input: LayerSolverInput,
): SolverInputValidation {
  const issues: SolverIssue[] = [];
  const packageLength = input.package.dimensionsMm.length;
  const packageWidth = input.package.dimensionsMm.width;
  const clearance = input.package.clearanceMm;

  if (input.package.shape !== "cuboid") {
    issues.push({
      code: "unsupported-package-shape",
      message: `Package shape "${input.package.shape}" is not supported; the v1 solver accepts cuboids only.`,
    });
  }
  if (!isFinitePositive(packageLength) || !isFinitePositive(packageWidth)) {
    issues.push({
      code: "invalid-package-dimensions",
      message: "Package length and width must be finite positive numbers.",
    });
  }
  if (!isFiniteNonNegative(clearance)) {
    issues.push({
      code: "invalid-clearance",
      message: "Package clearance must be a finite non-negative number.",
    });
  }

  let envelope = null;
  try {
    envelope = assertRectangleBounds(input.envelopeMm, "envelopeMm");
  } catch (cause) {
    issues.push({
      code: "invalid-envelope",
      message:
        cause instanceof Error
          ? cause.message
          : "The effective pallet envelope is invalid.",
    });
  }

  let physicalPalletBounds = null;
  if (input.physicalPalletBoundsMm !== undefined) {
    try {
      physicalPalletBounds = assertRectangleBounds(
        input.physicalPalletBoundsMm,
        "physicalPalletBoundsMm",
      );
    } catch (cause) {
      issues.push({
        code: "invalid-physical-pallet-bounds",
        message:
          cause instanceof Error
            ? cause.message
            : "The physical pallet bounds are invalid.",
      });
    }
  }

  let rawRotations: unknown = input.constraints?.allowedRotations;
  if (rawRotations === undefined) rawRotations = ORTHOGONAL_ROTATIONS;
  const rotationInputs: readonly unknown[] = Array.isArray(rawRotations)
    ? rawRotations
    : [];
  if (!Array.isArray(rawRotations)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "allowedRotations must be an array of orthogonal rotations.",
    });
  }
  const seenRotations = new Set<number>();
  const allowedRotations: Rotation[] = [];
  for (const candidateRotation of rotationInputs) {
    if (
      typeof candidateRotation !== "number" ||
      !rotations.has(candidateRotation)
    ) {
      issues.push({
        code: "invalid-input-constraint",
        message: `Allowed rotation ${String(candidateRotation)} is not orthogonal.`,
      });
      continue;
    }
    if (seenRotations.has(candidateRotation)) {
      issues.push({
        code: "duplicate-allowed-rotation",
        message: `Allowed rotation ${candidateRotation} is duplicated.`,
      });
      continue;
    }
    seenRotations.add(candidateRotation);
    allowedRotations.push(candidateRotation as Rotation);
  }
  allowedRotations.sort((left, right) => left - right);
  if (Array.isArray(rawRotations) && allowedRotations.length === 0) {
    issues.push({
      code: "invalid-input-constraint",
      message: "At least one orthogonal placement rotation is required.",
    });
  }

  const edgeClearanceMm = input.constraints?.edgeClearanceMm ?? 0;
  const minimumPackageCount = input.constraints?.minimumPackageCount ?? 1;
  const maxPlacements =
    input.constraints?.maxPlacements ?? DEFAULT_MAX_PLACEMENTS;
  const maximumPackageCount =
    input.constraints?.maximumPackageCount ?? maxPlacements;
  const maxBands = input.constraints?.maxBands ?? DEFAULT_MAX_BANDS;
  const maxCandidatesPerGenerator =
    input.constraints?.maxCandidatesPerGenerator ??
    DEFAULT_MAX_CANDIDATES_PER_GENERATOR;
  const provisionalPackagesPerCycle =
    input.constraints?.provisionalPackagesPerCycle ?? 1;
  const allowMixedPackageOrientations =
    input.constraints?.allowMixedPackageOrientations ?? true;
  const rawUnrotatedPackageLabelSide =
    input.constraints?.unrotatedPackageLabelSide ?? null;
  const unrotatedPackageLabelSide: Side | null = isPackageLabelSide(
    rawUnrotatedPackageLabelSide,
  )
    ? rawUnrotatedPackageLabelSide
    : null;
  const requiredShape: RequiredCandidateShape =
    input.constraints?.requiredShape ?? "any";
  let rawRectangularBlockFootprintPolicy: unknown =
    input.constraints?.rectangularBlockFootprintPolicy;
  if (rawRectangularBlockFootprintPolicy === undefined) {
    rawRectangularBlockFootprintPolicy = "fill-generation-bounds";
  }
  const rectangularBlockFootprintPolicy: RectangularBlockFootprintPolicy =
    isRectangularBlockFootprintPolicy(rawRectangularBlockFootprintPolicy)
      ? rawRectangularBlockFootprintPolicy
      : "fill-generation-bounds";

  if (!isFiniteNonNegative(edgeClearanceMm)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "edgeClearanceMm must be a finite non-negative number.",
    });
  }
  if (!isNonNegativeInteger(minimumPackageCount)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "minimumPackageCount must be a non-negative integer.",
    });
  }
  if (!isNonNegativeInteger(maximumPackageCount)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "maximumPackageCount must be a non-negative integer.",
    });
  }
  if (
    isNonNegativeInteger(minimumPackageCount) &&
    isNonNegativeInteger(maximumPackageCount) &&
    maximumPackageCount < minimumPackageCount
  ) {
    issues.push({
      code: "invalid-input-constraint",
      message:
        "maximumPackageCount must be greater than or equal to minimumPackageCount.",
    });
  }
  if (!isPositiveInteger(maxPlacements)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "maxPlacements must be a positive integer.",
    });
  }
  if (
    isNonNegativeInteger(maximumPackageCount) &&
    isPositiveInteger(maxPlacements) &&
    maximumPackageCount > maxPlacements
  ) {
    issues.push({
      code: "invalid-input-constraint",
      message: "maximumPackageCount must not exceed maxPlacements.",
    });
  }
  if (!isPositiveInteger(maxBands)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "maxBands must be a positive integer.",
    });
  }
  if (!isPositiveInteger(maxCandidatesPerGenerator)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "maxCandidatesPerGenerator must be a positive integer.",
    });
  }
  if (!isPositiveInteger(provisionalPackagesPerCycle)) {
    issues.push({
      code: "invalid-input-constraint",
      message: "provisionalPackagesPerCycle must be a positive integer.",
    });
  }
  if (typeof allowMixedPackageOrientations !== "boolean") {
    issues.push({
      code: "invalid-input-constraint",
      message: "allowMixedPackageOrientations must be a boolean.",
    });
  }
  if (
    rawUnrotatedPackageLabelSide !== null &&
    !isPackageLabelSide(rawUnrotatedPackageLabelSide)
  ) {
    issues.push({
      code: "invalid-input-constraint",
      message:
        'unrotatedPackageLabelSide must be "top", "right", "bottom", "left", or null.',
    });
  }
  if (
    unrotatedPackageLabelSide !== null &&
    input.physicalPalletBoundsMm === undefined
  ) {
    issues.push({
      code: "invalid-physical-pallet-bounds",
      message:
        "physicalPalletBoundsMm is required when nearest-edge label yaw preference is enabled.",
    });
  }
  if (requiredShape !== "any" && requiredShape !== "rectangular-block") {
    issues.push({
      code: "invalid-input-constraint",
      message: 'requiredShape must be "any" or "rectangular-block".',
    });
  }
  if (!isRectangularBlockFootprintPolicy(rawRectangularBlockFootprintPolicy)) {
    issues.push({
      code: "invalid-input-constraint",
      message:
        'rectangularBlockFootprintPolicy must be "fill-generation-bounds" or "compact-centered".',
    });
  }

  let usableEnvelope = envelope;
  if (envelope && isFiniteNonNegative(edgeClearanceMm)) {
    try {
      usableEnvelope =
        edgeClearanceMm === 0
          ? envelope
          : insetRectangleBounds(envelope, edgeClearanceMm);
    } catch (cause) {
      issues.push({
        code: "invalid-input-constraint",
        message:
          cause instanceof Error
            ? `edgeClearanceMm leaves no usable envelope: ${cause.message}`
            : "edgeClearanceMm leaves no usable envelope.",
      });
      usableEnvelope = null;
    }
  }

  let generationBounds = usableEnvelope;
  if (input.generationBoundsMm !== undefined) {
    try {
      generationBounds = assertRectangleBounds(
        input.generationBoundsMm,
        "generationBoundsMm",
      );
    } catch (cause) {
      issues.push({
        code: "invalid-envelope",
        message:
          cause instanceof Error
            ? cause.message
            : "The requested generation envelope is invalid.",
      });
      generationBounds = null;
    }
  }
  if (
    usableEnvelope &&
    generationBounds &&
    !rectangleBoundsContain(
      usableEnvelope,
      generationBounds,
      SOLVER_GEOMETRY_EPSILON_MM,
    )
  ) {
    issues.push({
      code: "invalid-envelope",
      message:
        "The requested generation envelope must fit inside the project-authorized pallet envelope.",
    });
  }

  if (
    generationBounds &&
    isFinitePositive(packageLength) &&
    isFinitePositive(packageWidth) &&
    allowedRotations.length > 0
  ) {
    const fits = allowedRotations.some((rotation) => {
      const size = rectangleSizeForRotation(
        { length: packageLength, width: packageWidth },
        rotation,
      );
      return (
        size.length <=
          generationBounds.maxX -
            generationBounds.minX +
            SOLVER_GEOMETRY_EPSILON_MM &&
        size.width <=
          generationBounds.maxY -
            generationBounds.minY +
            SOLVER_GEOMETRY_EPSILON_MM
      );
    });
    if (!fits) {
      issues.push({
        code: "package-does-not-fit",
        message:
          "The package does not fit the requested generation envelope in any allowed rotation.",
      });
    }
  }

  if (issues.length > 0 || !envelope || !usableEnvelope || !generationBounds) {
    return { valid: false, issues, normalized: null };
  }

  return {
    valid: true,
    issues: [],
    normalized: {
      package: {
        shape: input.package.shape,
        dimensionsMm: {
          length: packageLength,
          width: packageWidth,
        },
        clearanceMm: clearance,
      },
      envelopeMm: envelope,
      physicalPalletBoundsMm: physicalPalletBounds,
      usableEnvelopeMm: usableEnvelope,
      generationBoundsMm: generationBounds,
      constraints: {
        allowedRotations,
        edgeClearanceMm,
        minimumPackageCount,
        maximumPackageCount,
        maxPlacements,
        maxBands,
        maxCandidatesPerGenerator,
        provisionalPackagesPerCycle,
        allowMixedPackageOrientations,
        unrotatedPackageLabelSide,
        requiredShape,
        rectangularBlockFootprintPolicy,
      },
    },
  };
}

export function validateCandidatePlacements(
  input: NormalizedLayerSolverInput,
  placements: readonly GeneratedPlacement[],
): CandidateValidation {
  const issues: SolverIssue[] = [];
  const count = placements.length;
  if (count === 0) {
    issues.push({ code: "empty-candidate", message: "Candidate is empty." });
  }
  if (count < input.constraints.minimumPackageCount) {
    issues.push({
      code: "package-count-below-minimum",
      message: `Candidate has ${count} packages, below the minimum of ${input.constraints.minimumPackageCount}.`,
    });
  }
  if (count > input.constraints.maximumPackageCount) {
    issues.push({
      code: "package-count-above-maximum",
      message: `Candidate has ${count} packages, above the maximum of ${input.constraints.maximumPackageCount}.`,
    });
  }
  if (
    !input.constraints.allowMixedPackageOrientations &&
    placementsUseMixedPackageOrientations(placements)
  ) {
    issues.push({
      code: "mixed-package-orientations-disallowed",
      message:
        "Candidate mixes lengthwise and crosswise package orientations, but mixed orientations are disabled.",
    });
  }

  const allowedRotations = new Set<Rotation>(
    input.constraints.allowedRotations,
  );
  const boundsEntries: Array<{
    index: number;
    physical: ReturnType<typeof placementRectangleBounds>;
    clearance: ReturnType<typeof placementClearanceBounds>;
  }> = [];

  placements.forEach((placement, index) => {
    if (
      !Number.isFinite(placement.positionMm.x) ||
      !Number.isFinite(placement.positionMm.y)
    ) {
      issues.push({
        code: "non-finite-placement",
        message: `Placement ${index} has non-finite coordinates.`,
        placementIndices: [index],
      });
      return;
    }
    if (!allowedRotations.has(placement.rotation)) {
      issues.push({
        code: "unsupported-rotation",
        message: `Placement ${index} uses disallowed rotation ${placement.rotation}.`,
        placementIndices: [index],
      });
      return;
    }

    const physical = placementRectangleBounds(
      placement,
      input.package.dimensionsMm,
    );
    const clearanceBounds = placementClearanceBounds(
      placement,
      input.package.dimensionsMm,
      input.package.clearanceMm,
    );
    if (
      !rectangleBoundsContain(
        input.generationBoundsMm,
        physical,
        SOLVER_GEOMETRY_EPSILON_MM,
      )
    ) {
      issues.push({
        code: "placement-out-of-bounds",
        message: `Placement ${index} exceeds the requested generation envelope.`,
        placementIndices: [index],
      });
    }
    boundsEntries.push({ index, physical, clearance: clearanceBounds });
  });

  const sorted = [...boundsEntries].sort(
    (left, right) =>
      left.clearance.minX - right.clearance.minX ||
      left.clearance.minY - right.clearance.minY ||
      left.index - right.index,
  );
  for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
    const left = sorted[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < sorted.length;
      rightIndex += 1
    ) {
      const right = sorted[rightIndex]!;
      if (
        right.clearance.minX >=
        left.clearance.maxX - SOLVER_GEOMETRY_EPSILON_MM
      ) {
        break;
      }
      if (solverRectangleBoundsOverlap(left.clearance, right.clearance)) {
        issues.push({
          code: "placement-overlap",
          message: `Placements ${left.index} and ${right.index} overlap or violate clearance.`,
          placementIndices: [left.index, right.index],
        });
      }
    }
  }

  if (
    input.constraints.requiredShape === "rectangular-block" &&
    count > 0 &&
    boundsEntries.length === count
  ) {
    const assessment = assessRectangularBlockPlacements(input, placements);
    if (!assessment.valid) {
      issues.push({
        code: "non-rectangular-block",
        message: assessment.message,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
