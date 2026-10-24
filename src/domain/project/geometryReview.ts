import type { Project } from "./projectSchema";

/**
 * Canonical signature of the inputs that saved placements and grips depend on.
 * When it changes, nonempty solutions are kept but marked `requiresGeometryReview`.
 * Storage limits, weights and metadata are deliberately excluded: they are
 * validated by the stack and never move a saved package.
 */
export function geometryReviewSignature(project: Project): string {
  return JSON.stringify({
    shape: project.package.shape,
    dimensions: project.package.dimensionsMm,
    clearance: project.package.clearanceMm,
    inlet: project.package.inletOrientation,
    multipick: project.package.multiPickAllowed,
    labels: project.package.labelSidesAtPickup,
    palletDimensions: project.pallet?.dimensionsMm ?? null,
    overhang: project.pallet?.allowedOverhangMm ?? null,
  });
}
