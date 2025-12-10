"use client";

import Link from "next/link";
import { Check, ShieldCheck, Truck, Building2, Store, X, Rocket, Sparkles } from "lucide-react";
import { onSubscribe } from "@/actions/stripe-redirect";
import { toast } from "sonner";

const tiers = [
    {
        name: "🚀 Founding Member",
        price: "$0",
        period: "for 3 months",
        description: "Full Pro access FREE. Be part of our founding community.",
        icon: Rocket,
        features: [
            "Unlimited Businesses",
            "Unlimited Licenses & Permits",
            "Email Expiration Alerts",
            "Secure Document Vault",
            "Unlimited Team Members",
            "Then just $49/mo after trial",
        ],
        cta: "🎉 Claim Free Access",
        href: "/sign-up?plan=founding",
        featured: true,
        highlighted: true,
        priceId: null, // Free signup
        isFoundingMember: true,
    },
    {
        name: "The Starter",
        price: "$0",
        description: "For new trucks just getting permits organized.",
        icon: Store,
        features: [
            "1 Business Entity",
            "Limit: 3 Licenses Tracked",
            "Email Reminders",
            "Basic Document Storage",
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
            "Email Expiration Alerts",
            "Secure Document Vault",
            "2 Team Members",
        ],
        cta: "Subscribe Now",
        href: "/sign-up?plan=standard",
        featured: false,
        highlighted: false,
        priceId: "price_1ScscN9HXJ0MifVdh6FBWoku",
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
        cta: "Subscribe Now",
        href: "/sign-up?plan=growth",
        featured: false,
        highlighted: false,
        priceId: "price_1Scse99HXJ0MifVdGh9NhzyC",
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
        cta: "Subscribe Now",
        href: "/sign-up?plan=commissary",
        featured: false,
        highlighted: false,
        priceId: "price_1Scsew9HXJ0MifVd8URkdiuz",
    },
];

export default function PricingSection() {
    const onCheckout = async (priceId: string, mode: "subscription" | "payment" = "subscription") => {
        try {
            const response = await onSubscribe(priceId, mode);
            if (response.url) {
                window.location.href = response.url;
            } else if (response.error) {
                // If unauthorized, redirect directly to sign up WITHOUT showing error toast
                if (response.error === "Unauthorized") {
                    window.location.href = "/sign-up";
                    return;
                }
                // Only show toast for actual errors, not auth redirects
                toast.error(response.error);
            }
        } catch (error) {
            // Redirect to sign-up on any error (likely unauthorized)
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

                {/* Pricing Grid - 5 columns now */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                    {tiers.map((tier) => {
                        const isFoundingMember = 'isFoundingMember' in tier && tier.isFoundingMember;

                        return (
                            <div
                                key={tier.name}
                                className={`relative flex flex-col rounded-2xl border p-6 shadow-sm transition-all hover:shadow-md ${isFoundingMember
                                    ? "border-emerald-500 ring-2 ring-emerald-500 bg-gradient-to-b from-emerald-50 to-white scale-105 z-10"
                                    : tier.highlighted
                                        ? "border-blue-600 ring-1 ring-blue-600 bg-white scale-105 z-10"
                                        : "border-gray-200 bg-white"
                                    }`}
                            >
                                {isFoundingMember ? (
                                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-1 text-sm font-bold text-white shadow-lg animate-pulse">
                                        ✨ Limited Time
                                    </div>
                                ) : tier.highlighted && (
                                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-sm font-semibold text-white shadow-sm">
                                        Most Popular
                                    </div>
                                )}

                                <div className={`mb-4 flex items-center justify-center h-10 w-10 rounded-lg ${isFoundingMember
                                    ? "bg-emerald-100 text-emerald-600"
                                    : tier.highlighted
                                        ? "bg-blue-100 text-blue-600"
                                        : "bg-gray-100 text-gray-600"
                                    }`}>
                                    <tier.icon className="h-5 w-5" />
                                </div>

                                <h3 className={`text-lg font-semibold ${isFoundingMember ? "text-emerald-700" : "text-gray-900"}`}>{tier.name}</h3>
                                <p className="mt-2 text-sm text-gray-500 min-h-[40px]">{tier.description}</p>

                                <div className="my-4 flex items-baseline gap-2">
                                    <span className={`text-3xl font-bold tracking-tight ${isFoundingMember ? "text-emerald-600" : "text-gray-900"}`}>
                                        {tier.price}
                                    </span>
                                    {'period' in tier ? (
                                        <span className="text-sm font-semibold text-emerald-600">{tier.period}</span>
                                    ) : (
                                        tier.price !== "$0" && <span className="text-sm font-semibold text-gray-500">/month</span>
                                    )}
                                </div>

                                <ul className="mb-8 space-y-3 flex-1">
                                    {tier.features.map((feature) => (
                                        <li key={feature} className="flex items-start">
                                            <Check className={`h-5 w-5 flex-shrink-0 ${isFoundingMember ? "text-emerald-500" :
                                                tier.highlighted ? "text-blue-600" : "text-green-500"
                                                }`} />
                                            <span className="ml-3 text-sm text-gray-600">
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
                                        onClick={() => onCheckout(tier.priceId!, ('paymentMode' in tier ? tier.paymentMode : 'subscription') as "subscription" | "payment")}
                                        className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${tier.highlighted
                                            ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                                            : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                            }`}
                                    >
                                        {tier.cta}
                                    </button>
                                ) : (
                                    // Free tier - sign up link (special button for Founding Member)
                                    <Link
                                        href={tier.href}
                                        className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${isFoundingMember
                                            ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 shadow-lg"
                                            : tier.highlighted
                                                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                                                : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                            }`}
                                    >
                                        {tier.cta}
                                    </Link>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
