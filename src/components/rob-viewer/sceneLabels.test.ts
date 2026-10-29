// @vitest-environment node
import { describe, expect, it } from "vitest";
import { labelPositionBeside } from "~/components/rob-viewer/sceneLabels";

const block = { minX: 0, maxX: 400, minY: 100, maxY: 300 };

describe("labelPositionBeside", () => {
  it("sits past the block edge along the camera's right vector", () => {
    expect(labelPositionBeside(block, { x: 1, y: 0 }, 105)).toEqual({
      x: 505,
      y: 200,
    });
    expect(labelPositionBeside(block, { x: -1, y: 0 }, 105)).toEqual({
      x: -105,
      y: 200,
    });
    expect(labelPositionBeside(block, { x: 0, y: 1 }, 105)).toEqual({
      x: 200,
      y: 405,
    });
  });

  it("clears the block's projected extent on a diagonal view", () => {
    const beside = labelPositionBeside(block, { x: 1, y: 1 }, 0);
    // Half extents 200 and 100 projected on (√½, √½): 150·√2 ≈ 212.13.
    expect(beside.x).toBeCloseTo(200 + 150, 6);
    expect(beside.y).toBeCloseTo(200 + 150, 6);
  });

  it("falls back to +x when the right vector has no horizontal part", () => {
    expect(labelPositionBeside(block, { x: 0, y: 0 }, 10)).toEqual({
      x: 410,
      y: 200,
    });
  });
});
