"use client";

import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
                <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
                <p className="text-slate-400 mb-8">Last updated: December 5, 2024</p>

                <div className="prose prose-invert prose-slate max-w-none space-y-8">
                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">1. Information We Collect</h2>
                        <p className="text-slate-400 leading-relaxed">
                            SafeOps collects information you provide directly, including your name, email address, phone number,
                            and business information. We also collect data about your licenses, permits, and uploaded documents
                            to provide our compliance tracking services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">2. How We Use Your Information</h2>
                        <p className="text-slate-400 leading-relaxed">
                            We use your information to provide, maintain, and improve our services, including sending
                            SMS and email reminders about upcoming license expirations. We may also use your information
                            to communicate with you about your account and respond to support requests.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">3. SMS Communications</h2>
                        <p className="text-slate-400 leading-relaxed">
                            By providing your phone number and opting in to SMS alerts, you consent to receive automated
                            text messages about license expirations and compliance reminders. Message frequency varies.
                            Standard message and data rates may apply. Reply STOP to cancel at any time.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">4. Data Security</h2>
                        <p className="text-slate-400 leading-relaxed">
                            We implement industry-standard security measures to protect your personal information.
                            Your documents are stored securely and encrypted. We do not sell your personal information
                            to third parties.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-semibold text-white mb-4">5. Contact Us</h2>
                        <p className="text-slate-400 leading-relaxed">
                            If you have questions about this Privacy Policy, please contact us at{" "}
                            <a href="mailto:privacy@safeops.com" className="text-blue-400 hover:underline">privacy@safeops.com</a>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
}
