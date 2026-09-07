import {
  normalizeGeneratedGeometryMetric,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import {
  REGION_FOOTPRINT_CLASSES,
  type RegionFootprintClass,
  type RegionShape,
  type RegionShapeCatalog,
} from "~/domain/solver/region-topology/model";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";
import type { Rotation } from "~/domain/palletTypes";

export type RegionShapeCatalogBuildResult =
  | Readonly<{ status: "completed"; catalog: RegionShapeCatalog }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>
  | Readonly<{ status: "invalid"; reason: string }>;

type FootprintDefinition = Readonly<{
  footprintClass: RegionFootprintClass;
  representativeRotation: Rotation;
  lengthMm: number;
  widthMm: number;
}>;

const footprintClassOrder: Readonly<Record<RegionFootprintClass, number>> = {
  lengthwise: 0,
  crosswise: 1,
  square: 2,
};
const orthogonalRotations = new Set<number>([0, 90, 180, 270]);

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareRegionShapes(
  left: RegionShape,
  right: RegionShape,
): number {
  return (
    compareNumbers(left.packageCount, right.packageCount) ||
    compareNumbers(
      footprintClassOrder[left.footprintClass],
      footprintClassOrder[right.footprintClass],
    ) ||
    compareNumbers(left.columns, right.columns) ||
    compareNumbers(left.rows, right.rows) ||
    compareNumbers(left.representativeRotation, right.representativeRotation) ||
    compareNumbers(left.naturalSizeMm.length, right.naturalSizeMm.length) ||
    compareNumbers(left.naturalSizeMm.width, right.naturalSizeMm.width) ||
    compareStrings(left.key, right.key)
  );
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(reason: string): RegionShapeCatalogBuildResult {
  return Object.freeze({ status: "invalid", reason });
}

function stopped(
  reason: RegionSearchStopReason,
): RegionShapeCatalogBuildResult {
  return Object.freeze({ status: "stopped", reason });
}

function normalizedFloor(value: number): number {
  const nearestInteger = Math.round(value);
  const tolerance = Math.max(1, Math.abs(value)) * Number.EPSILON * 8;
  return Math.floor(
    Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : value,
  );
}

function maximumCountAlong(
  availableMm: number,
  itemSpanMm: number,
  clearanceMm: number,
): number {
  if (itemSpanMm > availableMm + SOLVER_GEOMETRY_EPSILON_MM) return 0;
  return Math.max(
    0,
    normalizedFloor(
      (availableMm + clearanceMm + SOLVER_GEOMETRY_EPSILON_MM) /
        (itemSpanMm + clearanceMm),
    ),
  );
}

function usedSpan(
  count: number,
  itemSpanMm: number,
  clearanceMm: number,
  field: string,
): number {
  return normalizeGeneratedGeometryMetric(
    count * itemSpanMm + (count - 1) * clearanceMm,
    field,
  );
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isOrthogonalRotation(value: unknown): value is Rotation {
  return typeof value === "number" && orthogonalRotations.has(value);
}

function normalizedRotations(
  rotationsInput: unknown,
): readonly Rotation[] | string {
  if (!isUnknownArray(rotationsInput) || rotationsInput.length === 0) {
    return "Allowed rotations must be a non-empty array.";
  }

  const seen = new Set<number>();
  const rotations: Rotation[] = [];
  for (const rotation of rotationsInput) {
    if (!isOrthogonalRotation(rotation)) {
      return "Every allowed rotation must be orthogonal.";
    }
    if (seen.has(rotation)) {
      return "Allowed rotations must not contain duplicates.";
    }
    seen.add(rotation);
    rotations.push(rotation);
  }
  rotations.sort((left, right) => left - right);
  return Object.freeze(rotations);
}

function footprintDefinitions(
  packageLength: number,
  packageWidth: number,
  rotations: readonly Rotation[],
): readonly FootprintDefinition[] {
  if (packageLength === packageWidth) {
    return Object.freeze([
      Object.freeze({
        footprintClass: "square" as const,
        representativeRotation: rotations[0]!,
        lengthMm: packageLength,
        widthMm: packageWidth,
      }),
    ]);
  }

  const definitions: FootprintDefinition[] = [];
  const lengthwiseRotation = rotations.find(
    (rotation) => rotation === 0 || rotation === 180,
  );
  if (lengthwiseRotation !== undefined) {
    definitions.push(
      Object.freeze({
        footprintClass: "lengthwise",
        representativeRotation: lengthwiseRotation,
        lengthMm: packageLength,
        widthMm: packageWidth,
      }),
    );
  }
  const crosswiseRotation = rotations.find(
    (rotation) => rotation === 90 || rotation === 270,
  );
  if (crosswiseRotation !== undefined) {
    definitions.push(
      Object.freeze({
        footprintClass: "crosswise",
        representativeRotation: crosswiseRotation,
        lengthMm: packageWidth,
        widthMm: packageLength,
      }),
    );
  }
  return Object.freeze(definitions);
}

function indexShapes(
  orderedShapes: readonly RegionShape[],
): Pick<
  RegionShapeCatalog,
  "countsAscending" | "shapesByCount" | "shapesByFootprintClass"
> {
  const shapesByCountMutable = new Map<number, RegionShape[]>();
  const shapesByClassMutable = new Map<RegionFootprintClass, RegionShape[]>();

  for (const shape of orderedShapes) {
    const countShapes = shapesByCountMutable.get(shape.packageCount) ?? [];
    countShapes.push(shape);
    shapesByCountMutable.set(shape.packageCount, countShapes);

    const classShapes = shapesByClassMutable.get(shape.footprintClass) ?? [];
    classShapes.push(shape);
    shapesByClassMutable.set(shape.footprintClass, classShapes);
  }

  const shapesByCount = new Map<number, readonly RegionShape[]>();
  for (const [count, shapes] of shapesByCountMutable) {
    shapesByCount.set(count, Object.freeze(shapes));
  }

  const shapesByFootprintClass = new Map<
    RegionFootprintClass,
    readonly RegionShape[]
  >();
  for (const footprintClass of REGION_FOOTPRINT_CLASSES) {
    const shapes = shapesByClassMutable.get(footprintClass);
    if (shapes) {
      shapesByFootprintClass.set(footprintClass, Object.freeze(shapes));
    }
  }

  return Object.freeze({
    countsAscending: Object.freeze([...shapesByCount.keys()]),
    shapesByCount,
    shapesByFootprintClass,
  });
}

export function buildRegionShapeCatalog(
  input: NormalizedLayerSolverInput,
  maximumPackageCountInput: number,
  ledger: RegionWorkLedger,
): RegionShapeCatalogBuildResult {
  if (typeof input !== "object" || input === null) {
    return invalid("Normalized solver input must be an object.");
  }
  if (input.package?.shape !== "cuboid") {
    return invalid("Region shapes require a cuboid package.");
  }

  const packageLength = input.package.dimensionsMm?.length;
  const packageWidth = input.package.dimensionsMm?.width;
  const clearance = input.package.clearanceMm;
  const bounds = input.generationBoundsMm;
  const maxBands = input.constraints?.maxBands;
  const maxPlacements = input.constraints?.maxPlacements;
  const constrainedMaximum = input.constraints?.maximumPackageCount;
  if (!isPositiveFinite(packageLength) || !isPositiveFinite(packageWidth)) {
    return invalid("Package dimensions must be finite positive numbers.");
  }
  if (!isNonNegativeFinite(clearance)) {
    return invalid("Package clearance must be a finite non-negative number.");
  }
  if (!isPositiveSafeInteger(maxBands)) {
    return invalid("constraints.maxBands must be a positive safe integer.");
  }
  if (!isPositiveSafeInteger(maxPlacements)) {
    return invalid(
      "constraints.maxPlacements must be a positive safe integer.",
    );
  }
  if (!isNonNegativeSafeInteger(constrainedMaximum)) {
    return invalid(
      "constraints.maximumPackageCount must be a non-negative safe integer.",
    );
  }
  if (constrainedMaximum > maxPlacements) {
    return invalid(
      "constraints.maximumPackageCount must not exceed constraints.maxPlacements.",
    );
  }
  if (!isNonNegativeSafeInteger(maximumPackageCountInput)) {
    return invalid("maximumPackageCount must be a non-negative safe integer.");
  }
  if (typeof bounds !== "object" || bounds === null) {
    return invalid("Generation bounds must be an object.");
  }

  const frameLength = bounds.maxX - bounds.minX;
  const frameWidth = bounds.maxY - bounds.minY;
  if (!isPositiveFinite(frameLength) || !isPositiveFinite(frameWidth)) {
    return invalid("Generation bounds must have finite positive spans.");
  }

  const rotations = normalizedRotations(input.constraints.allowedRotations);
  if (typeof rotations === "string") return invalid(rotations);

  const initialDecision = ledger.checkpoint();
  if (initialDecision !== "continue") return stopped(initialDecision);

  const maximumPackageCount = Math.min(
    maximumPackageCountInput,
    constrainedMaximum,
    maxPlacements,
  );
  const definitions = footprintDefinitions(
    packageLength,
    packageWidth,
    rotations,
  );
  const shapes: RegionShape[] = [];

  for (const definition of definitions) {
    const maximumColumns = maximumCountAlong(
      frameLength,
      definition.lengthMm,
      clearance,
    );
    const maximumRows = Math.min(
      maximumCountAlong(frameWidth, definition.widthMm, clearance),
      maxBands,
      maximumPackageCount,
    );

    for (let rows = 1; rows <= maximumRows; rows += 1) {
      const columnsForCount = Math.floor(maximumPackageCount / rows);
      const columns = Math.min(maximumColumns, columnsForCount);
      for (let columnCount = 1; columnCount <= columns; columnCount += 1) {
        const decision = ledger.debit("catalog-shape");
        if (decision !== "continue") return stopped(decision);

        const packageCount = columnCount * rows;
        const naturalLength = usedSpan(
          columnCount,
          definition.lengthMm,
          clearance,
          "regionShape.naturalSizeMm.length",
        );
        const naturalWidth = usedSpan(
          rows,
          definition.widthMm,
          clearance,
          "regionShape.naturalSizeMm.width",
        );
        if (
          naturalLength > frameLength + SOLVER_GEOMETRY_EPSILON_MM ||
          naturalWidth > frameWidth + SOLVER_GEOMETRY_EPSILON_MM
        ) {
          return invalid("A generated region shape exceeds generation bounds.");
        }

        shapes.push(
          Object.freeze({
            key: `region-shape-v1:${definition.footprintClass}:${columnCount}x${rows}`,
            footprintClass: definition.footprintClass,
            representativeRotation: definition.representativeRotation,
            columns: columnCount,
            rows,
            packageCount,
            naturalSizeMm: Object.freeze({
              length: naturalLength,
              width: naturalWidth,
            }),
          }),
        );
      }
    }
  }

  const orderedShapes = Object.freeze([...shapes].sort(compareRegionShapes));
  const indexes = indexShapes(orderedShapes);
  return Object.freeze({
    status: "completed",
    catalog: Object.freeze({
      maximumPackageCount,
      orderedShapes,
      ...indexes,
    }),
  });
}
