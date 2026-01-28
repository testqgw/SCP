"use client";

import Link from "next/link";
import { Check, ShieldCheck, Truck, Building2, Store, Sparkles } from "lucide-react";
import { onSubscribe } from "@/actions/stripe-redirect";
import { toast } from "sonner";

const tiers = [
    {
        name: "Starter",
        price: "$0",
        period: "forever",
        description: "For simplified tracking.",
        icon: Store,
        features: [
            "<strong>1</strong> Business",
            "<strong>Limit: 3</strong> Licenses",
            "Email Reminders",
            "Basic Document Storage",
        ],
        cta: "Start for Free",
        href: "/sign-up?plan=free",
        highlighted: false,
        priceId: null,
        isContactSales: false,
    },
    {
        name: "Owner Operator",
        price: "$49",
        period: "/month",
        description: "For trucks & small teams.",
        icon: Truck,
        features: [
            "<strong>1</strong> Business",
            "<strong>Limit: 20</strong> Licenses",
            "<strong>Inspection-Ready</strong> Document Vault",
            "Smart Email Alerts",
            "<strong>2</strong> Team Members",
        ],
        cta: "Subscribe",
        href: "/sign-up?plan=standard",
        highlighted: true,
        priceId: "price_1ScscN9HXJ0MifVdh6FBWoku",
        isContactSales: false,
    },
    {
        name: "Fleet Manager",
        price: "$99",
        period: "/month",
        description: "For growing restaurants & groups.",
        icon: Building2,
        features: [
            "<strong>5</strong> Businesses",
            "<strong>Limit: 100</strong> Licenses",
            "<strong>Everything in Owner +</strong>",
            "Admin & Staff Roles",
            "Activity/Audit Logs",
            "Priority Support",
        ],
        cta: "Subscribe",
        href: "/sign-up?plan=growth",
        highlighted: false,
        priceId: "price_1Scse99HXJ0MifVdGh9NhzyC",
        isContactSales: false,
    },
    {
        name: "Commissary",
        price: "$399",
        period: "/month",
        description: "For kitchens managing tenant trucks.",
        icon: ShieldCheck,
        features: [
            "<strong>10</strong> Businesses Included",
            "<strong>Unlimited</strong> Licenses",
            "<strong>Everything in Fleet +</strong>",
            "Tenant Compliance Dashboard",
            "Bulk License Import",
            "Dedicated Onboarding",
        ],
        cta: "Subscribe",
        href: "/sign-up?plan=commissary",
        highlighted: false,
        priceId: "price_1Scsew9HXJ0MifVd8URkdiuz",
        isContactSales: false,
    },
];

export default function PricingSection() {
    const onCheckout = async (priceId: string, mode: "subscription" | "payment" = "subscription") => {
        try {
            const response = await onSubscribe(priceId, mode);
            if (response.url) {
                window.location.href = response.url;
            } else if (response.error) {
                if (response.error === "Unauthorized") {
                    window.location.href = "/sign-up";
                    return;
                }
                toast.error(response.error);
            }
        } catch (error) {
            window.location.href = "/sign-up";
        }
    };

    return (
        <section className="py-24 bg-gray-50" id="pricing">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                        Simple pricing, zero hidden fines.
                    </h2>
                    <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
                        Start for free. Upgrade when you need more licenses and features.
                    </p>
                </div>

                {/* Pricing Grid - 4 columns */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {tiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`relative flex flex-col rounded-2xl border p-6 shadow-sm transition-all hover:shadow-md ${tier.highlighted
                                ? "border-blue-600 ring-2 ring-blue-600 bg-white scale-[1.02] z-10"
                                : "border-gray-200 bg-white"
                                }`}
                        >
                            {tier.highlighted && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-sm font-semibold text-white shadow-sm">
                                    Most Popular
                                </div>
                            )}

                            <div className={`mb-4 flex items-center justify-center h-12 w-12 rounded-xl ${tier.highlighted
                                ? "bg-blue-100 text-blue-600"
                                : "bg-gray-100 text-gray-600"
                                }`}>
                                <tier.icon className="h-6 w-6" />
                            </div>

                            <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                            <p className="mt-2 text-sm text-gray-500 min-h-[48px]">{tier.description}</p>

                            <div className="my-6 flex items-baseline gap-1">
                                <span className={`text-4xl font-bold tracking-tight ${tier.highlighted ? "text-blue-600" : "text-gray-900"}`}>
                                    {tier.price}
                                </span>
                                <span className="text-sm font-medium text-gray-500">{tier.period}</span>
                            </div>

                            <ul className="mb-8 space-y-3 flex-1">
                                {tier.features.map((feature, idx) => {
                                    // Safe parsing: extract bold text without dangerouslySetInnerHTML
                                    const parts = feature.split(/<strong>|<\/strong>/);
                                    return (
                                        <li key={idx} className="flex items-start gap-3">
                                            <Check className={`h-5 w-5 flex-shrink-0 mt-0.5 ${tier.highlighted ? "text-blue-600" : "text-green-500"}`} />
                                            <span className="text-sm text-gray-600">
                                                {parts.map((part, i) =>
                                                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                                                )}
                                            </span>
                                        </li>
                                    );
                                })}
                            </ul>

                            {tier.priceId ? (
                                <button
                                    onClick={() => onCheckout(tier.priceId!, 'subscription')}
                                    className={`block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold transition-all ${tier.highlighted
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/20"
                                        : "bg-gray-900 text-white hover:bg-gray-800"
                                        }`}
                                >
                                    {tier.cta}
                                </button>
                            ) : tier.isContactSales ? (
                                <a
                                    href={tier.href}
                                    className="block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 transition-all"
                                >
                                    {tier.cta}
                                </a>
                            ) : (
                                <Link
                                    href={tier.href}
                                    className="block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold bg-gray-100 text-gray-900 hover:bg-gray-200 transition-all"
                                >
                                    {tier.cta}
                                </Link>
                            )}
                        </div>
                    ))}
                </div>

                {/* VIP Onboarding Add-on */}
                <div className="mt-16 max-w-3xl mx-auto">
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-2xl p-8 text-center">
                        <div className="flex items-center justify-center gap-2 mb-4">
                            <Sparkles className="h-6 w-6 text-amber-500" />
                            <h3 className="text-2xl font-bold text-gray-900">VIP Onboarding</h3>
                            <Sparkles className="h-6 w-6 text-amber-500" />
                        </div>
                        <p className="text-lg text-gray-600 mb-4">
                            Too busy to set it up yourself? We&apos;ll do it for you.
                        </p>
                        <div className="text-4xl font-bold text-amber-600 mb-4">
                            $499 <span className="text-lg font-medium text-gray-500">one-time</span>
                        </div>
                        <ul className="text-left max-w-md mx-auto mb-6 space-y-2">
                            <li className="flex items-center gap-2 text-gray-700">
                                <Check className="h-5 w-5 text-amber-500" />
                                Send us your messy folder of documents
                            </li>
                            <li className="flex items-center gap-2 text-gray-700">
                                <Check className="h-5 w-5 text-amber-500" />
                                We verify, organize, and enter everything
                            </li>
                            <li className="flex items-center gap-2 text-gray-700">
                                <Check className="h-5 w-5 text-amber-500" />
                                Get a 100% ready-to-go account
                            </li>
                        </ul>
                        <a
                            href="mailto:masterq@ultops.com?subject=VIP Onboarding Request"
                            className="inline-block px-8 py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20"
                        >
                            Get VIP Setup
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
