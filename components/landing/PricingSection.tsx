"use client";

import Link from "next/link";
import { Check, ShieldCheck, Truck, Building2, Store, X } from "lucide-react";
import { onSubscribe } from "@/actions/stripe-redirect";
import { toast } from "sonner";

const tiers = [
    {
        name: "The Starter",
        price: "$0",
        description: "For new trucks just getting permits organized.",
        icon: Store,
        features: [
            "1 Business Entity",
            "Limit: 3 Licenses Tracked",
            "Email Reminders Only",
            "Basic Document Storage",
            "No SMS Alerts", // Clearly show what they are missing
        ],
        cta: "Get Started Free",
        href: "/sign-up?plan=free",
        featured: false,
        highlighted: false,
        priceId: null,
    },
    {
        name: "Owner Operator",
        price: "$49",
        description: "Perfect for the single food truck owner who can't afford downtime.",
        icon: Truck,
        features: [
            "1 Business Entity (Truck)",
            "Unlimited Licenses & Permits",
            "SMS & Email Expiration Alerts",
            "Secure Document Vault",
            "2 Team Members",
        ],
        cta: "Start Free Trial",
        href: "/sign-up?plan=standard",
        featured: true,
        highlighted: true,
        priceId: "price_1SXRu34ybcRPBciWNYNTDukK",
    },
    {
        name: "Fleet Manager",
        price: "$99",
        description: "For growing empires with multiple trucks or locations.",
        icon: Building2,
        features: [
            "Up to 5 Business Entities",
            "Everything in Owner Operator",
            "Role-Based Access (Admin/Viewer)",
            "Audit Logs (See who changed what)",
            "Priority Support",
        ],
        cta: "Start Free Trial",
        href: "/sign-up?plan=growth",
        featured: false,
        highlighted: false,
        priceId: "price_1SXRui4ybcRPBciWD2Nq4Xub",
    },
    {
        name: "Commissary",
        price: "$149",
        description: "For commissary kitchens managing permits for tenant trucks.",
        icon: ShieldCheck,
        features: [
            "Up to 15 Business Entities",
            "Client/Tenant View Mode",
            "Unlimited Team Members",
            "Bulk License Import",
            "Dedicated Account Manager",
        ],
        cta: "Start Free Trial",
        href: "/sign-up?plan=commissary",
        featured: false,
        highlighted: false,
        priceId: "price_1SXRw54ybcRPBciW4KwpyZWE",
    },
];

export default function PricingSection() {
    const onCheckout = async (priceId: string) => {
        try {
            const response = await onSubscribe(priceId);
            if (response.url) {
                window.location.href = response.url;
            } else if (response.error) {
                // If unauthorized, redirect directly to sign up without showing error
                if (response.error === "Unauthorized") {
                    window.location.href = "/sign-up";
                    return;
                }
                toast.error(response.error);
            }
        } catch (error) {
            toast.error("Something went wrong");
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
                        Start for free. Upgrade when you need SMS alerts and unlimited tracking.
                    </p>
                </div>

                {/* Changed grid-cols-3 to grid-cols-4 to fit all cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {tiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`relative flex flex-col rounded-2xl border p-6 shadow-sm transition-all hover:shadow-md ${tier.highlighted
                                ? "border-blue-600 ring-1 ring-blue-600 bg-white scale-105 z-10"
                                : "border-gray-200 bg-white"
                                }`}
                        >
                            {tier.highlighted && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-sm font-semibold text-white shadow-sm">
                                    Most Popular
                                </div>
                            )}

                            <div className={`mb-4 flex items-center justify-center h-10 w-10 rounded-lg ${tier.highlighted ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
                                }`}>
                                <tier.icon className="h-5 w-5" />
                            </div>

                            <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                            <p className="mt-2 text-sm text-gray-500 min-h-[40px]">{tier.description}</p>

                            <div className="my-4 flex items-baseline">
                                <span className="text-3xl font-bold tracking-tight text-gray-900">
                                    {tier.price}
                                </span>
                                {tier.price !== "$0" && <span className="text-sm font-semibold text-gray-500">/month</span>}
                            </div>

                            <ul className="mb-8 space-y-3 flex-1">
                                {tier.features.map((feature) => (
                                    <li key={feature} className="flex items-start">
                                        {/* Logic: If feature contains "No SMS", show an X icon */}
                                        {feature.includes("No SMS") ? (
                                            <X className="h-5 w-5 flex-shrink-0 text-gray-400" />
                                        ) : (
                                            <Check className={`h-5 w-5 flex-shrink-0 ${tier.highlighted ? "text-blue-600" : "text-green-500"}`} />
                                        )}
                                        <span className={`ml-3 text-sm ${feature.includes("No SMS") ? "text-gray-400" : "text-gray-600"}`}>
                                            {feature}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {/* Handle different button types based on tier configuration */}
                            {tier.href.startsWith("mailto:") ? (
                                // Contact Sales - opens email
                                <a
                                    href={tier.href}
                                    className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${tier.highlighted
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                                        : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                        }`}
                                >
                                    {tier.cta}
                                </a>
                            ) : tier.priceId ? (
                                // Paid tier with Stripe checkout
                                <button
                                    onClick={() => onCheckout(tier.priceId!)}
                                    className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${tier.highlighted
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                                        : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                        }`}
                                >
                                    {tier.cta}
                                </button>
                            ) : (
                                // Free tier - sign up link
                                <Link
                                    href={tier.href}
                                    className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${tier.highlighted
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                                        : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                        }`}
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
