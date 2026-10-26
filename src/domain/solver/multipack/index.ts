import {
  enumerateMultiPackSolutions,
  type MultiPackEnumerationInput,
} from "~/domain/solver/multipack/enumerate";
import {
  isValidMusterLayer,
  tileMuster,
} from "~/domain/solver/multipack/layer";
import type { MusterPackage } from "~/domain/solver/multipack/muster";
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

/** Enumerated MultiPack solutions that tile into a valid layer. */
export function generateMultiPackLayers(
  input: MultiPackEnumerationInput,
): MultiPackLayer[] {
  const layers: MultiPackLayer[] = [];
  for (const { variant, solution } of enumerateMultiPackSolutions(input)) {
    const muster = generateMultiPackMuster(solution);
    const packages = tileMuster(muster);
    if (packages.length === 0) continue;
    if (!isValidMusterLayer(packages, input.paletteDmm, input.clearanceDmm))
      continue;
    layers.push({ variant, blockCount: muster.blocks.length, packages });
  }
  return layers;
}
