import type {
  SheetBox,
  SheetLayer,
} from "~/features/reporting/palletSheetFigures";
import type {
  SheetPoint,
  SheetPrimitive,
} from "~/features/reporting/sheetPrimitives";
import { PT_TO_MM, text } from "~/features/reporting/sheetPrimitives";

/**
 * Isometric drawing of a loaded pallet, in the style of the MultiPack sheet:
 * grey cartons on a light euro pallet, the top layer lifted off the stack,
 * and dimension lines for the load block, the total height and the pallet.
 *
 * World axes: x along the pallet long side, y along the short side, z up;
 * z = 0 is the pallet deck. The viewer looks from the (-x, -y, +z) corner.
 */

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

type Vec3 = { x: number; y: number; z: number };

type Solid = SheetBox & {
  shade: { top: string; left: string; right: string; edge: string };
};

const CARTON = {
  top: "#6e6e6e",
  left: "#4a4a4a",
  right: "#363636",
  edge: "#1f1f1f",
};
const PALLET = {
  top: "#ececec",
  left: "#d6d6d6",
  right: "#c2c2c2",
  edge: "#7a7a7a",
};
const SHEET = {
  top: "#f5f2e9",
  left: "#e2ddcf",
  right: "#d3cdbd",
  edge: "#8a8577",
};

/** Unscaled isometric projection; screen y grows downward. */
export function projectIso(point: Vec3): SheetPoint {
  return {
    x: (point.y - point.x) * COS30,
    y: -(point.x + point.y) * SIN30 - point.z,
  };
}

/**
 * Euro-pallet style base: three bottom boards, nine blocks, a top deck.
 * Proportions scale with the configured pallet height.
 */
export function palletSolids(pallet: {
  lengthX: number;
  widthY: number;
  height: number;
}): Solid[] {
  const board = Math.max(10, pallet.height * 0.15);
  const deck = Math.max(10, pallet.height * 0.15);
  const blockHeight = Math.max(0, pallet.height - board - deck);
  const blockX = Math.min(145, pallet.lengthX / 6);
  const blockY = Math.min(100, pallet.widthY / 6);
  const xs = [0, (pallet.lengthX - blockX) / 2, pallet.lengthX - blockX];
  const ys = [0, (pallet.widthY - blockY) / 2, pallet.widthY - blockY];
  const z0 = -pallet.height;
  const solids: Solid[] = [];
  for (const y of ys) {
    solids.push({
      min: { x: 0, y, z: z0 },
      max: { x: pallet.lengthX, y: y + blockY, z: z0 + board },
      shade: PALLET,
    });
  }
  for (const x of xs) {
    for (const y of ys) {
      solids.push({
        min: { x, y, z: z0 + board },
        max: { x: x + blockX, y: y + blockY, z: z0 + board + blockHeight },
        shade: PALLET,
      });
    }
  }
  solids.push({
    min: { x: 0, y: 0, z: -deck },
    max: { x: pallet.lengthX, y: pallet.widthY, z: 0 },
    shade: PALLET,
  });
  return solids;
}

/**
 * True when `a` lies behind `b` along one axis (farther from the viewer)
 * and must therefore be painted first.
 */
function behind(a: SheetBox, b: SheetBox): boolean {
  return (
    a.min.x >= b.max.x - 1e-6 ||
    a.min.y >= b.max.y - 1e-6 ||
    a.max.z <= b.min.z + 1e-6
  );
}

function depth(box: SheetBox): number {
  return (
    (box.min.x + box.max.x) / 2 +
    (box.min.y + box.max.y) / 2 -
    (box.min.z + box.max.z) / 2
  );
}

/**
 * Painter's order for disjoint axis-aligned boxes: a topological sort of the
 * "behind" relation, ties and any cycle broken by depth (farthest first).
 */
