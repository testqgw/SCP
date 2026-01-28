import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from '@clerk/nextjs';
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "UltOps | Automated Compliance Reminders",
  description: "Never miss a license renewal. Automated SMS and email alerts for contractors and food trucks.",
  keywords: ["compliance", "license renewal", "food truck permits", "SMS reminders", "permit tracking"],
  authors: [{ name: "UltOps" }],
  openGraph: {
    title: "UltOps | Automated Compliance Reminders",
    description: "Never miss a license renewal. Automated SMS and email alerts for contractors and food trucks.",
    url: "https://ultops.com",
    siteName: "UltOps",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "UltOps | Automated Compliance Reminders",
    description: "Never miss a license renewal. Automated SMS and email alerts for contractors and food trucks.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>
          <div className="min-h-screen bg-gray-50">
            {children}
          </div>
          <Toaster position="bottom-right" />
        </body>
      </html>
    </ClerkProvider>
  );
}