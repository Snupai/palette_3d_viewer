import {
  enumerateBlockPlanSolutions,
  type BlockPlanEnumerationInput,
} from "~/domain/solver/blockPlan/enumerate";
import {
  isValidMusterLayer,
  tileMuster,
} from "~/domain/solver/blockPlan/layer";
import {
  MUSTER_BLOCK_CAP,
  type MusterPackage,
} from "~/domain/solver/blockPlan/muster";
import { generateBlockPlanMuster } from "~/domain/solver/blockPlan/optimizer";

export * from "~/domain/solver/blockPlan/enumerate";
export * from "~/domain/solver/blockPlan/families";
export * from "~/domain/solver/blockPlan/layer";
export * from "~/domain/solver/blockPlan/muster";
export * from "~/domain/solver/blockPlan/optimizer";
export * from "~/domain/solver/blockPlan/orientation";
export * from "~/domain/solver/blockPlan/overlap";
export * from "~/domain/solver/blockPlan/replication";

export type BlockPlanLayer = {
  variant: string;
  blockCount: number;
  packages: MusterPackage[];
};

/**
 * Enumerated block-plan solutions that tile into a valid layer.
 *
 * Per-package emission can exceed the 400-block Muster cap that tiling
 * range-checks, so an oversized solution falls back to block emission; one
 * that still exceeds the cap is skipped.
 */
export function generateBlockPlanLayers(
  input: BlockPlanEnumerationInput,
): BlockPlanLayer[] {
  const layers: BlockPlanLayer[] = [];
  for (const { variant, solution } of enumerateBlockPlanSolutions(input)) {
    let muster = generateBlockPlanMuster(solution);
    if (muster.blocks.length > MUSTER_BLOCK_CAP) {
      muster = generateBlockPlanMuster({
        ...solution,
        interactiveQuality: false,
      });
      if (muster.blocks.length > MUSTER_BLOCK_CAP) continue;
    }
    const packages = tileMuster(muster);
    if (packages.length === 0) continue;
    if (!isValidMusterLayer(packages, input.paletteDmm, input.clearanceDmm))
      continue;
    layers.push({ variant, blockCount: muster.blocks.length, packages });
  }
  return layers;
}
