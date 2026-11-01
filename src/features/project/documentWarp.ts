/**
 * Perspective correction for the sheet camera: maps the corners detected on
 * the small detection frame onto the full-resolution photo and warps that
 * quad into an upright rectangle. Pure, so it runs in tests without a canvas.
 */
import type {
  DocumentQuad,
  Point,
} from "~/features/project/documentCameraModel";

/** Longest side of a cropped photo; keeps the warp and the upload bounded. */
export const MAX_WARP_SIDE = 4096;

/** RGBA pixels, laid out like `ImageData`. */
export type RgbaImage = {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
};

/**
 * Corners of a frame-relative quad (0–1, as returned by detection on the
 * downscaled frame) in pixel coordinates of the full-resolution photo.
 */
export function quadToPixels(
  quad: DocumentQuad,
  width: number,
  height: number,
): [Point, Point, Point, Point] {
  const [a, b, c, d] = quad.map((point) => ({
    x: Math.min(width, Math.max(0, point.x * width)),
    y: Math.min(height, Math.max(0, point.y * height)),
  }));
  return [a!, b!, c!, d!];
}

/**
 * Size of the upright rectangle: the longer of each pair of opposite sides,
 * so no direction is shrunk, scaled down to fit `maxSide`.
 */
export function warpedSize(
  corners: readonly [Point, Point, Point, Point],
  maxSide = MAX_WARP_SIDE,
): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  const distance = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y);
  const width = Math.max(distance(tl, tr), distance(bl, br));
  const height = Math.max(distance(tl, bl), distance(tr, br));
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 3×3 homography in row-major order with the last entry fixed to 1. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Homography that maps each `from` point onto the matching `to` point, or
 * null when the points are degenerate (three on a line).
 */
export function homography(
  from: readonly [Point, Point, Point, Point],
  to: readonly [Point, Point, Point, Point],
): Homography | null {
  // x' = (h0 x + h1 y + h2) / (h6 x + h7 y + 1), likewise y' with h3..h5.
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const lead = rows[column]!;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const target = rows[row]!;
      const factor = target[column]! / lead[column]!;
      if (factor === 0) continue;
      for (let k = column; k < 9; k++) target[k]! -= factor * lead[k]!;
    }
  }
  const h = rows.map((row, index) => row[8]! / row[index]!);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyHomography(h: Homography, point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / w,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / w,
  };
}

/**
 * Warps the quad `corners` (pixel coordinates, top-left, top-right,
 * bottom-right, bottom-left) of `source` into an upright `width` × `height`
 * image. Each output pixel is sampled bilinearly from the source; samples
 * outside the source are clamped to its border. Null for a degenerate quad.
 */
export function warpPerspective(
  source: { data: Uint8ClampedArray; width: number; height: number },
  corners: readonly [Point, Point, Point, Point],
  width: number,
  height: number,
): RgbaImage | null {
  const rectangle: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  // Inverse mapping: for every output pixel, find where it comes from.
  const h = homography(rectangle, corners);
  if (!h) return null;
  const data = new Uint8ClampedArray(width * height * 4);
  const maxX = source.width - 1;
  const maxY = source.height - 1;
  const src = source.data;
  for (let v = 0; v < height; v++) {
    const cy = v + 0.5;
    for (let u = 0; u < width; u++) {
      const cx = u + 0.5;
      const w = h[6] * cx + h[7] * cy + h[8];
      // Pixel centres sit at +0.5, so shift back before interpolating.
      const sx = Math.min(
        maxX,
        Math.max(0, (h[0] * cx + h[1] * cy + h[2]) / w - 0.5),
      );
      const sy = Math.min(
        maxY,
        Math.max(0, (h[3] * cx + h[4] * cy + h[5]) / w - 0.5),
      );
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * source.width + x0) * 4;
      const i10 = (y0 * source.width + x1) * 4;
      const i01 = (y1 * source.width + x0) * 4;
      const i11 = (y1 * source.width + x1) * 4;
      const out = (v * width + u) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const top =
          src[i00 + channel]! +
          (src[i10 + channel]! - src[i00 + channel]!) * fx;
        const bottom =
          src[i01 + channel]! +
          (src[i11 + channel]! - src[i01 + channel]!) * fx;
        data[out + channel] = top + (bottom - top) * fy;
      }
    }
  }
  return { data, width, height };
}
