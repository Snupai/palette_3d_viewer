/**
 * Edge-based sheet detection for the sheet camera. The brightness detector in
 * `documentCameraModel.ts` needs a sheet that is clearly brighter than
 * everything around it; on a light desk or a grey floor the sheet is only a
 * little brighter, but its four sides are still straight edges. This finds
 * straight edges with a gradient-oriented Hough transform and picks the four
 * that best outline a sheet. Pure, so it runs in tests without a camera.
 */
import type { Point } from "~/features/project/documentCameraModel";

/** Gradient (3×3 Sobel on a blurred frame) an edge pixel needs; ≈ a step of 6 grey levels. */
const MIN_GRADIENT = 16;
/** Angle bins over 180°. */
const THETA_BINS = 180;
/** An edge pixel votes for lines within this many degrees of its gradient direction. */
const VOTE_SPREAD = 6;
/** Strongest lines kept from the Hough accumulator. */
const MAX_LINES = 16;
/** Votes a line needs, as a share of the shorter frame side. */
const MIN_LINE_VOTES = 0.15;
/** Opposite sides may differ by this much in angle (perspective). */
const MAX_OPPOSITE_ANGLE = (30 * Math.PI) / 180;
/** Adjacent sides must meet at least at this angle. */
const MIN_CORNER_ANGLE = (50 * Math.PI) / 180;
/** Share of each side that must lie on a matching edge. */
const MIN_SIDE_SUPPORT = 0.75;
/**
 * Share of each third of a side that must lie on an edge. A line that runs on
 * past the sheet's corner (a plank joint, the table edge) fails at that end.
 */
const MIN_THIRD_SUPPORT = 0.6;
/** Mean luminance step from inside to outside every side; paper is the brighter one. */
const MIN_SIDE_CONTRAST = 8;
/** Distance in pixels from a side at which inside and outside are sampled. */
const CONTRAST_OFFSET = 3;
/** Edge orientation must match the side within this angle. */
const MAX_ORIENTATION_ERROR = (20 * Math.PI) / 180;

type Line = { theta: number; rho: number; votes: number };

type Gradients = {
  magnitude: Float32Array;
  /** Gradient direction folded to [0, π). */
  direction: Float32Array;
  /** Thinned edge pixels (non-maximum suppressed, above `MIN_GRADIENT`). */
  edge: Uint8Array;
  blurred: Float32Array;
};

function gradients(
  luminance: Uint8Array,
  width: number,
  height: number,
): Gradients {
  // 3×3 box blur twice: text and wood grain fade, sheet edges stay.
  let blurred = new Float32Array(luminance);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(blurred.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += blurred[yy * width + xx]!;
            count++;
          }
        }
        next[y * width + x] = sum / count;
      }
    }
    blurred = next;
  }
  const magnitude = new Float32Array(width * height);
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const direction = new Float32Array(width * height);
  const at = (x: number, y: number) => blurred[y * width + x]!;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const sx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x - 1, y) -
        at(x - 1, y + 1);
      const sy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1);
      const index = y * width + x;
      gx[index] = sx;
      gy[index] = sy;
      magnitude[index] = Math.hypot(sx, sy);
      let angle = Math.atan2(sy, sx);
      if (angle < 0) angle += Math.PI;
      if (angle >= Math.PI) angle -= Math.PI;
      direction[index] = angle;
    }
  }
  // Keep only the ridge of each edge so a line gets one vote per pixel along it.
  const edge = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const value = magnitude[index]!;
      if (value < MIN_GRADIENT) continue;
      const stepX = Math.round(gx[index]! / value);
      const stepY = Math.round(gy[index]! / value);
      const ahead = magnitude[(y + stepY) * width + x + stepX]!;
      const behind = magnitude[(y - stepY) * width + x - stepX]!;
      if (value >= ahead && value >= behind) edge[index] = 1;
    }
  }
  return { magnitude, direction, edge, blurred };
}

