import { assertRectangleBounds } from "~/domain/geometry";
import type { RectangleBoundsMm } from "~/domain/geometry";

export const SOLVER_GEOMETRY_EPSILON_MM = 1e-9;

const GENERATED_COORDINATE_DECIMAL_PLACES = 9;

function normalizeGeneratedNumber(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  const normalized = Number(value.toFixed(GENERATED_COORDINATE_DECIMAL_PLACES));
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function normalizeGeneratedCoordinateMm(
  value: number,
  field: string,
): number {
  return normalizeGeneratedNumber(value, field);
}

export function normalizeGeneratedGeometryMetric(
  value: number,
  field: string,
): number {
  return normalizeGeneratedNumber(value, field);
}

export function normalizeGeneratedOffsetMm(
  value: number,
  field: string,
): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite.`);
  return Math.abs(value) <= SOLVER_GEOMETRY_EPSILON_MM
    ? 0
    : normalizeGeneratedCoordinateMm(value, field);
}

export function solverRectangleBoundsOverlap(
  leftInput: RectangleBoundsMm,
  rightInput: RectangleBoundsMm,
): boolean {
  const left = assertRectangleBounds(leftInput, "left");
  const right = assertRectangleBounds(rightInput, "right");
  return (
    left.minX < right.maxX - SOLVER_GEOMETRY_EPSILON_MM &&
    left.maxX > right.minX + SOLVER_GEOMETRY_EPSILON_MM &&
    left.minY < right.maxY - SOLVER_GEOMETRY_EPSILON_MM &&
    left.maxY > right.minY + SOLVER_GEOMETRY_EPSILON_MM
  );
}
