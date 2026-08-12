import { describe, expect, it } from "vitest";
import {
  findGripCollision,
  footprintSize,
  gripsToBoxes,
  layerInterlayerHeightMm,
  layerPlaceZ,
  layerZBottom,
  parseBlueLine,
  trailingInterlayerHeightMm,
  pickOffsetForCount,
  toRobInt,
} from "~/domain/palletGeometry";
import {
  ZWISCHENLAGE_HEIGHT_MM,
  type Grip,
  type Layer,
} from "~/domain/palletTypes";

function grip(
  id: string,
  x: number,
  y: number,
  overrides?: Partial<Grip>,
): Grip {
  return {
    id,
    pickX: 0,
    pickY: 0,
    pickRotation: 0,
    x,
    y,
    rotation: 0,
    numPackages: 1,
    dx: 0,
    dy: 0,
    ...overrides,
  };
}

describe("pallet Z geometry", () => {
  it("excludes pallet height and applies 3 mm interlayers", () => {
    const layers: Layer[] = [1, 0, 1].map((zwischenlage, index) => ({
      unique_layer_id: index + 1,
      boxes: [],
      zwischenlage,
    }));
    const packageHeight = 150;

    expect(layerZBottom(layers, 0, packageHeight)).toBe(ZWISCHENLAGE_HEIGHT_MM);
    expect(layerPlaceZ(layers, 0, packageHeight)).toBe(
      ZWISCHENLAGE_HEIGHT_MM + packageHeight,
    );
    expect(layerZBottom(layers, 1, packageHeight)).toBe(
      ZWISCHENLAGE_HEIGHT_MM + packageHeight,
    );
    expect(layerPlaceZ(layers, 1, packageHeight)).toBe(
      ZWISCHENLAGE_HEIGHT_MM + packageHeight * 2,
    );
    expect(layerZBottom(layers, 2, packageHeight)).toBe(
      ZWISCHENLAGE_HEIGHT_MM * 2 + packageHeight * 2,
    );
  });

  it("uses exact variable sheet thicknesses when a materialized preview supplies them", () => {
    const layers: Layer[] = [
      {
        unique_layer_id: 1,
        boxes: [],
        zwischenlage: 1,
        interlayerThicknessesMm: [5],
      },
      {
        unique_layer_id: 2,
        boxes: [],
        zwischenlage: 2,
        interlayerThicknessesMm: [2, 7],
      },
    ];

    expect(layerInterlayerHeightMm(layers[0])).toBe(5);
    expect(layerInterlayerHeightMm(layers[1])).toBe(9);
    expect(layerZBottom(layers, 0, 100)).toBe(5);
    expect(layerZBottom(layers, 1, 100)).toBe(114);
    expect(
      trailingInterlayerHeightMm({
        trailingZwischenlage: 2,
        trailingInterlayerThicknessesMm: [4, 6],
      }),
    ).toBe(10);
  });
});

describe("grip and package geometry", () => {
  it("preserves pick-offset rotation and input-direction semantics", () => {
    expect(pickOffsetForCount(200, 300, 0, 0, 2)).toEqual({
      x: 200,
      y: -150,
    });
    expect(pickOffsetForCount(200, 300, 0, 90, 2)).toEqual({
      x: 150,
      y: 200,
    });
    expect(pickOffsetForCount(200, 300, 0, 180, 2)).toEqual({
      x: -200,
      y: 150,
    });
    expect(pickOffsetForCount(200, 300, 0, 270, 2)).toEqual({
      x: -150,
      y: -200,
    });
    expect(pickOffsetForCount(200, 300, 1, 0, 2)).toEqual({
      x: 300,
      y: -100,
    });
  });

  it("expands grouped grips along the current rotation axis", () => {
    const horizontal = gripsToBoxes(
      [grip("horizontal", 600, 400, { numPackages: 2 })],
      200,
      300,
      150,
      0,
    );
    const vertical = gripsToBoxes(
      [grip("vertical", 600, 400, { rotation: 90, numPackages: 2 })],
      200,
      300,
      150,
      0,
    );

    expect(horizontal.map((box) => [box.rect.x, box.rect.y])).toEqual([
      [500, 400],
      [700, 400],
    ]);
    expect(vertical.map((box) => [box.rect.x, box.rect.y])).toEqual([
      [600, 300],
      [600, 500],
    ]);
  });

  it("uses the crosswise package span and required quarter-turn semantics for grouped input-direction-1 grips", () => {
    const boxes = gripsToBoxes(
      [
        grip("crosswise", 1128, 102, {
          rotation: 90,
          numPackages: 2,
        }),
      ],
      136,
      94,
      151,
      1,
    );

    expect(boxes.map((box) => [box.rect.x, box.rect.y])).toEqual([
      [1128, 55],
      [1128, 149],
    ]);
    expect(boxes[1]!.rect.y - boxes[0]!.rect.y).toBe(94);
    expect(boxes.map((box) => footprintSize(box))).toEqual([
      { width: 136, length: 94 },
      { width: 136, length: 94 },
    ]);
  });

  it("maps delta signs to the existing blue-line sides and corners", () => {
    expect(parseBlueLine(0, 0)).toBeNull();
    expect(parseBlueLine(1, 0)).toBe("left");
    expect(parseBlueLine(-1, 1)).toBe("bottom_right");
    expect(parseBlueLine(1, -1)).toBe("top_right");
  });

  it("truncates half-millimeter ROB coordinate candidates", () => {
    expect(toRobInt(100.5)).toBe(100);
    expect(toRobInt(-100.5)).toBe(-100);
  });
});

describe("grip collision geometry", () => {
  const packageWidth = 200;
  const packageLength = 300;

  it("treats edge-touching footprints as non-colliding with tolerance", () => {
    expect(
      findGripCollision(
        [grip("left", 100, 150), grip("right", 300, 150)],
        packageWidth,
        packageLength,
        0,
      ),
    ).toBeNull();
  });

  it("detects true overlap", () => {
    expect(
      findGripCollision(
        [grip("first", 200, 150), grip("second", 250, 150)],
        packageWidth,
        packageLength,
        0,
      ),
    ).toEqual({ firstGripIndex: 0, secondGripIndex: 1 });
  });

  it("can limit collision checks to one focused grip", () => {
    const grips = [
      grip("focused", 800, 150),
      grip("first", 200, 150),
      grip("second", 250, 150),
    ];

    expect(
      findGripCollision(grips, packageWidth, packageLength, 0, 0),
    ).toBeNull();
    expect(findGripCollision(grips, packageWidth, packageLength, 0)).toEqual({
      firstGripIndex: 1,
      secondGripIndex: 2,
    });
  });
});
