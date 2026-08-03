import { describe, expect, it } from "vitest";
import {
  ZWISCHENLAGE_HEIGHT_MM,
  findGripCollision,
  layerPlaceZ,
  layerZBottom,
  mergeGrips,
  parseRobText,
  serializeRobText,
  splitGrip,
  toRobInt,
  type Grip,
  type PalletData,
} from "~/lib/robParser";

/** Minimal 1-layer plan with one single package grip. */
function sampleRob(opts?: {
  newline?: "\n" | "\r\n";
  inputDirection?: 0 | 1;
  packageDims?: [number, number, number];
  palletDims?: [number, number, number];
  zwischenlage?: number;
  trailingZwischenlage?: number;
  blankBeforeCoords?: boolean;
}): string {
  const nl = opts?.newline ?? "\n";
  const [pw, pl, ph] = opts?.packageDims ?? [200, 300, 150];
  const [palW, palL, palH] = opts?.palletDims ?? [1200, 800, 144];
  const zw = opts?.zwischenlage ?? 0;
  const trail = opts?.trailingZwischenlage ?? 0;
  const dir =
    opts?.inputDirection === undefined ? "" : ` ${opts.inputDirection}`;
  const blank = opts?.blankBeforeCoords ? `${nl}` : "";
  return [
    `${palW} ${palL} ${palH}`,
    `${pw} ${pl} ${ph}${dir}`,
    "1",
    "1",
    `0 ${zw}`,
    `1 ${trail}`,
    blank + "1",
    "100 50 0 600 400 0 1 0 0",
  ].join(nl);
}

function multiLayerRob(): string {
  return [
    "1200 800 144",
    "200 300 150",
    "2",
    "3",
    "0 1",
    "1 0",
    "2 1",
    "1 0",
    "1",
    "100 50 0 400 300 0 1 1 0",
    "2",
    "100 50 0 500 300 90 2 0 -1",
    "120 60 0 700 400 0 1 0 1",
  ].join("\n");
}

function stripGripIds(data: PalletData): Omit<PalletData, "uniqueLayers"> & {
  uniqueLayers: Record<number, Array<Omit<Grip, "id">>>;
} {
  const uniqueLayers: Record<number, Array<Omit<Grip, "id">>> = {};
  for (const [key, grips] of Object.entries(data.uniqueLayers)) {
    uniqueLayers[Number(key)] = grips.map(({ id: _id, ...rest }) => rest);
  }
  return { ...data, uniqueLayers };
}

describe("parseRobText characterization", () => {
  it("parses LF and CRLF identically for supported plans", () => {
    const lf = parseRobText(sampleRob({ newline: "\n" }));
    const crlf = parseRobText(sampleRob({ newline: "\r\n" }));
    expect(stripGripIds(lf)).toEqual(stripGripIds(crlf));
  });

  it("keeps optional input direction when explicit", () => {
    const withDir = parseRobText(sampleRob({ inputDirection: 1 }));
    expect(withDir.inputDirection).toBe(1);
    expect(withDir.inputDirectionExplicit).toBe(true);
    const without = parseRobText(sampleRob());
    expect(without.inputDirection).toBe(0);
    expect(without.inputDirectionExplicit).toBe(false);
  });

  it("preserves blank lines before coordinate blocks", () => {
    const data = parseRobText(sampleRob({ blankBeforeCoords: true }));
    expect(data.total_boxes).toBe(1);
    expect(data.uniqueLayers[1]?.[0]?.x).toBe(600);
  });

  it("parses multi unique layers, multi-package grips, and zwischenlagen", () => {
    const data = parseRobText(multiLayerRob());
    expect(data.layers).toHaveLength(3);
    expect(data.layers[0]?.zwischenlage).toBe(1);
    expect(data.layers[1]?.zwischenlage).toBe(0);
    expect(data.layers[2]?.zwischenlage).toBe(1);
    expect(data.trailingZwischenlage).toBe(0);
    expect(data.uniqueLayers[1]).toHaveLength(1);
    expect(data.uniqueLayers[2]).toHaveLength(2);
    expect(data.uniqueLayers[2]?.[0]?.numPackages).toBe(2);
    expect(data.layers[1]?.boxes).toHaveLength(3);
  });

  it("round-trips parse → serialize → parse on domain fields", () => {
    const original = parseRobText(
      sampleRob({
        inputDirection: 1,
        zwischenlage: 1,
        trailingZwischenlage: 1,
      }),
    );
    const again = parseRobText(serializeRobText(original));
    expect(stripGripIds(again)).toEqual(stripGripIds(original));
  });

  it("round-trips multi-layer plans including pick/place pose", () => {
    const original = parseRobText(multiLayerRob());
    const again = parseRobText(serializeRobText(original));
    expect(stripGripIds(again)).toEqual(stripGripIds(original));
  });
});

