"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

interface MobileMenuProps {
    links: Array<{ href: string; label: string }>;
}

export function MobileMenu({ links }: MobileMenuProps) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="sm:hidden">
            {/* Hamburger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={isOpen ? "Close menu" : "Open menu"}
                aria-expanded={isOpen}
            >
                {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>

            {/* Mobile Menu Overlay */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Menu Panel */}
                    <div className="fixed top-0 right-0 w-64 h-full bg-[#0F172A] border-l border-slate-800 z-50 p-6 shadow-2xl">
                        <div className="flex justify-end mb-8">
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                                aria-label="Close menu"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <nav className="flex flex-col gap-4">
                            {links.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setIsOpen(false)}
                                    className="text-lg font-medium text-slate-300 hover:text-white transition-colors py-2 border-b border-slate-800"
                                >
                                    {link.label}
                                </Link>
                            ))}

                            <Link
                                href="/sign-up"
                                onClick={() => setIsOpen(false)}
                                className="mt-4 rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
                            >
                                Get Started
                            </Link>
                        </nav>
                    </div>
                </>
            )}
        </div>
    );
}
