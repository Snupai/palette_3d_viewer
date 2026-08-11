import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import {
  applySpecialTopLayer,
  calculateStackCapacity,
  calculateUniformStackCapacity,
  createCompositionSequence,
  materializeStack,
  solverCandidatePatternReference,
  stackPatternFromSolverCandidate,
  transformStackPattern,
  type EditableStackLayer,
  type MaterializedStackResult,
  type SpecialTopLayer,
  type StackCapacityResult,
  type StackCompositionMode,
  type StackInterlayerRules,
  type StackLayerTransform,
} from "~/domain/stack";
import { updateProject } from "~/domain/project/projectFactory";

export type IndividualInterlayerSetting = {
  enabled: boolean;
  thicknessMm: number;
};

export type StackWorkspaceState = {
  patternARef: string | null;
  patternBRef: string | null;
  compositionMode: StackCompositionMode;
  requestedLayerCount: number;
  layers: readonly EditableStackLayer[];
  interlayerMode: "all" | "individual";
  betweenThicknessMm: number;
  individualBeforeLayer: Readonly<
    Record<string, IndividualInterlayerSetting | undefined>
  >;
  baseEnabled: boolean;
  baseThicknessMm: number;
  deckEnabled: boolean;
  deckThicknessMm: number;
  specialTopEnabled: boolean;
  specialTopPatternRef: string | null;
  specialTopTransform: StackLayerTransform;
};

export function candidatePatternRef(candidate: SolverCandidate): string {
  return solverCandidatePatternReference(candidate.id);
}

export function createInitialStackWorkspaceState(
  candidates: readonly SolverCandidate[],
): StackWorkspaceState {
  const patternARef = candidates[0] ? candidatePatternRef(candidates[0]) : null;
  const patternBRef = candidates[1] ? candidatePatternRef(candidates[1]) : null;
  const layers = patternARef
    ? createCompositionSequence({
        mode: "tower",
        layerCount: 1,
        primaryPatternRef: patternARef,
        secondaryPatternRef: patternBRef,
      })
    : [];
  return {
    patternARef,
    patternBRef,
    compositionMode: "tower",
    requestedLayerCount: layers.length,
    layers,
    interlayerMode: "all",
    betweenThicknessMm: 3,
    individualBeforeLayer: {},
    baseEnabled: false,
    baseThicknessMm: 3,
    deckEnabled: false,
    deckThicknessMm: 3,
    specialTopEnabled: false,
    specialTopPatternRef: patternBRef ?? patternARef,
    specialTopTransform: "identity",
  };
}

export function rebuildStackSequence(
  state: StackWorkspaceState,
): StackWorkspaceState {
  if (!state.patternARef) return { ...state, layers: [] };
  const count = Number.isInteger(state.requestedLayerCount)
    ? Math.max(0, state.requestedLayerCount)
    : 0;
  const layers = createCompositionSequence({
    mode: state.compositionMode,
    layerCount: count,
    primaryPatternRef: state.patternARef,
    secondaryPatternRef: state.patternBRef,
  });
  return { ...state, layers, individualBeforeLayer: {} };
}

export function stackInterlayerRules(
  state: StackWorkspaceState,
): StackInterlayerRules {
  const baseSheet = state.baseEnabled
    ? { thicknessMm: state.baseThicknessMm }
    : null;
  const deckSheet = state.deckEnabled
    ? { thicknessMm: state.deckThicknessMm }
    : null;
  if (state.interlayerMode === "all") {
    return {
      mode: "all",
      betweenLayers: { thicknessMm: state.betweenThicknessMm },
      baseSheet,
      deckSheet,
    };
  }

  const beforeLayer = Object.fromEntries(
    Object.entries(state.individualBeforeLayer).flatMap(([layerId, setting]) =>
      setting?.enabled ? [[layerId, { thicknessMm: setting.thicknessMm }]] : [],
    ),
  );
  return { mode: "individual", beforeLayer, baseSheet, deckSheet };
}

export function specialTopLayer(state: StackWorkspaceState): SpecialTopLayer {
  return state.specialTopEnabled && state.specialTopPatternRef
    ? {
        enabled: true,
        patternRef: state.specialTopPatternRef,
        transform: state.specialTopTransform,
      }
    : { enabled: false };
}

function stackPackage(project: Project) {
  return {
    shape: project.package.shape,
    dimensionsMm: { ...project.package.dimensionsMm },
    weightKg: project.package.weightKg,
    weightProvenance:
      project.package.weightKg === null
        ? {
            status: "unknown" as const,
            source: "missing-project-package-weight",
            detail: "The project package weight is not configured.",
          }
        : {
            status: "verified" as const,
            source: "project-package-specification",
            detail: "Package weight is configured in the project.",
          },
    inletOrientation: project.package.inletOrientation,
  };
}

