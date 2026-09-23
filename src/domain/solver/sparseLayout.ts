import {
  boundingRectangleForPlacements,
  placementRectangleBounds,
  rectangleSizeForRotation,
} from "~/domain/geometry";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import type {
  GeneratedPlacement,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";

export type SparseLayoutReason = "unused-edge-strip" | "separating-corridor";

/**
 * Conservative geometric screen for free-count alternatives. A small boundary
 * remainder or an enclosed pinwheel core is not evidence of a sparse layout.
 * Callers retain requested counts and the best feasible count found by search.
 */
export function sparseLayoutReason(
  input: NormalizedLayerSolverInput,
  placements: readonly GeneratedPlacement[],
): SparseLayoutReason | null {
  if (placements.length === 0) return null;
  const size = input.package.dimensionsMm;
  const occupied = boundingRectangleForPlacements(placements, size)!;
  const bounds = input.generationBoundsMm;
  const width = occupied.maxX - occupied.minX;
  const height = occupied.maxY - occupied.minY;
  const gap = input.package.clearanceMm;
  const epsilon = SOLVER_GEOMETRY_EPSILON_MM;
  // Use the LONG edge: space for a differently oriented side column alone
  // does not make an otherwise full grid or strip arrangement unproductive.
  const completeStrip = Math.max(size.length, size.width) + gap;
  if (
    bounds.maxX - bounds.minX - width >= completeStrip - epsilon ||
    bounds.maxY - bounds.minY - height >= completeStrip - epsilon
  ) {
    return "unused-edge-strip";
  }

  const rectangles = placements.map((p) => placementRectangleBounds(p, size));
  const orientations = new Set(placements.map((p) => p.rotation % 180));
  const footprints = input.constraints.allowedRotations
    .filter(
      (rotation) =>
        input.constraints.allowMixedPackageOrientations ||
        orientations.has(rotation % 180),
    )
    .map((rotation) => rectangleSizeForRotation(size, rotation));
  for (const horizontal of [true, false]) {
    const minimum = (r: (typeof rectangles)[number]) =>
      horizontal ? r.minX : r.minY;
    const maximum = (r: (typeof rectangles)[number]) =>
      horizontal ? r.maxX : r.maxY;
    const sorted = [...rectangles].sort((a, b) => minimum(a) - minimum(b));
    let edge = maximum(sorted[0]!);
    for (const rectangle of sorted.slice(1)) {
      const corridor = minimum(rectangle) - edge;
      if (
        footprints.some(
          (footprint) =>
            corridor >=
              (horizontal ? footprint.length : footprint.width) +
                2 * gap -
                epsilon &&
            (horizontal ? height : width) >=
              (horizontal ? footprint.width : footprint.length) - epsilon,
        )
      ) {
        return "separating-corridor";
      }
      edge = Math.max(edge, maximum(rectangle));
    }
  }
  return null;
}
