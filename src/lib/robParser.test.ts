import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Grip, PalletData } from "~/domain/palletTypes";
import { parseRobText, serializeRobText } from "~/lib/robParser";

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

function fixture(name: "anonymized-plan-lf.rob" | "anonymized-plan-crlf.rob") {
  return readFileSync(
    resolve(process.cwd(), "src", "lib", "__fixtures__", name),
    "utf8",
  );
}

function multiLayerRob(): string {
  return fixture("anonymized-plan-lf.rob");
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
  it("parses durable LF and CRLF fixtures identically", () => {
    const lfText = fixture("anonymized-plan-lf.rob");
    const crlfText = fixture("anonymized-plan-crlf.rob");

    expect(lfText).not.toContain("\r\n");
    expect(crlfText).toContain("\r\n");
    expect(stripGripIds(parseRobText(lfText))).toEqual(
      stripGripIds(parseRobText(crlfText)),
    );
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
