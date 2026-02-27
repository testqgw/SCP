import type { Metadata } from "next";
import { Space_Grotesk, Archivo_Black } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo-black",
});

export const metadata: Metadata = {
  title: "NBA Snapshot Board",
  description:
    "Private NBA player prop intelligence board with last-5 hit rates, bounce-back signals, and opponent archetype allowance.",
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
