import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, Building2, FileText, Settings } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import FeedbackWidget from "@/components/FeedbackWidget";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = auth();

  // Fetch Tier
  const user = await prisma.user.findUnique({
    where: { id: userId as string },
    select: { subscriptionTier: true }
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
                  Safe<span className="text-blue-400">Ops</span>
                </span>
              </Link>

              {/* BADGE */}
              <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isPro
                ? "bg-blue-600/20 text-blue-200 border-blue-500/30"
                : "bg-slate-700/50 text-slate-300 border-slate-600"
                }`}>
                {isPro ? "PRO" : "FREE PLAN"}
              </div>
            </div>

            {/* MIDDLE: NAVIGATION LINKS */}
            <div className="hidden md:flex items-center space-x-1">
              <NavLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} text="Dashboard" active />
              <NavLink href="/dashboard/businesses" icon={<Building2 className="w-4 h-4" />} text="Businesses" />
              <NavLink href="/dashboard/licenses" icon={<FileText className="w-4 h-4" />} text="Licenses" />
              <NavLink href="/dashboard/documents" icon={<FileText className="w-4 h-4" />} text="Documents" />
            </div>

            {/* RIGHT: USER & SETTINGS */}
            <div className="flex items-center gap-4">
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

// Helper component for cleaner links
function NavLink({ href, icon, text, active = false }: { href: string, icon: React.ReactNode, text: string, active?: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${active ? "text-white bg-slate-800" : "text-slate-400 hover:text-white hover:bg-slate-800/50"
        }`}
    >
      {icon}
      {text}
    </Link>
  )
}