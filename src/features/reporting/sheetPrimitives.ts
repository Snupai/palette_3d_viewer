/**
 * Device-independent drawing commands for the printed pallet sheet. Units are
 * millimetres on an A4 portrait page with the origin at the top-left corner;
 * font sizes are in points. Both the PDF writer and the on-screen SVG preview
 * render exactly these commands, so the preview is the PDF.
 */
export type SheetPoint = { x: number; y: number };

export type SheetPrimitive =
  | {
      kind: "polygon";
      points: SheetPoint[];
      fill: string | null;
      stroke: string | null;
      strokeWidthMm: number;
    }
  | {
      kind: "line";
      from: SheetPoint;
      to: SheetPoint;
      stroke: string;
      strokeWidthMm: number;
    }
  | {
      kind: "text";
      at: SheetPoint;
      text: string;
      sizePt: number;
      bold: boolean;
      anchor: "start" | "middle" | "end";
      /** Clockwise rotation in degrees around `at`. */
      rotateDeg: number;
      fill: string;
    };

export type SheetDocument = {
  widthMm: number;
  heightMm: number;
  title: string;
  primitives: SheetPrimitive[];
};

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const PT_TO_MM = 25.4 / 72;

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    fill?: string | null;
    stroke?: string | null;
    strokeWidthMm?: number;
  },
): SheetPrimitive {
  return {
    kind: "polygon",
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
    fill: options.fill ?? null,
    stroke: options.stroke ?? null,
    strokeWidthMm: options.strokeWidthMm ?? 0.25,
  };
}

export function text(
  at: SheetPoint,
  value: string,
  options: {
    sizePt?: number;
    bold?: boolean;
    anchor?: "start" | "middle" | "end";
    rotateDeg?: number;
    fill?: string;
  } = {},
): SheetPrimitive {
  return {
    kind: "text",
    at,
    text: value,
    sizePt: options.sizePt ?? 10,
    bold: options.bold ?? false,
    anchor: options.anchor ?? "start",
    rotateDeg: options.rotateDeg ?? 0,
    fill: options.fill ?? "#1a1a1a",
  };
}
