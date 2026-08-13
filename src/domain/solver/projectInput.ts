import {
  createEffectivePalletEnvelope,
  symmetricSideAllowance,
} from "~/domain/geometry";
import { migrateProject } from "~/domain/project/projectMigration";
import type { Project, ProjectV2 } from "~/domain/project/projectSchema";
import type {
  LayerSolverInput,
  SolverInputConstraints,
} from "~/domain/solver/types";

/**
 * Adapts the canonical project model without involving the legacy editor DTO.
 * Project overhang values are defined per side and therefore applied twice per
 * axis through explicit symmetric side allowances.
 */
export function createLayerSolverInputFromProject(
  projectInput: Project | ProjectV2,
  constraintOverrides: SolverInputConstraints = {},
): LayerSolverInput {
  const project = migrateProject(projectInput);
  if (!project.pallet) {
    throw new Error("A pallet is required before solving a layer pattern.");
  }

  const selectedGripper =
    project.selectedGripperId === null
      ? null
      : (project.grippers.find(({ id }) => id === project.selectedGripperId) ??
        null);
  const allowedRotations =
    constraintOverrides.allowedRotations ??
    selectedGripper?.allowedPlaceRotations ??
    ([0, 90, 180, 270] as const);

  return {
    package: {
      shape: project.package.shape,
      dimensionsMm: {
        length: project.package.dimensionsMm.length,
        width: project.package.dimensionsMm.width,
      },
      clearanceMm: project.package.clearanceMm,
      inletOrientation: project.package.inletOrientation,
    },
    physicalPalletBoundsMm: {
      minX: 0,
      minY: 0,
      maxX: project.pallet.dimensionsMm.length,
      maxY: project.pallet.dimensionsMm.width,
    },
    envelopeMm: createEffectivePalletEnvelope(
      project.pallet.dimensionsMm,
      symmetricSideAllowance(project.pallet.allowedOverhangMm),
    ),
    constraints: {
      ...constraintOverrides,
      allowedRotations,
    },
  };
}
