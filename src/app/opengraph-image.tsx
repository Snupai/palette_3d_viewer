import { ImageResponse } from "next/og";

export const alt = "Pallet 3D Viewer";
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
          background: "linear-gradient(135deg, #2e026d 0%, #15162c 100%)",
          color: "white",
          padding: 64,
          fontSize: 56,
          fontWeight: 800,
          letterSpacing: -1,
        }}
      >
        <div style={{ opacity: 0.9 }}>Pallet 3D Viewer</div>
        <div style={{ fontSize: 24, fontWeight: 500, opacity: 0.85, marginTop: 8 }}>
          Visualize .rob pallet layouts in 3D
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}


