import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Settings, ShieldAlert, Home } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import FeedbackWidget from "@/components/FeedbackWidget";
import { DashboardNav } from "@/components/dashboard/Navbar";

// Force Vercel redeploy - Dec 4 2024

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth();

  // Fetch Tier
  const user = await prisma.user.findUnique({
    where: { id: userId as string },
    select: { subscriptionTier: true, role: true }
  });

  const isPro = user?.subscriptionTier === 'professional' || user?.subscriptionTier === 'multi_location';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* TOP NAVIGATION */}
      <nav className="bg-[#0B1120] border-b border-slate-800 text-white sticky top-0 z-50 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">

            {/* LEFT: LOGO & BADGE */}
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="flex items-center gap-2">
                <Logo className="w-8 h-8" />
                <span className="text-xl font-bold tracking-tight">
                  Ult<span className="text-blue-400">Ops</span>
                </span>
              </Link>

              {/* BADGE */}
              {user?.role === 'ADMIN' ? (
                <Link href="/admin">
                  <div className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-red-100 text-red-700 border-red-200 cursor-pointer hover:bg-red-200 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> MASTER ADMIN
                  </div>
                </Link>
              ) : (
                <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isPro
                  ? "bg-blue-600/20 text-blue-200 border-blue-500/30"
                  : "bg-slate-700/50 text-slate-300 border-slate-600"
                  }`}>
                  {isPro ? "PRO" : "FREE PLAN"}
                </div>
              )}
            </div>

            {/* MIDDLE: NAVIGATION LINKS */}
            <DashboardNav />

            {/* RIGHT: HOME, SETTINGS & USER */}
            <div className="flex items-center gap-4">
              <Link href="/" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors" title="Back to Home">
                <Home className="w-5 h-5" />
              </Link>
              <Link href="/dashboard/settings" className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors">
                <Settings className="w-5 h-5" />
              </Link>
              <UserButton afterSignOutUrl="/" appearance={{
                elements: {
                  avatarBox: "w-8 h-8 border-2 border-slate-700"
                }
              }} />
            </div>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Feedback Widget */}
      <FeedbackWidget />
    </div>
  );
}