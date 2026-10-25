// @vitest-environment node
import { translateDe } from "~/i18n";
import { describe, expect, it } from "vitest";
import type { Box, PalletData } from "~/domain/palletTypes";
import {
  explodeGapMm,
  paintOrder,
  projectIso,
} from "~/features/reporting/isometricPallet";
import {
  buildPalletSheet,
  sheetFileName,
} from "~/features/reporting/palletSheet";
import {
  renderSheetPdf,
  textWidthPt,
  winAnsiBytes,
} from "~/features/reporting/pdfWriter";
import { rect, text } from "~/features/reporting/sheetPrimitives";

function box(x: number, y: number): Box {
  return {
    blueNumber: 1,
    blueLine: null,
    rotation: 0,
    rect: { length: 400, width: 300, x, y },
    height: 200,
    placeX: x,
    placeY: y,
    numPackages: 1,
  };
}

const plan: PalletData = {
  layers: [0, 1].map(() => ({
    unique_layer_id: 1,
    boxes: [box(200, 150), box(600, 150), box(200, 450), box(600, 450)],
    zwischenlage: 0,
  })),
  uniqueLayers: {},
  layer_count: 2,
  total_boxes: 8,
  package: { length: 400, width: 300, height: 200 },
  pallet: { width: 1200, length: 800, height: 144 },
  inputDirection: 0,
};

const latin1 = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

describe("projectIso", () => {
  it("puts the front corner lowest and lifts z straight up", () => {
    expect(projectIso({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: -0 });
    expect(projectIso({ x: 0, y: 0, z: 100 })).toEqual({ x: 0, y: -100 });
    expect(projectIso({ x: 100, y: 0, z: 0 }).x).toBeCloseTo(-86.6025, 4);
    expect(projectIso({ x: 0, y: 100, z: 0 }).y).toBe(-50);
  });
});

describe("paintOrder", () => {
  const at = (x: number, y: number, z: number, size = 100) => ({
    min: { x, y, z },
    max: { x: x + size, y: y + size, z: z + size },
  });

  it("paints farther and lower boxes first", () => {
    const front = at(0, 0, 0);
    const back = at(200, 0, 0);
    const above = at(0, 0, 100);
    expect(paintOrder([above, front, back])).toEqual([back, front, above]);
  });

  it("is independent of the input order", () => {
    const boxes = [at(0, 0, 0), at(100, 0, 0), at(0, 100, 0), at(100, 100, 0)];
    const expected = paintOrder(boxes);
    expect(paintOrder([...boxes].reverse())).toEqual(expected);
    expect(expected[0]).toBe(boxes[3]);
    expect(expected[3]).toBe(boxes[0]);
  });
});

describe("explodeGapMm", () => {
  it("lifts the top layer by at least 150 mm", () => {
    expect(explodeGapMm(400)).toBe(150);
    expect(explodeGapMm(1128)).toBeCloseTo(248.16, 2);
  });
});

describe("pdfWriter", () => {
  it("encodes German sheet text as WinAnsi", () => {
    expect(winAnsiBytes("Packstückmaße × 3 – ok")).toEqual([
      0x50, 0x61, 0x63, 0x6b, 0x73, 0x74, 0xfc, 0x63, 0x6b, 0x6d, 0x61, 0xdf,
      0x65, 0x20, 0xd7, 0x20, 0x33, 0x20, 0x96, 0x20, 0x6f, 0x6b,
    ]);
    expect(winAnsiBytes("→")).toEqual([0x3f]);
  });

  it("measures Helvetica text", () => {
    expect(textWidthPt("1200", 10, false)).toBe(22.24);
    expect(textWidthPt("Mm", 10, true)).toBe(17.22);
  });

  it("writes a valid one-page PDF with exact xref offsets", () => {
    const bytes = renderSheetPdf({
      widthMm: 210,
      heightMm: 297,
      title: "Palettierschema Test",
      primitives: [
        rect(10, 10, 50, 20, { fill: "#ffffff", stroke: "#000000" }),
        text({ x: 20, y: 20 }, "Blockmaße", { bold: true }),
      ],
    });
    const pdf = latin1(bytes);
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
    // "Blockmaße" with ß as 0xDF.
    expect(pdf).toContain("<426c6f636b6d61df65> Tj");
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = [...pdf.matchAll(/(\d{10}) 00000 n /g)].map((match) =>
      Number(match[1]),
    );
    expect(entries).toHaveLength(7);
    entries.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
    const length = Number(/\/Length (\d+) >>\nstream\n/.exec(pdf)![1]);
    const streamStart = pdf.indexOf("stream\n") + "stream\n".length;
    expect(pdf.slice(streamStart + length, streamStart + length + 10)).toBe(
      "\nendstream",
    );
  });
});

describe("buildPalletSheet", () => {
  const sheet = buildPalletSheet({
    data: plan,
    storageHeightMm: 1500,
    productNumber: "UK01587",
    lineNumber: "AP-5006",
    palletName: "EURO pallet",
    date: "22.10.2026",
    t: translateDe,
  });
  const texts = sheet.primitives.flatMap((primitive) =>
    primitive.kind === "text" ? [primitive.text] : [],
  );

  it("prints the reference sheet sections and figures", () => {
    expect(sheet.title).toBe("Palettierschema UK01587");
    expect(texts).toEqual(
      expect.arrayContaining([
        "Szaidel Cosmetic GmbH",
        "22.10.2026",
        "UK01587",
        "AP-5006",
        "Packstückmaße:",
        "Palettenstauraum:",
        "Blockmaße:",
        "Packstücke/Palette: 8",
        "2 Lagen à 4 Packstücke",
        "Flächennutzung: 50,0 %",
        "Volumennutzung: 13,3 %",
        "400,0",
        "300,0",
        "1500,0",
      ]),
    );
  });

  it("dimensions the lifted top layer, both heights and the pallet", () => {
    // Top layer 800 × 600, block 400 high, total 544, pallet 1200 × 800.
    expect(texts).toEqual(
      expect.arrayContaining(["800", "600", "400", "544", "1200"]),
    );
  });

  it("keeps every drawn point on the A4 page", () => {
    const points = sheet.primitives.flatMap((primitive) =>
      primitive.kind === "polygon"
        ? primitive.points
        : primitive.kind === "line"
          ? [primitive.from, primitive.to]
          : [primitive.at],
    );
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(210);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(297);
    }
  });

  it("names the file after the product", () => {
    expect(sheetFileName("UK01587", "AP-5006", translateDe)).toBe(
      "UK01587-palettierschema.pdf",
    );
    expect(sheetFileName("", "", translateDe)).toBe(
      "palettierschema-palettierschema.pdf",
    );
  });
});
