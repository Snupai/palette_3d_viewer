import type { Rotation } from "~/domain/palletTypes";
import type { GeneratedPlacement } from "~/domain/solver/types";

export type PackageOrientationClass = "lengthwise" | "crosswise";

export function packageOrientationClass(
  rotation: Rotation,
): PackageOrientationClass {
  return rotation % 180 === 0 ? "lengthwise" : "crosswise";
}

export function placementsUseMixedPackageOrientations(
  placements: readonly Pick<GeneratedPlacement, "rotation">[],
): boolean {
  let firstClass: PackageOrientationClass | null = null;
  for (const placement of placements) {
    const orientationClass = packageOrientationClass(placement.rotation);
    if (firstClass === null) firstClass = orientationClass;
    else if (orientationClass !== firstClass) return true;
  }
  return false;
}