/** Lines x·cosθ + y·sinθ = ρ with the most votes, strongest first. */
function houghLines(
  { edge, direction }: Gradients,
  width: number,
  height: number,
): Line[] {
  const maxRho = Math.ceil(Math.hypot(width, height));
  const rhoBins = 2 * maxRho + 1;
  const votes = new Float32Array(THETA_BINS * rhoBins);
  const cos = new Float32Array(THETA_BINS);
  const sin = new Float32Array(THETA_BINS);
  for (let bin = 0; bin < THETA_BINS; bin++) {
    cos[bin] = Math.cos((bin * Math.PI) / THETA_BINS);
    sin[bin] = Math.sin((bin * Math.PI) / THETA_BINS);
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      if (!edge[index]) continue;
      const center = Math.round((direction[index]! / Math.PI) * THETA_BINS);
      for (let offset = -VOTE_SPREAD; offset <= VOTE_SPREAD; offset++) {
        const bin = (center + offset + THETA_BINS) % THETA_BINS;
        // Pixel centres, so a sheet side on a pixel boundary lands on one ρ.
        const rho = Math.round((x + 0.5) * cos[bin]! + (y + 0.5) * sin[bin]!);
        votes[bin * rhoBins + rho + maxRho]! += 1;
      }
    }
  }
  const minVotes = MIN_LINE_VOTES * Math.min(width, height);
  const lines: Line[] = [];
  while (lines.length < MAX_LINES) {
    let best = -1;
    let bestVotes = minVotes;
    for (let index = 0; index < votes.length; index++) {
      if (votes[index]! >= bestVotes) {
        // Ties resolve to the lowest index, keeping detection deterministic.
        if (votes[index]! > bestVotes || best < 0) {
          bestVotes = votes[index]!;
          best = index;
        }
      }
    }
    if (best < 0) break;
    const bin = Math.floor(best / rhoBins);
    const rho = (best % rhoBins) - maxRho;
    lines.push({ theta: (bin * Math.PI) / THETA_BINS, rho, votes: bestVotes });
    // Suppress the neighbourhood, including its mirror across θ = 0/180°.
    for (let dt = -8; dt <= 8; dt++) {
      let neighbourBin = bin + dt;
      let sign = 1;
      if (neighbourBin < 0) {
        neighbourBin += THETA_BINS;
        sign = -1;
      } else if (neighbourBin >= THETA_BINS) {
        neighbourBin -= THETA_BINS;
        sign = -1;
      }
      for (let dr = -5; dr <= 5; dr++) {
        const r = sign * (rho + dr) + maxRho;
        if (r < 0 || r >= rhoBins) continue;
        votes[neighbourBin * rhoBins + r] = 0;
      }
    }
  }
  return lines;
}

/** Smallest angle between two undirected lines, 0 to π/2. */
function angleBetween(a: Line, b: Line): number {
  const difference = Math.abs(a.theta - b.theta) % Math.PI;
  return Math.min(difference, Math.PI - difference);
}

function intersect(a: Line, b: Line): Point | null {
  const determinant =
    Math.cos(a.theta) * Math.sin(b.theta) -
    Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(determinant) < 1e-6) return null;
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / determinant,
    y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / determinant,
  };
}

/** Clockwise in image coordinates, starting top-left (smallest x + y). */
function orderCorners(points: Point[]): Point[] {
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i]!.x + sorted[i]!.y < sorted[start]!.x + sorted[start]!.y) {
      start = i;
    }
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]!);
}

function area(points: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function convex(points: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % 4]!;
    const c = points[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * How well one side of a candidate sheet sits on an edge: the share of its
 * length with a matching edge pixel nearby, and the mean step in brightness
 * from inside to outside.
 */
function sideScore(
  grads: Gradients,
  width: number,
  height: number,
  a: Point,
  b: Point,
): { support: number; weakestThird: number; contrast: number } {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  // Outward normal of a clockwise side in image coordinates.
  const nx = dy;
  const ny = -dx;
  let normalAngle = Math.atan2(ny, nx);
  if (normalAngle < 0) normalAngle += Math.PI;
  if (normalAngle >= Math.PI) normalAngle -= Math.PI;
  const sample = (x: number, y: number) =>
    grads.blurred[
      Math.min(height - 1, Math.max(0, Math.round(y - 0.5))) * width +
        Math.min(width - 1, Math.max(0, Math.round(x - 0.5)))
    ]!;
  const samples = 24;
  let supported = 0;
  const thirds = [0, 0, 0];
  let contrast = 0;
  for (let step = 0; step < samples; step++) {
    const t = 0.08 + (0.84 * step) / (samples - 1);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    contrast +=
      sample(x - nx * CONTRAST_OFFSET, y - ny * CONTRAST_OFFSET) -
      sample(x + nx * CONTRAST_OFFSET, y + ny * CONTRAST_OFFSET);
    for (let k = -2; k <= 2; k++) {
      const px = Math.floor(x + nx * k * 0.5);
      const py = Math.floor(y + ny * k * 0.5);
      if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) continue;
      const index = py * width + px;
      if (!grads.edge[index]) continue;
      const error = Math.abs(grads.direction[index]! - normalAngle);
      if (Math.min(error, Math.PI - error) <= MAX_ORIENTATION_ERROR) {
        supported++;
        thirds[Math.floor((step * 3) / samples)]!++;
        break;
      }
    }
  }
  return {
    support: supported / samples,
    weakestThird: Math.min(...thirds) / (samples / 3),
    contrast: contrast / samples,
  };
}

/** Least-squares fit of each side to its edge pixels, then re-intersected. */
function fitCorners(
  grads: Gradients,
  width: number,
  height: number,
  corners: Point[],
): Point[] {
  const fitted: Line[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / length;
    const ny = -(b.x - a.x) / length;
    const rho = a.x * nx + a.y * ny;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let count = 0;
    const minX = Math.max(1, Math.floor(Math.min(a.x, b.x)) - 2);
    const maxX = Math.min(width - 2, Math.ceil(Math.max(a.x, b.x)) + 2);
    const minY = Math.max(1, Math.floor(Math.min(a.y, b.y)) - 2);
    const maxY = Math.min(height - 2, Math.ceil(Math.max(a.y, b.y)) + 2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!grads.edge[y * width + x]) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        if (Math.abs(px * nx + py * ny - rho) > 1.5) continue;
        // Stay off the corners, where the neighbouring side's pixels sit.
        const along =
          ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) /
          (length * length);
        if (along < 0.1 || along > 0.9) continue;
        sx += px;
        sy += py;
        sxx += px * px;
        sxy += px * py;
        syy += py * py;
        count++;
      }
    }
    if (count < 6) return corners;
    const cx = sx / count;
    const cy = sy / count;
    const angle =
      0.5 *
      Math.atan2(
        2 * (sxy / count - cx * cy),
        sxx / count - cx * cx - (syy / count - cy * cy),
      );
    // Line direction is `angle`; its normal is angle + 90°.
    const theta = angle + Math.PI / 2;
    fitted.push({
      theta,
      rho: cx * Math.cos(theta) + cy * Math.sin(theta),
      votes: count,
    });
  }
  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const corner = intersect(fitted[(i + 3) % 4]!, fitted[i]!);
    if (
      !corner ||
      Math.hypot(corner.x - corners[i]!.x, corner.y - corners[i]!.y) > 3
    ) {
      return corners;
    }
    refined.push(corner);
  }
  return convex(refined) ? refined : corners;
}

