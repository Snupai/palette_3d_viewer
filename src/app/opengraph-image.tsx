import { ImageResponse } from "next/og";

export const alt = "Palettenplaner";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          background: "#e7e9e4",
          color: "#1d1b18",
          padding: 64,
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        <div style={{ opacity: 0.9 }}>Palettenplaner</div>
        <div
          style={{ fontSize: 24, fontWeight: 500, opacity: 0.85, marginTop: 8 }}
        >
          Neue Pläne erstellen. Vorhandene Pläne prüfen.
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
