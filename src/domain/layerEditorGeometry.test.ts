import { describe, expect, it } from "vitest";
import {
  MIN_PALLET_SUPPORT_RATIO,
  clampDragPosition,
  hasGripCollision,
  hasSufficientPalletSupport,
  palletSupportRatio,
} from "~/domain/layerEditorGeometry";
import type { Grip } from "~/domain/palletTypes";

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

  it("stops at the last collision-free position", () => {
    const moving = grip("moving", 50, 50);
    const result = clampDragPosition({
      grips: [moving, grip("obstacle", 250, 50)],
      gripIndex: 0,
      grip: moving,
      pallet,
      packageSize,
      inputDirection: 0,
      fromX: 50,
      fromY: 50,
      toX: 250,
      toY: 50,
    });

    expect(result).toEqual({
      x: 150,
      y: 50,
      collided: true,
      insufficientSupport: false,
    });
  });

  it("stops at the minimum supported pallet position", () => {
    const moving = grip("moving", 50, 100);
    const result = clampDragPosition({
      grips: [moving],
      gripIndex: 0,
      grip: moving,
      pallet,
      packageSize,
      inputDirection: 0,
      fromX: 50,
      fromY: 100,
      toX: -50,
      toY: 100,
    });

    expect(result).toEqual({
      x: 15,
      y: 100,
      collided: false,
      insufficientSupport: true,
    });
  });

  it("clamps diagonal movement without colliding with the moving grip itself", () => {
    const moving = grip("moving", 50, 50);
    const result = clampDragPosition({
      grips: [moving, grip("obstacle", 250, 250)],
      gripIndex: 0,
      grip: moving,
      pallet,
      packageSize,
      inputDirection: 0,
      fromX: 50,
      fromY: 50,
      toX: 250,
      toY: 250,
    });

    expect(result).toEqual({
      x: 150,
      y: 150,
      collided: true,
      insufficientSupport: false,
    });
  });

  it("returns the current position for a zero-distance drag", () => {
    const moving = grip("moving", 100, 100);
    expect(
      clampDragPosition({
        grips: [moving],
        gripIndex: 0,
        grip: moving,
        pallet,
        packageSize,
        inputDirection: 0,
        fromX: 100,
        fromY: 100,
        toX: 100,
        toY: 100,
      }),
    ).toEqual({
      x: 100,
      y: 100,
      collided: false,
      insufficientSupport: false,
    });
  });
});
