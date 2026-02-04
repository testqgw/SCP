import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Mail, MessageCircle, Clock, ArrowLeft } from "lucide-react";

export default function ContactPage() {
    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            {/* NAVBAR */}
            <nav className="mx-auto max-w-7xl px-6 lg:px-8 pt-6 flex justify-between items-center">
                <Link href="/" className="text-xl font-bold tracking-tight flex items-center gap-2">
                    <Logo className="w-8 h-8" />
                    <span>Ult<span className="text-blue-400">Ops</span></span>
                </Link>
                <Link
                    href="/"
                    className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                >
                    <ArrowLeft className="w-4 h-4" /> Back to Home
                </Link>
            </nav>

            {/* MAIN CONTENT */}
            <main className="mx-auto max-w-3xl px-6 lg:px-8 py-20">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold tracking-tight mb-4">
                        Need Help? <span className="text-blue-400">We're Here.</span>
                    </h1>
                    <p className="text-lg text-slate-400">
                        Have a question, issue, or just want to say hi? Don't hesitate to reach out.
                    </p>
                </div>

                {/* CONTACT CARD */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 mb-8">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center">
                            <Mail className="w-7 h-7 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-white">Email Us Directly</h2>
                            <p className="text-slate-400 text-sm">We typically respond within 24 hours</p>
                        </div>
                    </div>

                    <a
                        href="mailto:masterq@ultops.com"
                        className="block w-full bg-blue-600 hover:bg-blue-500 text-white text-center py-4 rounded-xl font-semibold text-lg transition-all shadow-lg shadow-blue-900/30 hover:shadow-blue-900/50"
                    >
                        masterq@ultops.com
                    </a>
                </div>

                {/* FAQ QUICK ANSWERS */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 mb-8">
                    <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-slate-400" />
                        Common Questions
                    </h3>

                    <div className="space-y-4">
                        <div className="border-b border-slate-800 pb-4">
                            <p className="text-white font-medium mb-1">How do I add my first license?</p>
                            <p className="text-slate-400 text-sm">
                                Go to Dashboard → Licenses → Add New. Upload your document and set the expiration date.
                            </p>
                        </div>
                        <div className="border-b border-slate-800 pb-4">
                            <p className="text-white font-medium mb-1">When do I get reminder notifications?</p>
                            <p className="text-slate-400 text-sm">
                                We send reminders at 90, 60, 30, 14, 7, and 1 day before expiration via email.
                            </p>
                        </div>
                        <div className="border-b border-slate-800 pb-4">
                            <p className="text-white font-medium mb-1">Can I cancel my subscription?</p>
                            <p className="text-slate-400 text-sm">
                                Yes! Go to Dashboard → Settings to manage your subscription. Cancel anytime.
                            </p>
                        </div>
                        <div>
                            <p className="text-white font-medium mb-1">What if I need help setting everything up?</p>
                            <p className="text-slate-400 text-sm">
                                Check out our <Link href="/#pricing" className="text-blue-400 hover:underline">VIP Onboarding</Link> — we'll set up your entire account for you.
                            </p>
                        </div>
                    </div>
                </div>

                {/* RESPONSE TIME */}
                <div className="text-center text-slate-500 text-sm flex items-center justify-center gap-2">
                    <Clock className="w-4 h-4" />
                    We typically respond within 24 hours during business days
                </div>
            </main>

            {/* FOOTER */}
            <footer className="border-t border-slate-800 py-8 mt-20">
                <div className="mx-auto max-w-7xl px-6 lg:px-8 text-center text-slate-500 text-sm">
                    © {new Date().getFullYear()} UltOps Inc. All rights reserved.
                </div>
            </footer>
        </div>
    );
}