function solverLabelOrientationPolicy(solverInput: LayerSolverInput) {
  const unrotatedPackageLabelSide =
    solverInput.constraints?.unrotatedPackageLabelSide ?? null;
  if (unrotatedPackageLabelSide === null) return null;
  return {
    unrotatedPackageLabelSide,
    allowedRotations:
      solverInput.constraints?.allowedRotations ?? ([0, 90, 180, 270] as const),
  };
}

function stackPallet(project: Project) {
  return project.pallet
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
    : null;
}

export function materializeStackWorkspace(
  project: Project,
  candidates: readonly SolverCandidate[],
  solverInput: LayerSolverInput,
  state: StackWorkspaceState,
): MaterializedStackResult {
  return materializeStack({
    package: stackPackage(project),
    pallet: stackPallet(project),
    resources: {
      selectedGripperId: project.selectedGripperId,
      selectedPalletStationId: project.selectedPalletStationId,
      availableMaterialResourceIds: null,
    },
    patterns: candidates.map((candidate) =>
      stackPatternFromSolverCandidate(candidate, {
        transformFrameMm:
          solverInput.generationBoundsMm ?? solverInput.envelopeMm,
        labelOrientationPolicy: solverLabelOrientationPolicy(solverInput),
      }),
    ),
    layers: state.layers,
    interlayers: stackInterlayerRules(state),
    specialTopLayer: specialTopLayer(state),
  });
}

export function calculateWorkspaceCapacity(
  project: Project,
  state: StackWorkspaceState,
): StackCapacityResult | null {
  const storageHeightMm = project.pallet?.storageEnvelopeMm?.height;
  if (storageHeightMm === undefined) return null;
  if (state.interlayerMode === "all") {
    return calculateUniformStackCapacity({
      storageHeightMm,
      packageHeightMm: project.package.dimensionsMm.height,
      betweenLayerThicknessMm: state.betweenThicknessMm,
      baseSheetThicknessMm: state.baseEnabled ? state.baseThicknessMm : 0,
      deckSheetThicknessMm: state.deckEnabled ? state.deckThicknessMm : 0,
    });
  }
  return calculateStackCapacity({
    storageHeightMm,
    packageHeightMm: project.package.dimensionsMm.height,
    layers: state.layers,
    interlayers: stackInterlayerRules(state),
  });
}

function projectPatternId(
  candidate: SolverCandidate,
  transform: StackLayerTransform,
  index: number,
): string {
  const suffix =
    candidate.id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(-48) || "candidate";
  return `solver-pattern-${index + 1}-${transform}-${suffix}`;
}

function projectPatternName(
  candidate: SolverCandidate,
  transform: StackLayerTransform,
): string {
  return `Candidate ${candidate.rank} · ${transform} · ${candidate.id}`.slice(
    0,
    200,
  );
}

function patternVariantKey(
  patternRef: string,
  transform: StackLayerTransform,
): string {
  return JSON.stringify([patternRef, transform]);
}

function canonicalInterlayerThickness(state: StackWorkspaceState): number {
  const candidates = [
    state.interlayerMode === "all" ? state.betweenThicknessMm : null,
    ...Object.values(state.individualBeforeLayer).map(
      (setting) => setting?.thicknessMm ?? null,
    ),
    state.baseEnabled ? state.baseThicknessMm : null,
    state.deckEnabled ? state.deckThicknessMm : null,
    3,
  ];
  return candidates.find(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value > 0,
  )!;
}

function interlayerQuantityBefore(
  state: StackWorkspaceState,
  layer: EditableStackLayer,
  index: number,
): number {
  if (index === 0) return state.baseEnabled ? 1 : 0;
  if (state.interlayerMode === "all") return 1;
  return state.individualBeforeLayer[layer.id]?.enabled ? 1 : 0;
}

function interlayerThicknessBefore(
  state: StackWorkspaceState,
  layer: EditableStackLayer,
  index: number,
): number | undefined {
  if (interlayerQuantityBefore(state, layer, index) === 0) return undefined;
  if (index === 0) return state.baseThicknessMm;
  if (state.interlayerMode === "all") return state.betweenThicknessMm;
  return state.individualBeforeLayer[layer.id]?.thicknessMm;
}

