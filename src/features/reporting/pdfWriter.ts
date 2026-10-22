import {
  PT_TO_MM,
  type SheetDocument,
  type SheetPoint,
  type SheetPrimitive,
} from "~/features/reporting/sheetPrimitives";

/**
 * Minimal, dependency-free PDF 1.4 writer for one-page vector sheets. Text
 * uses the standard Helvetica fonts with WinAnsi encoding, so nothing is
 * embedded and the output is byte-for-byte deterministic.
 */

const MM_TO_PT = 72 / 25.4;

/** Helvetica advance widths (1/1000 em) for WinAnsi codes 32–126. */
const HELVETICA_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
/** Helvetica-Bold widths for the same range. */
const HELVETICA_BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];
const LATIN1_WIDTHS: Record<number, [number, number]> = {
  0x96: [556, 556], // en dash
  0xb7: [278, 278], // middle dot
  0xb0: [400, 400], // degree
  0xd7: [584, 584], // multiplication sign
  0xc4: [667, 722],
  0xd6: [778, 778],
  0xdc: [722, 722],
  0xdf: [611, 611],
  0xe0: [556, 556],
  0xe4: [556, 556],
  0xf6: [556, 611],
  0xfc: [556, 611],
};

/** Unicode → WinAnsi byte; characters outside the set become "?". */
export function winAnsiBytes(value: string): number[] {
  const special: Record<string, number> = {
    "–": 0x96,
    "—": 0x97,
    "’": 0x92,
    "“": 0x93,
    "”": 0x94,
    "…": 0x85,
    "€": 0x80,
  };
  return Array.from(value).map((char) => {
    const mapped = special[char];
    if (mapped !== undefined) return mapped;
    const code = char.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) {
      return code;
    }
    return 0x3f;
  });
}

/** Text width in points for the standard Helvetica faces. */
export function textWidthPt(
  value: string,
  sizePt: number,
  bold: boolean,
): number {
  const table = bold ? HELVETICA_BOLD_ASCII : HELVETICA_ASCII;
  const units = winAnsiBytes(value).reduce((total, byte) => {
    if (byte >= 32 && byte <= 126) return total + table[byte - 32]!;
    const latin = LATIN1_WIDTHS[byte];
    return total + (latin ? latin[bold ? 1 : 0] : 556);
  }, 0);
  return (units * sizePt) / 1000;
}

function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function color(hex: string): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const channels = [0, 2, 4].map(
    (index) => parseInt(full.slice(index, index + 2), 16) / 255,
  );
  return channels.map((channel) => num(channel)).join(" ");
}

function pageX(x: number): number {
  return x * MM_TO_PT;
}

function pageY(y: number, pageHeightMm: number): number {
  return (pageHeightMm - y) * MM_TO_PT;
}

function path(points: readonly SheetPoint[], heightMm: number): string {
  return points
    .map(
      (point, index) =>
        `${num(pageX(point.x))} ${num(pageY(point.y, heightMm))} ${index === 0 ? "m" : "l"}`,
    )
    .join(" ");
}

function primitiveOps(primitive: SheetPrimitive, heightMm: number): string {
  switch (primitive.kind) {
    case "polygon": {
      const ops = [path(primitive.points, heightMm), "h"];
      const fill = primitive.fill;
      const stroke = primitive.stroke;
      const prefix = [
        fill ? `${color(fill)} rg` : "",
        stroke
          ? `${color(stroke)} RG ${num(primitive.strokeWidthMm * MM_TO_PT)} w`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const paint = fill && stroke ? "B" : fill ? "f" : stroke ? "S" : "n";
      return `${prefix} ${ops.join(" ")} ${paint}`.trim();
    }
    case "line":
      return `${color(primitive.stroke)} RG ${num(primitive.strokeWidthMm * MM_TO_PT)} w ${path([primitive.from, primitive.to], heightMm)} S`;
    case "text": {
      const width = textWidthPt(
        primitive.text,
        primitive.sizePt,
        primitive.bold,
      );
      const shift =
        primitive.anchor === "end"
          ? width
          : primitive.anchor === "middle"
            ? width / 2
            : 0;
      // Clockwise on the y-down page is clockwise on paper: angle -θ in PDF.
      const radians = (-primitive.rotateDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const x = pageX(primitive.at.x) - shift * cos;
      const y = pageY(primitive.at.y, heightMm) - shift * sin;
      const hex = winAnsiBytes(primitive.text)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return `BT ${color(primitive.fill)} rg /${primitive.bold ? "F2" : "F1"} ${num(primitive.sizePt)} Tf ${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(x)} ${num(y)} Tm <${hex}> Tj ET`;
    }
  }
}

function latin1(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function pdfHexString(value: string): string {
  return `<${winAnsiBytes(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}>`;
}

export function renderSheetPdf(document: SheetDocument): Uint8Array {
  const content = document.primitives
    .map((primitive) => primitiveOps(primitive, document.heightMm))
    .join("\n");
  const widthPt = num(document.widthMm * MM_TO_PT);
  const heightPt = num(document.heightMm * MM_TO_PT);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfHexString(document.title)} /Producer (Pallet planner) >>`,
  ];
  let output = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return latin1(output);
}

/** Point size → page millimetres, for layout code that mixes both. */
export function ptToMm(sizePt: number): number {
  return sizePt * PT_TO_MM;
}
