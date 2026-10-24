import { describe, expect, it } from "vitest";
import {
  flattenedSize,
  orderQuadCorners,
  pickDocumentQuad,
  polygonArea,
} from "./documentScanModel";

describe("orderQuadCorners", () => {
  it("orders a shuffled, skewed quad clockwise from the top-left", () => {
    const quad = orderQuadCorners([
      { x: 880, y: 1040 },
      { x: 120, y: 90 },
      { x: 60, y: 1100 },
      { x: 940, y: 150 },
    ]);
    expect(quad).toEqual([
      { x: 120, y: 90 },
      { x: 940, y: 150 },
      { x: 880, y: 1040 },
      { x: 60, y: 1100 },
    ]);
  });

  it("rejects anything but four corners", () => {
    expect(() => orderQuadCorners([{ x: 0, y: 0 }])).toThrow(
      "Expected 4 corners, got 1.",
    );
  });
});

describe("polygonArea", () => {
  it("computes the shoelace area regardless of winding", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });
});

describe("flattenedSize", () => {
  it("uses the longer opposite edge of a perspective-distorted sheet", () => {
    expect(
      flattenedSize([
        { x: 100, y: 100 },
        { x: 700, y: 120 },
        { x: 680, y: 1000 },
        { x: 60, y: 940 },
      ]),
    ).toEqual({ width: 623, height: 880 });
  });
});

describe("pickDocumentQuad", () => {
  const image = { width: 1000, height: 1000 };
  const sheet = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 900 },
    { x: 100, y: 900 },
  ];

  it("picks the largest convex quad that covers at least 15 % of the photo", () => {
    const smallLabel = [
      { x: 10, y: 10 },
      { x: 300, y: 10 },
      { x: 300, y: 300 },
      { x: 10, y: 300 },
    ];
    expect(
      pickDocumentQuad(
        [
          { points: smallLabel, convex: true },
          { points: sheet, convex: true },
        ],
        image.width,
        image.height,
      ),
    ).toEqual(sheet);
  });

  it("returns null when only small, concave, or non-quad shapes exist", () => {
    const concave = [
      { x: 100, y: 100 },
      { x: 900, y: 100 },
      { x: 500, y: 500 },
      { x: 100, y: 900 },
    ];
    expect(
      pickDocumentQuad(
        [
          { points: concave, convex: false },
          { points: sheet.slice(0, 3), convex: true },
          {
            points: [
              { x: 0, y: 0 },
              { x: 300, y: 0 },
              { x: 300, y: 300 },
              { x: 0, y: 300 },
            ],
            convex: true,
          },
        ],
        image.width,
        image.height,
      ),
    ).toBeNull();
  });
});
