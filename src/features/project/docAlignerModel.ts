/**
 * Pre- and post-processing for the DocAligner `lcnet100` heatmap model
 * (DocsaidLab, Apache-2.0; see `public/models/docaligner/NOTICE.md`).
 *
 * Mirrors `docaligner/heatmap_reg/infer.py` of the official repository:
 *
 * - preprocess: `cv2.resize(img, (256, 256), INTER_LINEAR)` of a BGR image,
 *   then HWC → CHW float32 divided by 255 (no mean/std);
 * - postprocess: per corner heatmap, `cv2.resize` back to the image size,
 *   values below 0.3 set to 0, `uint8(x * 255)`, Otsu binarisation, and the
 *   centroid of the largest blob. Heatmaps come in the order top-left,
 *   top-right, bottom-right, bottom-left.
 *
 * One deliberate deviation: the frame is first padded to a square with grey
 * (114) instead of being stretched to 256 × 256. A 16:9 portrait camera frame
 * stretched to a square is distorted 1.78×, and the model then found no
 * corners at all on real pallet-sheet photos; padded, it found them.
 *
 * Pure, so it runs in tests without onnxruntime, a canvas or a worker.
 */
import type {
  DocumentQuad,
  Point,
} from "~/features/project/documentCameraModel";

/** Model input is 256 × 256. */
export const DOCALIGNER_INPUT_SIZE = 256;
/** Grey used to pad the frame to a square. */
export const DOCALIGNER_PAD_VALUE = 114;
/** Heatmap values below this are background (official `heatmap_threshold`). */
export const DOCALIGNER_HEATMAP_THRESHOLD = 0.3;
/**
 * Side the heatmaps are scaled to before decoding. The official code scales
 * them to the full (padded) image; 512 keeps a live frame cheap and moves the
 * decoded corners by well under a pixel of the 128-px heatmap.
 */
export const DOCALIGNER_DECODE_SIZE = 512;
/** The sheet must cover at least this share of the frame (as in classic detection). */
const MIN_AREA_FRACTION = 0.1;
/** Corners may sit this far (share of the frame) outside it before the result is dropped. */
const OUTSIDE_TOLERANCE = 0.02;

/** Where the frame sits inside the padded square. */
export type Letterbox = { side: number; offsetX: number; offsetY: number };

export function letterbox(width: number, height: number): Letterbox {
  const side = Math.max(width, height);
  return {
    side,
    offsetX: Math.floor((side - width) / 2),
    offsetY: Math.floor((side - height) / 2),
  };
}

const COEF_BITS = 11;
const COEF_SCALE = 1 << COEF_BITS;

/** cvRound: nearest, ties to even. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** One axis of `cv2.resize(INTER_LINEAR)`: source index and fixed-point weights per output pixel. */
function linearTaps(sourceSize: number, targetSize: number) {
  const scale = sourceSize / targetSize;
  const index = new Int32Array(targetSize);
  const weight0 = new Int32Array(targetSize);
  const weight1 = new Int32Array(targetSize);
  for (let d = 0; d < targetSize; d++) {
    let f = Math.fround((d + 0.5) * scale - 0.5);
    let s = Math.floor(f);
    f = Math.fround(f - s);
    if (s < 0) {
      f = 0;
      s = 0;
    }
    if (s >= sourceSize - 1) {
      f = 0;
      s = sourceSize - 1;
    }
    index[d] = s;
    weight0[d] = roundHalfEven(Math.fround(1 - f) * COEF_SCALE);
    weight1[d] = roundHalfEven(f * COEF_SCALE);
  }
  return { index, weight0, weight1 };
}

/**
 * Model input from an RGBA frame (e.g. `getImageData`): padded to a square,
 * resized like `cv2.resize(INTER_LINEAR)` on 8-bit data, BGR, CHW, ÷ 255.
 */
