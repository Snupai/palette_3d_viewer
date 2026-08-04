import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://rob.snupai.dev",
  ),
  title: {
    default: "Pallet 3D Viewer",
    template: "%s | Pallet 3D Viewer",
  },
  description: "Visualize .rob pallet layouts in 3D.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  openGraph: {
    title: "Pallet 3D Viewer",
    description: "Visualize .rob pallet layouts in 3D.",
    siteName: "Pallet 3D Viewer",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Pallet 3D Viewer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pallet 3D Viewer",
    description: "Visualize .rob pallet layouts in 3D.",
    images: ["/opengraph-image"],
  },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body className="bg-zinc-950">{children}</body>
    </html>
  );
}