/** Persists the exact enabled boundaries and their materialized thicknesses. */
export function projectWithPersistedStack(
  project: Project,
  candidates: readonly SolverCandidate[],
  solverInput: LayerSolverInput,
  state: StackWorkspaceState,
): Project {
  const candidateByRef = new Map(
    candidates.map((candidate) => [candidatePatternRef(candidate), candidate]),
  );
  const resolvedLayers = applySpecialTopLayer(
    state.layers,
    specialTopLayer(state),
  );
  const usedVariants = new Map<
    string,
    { patternRef: string; transform: StackLayerTransform }
  >();
  resolvedLayers.forEach(({ patternRef, transform }) => {
    const key = patternVariantKey(patternRef, transform);
    if (!usedVariants.has(key)) {
      usedVariants.set(key, { patternRef, transform });
    }
  });

  const transformFrameMm =
    solverInput.generationBoundsMm ?? solverInput.envelopeMm;
  const patternIdByVariant = new Map<string, string>();
  const patterns = [...usedVariants.entries()].map(
    ([variantKey, { patternRef, transform }], index) => {
      const candidate = candidateByRef.get(patternRef);
      if (!candidate) {
        throw new Error(
          `Stack references a missing solver candidate: ${patternRef}`,
        );
      }

      const patternId = projectPatternId(candidate, transform, index);
      const transformed = transformStackPattern(
        stackPatternFromSolverCandidate(candidate, {
          transformFrameMm,
          labelOrientationPolicy: solverLabelOrientationPolicy(solverInput),
        }),
        transform,
        project.package.dimensionsMm,
      );
      const orderedGrips = [...transformed.grips].sort(
        (left, right) =>
          left.sequence - right.sequence ||
          left.sourceGripId.localeCompare(right.sourceGripId),
      );
      const projectGripIdBySource = new Map(
        orderedGrips.map((grip, gripIndex) => [
          grip.sourceGripId,
          `${patternId}-grip-${gripIndex + 1}`,
        ]),
      );
      patternIdByVariant.set(variantKey, patternId);
      return {
        id: patternId,
        name: projectPatternName(candidate, transform),
        grips: orderedGrips.map((grip) => ({
          id: projectGripIdBySource.get(grip.sourceGripId)!,
          groupNumber: grip.groupNumber,
          pickX: grip.pickX,
          pickY: grip.pickY,
          pickRotation: grip.pickRotation,
          x: grip.x,
          y: grip.y,
          rotation: grip.rotation,
          numPackages: grip.numPackages,
          dx: grip.dx,
          dy: grip.dy,
        })),
        placements: transformed.placements.map((placement, placementIndex) => {
          const gripId =
            placement.gripId === null
              ? null
              : projectGripIdBySource.get(placement.gripId);
          if (gripId === undefined) {
            throw new Error(
              `Generated placement references a missing grip: ${placement.gripId}`,
            );
          }
          return {
            id: `${patternId}-placement-${placementIndex + 1}`,
            sequence: placement.sequence,
            positionMm: { ...placement.positionMm },
            rotation: placement.rotation,
            gripId,
            labelSide: placement.labelSide,
          };
        }),
        groupOrder: orderedGrips.map(
          (grip) => projectGripIdBySource.get(grip.sourceGripId)!,
        ),
        orderDependencies: [],
      };
    },
  );

  const activeSolution = project.solutions.find(
    ({ id }) => id === project.activeSolutionId,
  );
  if (!activeSolution) {
    throw new Error(
      "The project has no active solution for stack persistence.",
    );
  }
  const updatedSolution = {
    ...activeSolution,
    origin: "calculated" as const,
    patterns,
    stack: {
      interlayerThicknessMm: canonicalInterlayerThickness(state),
      layers: resolvedLayers.map((layer, index) => ({
        id: layer.id,
        patternId: patternIdByVariant.get(
          patternVariantKey(layer.patternRef, layer.transform),
        )!,
        interlayerBefore: interlayerQuantityBefore(state, layer, index),
        ...(interlayerThicknessBefore(state, layer, index) === undefined
          ? {}
          : {
              interlayerThicknessMm: interlayerThicknessBefore(
                state,
                layer,
                index,
              ),
            }),
      })),
      trailingInterlayer: state.deckEnabled ? 1 : 0,
      ...(state.deckEnabled
        ? { trailingInterlayerThicknessMm: state.deckThicknessMm }
        : {}),
    },
    robotCycles: [],
  };

  return updateProject(project, {
    solutions: project.solutions.map((solution) =>
      solution.id === updatedSolution.id ? updatedSolution : solution,
    ),
  });
}
