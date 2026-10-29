import {
  createEffectivePalletEnvelope,
  symmetricSideAllowance,
} from "~/domain/geometry";
import { migrateProject } from "~/domain/project/projectMigration";
import type { Project, ProjectV2 } from "~/domain/project/projectSchema";
import { materializeStack } from "~/domain/stack/materialize";
import {
  projectPatternReference,
  stackPatternsFromProjectSolution,
} from "~/domain/stack/patterns";
import type {
  MaterializedStackResult,
  StackMaterializationInput,
  StackSheetSpecification,
} from "~/domain/stack/types";

export type ProjectStackDefinition = StackMaterializationInput & {
  projectId: string;
  solutionId: string;
};

function importedSheet(
  quantity: number,
  thicknessMm: number,
  location: string,
): StackSheetSpecification | null {
  if (quantity <= 0) return null;
  return {
    thicknessMm,
    quantity,
    weightKg: null,
    resourceId: null,
    provenance: {
      status: "derived",
      source: "project-layer-stack",
      detail: `${location} sheet quantity and thickness are preserved from the project stack.`,
    },
  };
}

export function createProjectStackDefinition(
  projectInput: Project | ProjectV2,
  solutionId: string | null = projectInput.activeSolutionId,
): ProjectStackDefinition {
  const project = migrateProject(projectInput);
  const solution = project.solutions.find(({ id }) => id === solutionId);
  if (!solution) {
    throw new Error(
      solutionId
        ? `Project solution "${solutionId}" does not exist.`
        : "Project has no active solution.",
    );
  }

  const transformFrameMm = project.pallet
    ? createEffectivePalletEnvelope(
        project.pallet.dimensionsMm,
        symmetricSideAllowance(project.pallet.allowedOverhangMm),
      )
    : null;
  const patterns = stackPatternsFromProjectSolution(
    project,
    solution.id,
    transformFrameMm,
  );
  const layers = solution.stack.layers.map((layer) => ({
    id: layer.id,
    patternRef: projectPatternReference(
      project.id,
      solution.id,
      layer.patternId,
    ),
    transform: "identity" as const,
    provenance: {
      kind: "project-stack" as const,
      projectId: project.id,
      solutionId: solution.id,
      sourceLayerId: layer.id,
    },
  }));
  const beforeLayer: Record<string, StackSheetSpecification> = {};
  for (let index = 1; index < solution.stack.layers.length; index += 1) {
    const sourceLayer = solution.stack.layers[index]!;
    const specification = importedSheet(
      sourceLayer.interlayerBefore,
      sourceLayer.interlayerThicknessMm ?? solution.stack.interlayerThicknessMm,
      `Before layer ${sourceLayer.id}`,
    );
    if (specification) beforeLayer[sourceLayer.id] = specification;
  }
  const firstLayer = solution.stack.layers[0];

  return {
    projectId: project.id,
    solutionId: solution.id,
    package: {
      shape: project.package.shape,
      dimensionsMm: { ...project.package.dimensionsMm },
      weightKg: project.package.weightKg,
      weightProvenance:
        project.package.weightKg === null
          ? {
              status: "unknown",
              source: "missing-project-package-weight",
              detail: "The project package weight is not configured.",
            }
          : {
              status: "verified",
              source: "project-package-specification",
              detail: "Package weight is configured in the project model.",
            },
      inletOrientation: project.package.inletOrientation,
    },
    pallet: project.pallet
      ? {
          id: project.pallet.id,
          dimensionsMm: { ...project.pallet.dimensionsMm },
          allowedOverhangMm: { ...project.pallet.allowedOverhangMm },
          storageEnvelopeMm: project.pallet.storageEnvelopeMm
            ? { ...project.pallet.storageEnvelopeMm }
            : null,
          tareKg: project.pallet.tareKg,
          maxGrossKg: project.pallet.maxGrossKg,
        }
      : null,
    resources: {
      selectedGripperId: project.selectedGripperId,
      selectedPalletStationId: project.selectedPalletStationId,
      availableMaterialResourceIds: null,
    },
    patterns,
    layers,
    interlayers: {
      mode: "individual",
      baseSheet: firstLayer
        ? importedSheet(
            firstLayer.interlayerBefore,
            firstLayer.interlayerThicknessMm ??
              solution.stack.interlayerThicknessMm,
            "Base",
          )
        : null,
      deckSheet: importedSheet(
        solution.stack.trailingInterlayer,
        solution.stack.trailingInterlayerThicknessMm ??
          solution.stack.interlayerThicknessMm,
        "Deck",
      ),
      beforeLayer,
    },
    specialTopLayer: { enabled: false },
  };
}

export function materializeProjectSolutionStack(
  projectInput: Project | ProjectV2,
  solutionId: string | null = projectInput.activeSolutionId,
): MaterializedStackResult {
  return materializeStack(
    createProjectStackDefinition(projectInput, solutionId),
  );
}
