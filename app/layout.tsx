import type { Metadata } from "next";
import { Manrope, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Manrope({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const archivoBlack = Barlow_Condensed({
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-archivo-black",
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
      <body className={`${spaceGrotesk.variable} ${archivoBlack.variable}`}>{children}</body>
    </html>
  );
}
