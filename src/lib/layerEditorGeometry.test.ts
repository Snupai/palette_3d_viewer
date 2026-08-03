import { describe, expect, it } from "vitest";
import {
  MIN_PALLET_SUPPORT_RATIO,
  hasGripCollision,
  hasSufficientPalletSupport,
  palletSupportRatio,
} from "~/lib/layerEditorGeometry";
import type { Grip } from "~/lib/robParser";

const packageSize = { width: 100, length: 100 };
const pallet = { width: 400, length: 300 };

function grip(id: string, x: number, y: number): Grip {
  return {
    id,
    pickX: x,
    pickY: y,
    pickRotation: 0,
    x,
    y,
    rotation: 0,
    numPackages: 1,
    dx: 0,
    dy: 0,
  };
}

describe("layer editor geometry", () => {
  it("rejects a package with less than 65% pallet support", () => {
    const supported = grip("supported", 15, 100);
    const unsupported = grip("unsupported", 14, 100);

    expect(palletSupportRatio(supported, pallet, packageSize, 0)).toBe(
      MIN_PALLET_SUPPORT_RATIO,
    );
    expect(hasSufficientPalletSupport(supported, pallet, packageSize, 0)).toBe(
      true,
    );
    expect(
      hasSufficientPalletSupport(unsupported, pallet, packageSize, 0),
    ).toBe(false);
  });

  it("detects overlapping package footprints", () => {
    expect(
      hasGripCollision(
        [grip("first", 100, 100), grip("second", 150, 100)],
        packageSize,
        0,
      ),
    ).toBe(true);
  });
});
