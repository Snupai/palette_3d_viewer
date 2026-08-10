import { describe, expect, it } from "vitest";
import {
  rotateUnrotatedPackageLabelSide,
  selectNearestEdgeLabelYaw,
} from "~/domain/solver/labelOrientation";
import type { Rotation, Side } from "~/domain/palletTypes";

const packageDimensionsMm = { length: 20, width: 10 } as const;
const physicalPalletBoundsMm = {
  minX: 0,
  minY: 0,
  maxX: 200,
  maxY: 100,
} as const;

function selection(
  positionMm: { x: number; y: number },
  currentRotation: Rotation,
  unrotatedPackageLabelSide: Side,
  allowedRotations: readonly Rotation[],
) {
  return selectNearestEdgeLabelYaw(
    positionMm,
    currentRotation,
    unrotatedPackageLabelSide,
    packageDimensionsMm,
    physicalPalletBoundsMm,
    allowedRotations,
  );
}

describe("nearest-edge label orientation", () => {
  it.each([
    ["top", 0, "top"],
    ["top", 90, "left"],
    ["top", 180, "bottom"],
    ["top", 270, "right"],
    ["right", 0, "right"],
    ["right", 90, "top"],
    ["right", 180, "left"],
    ["right", 270, "bottom"],
    ["bottom", 0, "bottom"],
    ["bottom", 90, "right"],
    ["bottom", 180, "top"],
    ["bottom", 270, "left"],
    ["left", 0, "left"],
    ["left", 90, "bottom"],
    ["left", 180, "right"],
    ["left", 270, "top"],
  ] as const)(
    "maps local %s through yaw %d to world %s",
    (localSide, rotation, worldSide) => {
      expect(rotateUnrotatedPackageLabelSide(localSide, rotation)).toBe(
        worldSide,
      );
    },
  );

  it("rotates by 180 degrees only when the opposite face is nearer", () => {
    expect(selection({ x: 40, y: 50 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 180,
      labelSide: "left",
    });
    expect(selection({ x: 160, y: 50 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: 100, y: 20 }, 90, "right", [90, 270])).toEqual({
      status: "selected",
      rotation: 270,
      labelSide: "bottom",
    });
    expect(selection({ x: 100, y: 80 }, 90, "right", [90, 270])).toEqual({
      status: "selected",
      rotation: 90,
      labelSide: "top",
    });
  });

  it("preserves the generated exact yaw on an edge-distance tie", () => {
    expect(selection({ x: 100, y: 20 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: 100, y: 80 }, 180, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 180,
      labelSide: "left",
    });
  });

  it("treats sub-epsilon edge-distance differences as a tie", () => {
    expect(
      selection({ x: 99.99999999975, y: 50 }, 0, "right", [0, 180]),
    ).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
  });

  it("does not use perpendicular displacement to break an axis-specific tie", () => {
    expect(selection({ x: 100, y: 5 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: 195, y: 50 }, 90, "right", [90, 270])).toEqual({
      status: "selected",
      rotation: 90,
      labelSide: "top",
    });
  });

  it("honors authorization before applying the nearest-edge preference", () => {
    expect(selection({ x: 40, y: 50 }, 0, "right", [0])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: 160, y: 50 }, 0, "right", [180])).toEqual({
      status: "selected",
      rotation: 180,
      labelSide: "left",
    });
    expect(selection({ x: 100, y: 50 }, 0, "right", [90, 270])).toEqual({
      status: "infeasible",
      reason: "no-authorized-yaw-in-footprint-class",
      allowedRotationsInClass: [],
    });
  });

  it("uses the explicit physical pallet frame instead of the generation frame", () => {
    expect(
      selectNearestEdgeLabelYaw(
        { x: 250, y: 250 },
        0,
        "right",
        packageDimensionsMm,
        { minX: 100, minY: 200, maxX: 300, maxY: 300 },
        [0, 180],
      ),
    ).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
  });

  it("preserves a mathematical tie in a large translated pallet frame", () => {
    expect(
      selectNearestEdgeLabelYaw(
        { x: 10_000_010.0005, y: 5 },
        0,
        "right",
        { length: 10, width: 10 },
        {
          minX: 10_000_000,
          minY: 0,
          maxX: 10_000_020.001,
          maxY: 10,
        },
        [0, 180],
      ),
    ).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
  });

  it("compares absolute face distance when a package overhangs the pallet", () => {
    expect(selection({ x: 205, y: 50 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: -5, y: 50 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 180,
      labelSide: "left",
    });
  });
});