/**
 * Corners (pixel coordinates, clockwise from top-left) of the sheet outlined
 * by four straight edges, or null when no four edges form one.
 */
export function detectSheetByEdges(
  luminance: Uint8Array,
  width: number,
  height: number,
  minAreaFraction: number,
): Point[] | null {
  const grads = gradients(luminance, width, height);
  const lines = houghLines(grads, width, height);
  const minSeparation = 0.2 * Math.min(width, height);
  const pairs: [Line, Line][] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (angleBetween(a, b) > MAX_OPPOSITE_ANGLE) continue;
      // Distance between the lines at the frame centre.
      const cx = width / 2;
      const cy = height / 2;
      const da = cx * Math.cos(a.theta) + cy * Math.sin(a.theta) - a.rho;
      const db = cx * Math.cos(b.theta) + cy * Math.sin(b.theta) - b.rho;
      const sameSide =
        Math.cos(a.theta) * Math.cos(b.theta) +
          Math.sin(a.theta) * Math.sin(b.theta) >
        0;
      const separation = Math.abs(sameSide ? da - db : da + db);
      if (separation < minSeparation) continue;
      pairs.push([a, b]);
    }
  }
  let best: { corners: Point[]; score: number } | null = null;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i]!;
      const [c, d] = pairs[j]!;
      if (
        angleBetween(a, c) < MIN_CORNER_ANGLE ||
        angleBetween(a, d) < MIN_CORNER_ANGLE ||
        angleBetween(b, c) < MIN_CORNER_ANGLE ||
        angleBetween(b, d) < MIN_CORNER_ANGLE
      ) {
        continue;
      }
      const points = [
        intersect(a, c),
        intersect(a, d),
        intersect(b, c),
        intersect(b, d),
      ];
      if (points.some((point) => !point)) continue;
      // A corner on or past the frame edge means the sheet is cut off.
      if (
        points.some(
          (point) =>
            point!.x < 1 ||
            point!.y < 1 ||
            point!.x > width - 1 ||
            point!.y > height - 1,
        )
      ) {
        continue;
      }
      const corners = orderCorners(points as Point[]);
      if (!convex(corners)) continue;
      if (area(corners) / (width * height) < minAreaFraction) continue;
      let score = 0;
      let accepted = true;
      for (let side = 0; side < 4; side++) {
        const p = corners[side]!;
        const q = corners[(side + 1) % 4]!;
        const { support, weakestThird, contrast } = sideScore(
          grads,
          width,
          height,
          p,
          q,
        );
        if (
          support < MIN_SIDE_SUPPORT ||
          weakestThird < MIN_THIRD_SUPPORT ||
          contrast < MIN_SIDE_CONTRAST
        ) {
          accepted = false;
          break;
        }
        score += support * Math.hypot(q.x - p.x, q.y - p.y);
      }
      if (!accepted) continue;
      if (!best || score > best.score) best = { corners, score };
    }
  }
  return best ? fitCorners(grads, width, height, best.corners) : null;
}
