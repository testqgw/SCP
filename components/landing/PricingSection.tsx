"use client";

import Link from "next/link";
import { Check, ShieldCheck, Truck, Building2, Store } from "lucide-react";
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
            "Track <strong>3</strong> Licenses",
            "Standard Email Reminders",
            "Basic Document Uploads",
        ],
        cta: "Start for Free",
        href: "/sign-up?plan=free",
        highlighted: false,
        priceId: null,
    },
    {
        name: "Owner Operator",
        price: "$49",
        period: "/month",
        description: "Total compliance for one location.",
        icon: Truck,
        features: [
            "<strong>1</strong> Business",
            "<strong>Unlimited</strong> Licenses & Permits",
            "<strong>Inspection-Ready</strong> Document Vault",
            "Smart Email Alerts (Escalation)",
            "<strong>2</strong> Team Members",
        ],
        cta: "Start Trial",
        href: "/sign-up?plan=standard",
        highlighted: true,
        priceId: "price_1ScscN9HXJ0MifVdh6FBWoku",
    },
    {
        name: "Fleet Manager",
        price: "$99",
        period: "/month",
        description: "Control for growing groups.",
        icon: Building2,
        features: [
            "<strong>5</strong> Businesses",
            "<strong>Everything in Owner</strong>",
            "Admin & Staff Roles",
            "Activity/Audit Logs",
            "Priority Support",
        ],
        cta: "Subscribe",
        href: "/sign-up?plan=growth",
        highlighted: false,
        priceId: "price_1Scse99HXJ0MifVdGh9NhzyC",
    },
    {
        name: "Commissary",
        price: "$149",
        period: "/month",
        description: "Management for kitchens.",
        icon: ShieldCheck,
        features: [
            "<strong>15</strong> Businesses",
            "<strong>Everything in Fleet</strong>",
            "Tenant View Mode (Read-Only)",
            "Bulk License Import",
            "Dedicated Onboarding",
        ],
        cta: "Contact Sales",
        href: "mailto:sales@ultops.com?subject=Commissary Plan Inquiry",
        highlighted: false,
        priceId: null,
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
                        Start for free. Upgrade when you need unlimited tracking and more features.
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
                                {tier.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <Check className={`h-5 w-5 flex-shrink-0 mt-0.5 ${tier.highlighted ? "text-blue-600" : "text-green-500"}`} />
                                        <span className="text-sm text-gray-600" dangerouslySetInnerHTML={{ __html: feature }} />
                                    </li>
                                ))}
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
            </div>
        </section>
    );
}
