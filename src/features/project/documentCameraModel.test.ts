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
    // Sheet rotated ~20°: corners (60,10) (140,40) (100,110) (20,80); detection lands within 1 px.
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
      [139, 39],
      [101, 109],
      [20, 80],
    ]);
  });

  it("reports no document without contrast", () => {
    expect(detectDocumentQuad(frame(128), WIDTH, HEIGHT)).toBeNull();
    expect(
      detectDocumentQuad(sheet(40, 30, 120, 90, 70), WIDTH, HEIGHT),
    ).toBeNull();
  });

  it("reports no document when the sheet is too small or fills the frame", () => {
    expect(detectDocumentQuad(sheet(70, 50, 90, 70), WIDTH, HEIGHT)).toBeNull();
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
