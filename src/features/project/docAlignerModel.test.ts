import { describe, expect, it } from "vitest";
import {
  DOCALIGNER_PAD_VALUE,
  decodeHeatmaps,
  frameToTensor,
  heatmapsToQuad,
  largestBlobCentroid,
  letterbox,
  otsuThreshold,
  resizeLinearFloat,
} from "~/features/project/docAlignerModel";

const HEATMAP = 128;

/** Four corner heatmaps with a Gaussian peak each (as the model outputs). */
function heatmaps(peaks: readonly (readonly [number, number] | null)[]) {
  const data = new Float32Array(4 * HEATMAP * HEATMAP);
  peaks.forEach((peak, channel) => {
    if (!peak) return;
    const [cx, cy] = peak;
    for (let y = 0; y < HEATMAP; y++) {
      for (let x = 0; x < HEATMAP; x++) {
        data[channel * HEATMAP * HEATMAP + y * HEATMAP + x] = Math.exp(
          -((x - cx) ** 2 + (y - cy) ** 2) / 8,
        );
      }
    }
  });
  return data;
}

const PEAKS = [
  [40, 30],
  [90, 32],
  [95, 100],
  [35, 98],
] as const;

describe("letterbox", () => {
  it("centres a portrait camera frame in a square", () => {
    expect(letterbox(1080, 1920)).toEqual({
      side: 1920,
      offsetX: 420,
      offsetY: 0,
    });
    expect(letterbox(641, 1139)).toEqual({
      side: 1139,
      offsetX: 249,
      offsetY: 0,
    });
  });
});

describe("frameToTensor", () => {
  it("pads, resizes like cv2 INTER_LINEAR and orders channels BGR", () => {
    // 4 × 2 frame → padded 4 × 4 (grey rows above and below) → 256 × 256.
    const rgb = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
      [100, 110, 120],
      [130, 140, 150],
      [160, 170, 180],
      [190, 200, 210],
      [220, 230, 240],
    ];
    const rgba = rgb.flatMap((pixel) => [...pixel, 255]);
    const tensor = frameToTensor(rgba, 4, 2);
    const plane = 256 * 256;
    const at = (channel: number, y: number, x: number) =>
      Math.round(tensor[channel * plane + y * 256 + x]! * 255);
    // Expected values from cv2.resize on the same padded BGR image.
    expect([
      at(0, 0, 0),
      at(0, 100, 0),
      at(0, 128, 64),
      at(0, 128, 255),
    ]).toEqual([DOCALIGNER_PAD_VALUE, 38, 106, 181]);
    expect([
      at(1, 0, 0),
      at(1, 100, 0),
      at(1, 128, 64),
      at(1, 128, 255),
    ]).toEqual([DOCALIGNER_PAD_VALUE, 28, 96, 171]);
    expect([
      at(2, 0, 0),
      at(2, 100, 0),
      at(2, 128, 64),
      at(2, 128, 255),
    ]).toEqual([DOCALIGNER_PAD_VALUE, 18, 86, 161]);
  });
});

describe("resizeLinearFloat", () => {
  it("matches cv2.resize(INTER_LINEAR) on float data", () => {
    const resized = resizeLinearFloat(
      new Float32Array([0, 1, 2, 4]),
      2,
      2,
      4,
      4,
    );
    expect(Array.from(resized)).toEqual([
      0, 0.25, 0.75, 1, 0.5, 0.8125, 1.4375, 1.75, 1.5, 1.9375, 2.8125, 3.25, 2,
      2.5, 3.5, 4,
    ]);
  });
});

describe("otsuThreshold", () => {
  it("matches cv2 THRESH_OTSU", () => {
    const bimodal = new Uint8Array(900 + 98);
    for (let i = 0; i < 98; i++) bimodal[900 + i] = 60 + 2 * i;
    expect(otsuThreshold(bimodal)).toBe(84);
    const ramp = Uint8Array.from({ length: 715 }, (_, i) => (i * 7) % 256);
    expect(otsuThreshold(ramp)).toBe(127);
  });
});

describe("largestBlobCentroid", () => {
  it("returns the centre of the largest 8-connected blob", () => {
    // A 2-pixel diagonal blob, a 3-pixel L and a lone pixel.
    const mask = Uint8Array.from([
      1,
      0,
      0,
      0,
      1, //
      0,
      1,
      0,
      0,
      0, //
      0,
      0,
      0,
      1,
      1, //
      0,
      0,
      0,
      0,
      1, //
    ]);
    expect(largestBlobCentroid(mask, 5, 4)).toEqual({ x: 4 - 1 / 3, y: 7 / 3 });
  });

  it("ignores single pixels", () => {
    expect(largestBlobCentroid(Uint8Array.from([0, 1, 0, 0]), 2, 2)).toBeNull();
  });
});

describe("decodeHeatmaps", () => {
  it("finds each corner peak", () => {
    const corners = decodeHeatmaps(heatmaps(PEAKS), HEATMAP, 512);
    // Peak at heatmap pixel p → (p + 0.5) · 4 − 0.5 in the 512 image.
    expect(corners.map((corner) => corner && [corner.x, corner.y])).toEqual([
      [161.5, 121.5],
      [361.5, 129.5],
      [381.5, 401.5],
      [141.5, 393.5],
    ]);
  });

  it("reports a corner without a peak above 0.3 as missing", () => {
    const flat = heatmaps(PEAKS);
    flat.fill(0.29, 2 * HEATMAP * HEATMAP, 3 * HEATMAP * HEATMAP);
    expect(decodeHeatmaps(flat, HEATMAP, 512)[2]).toBeNull();
  });
});

describe("heatmapsToQuad", () => {
  it("maps corners back through the padding into the camera frame", () => {
    // DocAligner's own postprocess (cv2, full 1920 px) puts these corners at
    // (187.5, 457.5) (937.5, 487.5) (1012.5, 1507.5) (112.5, 1477.5).
    const quad = heatmapsToQuad(heatmaps(PEAKS), HEATMAP, 1080, 1920);
    expect(quad?.map(({ x, y }) => [x * 1080, y * 1920])).toEqual([
      [187.5, 457.5],
      [937.5, 487.5],
      [1012.5, 1507.5],
      [112.5, 1477.5],
    ]);
  });

  it("drops a missing, crossed, tiny or out-of-frame outline", () => {
    expect(
      heatmapsToQuad(
        heatmaps([...PEAKS.slice(0, 3), null]),
        HEATMAP,
        1080,
        1920,
      ),
    ).toBeNull();
    const crossed = [PEAKS[1], PEAKS[0], PEAKS[2], PEAKS[3]];
    expect(heatmapsToQuad(heatmaps(crossed), HEATMAP, 1080, 1920)).toBeNull();
    const tiny = [
      [60, 60],
      [66, 60],
      [66, 66],
      [60, 66],
    ] as const;
    expect(heatmapsToQuad(heatmaps(tiny), HEATMAP, 1080, 1920)).toBeNull();
    // x = 10 lies in the left padding, outside the portrait frame.
    const outside = [[10, 30] as const, PEAKS[1], PEAKS[2], PEAKS[3]];
    expect(heatmapsToQuad(heatmaps(outside), HEATMAP, 1080, 1920)).toBeNull();
  });
});
