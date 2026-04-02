import type { Metadata } from "next";
import { Inter, Oswald } from "next/font/google";
import "./globals.css";

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Oswald({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "ULTOPS NBA | Player Prop Intelligence",
  description:
    "Professional NBA player prop intelligence with ranked precision picks, live line context, and full player-by-player research tools.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>{children}</body>
    </html>
  );
}
