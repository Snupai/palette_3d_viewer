import type { Translate } from "~/i18n";
import { translateDe } from "~/i18n/translateDe";
import type { Project } from "~/domain/project/projectSchema";
import {
  envelopePreservingSymmetries,
  transformPlacements,
  type LayerSymmetry,
  type PlacementGeometry,
  type RectangleSizeMm,
} from "~/domain/geometry";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import { matchPhysicalFootprintPlacements } from "~/lib/parity/physicalGeometry";

export const ROB_REFERENCE_TOLERANCE_MM = 0.500001;

export const GENERATION_STAGES = [
  ["inputs", "Inputs"],
  ["generate", "Generate"],
  ["stack", "Stack"],
] as const;

export const IMPORTED_STAGES = [["inputs", "Plan"]] as const;

export const PLANNING_STAGES = GENERATION_STAGES;

export type PlanningStage = (typeof GENERATION_STAGES)[number][0];

export type PlanningWorkflowStage = readonly [PlanningStage, string];

export function workflowStages(
  importedRob: boolean,
): readonly PlanningWorkflowStage[] {
  return importedRob ? IMPORTED_STAGES : GENERATION_STAGES;
}

export function clampPlanningStage(
  stage: string,
  importedRob: boolean,
): PlanningStage {
  const stages = workflowStages(importedRob);
  return stages.find(([id]) => id === stage)?.[0] ?? stages[0]![0];
}

/** Translated geometry-review notice; defaults to German without a `t`. */
export function geometryReviewMessage(t: Translate = translateDe): string {
  return t("planningCase.gate.geometryReview");
}

export function projectNeedsGeometryReview(project: Project | null): boolean {
  const solution =
    project?.solutions.find((entry) => entry.id === project.activeSolutionId) ??
    project?.solutions[0];
  return solution?.requiresGeometryReview === true;
}

export function planningStageForProject(
  project: Project | null,
): PlanningStage {
  if (!project) return "inputs";
  if (projectNeedsGeometryReview(project)) return "generate";
  if (project.source.kind === "rob-import") return "inputs";
  const solution =
    project.solutions.find((entry) => entry.id === project.activeSolutionId) ??
    project.solutions[0];
  if (!solution) return "inputs";
  if (solution.stack.layers.length > 0) return "stack";
  if (solution.patterns.length > 0) return "generate";
  return "inputs";
}

export type ProductionToolGateAction =
  | { kind: "stage"; stage: PlanningStage }
  | { kind: "tool"; tool: string };

export type ProductionToolGate =
  | { ready: true }
  | {
      ready: false;
      missing: string;
      actionLabel: string;
      action: ProductionToolGateAction;
    };

export function stackLayerCount(project: Project): number {
  const solution =
    project.solutions.find((entry) => entry.id === project.activeSolutionId) ??
    project.solutions[0];
  return solution?.stack.layers.length ?? 0;
}

/**
 * The single prerequisite map for the engineering tools. Header buttons,
 * tooltips, drawer empty states, and tests all derive from this function;
 * overlays must not re-implement their own gating.
 */
