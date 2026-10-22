import type { PalletData } from "~/domain/palletTypes";
import { isometricPallet } from "~/features/reporting/isometricPallet";
import {
  formatSheetNumber,
  palletSheetFigures,
  sheetLayers,
  type PalletSheetFigures,
} from "~/features/reporting/palletSheetFigures";
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  rect,
  text,
  type SheetDocument,
  type SheetPrimitive,
} from "~/features/reporting/sheetPrimitives";

export type PalletSheetInput = {
  data: PalletData;
  storageHeightMm: number | null;
  productNumber: string;
  lineNumber: string;
  palletName: string | null;
  /** Printed date, already formatted (dd.mm.yyyy). */
  date: string;
};

const COMPANY = "Szaidel Cosmetic GmbH";
const BRAND = "#173159";
const INK = "#1a1a1a";
const MUTED = "#5e5e5e";
const FRAME = "#9a9a9a";

const MARGIN = 16;
const CONTENT_WIDTH = A4_WIDTH_MM - MARGIN * 2;

/** Soft drop shadow like the reference sheet's raised boxes. */
function panel(y: number, height: number): SheetPrimitive[] {
  return [
    rect(MARGIN + 0.8, y + 0.8, CONTENT_WIDTH, height, { fill: "#d9d9d9" }),
    rect(MARGIN, y, CONTENT_WIDTH, height, {
      fill: "#ffffff",
      stroke: FRAME,
      strokeWidthMm: 0.3,
    }),
  ];
}

/** "308,0 x 220,0 x 188,0 mm" with right-aligned number columns. */
function dimensionRow(
  y: number,
  label: string,
  values: readonly (number | null)[],
): SheetPrimitive[] {
  const columns = [104, 128, 152];
  return [
    text({ x: MARGIN + 5, y }, label, { sizePt: 10.5 }),
    ...values.flatMap((value, index) => [
      text(
        { x: columns[index]!, y },
        value === null ? "–" : formatSheetNumber(value),
        { sizePt: 10.5, anchor: "end" },
      ),
      ...(index < values.length - 1
        ? [
            text({ x: columns[index]! + 4, y }, "x", {
              sizePt: 10.5,
              anchor: "middle",
            }),
          ]
        : []),
    ]),
    text({ x: 155, y }, "mm", { sizePt: 10.5 }),
  ];
}

function layerSummary(figures: PalletSheetFigures): string {
  const layers = `${figures.layerCount} ${figures.layerCount === 1 ? "Lage" : "Lagen"}`;
  if (figures.uniformPackagesPerLayer !== null) {
    return `${layers} à ${figures.uniformPackagesPerLayer} Packstücke`;
  }
  return `${layers} à ${figures.minPackagesPerLayer}–${figures.maxPackagesPerLayer} Packstücke`;
}

function percent(value: number | null): string {
  return value === null ? "–" : `${formatSheetNumber(value)} %`;
}

/** Small isometric carton mark for the header, drawn with the brand navy. */
function brandMark(x: number, y: number, size: number): SheetPrimitive[] {
  const c = Math.cos(Math.PI / 6) * size;
  const h = size;
  const top = { x, y };
  const left = { x: x - c, y: y + size / 2 };
  const right = { x: x + c, y: y + size / 2 };
  const front = { x, y: y + size };
  const down = (point: { x: number; y: number }) => ({
    x: point.x,
    y: point.y + h,
  });
  const face = (
    points: { x: number; y: number }[],
    fill: string,
  ): SheetPrimitive => ({
    kind: "polygon",
    points,
    fill,
    stroke: BRAND,
    strokeWidthMm: 0.4,
  });
  return [
    face([top, right, front, left], "#ffffff"),
    face([left, front, down(front), down(left)], "#8bb0c9"),
    face([front, right, down(right), down(front)], BRAND),
  ];
}

