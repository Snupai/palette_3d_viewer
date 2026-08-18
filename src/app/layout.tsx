import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://rob.snupai.dev",
  ),
  title: {
    default: "Pallet Plan Inspection Desk",
    template: "%s | Pallet Plan Inspection Desk",
  },
  description:
    "Generate, compare, stack, and validate pallet plans against observed .rob references.",
  openGraph: {
    title: "Pallet Plan Inspection Desk",
    description:
      "Generate, compare, stack, and validate pallet plans against observed .rob references.",
    siteName: "Pallet Plan Inspection Desk",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Pallet Plan Inspection Desk",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pallet Plan Inspection Desk",
    description:
      "Generate, compare, stack, and validate pallet plans against observed .rob references.",
    images: ["/opengraph-image"],
  },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="bg-[var(--canvas)] text-[var(--ink)]">{children}</body>
    </html>
  );
}
