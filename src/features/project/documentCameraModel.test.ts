import { describe, expect, it } from "vitest";
import {
  cameraErrorKind,
  detectDocumentQuad,
  initialQuadTracker,
  liveCameraSupported,
  rgbaToLuminance,
  trackQuad,
  type DocumentQuad,
} from "~/features/project/documentCameraModel";

const WIDTH = 160;
const HEIGHT = 120;

function frame(
  background: number,
  paint: (x: number, y: number) => number | null = () => null,
): Uint8Array {
  const luminance = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      luminance[y * WIDTH + x] = paint(x, y) ?? background;
    }
  }
  return luminance;
}

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inside a clockwise polygon in image coordinates. */
function insidePolygon(
  corners: readonly { x: number; y: number }[],
  x: number,
  y: number,
): boolean {
  return corners.every((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
  });
}

const pixelCorners = (quad: DocumentQuad | null) =>
  quad?.map(({ x, y }) => [Math.round(x * WIDTH), Math.round(y * HEIGHT)]) ??
  null;

const sheet = (x0: number, y0: number, x1: number, y1: number, value = 220) =>
  frame(40, (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? value : null));

describe("detectDocumentQuad", () => {
  it("outlines a bright sheet on a dark background", () => {
    expect(detectDocumentQuad(sheet(40, 30, 120, 90), WIDTH, HEIGHT)).toEqual([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ]);
  });

  it("follows a tilted sheet", () => {
    // Sheet rotated ~20°: corners (60,10) (140,40) (100,110) (20,80); detection lands on them.
    const corners = [
      { x: 60, y: 10 },
      { x: 140, y: 40 },
      { x: 100, y: 110 },
      { x: 20, y: 80 },
    ];
    const inside = (x: number, y: number) =>
      corners.every((a, i) => {
        const b = corners[(i + 1) % 4]!;
        return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
      });
    const quad = detectDocumentQuad(
      frame(40, (x, y) => (inside(x + 0.5, y + 0.5) ? 220 : null)),
      WIDTH,
      HEIGHT,
    );
    expect(
      quad?.map(({ x, y }) => [Math.round(x * WIDTH), Math.round(y * HEIGHT)]),
    ).toEqual([
      [60, 10],
      [140, 40],
      [100, 110],
      [20, 80],
    ]);
  });

  it("finds an unevenly lit sheet between a bright cloth and a bright floor", () => {
    // Wood table (77) with a cloth in the top-left corner (125), a dark table
    // edge (50) and a light floor (170) below it that is larger than the sheet. The sheet darkens from 190
    // to 128 towards its top-left corner, so no single cut-off fits it.
    const scene = frame(77, (x, y) => {
      if (y >= 80) return 170;
      if (y >= 74) return 50;
      if (x >= 30 && x < 130 && y >= 15 && y < 70) {
        return Math.round(128 + ((x - 30 + (y - 15)) / 153) * 62);
      }
      if (x + y < 40) return 125;
      return null;
    });
    expect(
      detectDocumentQuad(scene, WIDTH, HEIGHT)?.map(({ x, y }) => [
        Math.round(x * WIDTH),
        Math.round(y * HEIGHT),
      ]),
    ).toEqual([
      [30, 15],
      [130, 15],
      [130, 70],
      [30, 70],
    ]);
  });

  it("finds a sheet on a light desk under uneven light", () => {
    // Paper (200) only 20 grey levels above a light desk (180), both
    // darkening by 40 towards the left, with sensor noise and lines of text.
    const quad = [
      { x: 35, y: 18 },
      { x: 128, y: 26 },
      { x: 136, y: 100 },
      { x: 24, y: 94 },
    ];
    const random = noise(7);
    const scene = frame(0, (x, y) => {
      const light = -40 + (x / WIDTH) * 40;
      const grain = Math.round((random() - 0.5) * 12);
      if (!insidePolygon(quad, x + 0.5, y + 0.5)) return 180 + light + grain;
      const text =
        y % 9 < 2 && x % 7 < 5 && x > 45 && x < 115 && y > 35 && y < 85;
      return (text ? 90 : 200) + light + grain;
    });
    expect(pixelCorners(detectDocumentQuad(scene, WIDTH, HEIGHT))).toEqual([
      [35, 18],
      [128, 26],
      [136, 100],
      [24, 94],
    ]);
  });

  it("finds a sheet on wooden planks next to the table edge", () => {
    // Planks of 150–185 with grain, the table ending at y = 108 above a
    // dark floor, and a sheet (215) rotated a few degrees.
    const quad = [
      { x: 42, y: 12 },
      { x: 122, y: 18 },
      { x: 116, y: 98 },
      { x: 36, y: 92 },
    ];
    const random = noise(11);
    const planks = [150, 172, 160, 185, 155, 178, 165, 150];
    const scene = frame(0, (x, y) => {
      const grain = Math.round((random() - 0.5) * 16);
      if (insidePolygon(quad, x + 0.5, y + 0.5)) return 215 + grain;
      if (y >= 108) return 60 + grain;
      return planks[Math.floor(x / 20)]! + grain;
    });
    expect(pixelCorners(detectDocumentQuad(scene, WIDTH, HEIGHT))).toEqual([
      [42, 12],
      [122, 18],
      [116, 98],
      [36, 92],
    ]);
  });

  it("finds nothing on bare wooden planks", () => {
    const random = noise(3);
    const planks = [150, 172, 160, 185, 155, 178, 165, 150];
    const scene = frame(0, (x, y) =>
      y >= 108
        ? 60
        : planks[Math.floor(x / 20)]! + Math.round((random() - 0.5) * 16),
    );
    expect(detectDocumentQuad(scene, WIDTH, HEIGHT)).toBeNull();
  });

  it("reports no document without contrast", () => {
    expect(detectDocumentQuad(frame(128), WIDTH, HEIGHT)).toBeNull();
    expect(
      detectDocumentQuad(sheet(40, 30, 120, 90, 44), WIDTH, HEIGHT),
    ).toBeNull();
  });

  it("reports no document when the sheet is too small, cut off, or fills the frame", () => {
    expect(detectDocumentQuad(sheet(70, 50, 90, 70), WIDTH, HEIGHT)).toBeNull();
    expect(detectDocumentQuad(sheet(0, 30, 120, 90), WIDTH, HEIGHT)).toBeNull();
    expect(
      detectDocumentQuad(sheet(40, 0, 120, 120), WIDTH, HEIGHT),
    ).toBeNull();
    expect(detectDocumentQuad(sheet(0, 0, 160, 118), WIDTH, HEIGHT)).toBeNull();
  });

  it("rejects bright regions that are not four-cornered", () => {
    const disc = frame(40, (x, y) =>
      (x - 80) ** 2 + (y - 60) ** 2 < 45 ** 2 ? 220 : null,
    );
    expect(detectDocumentQuad(disc, WIDTH, HEIGHT)).toBeNull();
  });
});