export function paintOrder<T extends SheetBox>(boxes: readonly T[]): T[] {
  const n = boxes.length;
  const blockers = Array.from({ length: n }, () => 0);
  const after: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ij = behind(boxes[i]!, boxes[j]!);
      const ji = behind(boxes[j]!, boxes[i]!);
      // Separated both ways means they cannot overlap on screen.
      if (ij === ji) continue;
      const [first, second] = ij ? [i, j] : [j, i];
      after[first]!.push(second);
      blockers[second]! += 1;
    }
  }
  // Ties are broken geometrically so the result never depends on input order.
  const byDepth = (a: number, b: number) => {
    const A = boxes[a]!;
    const B = boxes[b]!;
    return (
      depth(B) - depth(A) ||
      B.min.x - A.min.x ||
      B.min.y - A.min.y ||
      A.min.z - B.min.z ||
      a - b
    );
  };
  const ready = boxes.map((_, index) => index).filter((i) => blockers[i] === 0);
  const placed = new Set<number>();
  const order: T[] = [];
  while (order.length < n) {
    if (ready.length === 0) {
      // Cycle: release the farthest remaining box.
      const rest = boxes
        .map((_, index) => index)
        .filter((index) => !placed.has(index))
        .sort(byDepth);
      ready.push(rest[0]!);
    }
    ready.sort(byDepth);
    const next = ready.shift()!;
    if (placed.has(next)) continue;
    placed.add(next);
    order.push(boxes[next]!);
    for (const target of after[next]!) {
      blockers[target]! -= 1;
      if (blockers[target] === 0 && !placed.has(target)) ready.push(target);
    }
  }
  return order;
}

type Transform = (point: Vec3) => SheetPoint;

function solidFaces(solid: Solid, toPage: Transform): SheetPrimitive[] {
  const { min, max } = solid;
  const p = (x: number, y: number, z: number) => toPage({ x, y, z });
  const face = (points: SheetPoint[], fill: string): SheetPrimitive => ({
    kind: "polygon",
    points,
    fill,
    stroke: solid.shade.edge,
    strokeWidthMm: 0.12,
  });
  return [
    // Face toward -y (spans x).
    face(
      [
        p(min.x, min.y, min.z),
        p(max.x, min.y, min.z),
        p(max.x, min.y, max.z),
        p(min.x, min.y, max.z),
      ],
      solid.shade.left,
    ),
    // Face toward -x (spans y).
    face(
      [
        p(min.x, min.y, min.z),
        p(min.x, max.y, min.z),
        p(min.x, max.y, max.z),
        p(min.x, min.y, max.z),
      ],
      solid.shade.right,
    ),
    face(
      [
        p(min.x, min.y, max.z),
        p(max.x, min.y, max.z),
        p(max.x, max.y, max.z),
        p(min.x, max.y, max.z),
      ],
      solid.shade.top,
    ),
  ];
}

const DIM_COLOR = "#2b2b2b";
const LABEL_SIZE_PT = 8;

