"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-[#0B1120] text-white">
            {/* Header */}
            <header className="border-b border-slate-800">
                <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <Logo className="w-8 h-8" />
                        <span className="text-xl font-bold">Safe<span className="text-blue-400">Ops</span></span>
                    </Link>
                    <Link href="/" className="text-slate-400 hover:text-white flex items-center gap-2 text-sm">
                        <ArrowLeft className="w-4 h-4" /> Back to Home
                    </Link>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-6 py-16">
                <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
                <p className="text-slate-400 mb-8">Last updated: December 5, 2024</p>

                <div className="prose prose-invert prose-slate max-w-none space-y-8">
                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">1. Acceptance of Terms</h2>
                        <p className="text-slate-400 leading-relaxed">
                            By accessing or using SafeOps, you agree to be bound by these Terms of Service.
                            If you do not agree to these terms, please do not use our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">2. Description of Service</h2>
                        <p className="text-slate-400 leading-relaxed">
                            SafeOps provides license and permit tracking services for food service businesses.
                            We send reminders about upcoming expirations and provide document storage.
                            Our service is designed to help you stay compliant, but does not guarantee compliance
                            with any regulatory requirements.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">3. User Responsibilities</h2>
                        <p className="text-slate-400 leading-relaxed">
                            You are responsible for maintaining accurate information about your licenses and permits.
                            SafeOps relies on the data you provide to send reminders. You are solely responsible
                            for ensuring your licenses are renewed on time and that you maintain compliance with
                            all applicable regulations.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">4. Subscription and Billing</h2>
                        <p className="text-slate-400 leading-relaxed">
                            Paid subscriptions are billed monthly or annually as selected. You may cancel your
                            subscription at any time. Refunds are handled on a case-by-case basis.
                            Free tier users may upgrade at any time.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">5. Limitation of Liability</h2>
                        <p className="text-slate-400 leading-relaxed">
                            SafeOps is not liable for any fines, penalties, or damages resulting from expired
                            licenses or permits. While we strive to send timely reminders, delivery of SMS and
                            email messages cannot be guaranteed. You acknowledge that compliance with regulatory
                            requirements is your sole responsibility.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">6. Contact Us</h2>
                        <p className="text-slate-400 leading-relaxed">
                            If you have questions about these Terms, please contact us at{" "}
                            <a href="mailto:legal@safeops.com" className="text-blue-400 hover:underline">legal@safeops.com</a>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
