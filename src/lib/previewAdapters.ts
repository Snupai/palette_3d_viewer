import type { RectangleBoundsMm } from "~/domain/geometry";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import { footprintSize } from "~/domain/palletGeometry";
import type { PalletData } from "~/domain/palletTypes";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver/types";

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Read-only 2D projection of one physical PalletData layer. */
export function palletLayerToPatternPreview(
  data: PalletData,
  layerIndex: number,
): LayerPatternPreview {
  const layer = data.layers[layerIndex];
  if (!layer) {
    throw new Error(`Pallet layer ${layerIndex + 1} does not exist.`);
  }

  const palletWidth = finitePositive(data.pallet?.width ?? 1200, 1200);
  const palletLength = finitePositive(data.pallet?.length ?? 800, 800);
  const plannerLayer = data.planner?.layers[layerIndex] ?? null;
  const seenGroups = new Set<number>();
  const items = layer.boxes.map((box, boxIndex) => {
    const size = footprintSize(box);
    const showGroupLabel = !seenGroups.has(box.blueNumber);
    seenGroups.add(box.blueNumber);
    return {
      id: `${plannerLayer?.id ?? `layer-${layerIndex + 1}`}:box-${boxIndex + 1}`,
      centerMm: { x: box.rect.x, y: box.rect.y },
      sizeMm: { x: size.width, y: size.length },
      rotation: box.rotation,
      labelSide: box.blueLine,
      groupLabel: showGroupLabel ? `G${box.blueNumber}` : null,
    };
  });

  return {
    id: plannerLayer?.id ?? `pallet-layer-${layerIndex + 1}`,
    label: plannerLayer?.label ?? `Layer ${layerIndex + 1}`,
    palletBoundsMm: {
      minX: 0,
      minY: 0,
      maxX: palletWidth,
      maxY: palletLength,
    },
    items,
    metadata: {
      source: "pallet-layer",
      sourceId: plannerLayer?.id ?? `layer-${layerIndex + 1}`,
      layerIndex,
      patternRef: plannerLayer?.patternRef ?? null,
      candidateId: plannerLayer?.candidateId ?? null,
      packageCount: items.length,
      cycleCount: seenGroups.size,
    },
  };
}

export type SolverCandidatePreviewOptions = {
  physicalPalletBoundsMm?: RectangleBoundsMm;
};

/** Deterministic candidate thumbnail/report projection without materializing a stack. */
export function solverCandidateToPatternPreview(
  candidate: SolverCandidate,
  input: Pick<
    LayerSolverInput,
    "package" | "envelopeMm" | "generationBoundsMm"
  >,
  options: SolverCandidatePreviewOptions = {},
): LayerPatternPreview {
  const packageLength = input.package.dimensionsMm.length;
  const packageWidth = input.package.dimensionsMm.width;
  const items = candidate.placements.map((placement, index) => {
    const rotated = placement.rotation === 90 || placement.rotation === 270;
    return {
      id: `${candidate.id}:placement-${index + 1}`,
      centerMm: { ...placement.positionMm },
      sizeMm: {
        x: rotated ? packageWidth : packageLength,
        y: rotated ? packageLength : packageWidth,
      },
      rotation: placement.rotation,
      labelSide: placement.labelSide,
      groupLabel: null,
    };
  });

  return {
    id: candidate.id,
    label: `Candidate ${candidate.rank}`,
    palletBoundsMm: {
      ...(options.physicalPalletBoundsMm ?? input.envelopeMm),
    },
    effectiveEnvelopeMm: { ...input.envelopeMm },
    ...(input.generationBoundsMm
      ? { generationBoundsMm: { ...input.generationBoundsMm } }
      : {}),
    items,
    metadata: {
      source: "solver-candidate",
      sourceId: candidate.id,
      rank: candidate.rank,
      geometryId: candidate.geometryId,
      packageCount: candidate.metrics.packageCount,
      cycleCount: candidate.metrics.provisionalCycleCount,
      utilizationPercent: candidate.metrics.utilizationPercent,
    },
  };
}
