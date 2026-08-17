import { describe, expect, it } from "vitest";
import { gripDeltaArrow } from "~/components/layer-editor/gripVisualGeometry";

const footprint = [{ left: 0, right: 100, top: 0, bottom: 100 }];

describe("grip delta arrow", () => {
  it.each([
    [{ dx: 1, dy: 0 }, { endX: 10, endY: 50 }],
    [{ dx: -1, dy: 0 }, { endX: 90, endY: 50 }],
    [{ dx: 0, dy: 1 }, { endX: 50, endY: 90 }],
    [{ dx: 0, dy: -1 }, { endX: 50, endY: 10 }],
  ])("shows the physical approach direction for ROB offset %o", (delta, expectedEnd) => {
    expect(gripDeltaArrow({ x: 50, y: 50 }, delta, footprint)).toMatchObject(
      expectedEnd,
    );
  });

  it("does not draw an arrow for a zero delta", () => {
    expect(
      gripDeltaArrow({ x: 50, y: 50 }, { dx: 0, dy: 0 }, footprint),
    ).toBeNull();
  });
});
