import {
  enumerateMultiPackSolutions,
  type MultiPackEnumerationInput,
} from "~/domain/solver/multipack/enumerate";
import {
  isValidMusterLayer,
  tileMuster,
} from "~/domain/solver/multipack/layer";
import {
  MUSTER_BLOCK_CAP,
  type MusterPackage,
} from "~/domain/solver/multipack/muster";
import { generateMultiPackMuster } from "~/domain/solver/multipack/optimizer";

export * from "~/domain/solver/multipack/enumerate";
export * from "~/domain/solver/multipack/families";
export * from "~/domain/solver/multipack/layer";
export * from "~/domain/solver/multipack/mpwin";
export * from "~/domain/solver/multipack/muster";
export * from "~/domain/solver/multipack/optimizer";
export * from "~/domain/solver/multipack/orientation";
export * from "~/domain/solver/multipack/overlap";
export * from "~/domain/solver/multipack/replication";

export type MultiPackLayer = {
  variant: string;
  blockCount: number;
  packages: MusterPackage[];
};

/**
 * Enumerated MultiPack solutions that tile into a valid layer.
 *
 * Per-package emission can exceed the 400-entry record that the legacy
 * tiling range-checks. The legacy optimizer only emits per package below a
 * solution-word threshold of 250, so an oversized solution falls back to
 * block emission; one that still exceeds the record is skipped.
 */
export function generateMultiPackLayers(
  input: MultiPackEnumerationInput,
): MultiPackLayer[] {
  const layers: MultiPackLayer[] = [];
  for (const { variant, solution } of enumerateMultiPackSolutions(input)) {
    let muster = generateMultiPackMuster(solution);
    if (muster.blocks.length > MUSTER_BLOCK_CAP) {
      muster = generateMultiPackMuster({
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