export function frameToTensor(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Float32Array {
  const size = DOCALIGNER_INPUT_SIZE;
  const { side, offsetX, offsetY } = letterbox(width, height);
  const xs = linearTaps(side, size);
  const ys = linearTaps(side, size);
  const pad = DOCALIGNER_PAD_VALUE;
  // Byte offset of each horizontal tap within a frame row, −1 in the padding.
  const tap0 = new Int32Array(size);
  const tap1 = new Int32Array(size);
  for (let x = 0; x < size; x++) {
    const s0 = xs.index[x]! - offsetX;
    const s1 = Math.min(side - 1, xs.index[x]! + 1) - offsetX;
    tap0[x] = s0 >= 0 && s0 < width ? s0 * 4 : -1;
    tap1[x] = s1 >= 0 && s1 < width ? s1 * 4 : -1;
  }
  // Horizontal pass of one padded row (fixed point, scale 2048), R G B
  // interleaved. Source rows only advance, so two buffers suffice.
  const horizontal = (y: number, row: Int32Array) => {
    const sy = y - offsetY;
    const base = sy >= 0 && sy < height ? sy * width * 4 : -1;
    for (let x = 0; x < size; x++) {
      const w0 = xs.weight0[x]!;
      const w1 = xs.weight1[x]!;
      const o0 = base < 0 || tap0[x]! < 0 ? -1 : base + tap0[x]!;
      const o1 = base < 0 || tap1[x]! < 0 ? -1 : base + tap1[x]!;
      for (let c = 0; c < 3; c++) {
        row[x * 3 + c] =
          (o0 < 0 ? pad : rgba[o0 + c]!) * w0 +
          (o1 < 0 ? pad : rgba[o1 + c]!) * w1;
      }
    }
  };
  const rowA = new Int32Array(size * 3);
  const rowB = new Int32Array(size * 3);
  let rowAY = -1;
  let rowBY = -1;
  const rowFor = (y: number) => {
    if (y === rowAY) return rowA;
    if (y === rowBY) return rowB;
    // Recycle the buffer holding the lower row; rows only move down.
    if (rowAY < rowBY) {
      horizontal(y, rowA);
      rowAY = y;
      return rowA;
    }
    horizontal(y, rowB);
    rowBY = y;
    return rowB;
  };
  const scale = new Float32Array(256);
  for (let v = 0; v < 256; v++) scale[v] = v / 255;
  const tensor = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    const s = ys.index[y]!;
    const s1 = Math.min(side - 1, s + 1);
    // Fetch both rows before either can be recycled.
    const row0 = rowFor(s);
    const row1 = s1 === s ? row0 : rowFor(s1);
    const b0 = ys.weight0[y]!;
    const b1 = ys.weight1[y]!;
    const out = y * size;
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        // SIMD path of cv2's vertical pass: 16-bit high products, then round.
        const value =
          (((b0 * (row0[x * 3 + c]! >> 4)) >> 16) +
            ((b1 * (row1[x * 3 + c]! >> 4)) >> 16) +
            2) >>
          2;
        // RGBA channel c → BGR plane 2 − c.
        tensor[(2 - c) * plane + out + x] =
          scale[value < 0 ? 0 : value > 255 ? 255 : value]!;
      }
    }
  }
  return tensor;
}

/** `cv2.resize(INTER_LINEAR)` of a single-channel float image. */
export function resizeLinearFloat(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const axis = (sourceSize: number, targetSize: number) => {
    const scale = sourceSize / targetSize;
    const index = new Int32Array(targetSize);
    const fraction = new Float32Array(targetSize);
    for (let d = 0; d < targetSize; d++) {
      let f = Math.fround((d + 0.5) * scale - 0.5);
      let s = Math.floor(f);
      f = Math.fround(f - s);
      if (s < 0) {
        f = 0;
        s = 0;
      }
      if (s >= sourceSize - 1) {
        f = 0;
        s = sourceSize - 1;
      }
      index[d] = s;
      fraction[d] = f;
    }
    return { index, fraction };
  };
  const xs = axis(sourceWidth, targetWidth);
  const ys = axis(sourceHeight, targetHeight);
  const rows = new Float32Array(sourceHeight * targetWidth);
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const s = xs.index[x]!;
      const f = xs.fraction[x]!;
      const s1 = Math.min(sourceWidth - 1, s + 1);
      rows[y * targetWidth + x] =
        source[y * sourceWidth + s]! * (1 - f) +
        source[y * sourceWidth + s1]! * f;
    }
  }
  const target = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const s = ys.index[y]!;
    const f = ys.fraction[y]!;
    const s1 = Math.min(sourceHeight - 1, s + 1);
    for (let x = 0; x < targetWidth; x++) {
      target[y * targetWidth + x] =
        rows[s * targetWidth + x]! * (1 - f) + rows[s1 * targetWidth + x]! * f;
    }
  }
  return target;
}

/**
 * `cv2.threshold(..., THRESH_OTSU)` threshold of 8-bit values; a literal port
 * of OpenCV's `getThreshVal_Otsu_8u`, quirks included.
 */
