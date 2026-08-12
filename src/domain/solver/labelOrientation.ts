import { rectangleSizeForRotation } from "~/domain/geometry";
import type { PointMm, RectangleBoundsMm } from "~/domain/geometry";
import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import { packageOrientationClass } from "~/domain/solver/orientationPolicy";
import type { Rotation, Side } from "~/domain/palletTypes";

const CARDINAL_SIDES_COUNTERCLOCKWISE = [
  "right",
  "top",
  "left",
  "bottom",
] as const satisfies readonly Side[];

/** Maps a physical face on the yaw-0 package to its world-facing side. */
export function rotateUnrotatedPackageLabelSide(
  unrotatedPackageLabelSide: Side,
  rotation: Rotation,
): Side {
  const sourceIndex = CARDINAL_SIDES_COUNTERCLOCKWISE.indexOf(
    unrotatedPackageLabelSide,
  );
  const quarterTurns = rotation / 90;
  return CARDINAL_SIDES_COUNTERCLOCKWISE[
    (sourceIndex + quarterTurns) % CARDINAL_SIDES_COUNTERCLOCKWISE.length
  ]!;
}

export function selectAuthorizedYawForWorldLabel(
  currentRotation: Rotation,
  unrotatedPackageLabelSide: Side,
  worldLabelSide: Side,
  allowedRotations: readonly Rotation[],
): Rotation | null {
  const orientationClass = packageOrientationClass(currentRotation);
  return (
    [...new Set(allowedRotations)]
      .filter(
        (rotation) =>
          packageOrientationClass(rotation) === orientationClass &&
          rotateUnrotatedPackageLabelSide(
            unrotatedPackageLabelSide,
            rotation,
          ) === worldLabelSide,
      )
      .sort((left, right) => left - right)[0] ?? null
  );
}

export type NearestEdgeLabelYawSelection =
  | {
      status: "selected";
      rotation: Rotation;
      labelSide: Side;
    }
  | {
      status: "infeasible";
      reason: "no-authorized-yaw-in-footprint-class";
      allowedRotationsInClass: readonly Rotation[];
    };

function oppositeRotation(rotation: Rotation): Rotation {
  return ((rotation + 180) % 360) as Rotation;
}

function distanceFromPackageFaceToPalletEdge(
  labelSide: Side,
  positionMm: PointMm,
  packageSizeMm: { length: number; width: number },
  physicalPalletBoundsMm: RectangleBoundsMm,
): number {
  const localCenterX = positionMm.x - physicalPalletBoundsMm.minX;
  const localCenterY = positionMm.y - physicalPalletBoundsMm.minY;
  const palletLength =
    physicalPalletBoundsMm.maxX - physicalPalletBoundsMm.minX;
  const palletWidth = physicalPalletBoundsMm.maxY - physicalPalletBoundsMm.minY;
  const halfLength = packageSizeMm.length / 2;
  const halfWidth = packageSizeMm.width / 2;

  if (labelSide === "left") {
    return Math.abs(localCenterX - halfLength);
  }
  if (labelSide === "right") {
    return Math.abs(palletLength - (localCenterX + halfLength));
  }
  if (labelSide === "bottom") {
    return Math.abs(localCenterY - halfWidth);
  }
  return Math.abs(palletWidth - (localCenterY + halfWidth));
}

function edgeDistanceComparisonEpsilonMm(
  positionMm: PointMm,
  physicalPalletBoundsMm: RectangleBoundsMm,
): number {
  const coordinateMagnitude = Math.max(
    1,
    Math.abs(positionMm.x),
    Math.abs(positionMm.y),
    Math.abs(physicalPalletBoundsMm.minX),
    Math.abs(physicalPalletBoundsMm.minY),
    Math.abs(physicalPalletBoundsMm.maxX),
    Math.abs(physicalPalletBoundsMm.maxY),
  );
  return Math.max(
    SOLVER_GEOMETRY_EPSILON_MM,
    Number.EPSILON * coordinateMagnitude * 4,
  );
}

/**
 * Keeps the generated footprint and compares only its current yaw with the
 * opposite 180-degree yaw. The package rotates only when the opposite label
 * direction reaches its corresponding physical pallet edge more directly.
 */
export function selectNearestEdgeLabelYaw(
  positionMm: PointMm,
  currentRotation: Rotation,
  unrotatedPackageLabelSide: Side,
  packageDimensionsMm: { length: number; width: number },
  physicalPalletBoundsMm: RectangleBoundsMm,
  allowedRotations: readonly Rotation[],
): NearestEdgeLabelYawSelection {
  const alternativeRotation = oppositeRotation(currentRotation);
  const allowed = new Set(allowedRotations);
  const currentAuthorized = allowed.has(currentRotation);
  const alternativeAuthorized = allowed.has(alternativeRotation);
  const allowedRotationsInClass = [currentRotation, alternativeRotation].filter(
    (rotation, index, rotations) =>
      allowed.has(rotation) && rotations.indexOf(rotation) === index,
  );

  if (!currentAuthorized && !alternativeAuthorized) {
    return {
      status: "infeasible",
      reason: "no-authorized-yaw-in-footprint-class",
      allowedRotationsInClass,
    };
  }

  let rotation = currentAuthorized ? currentRotation : alternativeRotation;
  if (currentAuthorized && alternativeAuthorized) {
    const packageSizeMm = rectangleSizeForRotation(
      packageDimensionsMm,
      currentRotation,
    );
    const currentLabelSide = rotateUnrotatedPackageLabelSide(
      unrotatedPackageLabelSide,
      currentRotation,
    );
    const alternativeLabelSide = rotateUnrotatedPackageLabelSide(
      unrotatedPackageLabelSide,
      alternativeRotation,
    );
    const currentDistanceMm = distanceFromPackageFaceToPalletEdge(
      currentLabelSide,
      positionMm,
      packageSizeMm,
      physicalPalletBoundsMm,
    );
    const alternativeDistanceMm = distanceFromPackageFaceToPalletEdge(
      alternativeLabelSide,
      positionMm,
      packageSizeMm,
      physicalPalletBoundsMm,
    );

    if (
      alternativeDistanceMm <
      currentDistanceMm -
        edgeDistanceComparisonEpsilonMm(positionMm, physicalPalletBoundsMm)
    ) {
      rotation = alternativeRotation;
    }
  }

  return {
    status: "selected",
    rotation,
    labelSide: rotateUnrotatedPackageLabelSide(
      unrotatedPackageLabelSide,
      rotation,
    ),
  };
}
