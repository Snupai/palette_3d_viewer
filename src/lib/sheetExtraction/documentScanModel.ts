/**
 * Pure geometry for the sheet-photo document scan: picks the paper quad from
 * contour candidates, orders its corners, and sizes the flattened output.
 * Kept free of OpenCV so it can be unit-tested without the wasm module.
 */

export type Point = { x: number; y: number };

/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

/** Smallest paper area, as a share of the photo, that counts as a detection. */
export const MIN_DOCUMENT_AREA_SHARE = 0.15;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Orders four arbitrary corners clockwise from the top-left using the classic
 * sum/difference rule: top-left has the smallest x + y, bottom-right the
 * largest, top-right the smallest y − x, bottom-left the largest.
 */
export function orderQuadCorners(points: readonly Point[]): Quad {
  if (points.length !== 4) {
    throw new Error(`Expected 4 corners, got ${points.length}.`);
  }
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const topLeft = bySum[0]!;
  const bottomRight = bySum[3]!;
  const rest = points.filter((p) => p !== topLeft && p !== bottomRight);
  const byDiff = rest.sort((a, b) => a.y - a.x - (b.y - b.x));
  return [topLeft, byDiff[0]!, bottomRight, byDiff[1]!];
}

/** Shoelace area of a polygon in pixel². */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Output size of the flattened sheet: the longer of each opposite edge pair,
 * rounded to whole pixels, so no part of the paper is downsampled.
 */
export function flattenedSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(
      1,
      Math.round(Math.max(distance(tl, tr), distance(bl, br))),
    ),
    height: Math.max(
      1,
      Math.round(Math.max(distance(tl, bl), distance(tr, br))),
    ),
  };
}

/**
 * Chooses the paper among polygon candidates: the largest convex quadrilateral
 * covering at least {@link MIN_DOCUMENT_AREA_SHARE} of the photo.
 */
export function pickDocumentQuad(
  candidates: readonly { points: readonly Point[]; convex: boolean }[],
  imageWidth: number,
  imageHeight: number,
): Quad | null {
  const minArea = imageWidth * imageHeight * MIN_DOCUMENT_AREA_SHARE;
  let best: { quad: Quad; area: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.points.length !== 4 || !candidate.convex) continue;
    const area = polygonArea(candidate.points);
    if (area < minArea) continue;
    if (best === null || area > best.area) {
      best = { quad: orderQuadCorners(candidate.points), area };
    }
  }
  return best?.quad ?? null;
}