export function otsuThreshold(values: Uint8Array): number {
  const FLT_EPSILON = 1.1920928955078125e-7;
  const histogram = new Float64Array(256);
  for (const value of values) histogram[value]!++;
  const scale = 1 / values.length;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * histogram[i]!;
  mu *= scale;
  let mu1 = 0;
  let q1 = 0;
  let maxSigma = 0;
  let threshold = 0;
  for (let i = 0; i < 256; i++) {
    const p = histogram[i]! * scale;
    mu1 *= q1;
    q1 += p;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < FLT_EPSILON || Math.max(q1, q2) > 1 - FLT_EPSILON) {
      continue;
    }
    mu1 = (mu1 + i * p) / q1;
    const mu2 = (mu - q1 * mu1) / q2;
    const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
    if (sigma > maxSigma) {
      maxSigma = sigma;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * Centroid (pixel coordinates) of the largest 8-connected blob, or null.
 * Single-pixel blobs are ignored, as single-point contours are upstream.
 */
export function largestBlobCentroid(
  mask: Uint8Array,
  width: number,
  height: number,
): Point | null {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let best: { count: number; x: number; y: number } | null = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let sumX = 0;
    let sumY = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      const x = index % width;
      const y = (index - x) / width;
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail < 2) continue;
    // Ties keep the first blob in scan order, so decoding is deterministic.
    if (!best || tail > best.count) {
      best = { count: tail, x: sumX / tail, y: sumY / tail };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Corner points (pixel coordinates of a `size` × `size` image) from the
 * model's heatmaps, in heatmap order. Missing corners are null.
 */
export function decodeHeatmaps(
  heatmaps: Float32Array,
  heatmapSize: number,
  size = DOCALIGNER_DECODE_SIZE,
): (Point | null)[] {
  const plane = heatmapSize * heatmapSize;
  const corners: (Point | null)[] = [];
  for (let channel = 0; channel < 4; channel++) {
    const scaled = resizeLinearFloat(
      heatmaps.subarray(channel * plane, (channel + 1) * plane),
      heatmapSize,
      heatmapSize,
      size,
      size,
    );
    const bytes = new Uint8Array(scaled.length);
    for (let i = 0; i < scaled.length; i++) {
      const value = scaled[i]!;
      // `pred[pred < t] = 0; np.uint8(pred * 255)`: truncation, not rounding.
      bytes[i] =
        value < DOCALIGNER_HEATMAP_THRESHOLD
          ? 0
          : Math.min(255, Math.trunc(value * 255));
    }
    const threshold = otsuThreshold(bytes);
    const mask = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      mask[i] = bytes[i]! > threshold ? 1 : 0;
    }
    corners.push(largestBlobCentroid(mask, size, size));
  }
  return corners;
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
 * Sheet outline in frame-relative coordinates (0–1, as the classic detector
 * returns), or null when a corner is missing or the four do not form a
 * plausible sheet (not convex, too small, or outside the frame).
 */
export function heatmapsToQuad(
  heatmaps: Float32Array,
  heatmapSize: number,
  frameWidth: number,
  frameHeight: number,
  size = DOCALIGNER_DECODE_SIZE,
): DocumentQuad | null {
  const corners = decodeHeatmaps(heatmaps, heatmapSize, size);
  if (corners.some((corner) => !corner)) return null;
  const { side, offsetX, offsetY } = letterbox(frameWidth, frameHeight);
  const scale = side / size;
  const quad = (corners as Point[]).map((corner) => {
    // Pixel centre in the decode image → pixel centre in the padded square →
    // pixel edge coordinates of the frame, normalised.
    const x = (corner.x + 0.5) * scale - offsetX;
    const y = (corner.y + 0.5) * scale - offsetY;
    return { x: x / frameWidth, y: y / frameHeight };
  });
  if (
    quad.some(
      ({ x, y }) =>
        x < -OUTSIDE_TOLERANCE ||
        y < -OUTSIDE_TOLERANCE ||
        x > 1 + OUTSIDE_TOLERANCE ||
        y > 1 + OUTSIDE_TOLERANCE,
    )
  ) {
    return null;
  }
  if (!isConvex(quad) || polygonArea(quad) < MIN_AREA_FRACTION) return null;
  const [a, b, c, d] = quad.map(({ x, y }) => ({
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  }));
  return [a!, b!, c!, d!];
}
