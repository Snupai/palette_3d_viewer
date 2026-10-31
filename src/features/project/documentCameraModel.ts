/**
 * Live document detection for the sheet camera. Works on a small luminance
 * frame (≈160 px wide): a paper sheet is a bright, four-cornered region that
 * stands out from what surrounds it. Pure, so it runs in tests without a
 * camera or canvas.
 */

export type Point = { x: number; y: number };

/** Corners in frame-relative coordinates (0–1): top-left, top-right, bottom-right, bottom-left. */
export type DocumentQuad = readonly [Point, Point, Point, Point];

/** Width the camera frame is scaled down to before detection. */
export const DETECTION_WIDTH = 160;

/** The sheet must cover at least this share of the frame to count. */
const MIN_AREA_FRACTION = 0.1;
/** Share of the quad the region must cover; text and windows leave holes. */
const MIN_INSIDE_FILL = 0.75;
/** Region pixels outside the quad, relative to its area; rejects discs and blobs. */
const MAX_OUTSIDE_FILL = 0.1;
/** Luminance step between the sheet edge and just outside it. */
const MIN_EDGE_CONTRAST = 30;
/** Brightness cut-offs tried, brightest first: paper is not always the brightest thing in view. */
const THRESHOLDS = Array.from({ length: 26 }, (_, index) => 240 - index * 8);
/** Distance in pixels from the edge at which inside and outside are sampled. */
const EDGE_SAMPLE_OFFSET = 2;

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

/** Corners in image coordinates run clockwise, so inside is right of every edge. */
function insideQuad(corners: readonly Point[], x: number, y: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/** Mean luminance step from just inside to just outside the quad's edges. */
function edgeContrast(
  luminance: Uint8Array,
  width: number,
  height: number,
  corners: readonly Point[],
): number {
  const sample = (x: number, y: number) =>
    luminance[
      Math.min(height - 1, Math.max(0, Math.floor(y))) * width +
        Math.min(width - 1, Math.max(0, Math.floor(x)))
    ]!;
  let total = 0;
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    // Outward normal of a clockwise edge in image coordinates.
    const nx = ((b.y - a.y) / length) * EDGE_SAMPLE_OFFSET;
    const ny = (-(b.x - a.x) / length) * EDGE_SAMPLE_OFFSET;
    for (let step = 1; step < 10; step++) {
      const x = a.x + ((b.x - a.x) * step) / 10;
      const y = a.y + ((b.y - a.y) * step) / 10;
      total += sample(x - nx, y - ny) - sample(x + nx, y + ny);
      count++;
    }
  }
  return total / count;
}

/** How far (pixels) each side may move when it is snapped to the strongest edge. */
const REFINE_SEARCH = 12;

/**
 * Snaps each side to the strongest bright→dark step along its middle half and
 * intersects the fitted lines. Uneven light can clip a corner at any single
 * brightness cut-off; the sides themselves stay straight.
 */
