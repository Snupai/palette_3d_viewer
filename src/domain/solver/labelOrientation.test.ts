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

  it("selects the positive world axis on an edge-distance tie", () => {
    expect(selection({ x: 100, y: 20 }, 0, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
    expect(selection({ x: 100, y: 80 }, 180, "right", [0, 180])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "right",
    });
  });

  it.each([
    ["bottom", 0, 180, "top", { x: 60, y: 50 }],
    ["bottom", 90, 90, "right", { x: 100, y: 20 }],
    ["top", 0, 0, "top", { x: 60, y: 50 }],
    ["top", 90, 270, "right", { x: 100, y: 20 }],
    ["left", 0, 180, "right", { x: 100, y: 20 }],
    ["left", 90, 270, "top", { x: 60, y: 50 }],
    ["right", 0, 0, "right", { x: 100, y: 20 }],
    ["right", 90, 90, "top", { x: 60, y: 50 }],
  ] as const)(
    "canonicalizes a %s label in footprint yaw %d independently of its generated yaw",
    (side, initialYaw, expectedYaw, labelSide, position) => {
      const allowed = [0, 90, 180, 270] as const;
      const expected = { status: "selected", rotation: expectedYaw, labelSide };
      expect(selection(position, initialYaw, side, allowed)).toEqual(expected);
      expect(
        selection(
          position,
          ((initialYaw + 180) % 360) as Rotation,
          side,
          [...allowed].reverse(),
        ),
      ).toEqual(expected);
    },
  );

  it.each([
    [49.999, 0],
    [50, 180],
    [50.001, 180],
  ] as const)("orients a bottom label at y=%s to yaw %s", (y, rotation) => {
    expect(selection({ x: 60, y }, 0, "bottom", [0, 180])).toEqual({
      status: "selected",
      rotation,
      labelSide: rotation === 0 ? "bottom" : "top",
    });
  });

  it("keeps the only authorized yaw even when the opposite tie direction is preferred", () => {
    expect(selection({ x: 60, y: 50 }, 0, "bottom", [0])).toEqual({
      status: "selected",
      rotation: 0,
      labelSide: "bottom",
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
