/**
 * Live document detection for the sheet camera. Works on a small luminance
 * frame (≈160 px wide): a paper sheet is the largest bright, roughly
 * quadrilateral region against a darker background. Pure, so it runs in tests
 * without a camera or canvas.
 */

export type Point = { x: number; y: number };

/** Corners in frame-relative coordinates (0–1): top-left, top-right, bottom-right, bottom-left. */
export type DocumentQuad = readonly [Point, Point, Point, Point];

/** Width the camera frame is scaled down to before detection. */
export const DETECTION_WIDTH = 160;

/** The sheet must cover at least this share of the frame to count. */
const MIN_AREA_FRACTION = 0.1;
/** Above this the whole frame is bright and no sheet edge is visible. */
const MAX_AREA_FRACTION = 0.95;
/** Region pixels / quad area must stay within this of 1; rejects bright blobs that are not quadrilaterals. */
const MAX_FILL_DEVIATION = 0.15;
/** Otsu between-class separation (in luminance units) a sheet needs over its background. */
const MIN_CONTRAST = 40;

/** Rec. 601 luma of an RGBA buffer, e.g. from `getImageData`. */
export function rgbaToLuminance(rgba: ArrayLike<number>): Uint8Array {
  const luminance = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < luminance.length; i++) {
    const o = i * 4;
    luminance[i] =
      (rgba[o]! * 77 + rgba[o + 1]! * 150 + rgba[o + 2]! * 29) >> 8;
  }
  return luminance;
}

/** Otsu threshold plus the mean gap between the two classes it splits. */
function otsu(luminance: Uint8Array): { threshold: number; contrast: number } {
  const histogram = new Array<number>(256).fill(0);
  let sum = 0;
  for (const value of luminance) {
    histogram[value]!++;
    sum += value;
  }
  const total = luminance.length;
  let backgroundCount = 0;
  let backgroundSum = 0;
  let best = { threshold: 0, contrast: 0, variance: -1 };
  for (let t = 0; t < 256; t++) {
    backgroundCount += histogram[t]!;
    if (backgroundCount === 0) continue;
    const foregroundCount = total - backgroundCount;
    if (foregroundCount === 0) break;
    backgroundSum += t * histogram[t]!;
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (sum - backgroundSum) / foregroundCount;
    const gap = foregroundMean - backgroundMean;
    const variance = backgroundCount * foregroundCount * gap * gap;
    if (variance > best.variance)
      best = { threshold: t, contrast: gap, variance };
  }
  return { threshold: best.threshold, contrast: best.contrast };
}

/** Pixel indices of the largest 4-connected region where `mask` is set. */
function largestRegion(
  mask: Uint8Array,
  width: number,
  height: number,
): Int32Array {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best = new Int32Array(0);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        index >= width ? index - width : -1,
        index < width * (height - 1) ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || !mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (tail > best.length) best = queue.slice(0, tail);
  }
  return best;
}

function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function isConvex(points: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Finds the document in a luminance frame, or `null` when no sheet is visible
 * (too little contrast, too small, filling the whole frame, or not four-cornered).
 */
export function detectDocumentQuad(
  luminance: Uint8Array,
  width: number,
  height: number,
): DocumentQuad | null {
  const { threshold, contrast } = otsu(luminance);
  if (contrast < MIN_CONTRAST) return null;

  const mask = new Uint8Array(luminance.length);
  for (let i = 0; i < luminance.length; i++) {
    mask[i] = luminance[i]! > threshold ? 1 : 0;
  }
  const region = largestRegion(mask, width, height);
  const frameArea = width * height;
  const regionFraction = region.length / frameArea;
  if (
    regionFraction < MIN_AREA_FRACTION ||
    regionFraction > MAX_AREA_FRACTION
  ) {
    return null;
  }

  // Extreme points along the diagonals are the corners of a sheet held
  // roughly upright (up to about ±40° of rotation).
  let topLeft = { x: 0, y: 0, score: Infinity };
  let bottomRight = { x: 0, y: 0, score: -Infinity };
  let topRight = { x: 0, y: 0, score: -Infinity };
  let bottomLeft = { x: 0, y: 0, score: Infinity };
  for (const index of region) {
    const x = index % width;
    const y = (index - x) / width;
    if (x + y < topLeft.score) topLeft = { x, y, score: x + y };
    if (x + y > bottomRight.score) bottomRight = { x, y, score: x + y };
    if (x - y > topRight.score) topRight = { x, y, score: x - y };
    if (x - y < bottomLeft.score) bottomLeft = { x, y, score: x - y };
  }
  // Pixel centres → pixel edges, so a full sheet spans its whole extent.
  const corners: Point[] = [
    { x: topLeft.x, y: topLeft.y },
    { x: topRight.x + 1, y: topRight.y },
    { x: bottomRight.x + 1, y: bottomRight.y + 1 },
    { x: bottomLeft.x, y: bottomLeft.y + 1 },
  ];
  if (!isConvex(corners)) return null;
  const quadArea = polygonArea(corners);
  if (quadArea / frameArea < MIN_AREA_FRACTION) return null;
  if (Math.abs(region.length / quadArea - 1) > MAX_FILL_DEVIATION) return null;

  const [a, b, c, d] = corners.map((point) => ({
    x: point.x / width,
    y: point.y / height,
  }));
  return [a!, b!, c!, d!];
}

/** Outline shown in the preview; survives a few missed frames so it does not flicker. */
export type QuadTracker = { quad: DocumentQuad | null; misses: number };

export const initialQuadTracker: QuadTracker = { quad: null, misses: 0 };

/** Frames without a detection before the outline disappears (≈0.6 s at 10 fps). */
const MAX_MISSES = 6;
/** Weight of the new detection when smoothing corner movement. */
const SMOOTHING = 0.5;

export function trackQuad(
  tracker: QuadTracker,
  detected: DocumentQuad | null,
): QuadTracker {
  if (!detected) {
    const misses = tracker.misses + 1;
    return misses > MAX_MISSES
      ? { quad: null, misses }
      : { quad: tracker.quad, misses };
  }
  if (!tracker.quad) return { quad: detected, misses: 0 };
  const previous = tracker.quad;
  const [a, b, c, d] = detected.map((point, index) => ({
    x: previous[index]!.x + (point.x - previous[index]!.x) * SMOOTHING,
    y: previous[index]!.y + (point.y - previous[index]!.y) * SMOOTHING,
  }));
  return { quad: [a!, b!, c!, d!], misses: 0 };
}

export type CameraErrorKind =
  | "unsupported"
  | "denied"
  | "notFound"
  | "busy"
  | "failed";

/** Maps a `getUserMedia` rejection to the message the user should see. */
export function cameraErrorKind(error: unknown): CameraErrorKind {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "notFound";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    case "NotSupportedError":
      return "unsupported";
    default:
      return "failed";
  }
}

/** Live preview needs a secure context (HTTPS or localhost) and `getUserMedia`. */
export function liveCameraSupported(
  scope: {
    isSecureContext?: boolean;
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  } = globalThis,
): boolean {
  return (
    scope.isSecureContext !== false &&
    typeof scope.navigator?.mediaDevices?.getUserMedia === "function"
  );
}
