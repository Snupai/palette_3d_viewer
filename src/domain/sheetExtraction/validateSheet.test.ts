import { describe, expect, it } from "vitest";
import {
  isCartonSideSum,
  splitProductIdentifiers,
  parseSheetNumber,
  rawPalletSheetSchema,
  validatePalletSheet,
} from "~/domain/sheetExtraction";

function raw(overrides: Record<string, unknown> = {}) {
  return rawPalletSheetSchema.parse({
    sheetType: "multipack",
    productName: "Test",
    cartonMm: { length: 148, width: 148, height: 122 },
    blockMm: { length: 1184, width: 740, height: 1586 },
    palletMm: { length: 1200, width: 800 },
    cartonsPerLayer: 40,
    layers: 13,
    cartonsPerPallet: 520,
    ...overrides,
  });
}

const errors = (overrides: Record<string, unknown> = {}) =>
  validatePalletSheet(raw(overrides))
    .issues.filter(({ severity }) => severity === "error")
    .map(({ field }) => field);

describe("parseSheetNumber", () => {
  it.each([
    ["148,0", 148],
    ["1.200,0", 1200],
    ["1.512", 1512],
    ["1152,2 mm", 1152.2],
    [774, 774],
    ["", null],
    ["n/a", null],
  ])("reads %j as %j", (input, expected) => {
    expect(parseSheetNumber(input)).toBe(expected);
  });
});

