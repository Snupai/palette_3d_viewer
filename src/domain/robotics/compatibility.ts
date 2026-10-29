import type { GripperPackageLimits } from "~/domain/project/equipmentProfiles";
import type { Gripper, PackageSpec } from "~/domain/project/projectSchema";
import type { RobotDiagnostic, RobotGripGroup } from "~/domain/robotics/types";

function dimensionDiagnostic(
  field: "length" | "width" | "height",
  value: number,
  minimum: number,
  maximum: number,
  gripper: Gripper,
): RobotDiagnostic | null {
  if (value >= minimum && value <= maximum) return null;
  const code =
    field === "length"
      ? "package-length-out-of-range"
      : field === "width"
        ? "package-width-out-of-range"
        : "package-height-out-of-range";
  return {
    severity: "error",
    phase: "compatibility",
    code,
    message: `Package ${field} ${value} mm is outside gripper "${gripper.name}" range ${minimum}..${maximum} mm.`,
    path: ["package", "dimensionsMm", field],
    resourceId: gripper.id,
    details: { value, minimum, maximum },
  };
}

export function pickupSpanMm(
  packageSpec: PackageSpec,
  packageCount: number,
): number {
  const feedLength =
    packageSpec.inletOrientation === "lengthwise"
      ? packageSpec.dimensionsMm.length
      : packageSpec.dimensionsMm.width;
  return Math.max(1, packageCount) * feedLength;
}

/**
 * M6 intentionally validates suction grippers first. Clamp/fork schemas remain
 * persisted resources, but using them for generated cycles is blocked until their
 * pick mechanics have an independently verified implementation.
 */
export function validateSuctionCompatibility(
  packageSpec: PackageSpec,
  gripper: Gripper,
  groups: readonly RobotGripGroup[],
  effectivePackageLimits: GripperPackageLimits | null = gripper.packageLimits,
): RobotDiagnostic[] {
  const diagnostics: RobotDiagnostic[] = [];
  if (gripper.settings.type !== "suction") {
    diagnostics.push({
      severity: "error",
      phase: "compatibility",
      code: "unsupported-gripper-type",
      message: `Generated robot cycles currently support suction grippers only; "${gripper.name}" is ${gripper.settings.type}.`,
      resourceId: gripper.id,
      details: { gripperType: gripper.settings.type },
    });
    return diagnostics;
  }

  if (
    gripper.inletOrientation !== "any" &&
    gripper.inletOrientation !== packageSpec.inletOrientation
  ) {
    diagnostics.push({
      severity: "error",
      phase: "compatibility",
      code: "inlet-orientation-incompatible",
      message: `Package inlet orientation "${packageSpec.inletOrientation}" is incompatible with gripper "${gripper.name}" (${gripper.inletOrientation}).`,
      path: ["package", "inletOrientation"],
      resourceId: gripper.id,
    });
  }

  if (effectivePackageLimits) {
    const dimensions = packageSpec.dimensionsMm;
    const candidates = [
      dimensionDiagnostic(
        "length",
        dimensions.length,
        effectivePackageLimits.lengthMm.min,
        effectivePackageLimits.lengthMm.max,
        gripper,
      ),
      dimensionDiagnostic(
        "width",
        dimensions.width,
        effectivePackageLimits.widthMm.min,
        effectivePackageLimits.widthMm.max,
        gripper,
      ),
      dimensionDiagnostic(
        "height",
        dimensions.height,
        effectivePackageLimits.heightMm.min,
        effectivePackageLimits.heightMm.max,
        gripper,
      ),
    ];
    diagnostics.push(
      ...candidates.filter(
        (diagnostic): diagnostic is RobotDiagnostic => diagnostic !== null,
      ),
    );
  }

  for (const group of groups) {
    const normalizedRotation = ((group.placeRotationDeg % 360) + 360) % 360;
    if (
      normalizedRotation !== 0 &&
      normalizedRotation !== 90 &&
      normalizedRotation !== 180 &&
      normalizedRotation !== 270
    ) {
      diagnostics.push({
        severity: "error",
        phase: "compatibility",
        code: "place-rotation-incompatible",
        message: `Group "${group.id}" has non-orthogonal place rotation ${group.placeRotationDeg}°.`,
        resourceId: gripper.id,
        groupId: group.id,
      });
    } else if (!gripper.allowedPlaceRotations.includes(normalizedRotation)) {
      diagnostics.push({
        severity: "error",
        phase: "compatibility",
        code: "place-rotation-incompatible",
        message: `Group "${group.id}" rotation ${normalizedRotation}° is not allowed by gripper "${gripper.name}".`,
        resourceId: gripper.id,
        groupId: group.id,
        details: { rotation: normalizedRotation },
      });
    }

    if (group.packageCount > 1 && !packageSpec.multiPickAllowed) {
      diagnostics.push({
        severity: "error",
        phase: "compatibility",
        code: "multipick-not-allowed",
        message: `Group "${group.id}" contains ${group.packageCount} packages but the package specification disables multipick.`,
        resourceId: gripper.id,
        groupId: group.id,
        details: { packageCount: group.packageCount },
      });
    }

    const pickupLength = pickupSpanMm(packageSpec, group.packageCount);
    if (
      gripper.maxPickupLengthMm !== null &&
      pickupLength > gripper.maxPickupLengthMm
    ) {
      diagnostics.push({
        severity: "error",
        phase: "compatibility",
        code: "pickup-length-exceeded",
        message: `Group "${group.id}" pickup span ${pickupLength} mm exceeds gripper limit ${gripper.maxPickupLengthMm} mm.`,
        resourceId: gripper.id,
        groupId: group.id,
        details: {
          pickupLengthMm: pickupLength,
          maximumMm: gripper.maxPickupLengthMm,
        },
      });
    }
  }

  if (
    gripper.settings.multipickSinglePlace &&
    groups.some(({ packageCount }) => packageCount > 1)
  ) {
    diagnostics.push({
      severity: "warning",
      phase: "compatibility",
      code: "multipick-single-place-unverified",
      message:
        "The gripper permits multipick with single-place release, but this suction-first core emits one place action per complete grip group; split release is not represented.",
      resourceId: gripper.id,
    });
  }

  return diagnostics;
}
