import "~/styles/globals.css";

import { type Metadata } from "next";
import localFont from "next/font/local";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://rob.snupai.dev",
  ),
  title: {
    default: "Palettenplaner",
    template: "%s | Palettenplaner",
  },
  description:
    "Palettierpläne erstellen, passende Lagenmuster finden und vorhandene .rob-Pläne ansehen.",
  openGraph: {
    title: "Palettenplaner",
    description:
      "Palettierpläne erstellen, passende Lagenmuster finden und vorhandene .rob-Pläne ansehen.",
    siteName: "Palettenplaner",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Palettenplaner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Palettenplaner",
    description:
      "Palettierpläne erstellen, passende Lagenmuster finden und vorhandene .rob-Pläne ansehen.",
    images: ["/opengraph-image"],
  },
};

const barlow = localFont({
  src: [
    { path: "../../public/fonts/barlow-400.ttf", weight: "400" },
    { path: "../../public/fonts/barlow-500.ttf", weight: "500" },
    { path: "../../public/fonts/barlow-600.ttf", weight: "600" },
    { path: "../../public/fonts/barlow-700.ttf", weight: "700" },
  ],
  variable: "--font-barlow",
  display: "swap",
});
const condensed = localFont({
  src: [
    { path: "../../public/fonts/barlow-condensed-500.ttf", weight: "500" },
    { path: "../../public/fonts/barlow-condensed-600.ttf", weight: "600" },
    { path: "../../public/fonts/barlow-condensed-700.ttf", weight: "700" },
  ],
  variable: "--font-barlow-condensed",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className={`${barlow.variable} ${condensed.variable}`}>
      <body className="bg-canvas text-ink">{children}</body>
    </html>
  );
}