describe("validatePalletSheet", () => {
  // Geometry from the photographed reference sheets (no product data):
  // carton l, w, h; block l, w, h (null when only the total incl. pallet is printed); counts.
  it.each([
    [147, 104, 139, 1176, 771, 1118, 59, 7, 413],
    [158, 82, 165, 1148, 790, 660, 70, 4, 280],
    [172, 130, 104, 1162, 780, 832, 40, 8, 320],
    [148, 148, 122, 1184, 740, 1586, 40, 13, 520],
    [256, 173, 177, 1197, 775, 1206, 20, 6, 120],
    [380, 250, 200, 1130, 760, 1400, 9, 7, 63],
    [245, 98, 174, 1078, 735, 870, 32, 5, 160],
    [157, 110, 175, 1178, 785, 1575, 53, 9, 477],
    [249, 170, 136, 1190, 747, 1088, 21, 8, 168],
    [157, 106, 150, 1166, 789, 1350, 55, 9, 495],
    [308, 220, 188, 1144, 660, 1128, 11, 6, 66],
    [135, 91, 196, 1183, 766, 784, 73, 4, 292],
    [154, 107, 171, 1164, 770, 855, 54, 5, 270],
    [177, 123, 143, 1200, 777, 858, 42, 6, 252],
    [135, 91, 196, 1183, 766, 1372, 73, 7, 511],
    [230, 157, 58, 1077, 785, 1450, 23, 25, 575],
    [204, 110, 193, 1162, 738, 1544, 38, 8, 304],
    [128, 93, 161, 1152.2, 733, 805, 68, 5, 340],
    [184, 94, 216, 1198, 752, 864, 52, 4, 208],
    [158, 109, 135, 1188, 790, 135, 54, 7, 378],
  ])(
    "accepts carton %s × %s × %s in block %s × %s × %s (%s × %s = %s)",
    (cl, cw, ch, bl, bw, bh, perLayer, layers, perPallet) => {
      expect(
        errors({
          cartonMm: { length: cl, width: cw, height: ch },
          blockMm: { length: bl, width: bw, height: bh },
          cartonsPerLayer: perLayer,
          layers,
          cartonsPerPallet: perPallet,
        }),
      ).toEqual([]);
    },
  );

  it("corrects a height that includes the pallet deck", () => {
    const { sheet } = validatePalletSheet(
      raw({
        cartonMm: { length: 147, width: 104, height: 139 },
        blockMm: { length: 1176, width: 771, height: 1118 },
        cartonsPerLayer: 59,
        layers: 7,
        cartonsPerPallet: 413,
      }),
    );
    expect(sheet.blockMm).toEqual({ length: 1176, width: 771, height: 973 });
  });

  it("corrects a single-layer height to the full stack", () => {
    const { sheet } = validatePalletSheet(
      raw({
        cartonMm: { length: 158, width: 109, height: 135 },
        blockMm: { length: 1188, width: 790, height: 135 },
        cartonsPerLayer: 54,
        layers: 7,
        cartonsPerPallet: 378,
      }),
    );
    expect(sheet.blockMm?.height).toBe(945);
  });

  it("rejects the single product read as the carton", () => {
    expect(
      errors({ cartonMm: { length: 45, width: 45, height: 164 } }),
    ).toEqual(["blockMm", "blockMm", "blockMm", "blockMm"]);
  });

  it("rejects the load space read as the block", () => {
    expect(
      errors({
        cartonMm: { length: 157, width: 110, height: 175 },
        blockMm: { length: 1190, width: 790, height: 1615 },
        cartonsPerLayer: 53,
        layers: 9,
        cartonsPerPallet: 477,
      }),
    ).toEqual(["blockMm", "blockMm", "blockMm"]);
  });

  it("rejects “5 × 14 cartons per layer” read as 5 per layer and 14 layers", () => {
    expect(
      errors({
        cartonMm: { length: 158, width: 82, height: 165 },
        blockMm: { length: 1148, width: 790, height: 660 },
        cartonsPerLayer: 5,
        layers: 14,
        cartonsPerPallet: 70,
      }),
    ).toEqual(["blockMm", "blockMm"]);
  });

  it("rejects a pallet-sized carton and a count that does not multiply out", () => {
    expect(
      errors({
        cartonMm: { length: 1200, width: 800, height: 1736 },
        cartonsPerPallet: 500,
      }),
    ).toEqual(["cartonMm", "cartonsPerPallet"]);
  });

  it("derives the missing layer count and assumes a EURO pallet", () => {
    const { sheet, issues } = validatePalletSheet(
      raw({ layers: null, palletMm: null }),
    );
    expect(sheet.layers).toBe(13);
    expect(sheet.palletMm).toEqual({ length: 1200, width: 800 });
    expect(issues.map(({ severity }) => severity)).toEqual(["info", "info"]);
  });

  it("flags handwritten notes for review", () => {
    const { issues } = validatePalletSheet(
      raw({ handwrittenNotes: "1248 abgeändert" }),
    );
    expect(issues).toEqual([
      {
        severity: "warning",
        field: "handwrittenNotes",
        message:
          "Handwritten note on the sheet: “1248 abgeändert”. Check whether it overrides printed values.",
      },
    ]);
  });
});

describe("isCartonSideSum", () => {
  it.each([
    [777, 177, 123, true],
    [800, 177, 123, false],
    [1190, 157, 110, false],
    [1152.2, 128, 93, true],
  ])("%s mm from %s / %s mm sides → %s", (side, length, width, expected) => {
    expect(isCartonSideSum(side, length, width)).toBe(expected);
  });
});

describe("splitProductIdentifiers", () => {
  it.each([
    ["1195-00027 UK02459", null, "1195-00027", "UK02459"],
    ["1292-UK02020", null, null, "UK02020"],
    ["813-......", "UK01379", null, "UK01379"],
    ["843-00007-10", "UK01748", "843-00007-10", "UK01748"],
    ["1329-00003+4", null, "1329-00003+4", null],
    [null, null, null, null],
  ])(
    "%j / %j → %j / %j",
    (product, carton, expectedProduct, expectedCarton) => {
      expect(splitProductIdentifiers(product, carton)).toEqual({
        productNumber: expectedProduct,
        cartonId: expectedCarton,
      });
    },
  );

  it("flags a misread handwritten number", () => {
    const { issues } = validatePalletSheet(raw({ productNumber: "791-0M47" }));
    expect(issues.map(({ field, severity }) => [field, severity])).toEqual([
      ["productNumber", "warning"],
    ]);
  });
});