describe("rgbaToLuminance", () => {
  it("weights channels like Rec. 601", () => {
    expect([
      ...rgbaToLuminance([255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]),
    ]).toEqual([255, 76, 28]);
  });
});

describe("trackQuad", () => {
  const a: DocumentQuad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const b: DocumentQuad = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];

  it("smooths corner movement between frames", () => {
    const tracked = trackQuad(trackQuad(initialQuadTracker, a), b);
    expect(tracked).toEqual({
      quad: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
      misses: 0,
    });
  });

  it("keeps the outline through six missed frames and drops it on the seventh", () => {
    let tracker = trackQuad(initialQuadTracker, a);
    for (let i = 0; i < 6; i++) tracker = trackQuad(tracker, null);
    expect(tracker.quad).toBe(a);
    expect(trackQuad(tracker, null)).toEqual({ quad: null, misses: 7 });
  });
});

describe("cameraErrorKind", () => {
  it("maps getUserMedia failures to user-facing causes", () => {
    const kinds = [
      "NotAllowedError",
      "SecurityError",
      "NotFoundError",
      "OverconstrainedError",
      "NotReadableError",
      "NotSupportedError",
      "TypeError",
    ].map((name) => cameraErrorKind({ name }));
    expect(kinds).toEqual([
      "denied",
      "denied",
      "notFound",
      "notFound",
      "busy",
      "unsupported",
      "failed",
    ]);
    expect(cameraErrorKind("boom")).toBe("failed");
  });
});

describe("liveCameraSupported", () => {
  const getUserMedia = () => undefined;

  it("needs getUserMedia in a secure context", () => {
    expect(
      liveCameraSupported({
        isSecureContext: true,
        navigator: { mediaDevices: { getUserMedia } },
      }),
    ).toBe(true);
    expect(
      liveCameraSupported({
        isSecureContext: false,
        navigator: { mediaDevices: { getUserMedia } },
      }),
    ).toBe(false);
    expect(liveCameraSupported({ isSecureContext: true, navigator: {} })).toBe(
      false,
    );
  });
});