export function buildPalletSheet(input: PalletSheetInput): SheetDocument {
  const figures = palletSheetFigures({
    data: input.data,
    storageHeightMm: input.storageHeightMm,
  });
  const primitives: SheetPrimitive[] = [];

  // 1. Header: company, document title, date.
  const headerY = 14;
  const headerH = 26;
  primitives.push(
    ...panel(headerY, headerH),
    ...brandMark(MARGIN + 13, headerY + 4.5, 8.5),
    text({ x: MARGIN + 28, y: headerY + 10.5 }, COMPANY, {
      sizePt: 17,
      fill: BRAND,
    }),
    text({ x: MARGIN + 28, y: headerY + 17 }, "Palettierschema", {
      sizePt: 10,
      fill: INK,
    }),
    text(
      { x: MARGIN + 28, y: headerY + 22 },
      input.palletName ? `Palette: ${input.palletName}` : "Pallet planner",
      { sizePt: 8.5, fill: MUTED },
    ),
    text({ x: MARGIN + CONTENT_WIDTH - 5, y: headerY + 9 }, input.date, {
      sizePt: 10.5,
      anchor: "end",
    }),
  );

  // 2. Product.
  const productY = headerY + headerH + 4;
  const productH = 16;
  primitives.push(
    ...panel(productY, productH),
    text({ x: MARGIN + 5, y: productY + 6.5 }, "Produkt-Nr.:", {
      sizePt: 10.5,
    }),
    text({ x: MARGIN + 50, y: productY + 6.5 }, input.productNumber || "–", {
      sizePt: 10.5,
      bold: true,
    }),
    text({ x: MARGIN + 5, y: productY + 12.5 }, "Linie:", { sizePt: 10.5 }),
    text({ x: MARGIN + 50, y: productY + 12.5 }, input.lineNumber || "–", {
      sizePt: 10.5,
    }),
  );

  // 3. Figures.
  const figuresY = productY + productH + 4;
  const figuresH = 40;
  const rowY = (row: number) => figuresY + 7 + row * 5.6;
  primitives.push(
    ...panel(figuresY, figuresH),
    ...dimensionRow(rowY(0), "Packstückmaße:", [
      figures.packageMm.length,
      figures.packageMm.width,
      figures.packageMm.height,
    ]),
    ...dimensionRow(rowY(1), "Palettenstauraum:", [
      figures.storageMm.length,
      figures.storageMm.width,
      figures.storageMm.height,
    ]),
    ...dimensionRow(rowY(2), "Blockmaße:", [
      figures.blockMm.length,
      figures.blockMm.width,
      figures.blockMm.height,
    ]),
    text(
      { x: MARGIN + 5, y: rowY(3) + 3.5 },
      `Packstücke/Palette: ${figures.packageCount}`,
      { sizePt: 10.5 },
    ),
    text({ x: 110, y: rowY(3) + 3.5 }, layerSummary(figures), { sizePt: 10.5 }),
    text(
      { x: MARGIN + 5, y: rowY(4) + 3.5 },
      `Flächennutzung: ${percent(figures.areaUtilizationPercent)}`,
      { sizePt: 10.5 },
    ),
    text(
      { x: 110, y: rowY(4) + 3.5 },
      `Volumennutzung: ${percent(figures.volumeUtilizationPercent)}`,
      { sizePt: 10.5 },
    ),
  );

  // 4. Drawing.
  const drawingY = figuresY + figuresH + 4;
  const drawingH = A4_HEIGHT_MM - 14 - drawingY;
  primitives.push(
    rect(MARGIN, drawingY, CONTENT_WIDTH, drawingH, {
      fill: "#ffffff",
      stroke: FRAME,
      strokeWidthMm: 0.3,
    }),
  );
  const pallet = input.data.pallet ?? { width: 1200, length: 800, height: 144 };
  const sheetFootprint = input.data.interlayer ?? null;
  primitives.push(
    ...isometricPallet({
      layers: sheetLayers(input.data),
      pallet: {
        lengthX: pallet.width,
        widthY: pallet.length,
        height: pallet.height,
      },
      ...(sheetFootprint
        ? {
            sheetFootprint: {
              lengthX: sheetFootprint.width,
              widthY: sheetFootprint.length,
            },
          }
        : {}),
      frame: { x: MARGIN, y: drawingY, width: CONTENT_WIDTH, height: drawingH },
      formatMm: (value) => String(Math.round(value)),
    }),
  );

  // Footer note.
  primitives.push(
    text(
      { x: MARGIN, y: A4_HEIGHT_MM - 8 },
      `${COMPANY} · Erstellt mit dem Pallet planner`,
      { sizePt: 7.5, fill: MUTED },
    ),
  );

  return {
    widthMm: A4_WIDTH_MM,
    heightMm: A4_HEIGHT_MM,
    title:
      `Palettierschema ${input.productNumber || input.lineNumber || ""}`.trim(),
    primitives,
  };
}

export function sheetFileName(
  productNumber: string,
  lineNumber: string,
): string {
  const stem =
    (productNumber || lineNumber || "palettierschema")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-") || "palettierschema";
  return `${stem}-palettierschema.pdf`;
}
