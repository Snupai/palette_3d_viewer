import type { MultiPackPackageDmm } from "~/domain/solver/multipack/families";

/**
 * MPWin mode (`PTR_DAT_00d26fb0`, checked at 0x00a464d6).
 *
 * In MPWin mode the optimizer routes the layer to the Round/Oval/Complex
 * generator (`FUN_00a3f0b8`), which is not part of this rectangular port.
 * The one MPWin behaviour that belongs to the rectangular input model is the
 * dimension swap in `FUN_00ca4118`:
 *
 *   layer[+0x15] := layer[+0x11]      // BlockBreite := BlockLaenge
 *
 * i.e. the package width becomes the package length. Callers can map their
 * dimensions with this helper before generating, but
 * `generateMultiPackMuster` still rejects MPWin solutions because their
 * geometry comes from the unsupported round path.
 */
export function mapMultiPackMPWinDimensions(
  pkg: MultiPackPackageDmm,
): MultiPackPackageDmm {
  return { length: pkg.length, width: pkg.length };
}

export class MultiPackMPWinUnsupportedError extends Error {
  constructor() {
    super(
      "MultiPack MPWin mode uses the Round/Oval/Complex generator (FUN_00a3f0b8), which is not ported.",
    );
    this.name = "MultiPackMPWinUnsupportedError";
  }
}