function refineCorners(
  luminance: Uint8Array,
  width: number,
  height: number,
  corners: readonly Point[],
): Point[] {
  const sample = (x: number, y: number) =>
    luminance[
      Math.min(height - 1, Math.max(0, Math.floor(y))) * width +
        Math.min(width - 1, Math.max(0, Math.floor(x)))
    ]!;
  const lines: { point: Point; direction: Point }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    // Outward normal of a clockwise edge in image coordinates.
    const nx = dy;
    const ny = -dx;
    const points: Point[] = [];
    for (let step = 0; step <= 16; step++) {
      const t = 0.25 + (0.5 * step) / 16;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      let bestStep = -Infinity;
      let bestOffset = 0;
      for (let k = -REFINE_SEARCH; k <= REFINE_SEARCH; k++) {
        // Pixel just inside vs just outside a boundary at offset k.
        const value =
          sample(x + nx * (k - 0.5), y + ny * (k - 0.5)) -
          sample(x + nx * (k + 0.5), y + ny * (k + 0.5));
        if (value > bestStep) {
          bestStep = value;
          bestOffset = k;
        }
      }
      if (bestStep >= MIN_EDGE_CONTRAST) {
        points.push({ x: x + nx * bestOffset, y: y + ny * bestOffset });
      }
    }
    if (points.length < 6) return [...corners];
    // Least-squares line: centroid plus principal direction.
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const point of points) {
      sxx += (point.x - cx) ** 2;
      sxy += (point.x - cx) * (point.y - cy);
      syy += (point.y - cy) ** 2;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({
      point: { x: cx, y: cy },
      direction: { x: Math.cos(angle), y: Math.sin(angle) },
    });
  }
  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i joins the side ending there (i − 1) and the side starting there (i).
    const p = lines[(i + 3) % 4]!;
    const q = lines[i]!;
    const cross = p.direction.x * q.direction.y - p.direction.y * q.direction.x;
    if (Math.abs(cross) < 0.2) return [...corners];
    const t =
      ((q.point.x - p.point.x) * q.direction.y -
        (q.point.y - p.point.y) * q.direction.x) /
      cross;
    const corner = {
      x: p.point.x + p.direction.x * t,
      y: p.point.y + p.direction.y * t,
    };
    const rough = corners[i]!;
    if (
      Math.hypot(corner.x - rough.x, corner.y - rough.y) > REFINE_SEARCH * 2 ||
      corner.x < 0 ||
      corner.y < 0 ||
      corner.x > width ||
      corner.y > height
    ) {
      return [...corners];
    }
    refined.push(corner);
  }
  return isConvex(refined) ? refined : [...corners];
}

/** Quad of one bright region, or null when the region does not look like a sheet. */
function regionQuad(
  region: Int32Array,
  luminance: Uint8Array,
  width: number,
  height: number,
): Point[] | null {
  // Extreme points along the diagonals are the corners of a sheet held
  // roughly upright (up to about ±40° of rotation).
  let topLeft = { x: 0, y: 0, score: Infinity };
  let bottomRight = { x: 0, y: 0, score: -Infinity };
  let topRight = { x: 0, y: 0, score: -Infinity };
  let bottomLeft = { x: 0, y: 0, score: Infinity };
  for (const index of region) {
    const x = index % width;
    const y = (index - x) / width;
    // A region touching the frame edge is a sheet cut off by the camera.
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      return null;
    }
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
  if (quadArea / (width * height) < MIN_AREA_FRACTION) return null;
  let inside = 0;
  for (const index of region) {
    const x = index % width;
    if (insideQuad(corners, x + 0.5, (index - x) / width + 0.5)) inside++;
  }
  if (inside / quadArea < MIN_INSIDE_FILL) return null;
  if ((region.length - inside) / quadArea > MAX_OUTSIDE_FILL) return null;
  if (edgeContrast(luminance, width, height, corners) < MIN_EDGE_CONTRAST) {
    return null;
  }
  return corners;
}

/**
 * Finds the document in a luminance frame, or `null` when no sheet is visible
 * (too little contrast, too small, cut off at the frame edge, or not four-cornered).
 * Tries several brightness cut-offs, because a bright tablecloth or wall can
 * merge with the sheet at one cut-off and separate from it at a higher one;
 * the largest sheet-like region wins.
 */
export function detectDocumentQuad(
  luminance: Uint8Array,
  width: number,
  height: number,
): DocumentQuad | null {
  const minRegion = MIN_AREA_FRACTION * width * height;
  const visited = new Uint8Array(luminance.length);
  const queue = new Int32Array(luminance.length);
  let best: { corners: Point[]; area: number } | null = null;
  for (const threshold of THRESHOLDS) {
    visited.fill(0);
    for (let start = 0; start < luminance.length; start++) {
      if (visited[start] || luminance[start]! <= threshold) continue;
      // Flood-fill one 4-connected bright region.
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
          if (next < 0 || visited[next] || luminance[next]! <= threshold) {
            continue;
          }
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      if (tail < minRegion) continue;
      const corners = regionQuad(
        queue.subarray(0, tail),
        luminance,
        width,
        height,
      );
      if (!corners) continue;
      const area = polygonArea(corners);
      if (!best || area > best.area) best = { corners, area };
    }
  }
  if (!best) return null;
  const corners = refineCorners(luminance, width, height, best.corners);
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