function add(a: SheetPoint, b: SheetPoint, scale = 1): SheetPoint {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

function unit(v: SheetPoint): SheetPoint {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

/**
 * A dimension between two page points, offset by `offsetMm` along `normal`:
 * witness lines, a dimension line with filled arrowheads, and a label
 * rotated to the line and kept readable.
 */
export function dimension(
  from: SheetPoint,
  to: SheetPoint,
  normal: SheetPoint,
  offsetMm: number,
  label: string,
): SheetPrimitive[] {
  const n = unit(normal);
  const a = add(from, n, offsetMm);
  const b = add(to, n, offsetMm);
  const along = unit({ x: b.x - a.x, y: b.y - a.y });
  const arrow = (tip: SheetPoint, direction: SheetPoint): SheetPrimitive => {
    const base = add(tip, direction, -2.2);
    return {
      kind: "polygon",
      points: [
        tip,
        add(base, { x: -direction.y, y: direction.x }, 0.7),
        add(base, { x: direction.y, y: -direction.x }, 0.7),
      ],
      fill: DIM_COLOR,
      stroke: null,
      strokeWidthMm: 0,
    };
  };
  // Keep labels readable: left-to-right, and bottom-to-top when vertical.
  let angle = (Math.atan2(along.y, along.x) * 180) / Math.PI;
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Glyphs grow along the text's "up" vector; when that points back at the
  // dimension line, move the baseline out by the cap height so the label
  // sits beside the line instead of on it.
  const radians = (angle * Math.PI) / 180;
  const up = { x: Math.sin(radians), y: -Math.cos(radians) };
  const facesOut = up.x * n.x + up.y * n.y >= 0;
  const labelOffset = facesOut ? 1.3 : 1.3 + LABEL_SIZE_PT * PT_TO_MM * 0.72;
  return [
    {
      kind: "line",
      from: add(from, n, 1),
      to: add(from, n, offsetMm + 1.5),
      stroke: DIM_COLOR,
      strokeWidthMm: 0.15,
    },
    {
      kind: "line",
      from: add(to, n, 1),
      to: add(to, n, offsetMm + 1.5),
      stroke: DIM_COLOR,
      strokeWidthMm: 0.15,
    },
    { kind: "line", from: a, to: b, stroke: DIM_COLOR, strokeWidthMm: 0.2 },
    arrow(a, { x: -along.x, y: -along.y }),
    arrow(b, along),
    text(add(mid, n, labelOffset), label, {
      sizePt: LABEL_SIZE_PT,
      anchor: "middle",
      rotateDeg: angle,
      fill: DIM_COLOR,
    }),
  ];
}

export type IsometricPalletInput = {
  layers: readonly SheetLayer[];
  pallet: { lengthX: number; widthY: number; height: number };
  /** Footprint for interlayer sheets (defaults to the pallet). */
  sheetFootprint?: { lengthX: number; widthY: number };
  frame: { x: number; y: number; width: number; height: number };
  formatMm: (value: number) => string;
};

/** Distance the top layer is lifted above the stack, in world millimetres. */
export function explodeGapMm(stackHeightMm: number): number {
  return Math.max(150, stackHeightMm * 0.22);
}

export function isometricPallet(input: IsometricPalletInput): SheetPrimitive[] {
  const { layers, pallet, frame, formatMm } = input;
  const boxes = layers.flatMap(({ boxes }) => boxes);
  if (boxes.length === 0) return [];
  const block = {
    min: {
      x: Math.min(...boxes.map(({ min }) => min.x)),
      y: Math.min(...boxes.map(({ min }) => min.y)),
      z: 0,
    },
    max: {
      x: Math.max(...boxes.map(({ max }) => max.x)),
      y: Math.max(...boxes.map(({ max }) => max.y)),
      z: Math.max(...boxes.map(({ max }) => max.z)),
    },
  };
  const exploded = layers.length > 1;
  const gap = exploded ? explodeGapMm(block.max.z) : 0;
  const topIndex = layers.length - 1;
  const lift = (box: SheetBox, layerIndex: number): SheetBox =>
    exploded && layerIndex === topIndex
      ? {
          min: { ...box.min, z: box.min.z + gap },
          max: { ...box.max, z: box.max.z + gap },
        }
      : box;

  const sheet = input.sheetFootprint ?? pallet;
  const solids: Solid[] = [
    ...palletSolids(pallet),
    ...layers.flatMap((layer) => [
      ...layer.sheetsBelow
        .map(
          (entry): Solid =>
            lift(
              {
                min: { x: 0, y: 0, z: entry.zBottom },
                max: {
                  x: sheet.lengthX,
                  y: sheet.widthY,
                  z: entry.zBottom + entry.thicknessMm,
                },
              },
              layer.index,
            ) as Solid,
        )
        .map((solid) => ({ ...solid, shade: SHEET })),
      ...layer.boxes.map((box) => ({
        ...lift(box, layer.index),
        shade: CARTON,
      })),
    ]),
  ];

  // Fit the projected solids into the frame, leaving room for dimensions.
  const corners = solids.flatMap(({ min, max }) =>
    [min.x, max.x].flatMap((x) =>
      [min.y, max.y].flatMap((y) =>
        [min.z, max.z].map((z) => projectIso({ x, y, z })),
      ),
    ),
  );
  const minX = Math.min(...corners.map(({ x }) => x));
  const maxX = Math.max(...corners.map(({ x }) => x));
  const minY = Math.min(...corners.map(({ y }) => y));
  const maxY = Math.max(...corners.map(({ y }) => y));
  const inset = 22;
  const scale = Math.min(
    (frame.width - inset * 2) / (maxX - minX || 1),
    (frame.height - inset * 2) / (maxY - minY || 1),
  );
  const offsetX = frame.x + frame.width / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = frame.y + frame.height / 2 - ((minY + maxY) / 2) * scale;
  const toPage: Transform = (point) => {
    const projected = projectIso(point);
    return {
      x: offsetX + projected.x * scale,
      y: offsetY + projected.y * scale,
    };
  };

  const primitives = paintOrder(solids).flatMap((solid) =>
    solidFaces(solid, toPage),
  );

  // Directions on the page for world offsets.
  const pageDir = (v: Vec3): SheetPoint => {
    const origin = toPage({ x: 0, y: 0, z: 0 });
    const tip = toPage(v);
    return { x: tip.x - origin.x, y: tip.y - origin.y };
  };
  const offset = 7;

  // Top layer (lifted): length and width along its back edges.
  const top = layers[topIndex]!.boxes.map((box) => lift(box, topIndex));
  const topMinX = Math.min(...top.map(({ min }) => min.x));
  const topMaxX = Math.max(...top.map(({ max }) => max.x));
  const topMinY = Math.min(...top.map(({ min }) => min.y));
  const topMaxY = Math.max(...top.map(({ max }) => max.y));
  const topZ = Math.max(...top.map(({ max }) => max.z));
  primitives.push(
    ...dimension(
      toPage({ x: topMinX, y: topMaxY, z: topZ }),
      toPage({ x: topMaxX, y: topMaxY, z: topZ }),
      pageDir({ x: 0, y: 1, z: 0 }),
      offset,
      formatMm(topMaxX - topMinX),
    ),
    ...dimension(
      toPage({ x: topMaxX, y: topMinY, z: topZ }),
      toPage({ x: topMaxX, y: topMaxY, z: topZ }),
      pageDir({ x: 1, y: 0, z: 0 }),
      offset,
      formatMm(topMaxY - topMinY),
    ),
  );

  // Block height on the left, total height on the right (stack not lifted).
  const blockTop = block.max.z;
  primitives.push(
    ...dimension(
      toPage({ x: block.max.x, y: block.min.y, z: 0 }),
      toPage({ x: block.max.x, y: block.min.y, z: blockTop }),
      { x: -1, y: 0 },
      offset + 2,
      formatMm(blockTop),
    ),
    ...dimension(
      toPage({ x: 0, y: pallet.widthY, z: -pallet.height }),
      toPage({ x: 0, y: pallet.widthY, z: blockTop }),
      { x: 1, y: 0 },
      offset + 2,
      formatMm(blockTop + pallet.height),
    ),
  );

  // Pallet length and width along the front bottom edges.
  primitives.push(
    ...dimension(
      toPage({ x: 0, y: 0, z: -pallet.height }),
      toPage({ x: pallet.lengthX, y: 0, z: -pallet.height }),
      pageDir({ x: 0, y: -1, z: 0 }),
      offset,
      formatMm(pallet.lengthX),
    ),
    ...dimension(
      toPage({ x: 0, y: 0, z: -pallet.height }),
      toPage({ x: 0, y: pallet.widthY, z: -pallet.height }),
      pageDir({ x: -1, y: 0, z: 0 }),
      offset,
      formatMm(pallet.widthY),
    ),
  );
  return primitives;
}
