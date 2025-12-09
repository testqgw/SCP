import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LayoutDashboard, MessageSquare, Users, Settings, LogOut } from "lucide-react";

const ADMIN_EMAILS = [
    "quincy@ultops.com",
    "quincygw@gmail.com", // Your actual email
    process.env.ADMIN_EMAIL
].filter(Boolean);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const user = await currentUser();

    if (!user || !user.emailAddresses.some(email => ADMIN_EMAILS.includes(email.emailAddress))) {
        redirect("/dashboard"); // Redirect unauthorized users back to dashboard
    }

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex">
            {/* SIDEBAR */}
            <aside className="w-64 bg-[#0B1120] text-white flex-shrink-0 hidden md:flex flex-col">
                <div className="p-6 border-b border-slate-800 flex items-center gap-2">
                    <Logo className="w-8 h-8" />
                    <span className="text-xl font-bold tracking-tight">
                        Ult<span className="text-blue-400">Ops</span> <span className="text-xs text-slate-500 ml-1">ADMIN</span>
                    </span>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    <Link href="/admin" className="flex items-center gap-3 px-3 py-2 rounded-md bg-slate-800 text-white">
                        <MessageSquare className="w-5 h-5" />
                        Feedback
                    </Link>
                    <Link href="/admin/users" className="flex items-center gap-3 px-3 py-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors">
                        <Users className="w-5 h-5" />
                        Users (Soon)
                    </Link>
                </nav>

                <div className="p-4 border-t border-slate-800">
                    <div className="flex items-center gap-3 px-3 py-2 text-slate-400">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                            A
                        </div>
                        <div className="text-sm">
                            <p className="text-white font-medium">Admin</p>
                            <p className="text-xs">Super User</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* MAIN CONTENT */}
            <main className="flex-1 overflow-y-auto">
                <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-8">
                    <h1 className="text-xl font-semibold text-slate-800">Admin Dashboard</h1>
                    <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
                        Back to App
                    </Link>
                </header>
                <div className="p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
