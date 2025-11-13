import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { isClerkConfigured } from "@/lib/clerk-config";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Compliance Reminder - License Renewal Tracking",
  description: "Never miss a license renewal again",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerkConfigured = isClerkConfigured();

  // Development mode without Clerk
  if (!clerkConfigured) {
    return (
      <html lang="en">
        <body className={inter.className}>
          <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4">
            <p className="font-bold">⚠️ Clerk Authentication Not Configured</p>
            <p className="text-sm">Add your Clerk API keys to .env to enable authentication. Site running in development mode.</p>
          </div>
          <div className="min-h-screen bg-gray-50">
            {children}
          </div>
        </body>
      </html>
    );
  }

  // Production mode with Clerk
  const { ClerkProvider } = require("@clerk/nextjs");
  
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>
          <div className="min-h-screen bg-gray-50">
            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}