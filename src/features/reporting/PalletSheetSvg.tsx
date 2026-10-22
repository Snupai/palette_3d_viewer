import {
  PT_TO_MM,
  type SheetDocument,
} from "~/features/reporting/sheetPrimitives";

/**
 * On-screen preview of the printed sheet. It renders the same primitives as
 * the PDF writer, so what the user sees is what the PDF contains. Helvetica
 * is requested to match the PDF's standard font metrics.
 */
export function PalletSheetSvg({
  sheet,
  className,
}: {
  sheet: SheetDocument;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}
      role="img"
      aria-label={sheet.title}
      className={className}
      style={{ background: "#ffffff" }}
      fontFamily="Helvetica, Arial, sans-serif"
    >
      {sheet.primitives.map((primitive, index) => {
        switch (primitive.kind) {
          case "polygon":
            return (
              <polygon
                key={index}
                points={primitive.points
                  .map(({ x, y }) => `${x},${y}`)
                  .join(" ")}
                fill={primitive.fill ?? "none"}
                stroke={primitive.stroke ?? "none"}
                strokeWidth={primitive.strokeWidthMm}
                strokeLinejoin="round"
              />
            );
          case "line":
            return (
              <line
                key={index}
                x1={primitive.from.x}
                y1={primitive.from.y}
                x2={primitive.to.x}
                y2={primitive.to.y}
                stroke={primitive.stroke}
                strokeWidth={primitive.strokeWidthMm}
              />
            );
          case "text":
            return (
              <text
                key={index}
                x={primitive.at.x}
                y={primitive.at.y}
                fontSize={primitive.sizePt * PT_TO_MM}
                fontWeight={primitive.bold ? 700 : 400}
                fill={primitive.fill}
                textAnchor={primitive.anchor}
                transform={
                  primitive.rotateDeg
                    ? `rotate(${primitive.rotateDeg} ${primitive.at.x} ${primitive.at.y})`
                    : undefined
                }
              >
                {primitive.text}
              </text>
            );
        }
      })}
    </svg>
  );
}