describe("Z math", () => {
  it("excludes pallet height and applies 3 mm Zwischenlagen", () => {
    const data = parseRobText(multiLayerRob());
    const h = data.package.height;
    // Layer 0: zw=1 → bottom = 3
    expect(layerZBottom(data.layers, 0, h)).toBe(ZWISCHENLAGE_HEIGHT_MM);
    expect(layerPlaceZ(data.layers, 0, h)).toBe(ZWISCHENLAGE_HEIGHT_MM + h);
    // Layer 1: zw under layer0 (3) + package + zw under layer1 (0)
    expect(layerZBottom(data.layers, 1, h)).toBe(ZWISCHENLAGE_HEIGHT_MM + h);
    expect(layerPlaceZ(data.layers, 1, h)).toBe(ZWISCHENLAGE_HEIGHT_MM + h + h);
    // Layer 2: + another package + zw=1 under layer2
    expect(layerZBottom(data.layers, 2, h)).toBe(
      ZWISCHENLAGE_HEIGHT_MM + h + h + ZWISCHENLAGE_HEIGHT_MM,
    );
  });
});

describe("parseRobText validation", () => {
  it("rejects missing coordinate fields with line and field context", () => {
    const text = sampleRob().replace(
      "100 50 0 600 400 0 1 0 0",
      "100 50 0 600 400 0 1",
    );
    expect(() => parseRobText(text)).toThrow(/line \d+.*9 integer fields/i);
  });

  it("rejects NaN-like tokens", () => {
    const text = sampleRob().replace(
      "100 50 0 600 400 0 1 0 0",
      "100 50 0 abc 400 0 1 0 0",
    );
    expect(() => parseRobText(text)).toThrow(/field "x".*integer/i);
  });

  it("rejects invalid rotations", () => {
    const text = sampleRob().replace(
      "100 50 0 600 400 0 1 0 0",
      "100 50 0 600 400 45 1 0 0",
    );
    expect(() => parseRobText(text)).toThrow(/rotation.*0, 90, 180, or 270/i);
  });

  it("rejects non-positive package counts", () => {
    const text = sampleRob().replace(
      "100 50 0 600 400 0 1 0 0",
      "100 50 0 600 400 0 0 0 0",
    );
    expect(() => parseRobText(text)).toThrow(/num_packages.*must be > 0/i);
  });

  it("rejects undefined unique layer references", () => {
    const text = [
      "1200 800 144",
      "200 300 150",
      "1",
      "1",
      "0 0",
      "9 0",
      "1",
      "100 50 0 600 400 0 1 0 0",
    ].join("\n");
    expect(() => parseRobText(text)).toThrow(/unique layer id 9/i);
  });
});

describe("toRobInt", () => {
  it("truncates half-millimeter editor candidates", () => {
    expect(toRobInt(100.5)).toBe(100);
    expect(toRobInt(-100.5)).toBe(-100);
  });
});

describe("grip operations", () => {
  const pkg = { width: 200, length: 300, inputDirection: 0 as const };

  it("splits a multi-package grip into singles", () => {
    const grip: Grip = {
      id: "g1",
      pickX: 200,
      pickY: -150,
      pickRotation: 0,
      x: 600,
      y: 400,
      rotation: 0,
      numPackages: 2,
      dx: 0,
      dy: 0,
    };
    const split = splitGrip(grip, pkg.width, pkg.length, pkg.inputDirection);
    expect(split).toHaveLength(2);
    expect(split.every((g) => g.numPackages === 1)).toBe(true);
  });

  it("merges aligned touching singles", () => {
    const a: Grip = {
      id: "a",
      pickX: 100,
      pickY: -150,
      pickRotation: 0,
      x: 500,
      y: 400,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const b: Grip = {
      id: "b",
      pickX: 100,
      pickY: -150,
      pickRotation: 0,
      x: 700,
      y: 400,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const merged = mergeGrips(
      [a, b],
      pkg.width,
      pkg.length,
      pkg.inputDirection,
    );
    expect(merged).not.toBeNull();
    expect(merged?.numPackages).toBe(2);
    expect(merged?.x).toBe(600);
    expect(merged?.y).toBe(400);
  });

  it("treats edge-touching footprints as non-colliding with 0.5 mm tolerance", () => {
    const left: Grip = {
      id: "l",
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: 100,
      y: 150,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const right: Grip = {
      id: "r",
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: 300,
      y: 150,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    expect(
      findGripCollision(
        [left, right],
        pkg.width,
        pkg.length,
        pkg.inputDirection,
      ),
    ).toBeNull();
  });

  it("detects true overlap", () => {
    const a: Grip = {
      id: "a",
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: 200,
      y: 150,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    const b: Grip = {
      id: "b",
      pickX: 0,
      pickY: 0,
      pickRotation: 0,
      x: 250,
      y: 150,
      rotation: 0,
      numPackages: 1,
      dx: 0,
      dy: 0,
    };
    expect(
      findGripCollision([a, b], pkg.width, pkg.length, pkg.inputDirection),
    ).not.toBeNull();
  });
});
