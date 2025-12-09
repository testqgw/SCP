"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, FileText, MessageSquare } from "lucide-react";

interface NavLinkProps {
    href: string;
    icon: React.ReactNode;
    text: string;
}

function NavLink({ href, icon, text }: NavLinkProps) {
    const pathname = usePathname();

    // For exact /dashboard match, only highlight if we're exactly on /dashboard
    // For other paths, highlight if pathname starts with the href
    const isActive = href === '/dashboard'
        ? pathname === '/dashboard'
        : pathname.startsWith(href);

    return (
        <Link
            href={href}
            className={`px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${isActive
                ? "text-white bg-slate-800"
                : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
        >
            {icon}
            {text}
        </Link>
    );
}

export function DashboardNav() {
    return (
        <div className="hidden md:flex items-center space-x-1">
            <NavLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />} text="Dashboard" />
            <NavLink href="/dashboard/businesses" icon={<Building2 className="w-4 h-4" />} text="Businesses" />
            <NavLink href="/dashboard/licenses" icon={<FileText className="w-4 h-4" />} text="Licenses" />
            <NavLink href="/dashboard/documents" icon={<FileText className="w-4 h-4" />} text="Documents" />
            <NavLink href="/dashboard/messages" icon={<MessageSquare className="w-4 h-4" />} text="Messages" />
        </div>
    );
}