export function productionToolGate(
  tool: string,
  project: Project | null,
  robotCycleCount: number,
  t: Translate = translateDe,
): ProductionToolGate {
  const noProjectGate: ProductionToolGate = {
    ready: false,
    missing: t("planningCase.gate.noPlan"),
    actionLabel: t("planningCase.gate.toInputs"),
    action: { kind: "stage", stage: "inputs" },
  };
  if (
    projectNeedsGeometryReview(project) &&
    ["robotics", "simulation", "report"].includes(tool)
  ) {
    return {
      ready: false,
      missing: geometryReviewMessage(t),
      actionLabel: t("planningCase.gate.recalcPatterns"),
      action: { kind: "stage", stage: "generate" },
    };
  }
  switch (tool) {
    case "editor":
      if (!project) return noProjectGate;
      return stackLayerCount(project) > 0
        ? { ready: true }
        : {
            ready: false,
            missing: t("planningCase.gate.editorNeedsStack"),
            actionLabel: t("planningCase.gate.buildStack"),
            action: { kind: "stage", stage: "stack" },
          };
    case "robotics":
      if (!project) return noProjectGate;
      return stackLayerCount(project) > 0
        ? { ready: true }
        : {
            ready: false,
            missing: t("planningCase.gate.roboticsNeedsStack"),
            actionLabel: t("planningCase.gate.buildStack"),
            action: { kind: "stage", stage: "stack" },
          };
    case "simulation":
      if (!project) return noProjectGate;
      return robotCycleCount > 0
        ? { ready: true }
        : {
            ready: false,
            missing: t("planningCase.gate.simulationNeedsCycle"),
            actionLabel: t("planningCase.gate.openRobotics"),
            action: { kind: "tool", tool: "robotics" },
          };
    default:
      return { ready: true };
  }
}

export type PatternComparisonStatus =
  | "unavailable"
  | "count-mismatch"
  | "no-match"
  | "integer-compatible"
  | "exact";

export type PatternComparison = {
  status: PatternComparisonStatus;
  referenceCount: number;
  currentCount: number;
  missingCount: number;
  extraCount: number;
  acceptedSymmetry: LayerSymmetry | null;
  maximumAxisDisplacementMm: number | null;
  toleranceMm: number;
};

function previewPlacements(preview: LayerPatternPreview): PlacementGeometry[] {
  return preview.items.map((item) => ({
    positionMm: { ...item.centerMm },
    rotation: item.rotation,
  }));
}

export function comparePatternPreviews(
  reference: LayerPatternPreview | null,
  current: LayerPatternPreview | null,
  packageSize: RectangleSizeMm,
): PatternComparison {
  const referenceCount = reference?.items.length ?? 0;
  const currentCount = current?.items.length ?? 0;
  const base = {
    referenceCount,
    currentCount,
    missingCount: Math.max(0, referenceCount - currentCount),
    extraCount: Math.max(0, currentCount - referenceCount),
    acceptedSymmetry: null,
    maximumAxisDisplacementMm: null,
    toleranceMm: ROB_REFERENCE_TOLERANCE_MM,
  };

  if (!reference || !current) return { ...base, status: "unavailable" };
  if (referenceCount !== currentCount) {
    return { ...base, status: "count-mismatch" };
  }

  const currentPlacements = previewPlacements(current);
  const referencePlacements = previewPlacements(reference);
  const symmetries = envelopePreservingSymmetries(
    reference.palletBoundsMm,
    true,
  );

  for (const symmetry of symmetries) {
    const transformed = transformPlacements(
      referencePlacements,
      reference.palletBoundsMm,
      symmetry,
    );
    const match = matchPhysicalFootprintPlacements(
      transformed,
      currentPlacements,
      packageSize,
      0,
    );
    if (match.matched) {
      return {
        ...base,
        status: "exact",
        acceptedSymmetry: symmetry,
        maximumAxisDisplacementMm: 0,
      };
    }
  }

  for (const symmetry of symmetries) {
    const transformed = transformPlacements(
      referencePlacements,
      reference.palletBoundsMm,
      symmetry,
    );
    const match = matchPhysicalFootprintPlacements(
      transformed,
      currentPlacements,
      packageSize,
      ROB_REFERENCE_TOLERANCE_MM,
    );
    if (match.matched) {
      return {
        ...base,
        status: "integer-compatible",
        acceptedSymmetry: symmetry,
        maximumAxisDisplacementMm: match.maximumAxisDisplacementMm,
      };
    }
  }

  return { ...base, status: "no-match" };
}

export type ValidationStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "OBSERVED"
  | "SKIPPED";

export type ValidationEvidence = "G" | "O" | "?";

export type ValidationLedgerRow = {
  id: string;
  label: string;
  status: ValidationStatus;
  evidence: ValidationEvidence;
  claim: string;
  detail?: string;
};
