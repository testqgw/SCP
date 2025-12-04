"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, ArrowLeft, Crown, Sparkles } from "lucide-react";
import { onSubscribe } from "@/actions/stripe-redirect";
import { toast } from "sonner";
import Link from "next/link";

const plans = [
    {
        id: "starter",
        name: "The Starter",
        price: "$0",
        period: "/mo",
        description: "For new businesses just getting organized.",
        features: ["1 Business", "3 Licenses Max", "Email Reminders Only"],
        priceId: null,
        tier: "starter"
    },
    {
        id: "professional",
        name: "Owner Operator",
        price: "$49",
        period: "/mo",
        description: "The standard for professional operators.",
        features: ["1 Business", "Unlimited Licenses", "SMS & Email Alerts", "2 Team Members"],
        priceId: "price_1SXRu34ybcRPBciWNYNTDukK",
        tier: "professional",
        popular: true
    },
    {
        id: "multi_location",
        name: "Fleet Manager",
        price: "$99",
        period: "/mo",
        description: "For owners with multiple locations.",
        features: ["Up to 5 Businesses", "Unlimited Licenses", "SMS & Email Alerts", "Priority Support"],
        priceId: "price_1SXRui4ybcRPBciWD2Nq4Xub",
        tier: "multi_location"
    },
    {
        id: "enterprise",
        name: "Commissary",
        price: "$149",
        period: "/mo",
        description: "For kitchens managing tenant businesses.",
        features: ["Up to 15 Businesses", "Unlimited Everything", "Dedicated Account Manager"],
        priceId: "price_1SXRw54ybcRPBciW4KwpyZWE",
        tier: "enterprise"
    }
];

export default function ChangePlanPage() {
    const [loading, setLoading] = useState<string | null>(null);
    const [currentTier, setCurrentTier] = useState<string>("starter");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        async function fetchCurrentPlan() {
            try {
                const res = await fetch("/api/settings");
                if (res.ok) {
                    const data = await res.json();
                    setCurrentTier(data.subscriptionTier || "starter");
                }
            } catch (error) {
                console.error("Failed to fetch plan");
            } finally {
                setIsLoading(false);
            }
        }
        fetchCurrentPlan();
    }, []);

    const onCheckout = async (priceId: string | null, planName: string) => {
        if (!priceId) {
            toast.error("Cannot downgrade to free plan from dashboard. Please contact support.");
            return;
        }

        setLoading(planName);
        try {
            const response = await onSubscribe(priceId);
            if (response.url) {
                window.location.href = response.url;
            } else {
                toast.error("Failed to create checkout session.");
            }
        } catch (error) {
            toast.error("Something went wrong. Please try again.");
        } finally {
            setLoading(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        );
    }

    const currentPlanIndex = plans.findIndex(p => p.tier === currentTier);

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header with back button */}
            <div className="mb-8">
                <Link
                    href="/dashboard/settings"
                    className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Settings
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">Change Your Plan</h1>
                <p className="text-slate-500 mt-1">Select a new plan. Changes take effect immediately.</p>
            </div>

            {/* Current Plan Indicator */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-8 flex items-center gap-3">
                <Crown className="w-5 h-5 text-blue-600" />
                <span className="text-blue-900">
                    You're currently on the <strong>{plans.find(p => p.tier === currentTier)?.name || "Starter"}</strong> plan
                </span>
            </div>

            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {plans.map((plan, index) => {
                    const isCurrentPlan = plan.tier === currentTier;
                    const isUpgrade = index > currentPlanIndex;
                    const isDowngrade = index < currentPlanIndex;

                    return (
                        <div
                            key={plan.id}
                            className={`relative p-6 rounded-xl border-2 transition-all ${isCurrentPlan
                                    ? "border-blue-500 bg-blue-50/50"
                                    : plan.popular
                                        ? "border-slate-900 bg-slate-900 text-white"
                                        : "border-slate-200 bg-white hover:border-slate-300"
                                }`}
                        >
                            {/* Current Plan Badge */}
                            {isCurrentPlan && (
                                <div className="absolute -top-3 left-4 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                                    CURRENT PLAN
                                </div>
                            )}

                            {/* Popular Badge */}
                            {plan.popular && !isCurrentPlan && (
                                <div className="absolute -top-3 left-4 bg-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> POPULAR
                                </div>
                            )}

                            <div className="mb-4">
                                <h3 className={`text-lg font-bold ${plan.popular && !isCurrentPlan ? "text-white" : "text-slate-900"}`}>
                                    {plan.name}
                                </h3>
                                <p className={`text-sm mt-1 ${plan.popular && !isCurrentPlan ? "text-slate-300" : "text-slate-500"}`}>
                                    {plan.description}
                                </p>
                            </div>

                            <div className="mb-4">
                                <span className={`text-3xl font-bold ${plan.popular && !isCurrentPlan ? "text-white" : "text-slate-900"}`}>
                                    {plan.price}
                                </span>
                                <span className={`text-sm ${plan.popular && !isCurrentPlan ? "text-slate-400" : "text-slate-500"}`}>
                                    {plan.period}
                                </span>
                            </div>

                            <ul className="space-y-2 mb-6">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-center gap-2 text-sm">
                                        <Check className={`w-4 h-4 ${plan.popular && !isCurrentPlan ? "text-blue-400" : "text-green-600"}`} />
                                        <span className={plan.popular && !isCurrentPlan ? "text-slate-200" : "text-slate-700"}>
                                            {feature}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            {isCurrentPlan ? (
                                <button
                                    disabled
                                    className="w-full py-2.5 rounded-lg text-sm font-medium bg-blue-100 text-blue-600 cursor-not-allowed"
                                >
                                    Current Plan
                                </button>
                            ) : isDowngrade ? (
                                <button
                                    disabled
                                    className="w-full py-2.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-400 cursor-not-allowed"
                                    title="Contact support to downgrade"
                                >
                                    Contact Support to Downgrade
                                </button>
                            ) : (
                                <button
                                    onClick={() => onCheckout(plan.priceId, plan.name)}
                                    disabled={loading !== null}
                                    className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${plan.popular
                                            ? "bg-blue-600 hover:bg-blue-500 text-white"
                                            : "bg-slate-900 hover:bg-slate-800 text-white"
                                        } disabled:opacity-50`}
                                >
                                    {loading === plan.name ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Processing...
                                        </span>
                                    ) : (
                                        `Upgrade to ${plan.name}`
                                    )}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Help Text */}
            <div className="mt-8 text-center text-sm text-slate-500">
                <p>Need to downgrade or cancel your subscription?</p>
                <Link href="/dashboard/settings" className="text-blue-600 hover:underline">
                    Manage Billing
                </Link>
                {" "}or contact <a href="mailto:support@safeops.com" className="text-blue-600 hover:underline">support@safeops.com</a>
            </div>
        </div>
    );
}
