import { describe, expect, it } from "vitest";
import type {
  DocumentQuad,
  Point,
} from "~/features/project/documentCameraModel";
import {
  applyHomography,
  homography,
  quadToPixels,
  warpedSize,
  warpPerspective,
  type RgbaImage,
} from "~/features/project/documentWarp";

type Corners = [Point, Point, Point, Point];

function grey(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = value(x, y);
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const pixel = (image: RgbaImage, x: number, y: number) =>
  image.data[(y * image.width + x) * 4]!;

describe("quadToPixels", () => {
  it("maps detection-frame corners onto the full-resolution photo", () => {
    const quad: DocumentQuad = [
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 0.25, y: 0.9 },
    ];
    expect(quadToPixels(quad, 1920, 1080)).toEqual([
      { x: 480, y: 108 },
      { x: 1440, y: 108 },
      { x: 1440, y: 972 },
      { x: 480, y: 972 },
    ]);
  });

  it("keeps corners inside the photo", () => {
    const quad: DocumentQuad = [
      { x: -0.01, y: -0.02 },
      { x: 1.01, y: 0 },
      { x: 1, y: 1.02 },
      { x: 0, y: 1 },
    ];
    expect(quadToPixels(quad, 1920, 1080)).toEqual([
      { x: 0, y: 0 },
      { x: 1920, y: 0 },
      { x: 1920, y: 1080 },
      { x: 0, y: 1080 },
    ]);
  });
});

describe("warpedSize", () => {
  it("uses the longer of each pair of opposite sides", () => {
    const trapezoid: Corners = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 600, y: 400 },
      { x: 0, y: 400 },
    ];
    // Top 400, bottom 600; both legs √(100² + 300²) ≈ 316.2.
    expect(warpedSize(trapezoid)).toEqual({ width: 600, height: 316 });
  });

  it("scales oversized sheets down to the maximum side", () => {
    const wide: Corners = [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    expect(warpedSize(wide, 4096)).toEqual({ width: 4096, height: 1024 });
  });
});

describe("homography", () => {
  const rectangle: Corners = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ];

  it("reduces to scale and offset between upright rectangles", () => {
    const target: Corners = [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 170 },
      { x: 10, y: 170 },
    ];
    const h = homography(rectangle, target)!;
    expect(h.map((value) => Math.round(value * 1e9) / 1e9 + 0)).toEqual([
      2, 0, 10, 0, 3, 20, 0, 0, 1,
    ]);
  });

  it("maps every corner of a perspective quad exactly", () => {
    const quad: Corners = [
      { x: 30, y: 20 },
      { x: 170, y: 35 },
      { x: 185, y: 140 },
      { x: 12, y: 120 },
    ];
    const h = homography(rectangle, quad)!;
    rectangle.forEach((corner, index) => {
      const mapped = applyHomography(h, corner);
      expect(mapped.x).toBeCloseTo(quad[index]!.x, 9);
      expect(mapped.y).toBeCloseTo(quad[index]!.y, 9);
    });
  });

  it("rejects degenerate quads", () => {
    const line: Corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(homography(rectangle, line)).toBeNull();
  });
});

describe("warpPerspective", () => {
  it("copies an upright crop pixel for pixel", () => {
    const source = grey(8, 6, (x, y) => y * 8 + x);
    const crop = warpPerspective(
      source,
      [
        { x: 2, y: 1 },
        { x: 6, y: 1 },
        { x: 6, y: 5 },
        { x: 2, y: 5 },
      ],
      4,
      4,
    )!;
    const values = Array.from({ length: 16 }, (_, i) =>
      pixel(crop, i % 4, Math.floor(i / 4)),
    );
    expect(values).toEqual([
      10, 11, 12, 13, 18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37,
    ]);
  });

  it("straightens a sheet photographed at an angle", () => {
    // A 100 × 50 sheet, white on its left half and black on its right,
    // seen in perspective on a grey 200 × 150 table.
    const quad: Corners = [
      { x: 30, y: 20 },
      { x: 170, y: 35 },
      { x: 185, y: 140 },
      { x: 12, y: 120 },
    ];
    const toSheet = homography(quad, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ])!;
    const photo = grey(200, 150, (x, y) => {
      const { x: u, y: v } = applyHomography(toSheet, {
        x: x + 0.5,
        y: y + 0.5,
      });
      if (u < 0 || u > 100 || v < 0 || v > 50) return 128;
      return u < 50 ? 255 : 0;
    });

    const sheet = warpPerspective(photo, quad, 100, 50)!;

    expect([sheet.width, sheet.height]).toEqual([100, 50]);
    // Rows across the sheet: white, then black, no table showing through.
    for (const y of [3, 25, 46]) {
      expect([3, 20, 45, 55, 80, 96].map((x) => pixel(sheet, x, y))).toEqual([
        255, 255, 255, 0, 0, 0,
      ]);
    }
  });

  it("gives up on a degenerate quad", () => {
    const photo = grey(4, 4, () => 0);
    const line: Corners = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(warpPerspective(photo, line, 2, 2)).toBeNull();
  });
});
