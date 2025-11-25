"use client";

import { useState } from "react";
import { Check, ShieldCheck, Truck, Building2, Store, X, Loader2 } from "lucide-react";
import { onSubscribe } from "@/actions/stripe-redirect"; // The action we wrote earlier
import { toast } from "sonner";
import { cn } from "@/lib/utils"; // ShadCN utility, or just use template literals

// 1. Define the Plans to match your Landing Page
// 1. Define the Plans to match your Landing Page
const plans = [
  {
    name: "Starter",
    price: "$0",
    period: "/mo",
    description: "For new trucks just getting organized.",
    features: [
      "1 Business Entity",
      "Limit: 3 Licenses Tracked",
      "Email Reminders Only",
      "No SMS Alerts",
    ],
    actionLabel: "Current Plan",
    priceId: null, // Free plan has no Stripe ID
    popular: false,
  },
  {
    name: "Owner Operator",
    price: "$49",
    period: "/mo",
    description: "The standard for professional food trucks.",
    features: [
      "1 Business Entity",
      "Unlimited Licenses",
      "SMS & Email Alerts",
      "Secure Document Vault",
      "2 Team Members",
    ],
    actionLabel: "Upgrade to Pro",
    priceId: process.env.NEXT_PUBLIC_PRICE_ID_STANDARD || null,
    popular: true, // This triggers the Blue Dark Mode look
  },
  {
    name: "Fleet Manager",
    price: "$99",
    period: "/mo",
    description: "For owners with multiple trucks.",
    features: [
      "Up to 5 Businesses",
      "Everything in Owner",
      "Role-Based Access",
      "Audit Logs",
      "Priority Support",
    ],
    actionLabel: "Upgrade to Fleet",
    priceId: process.env.NEXT_PUBLIC_PRICE_ID_GROWTH || null,
    popular: false,
  },
  {
    name: "Commissary",
    price: "$149",
    period: "/mo",
    description: "For kitchens managing tenant trucks.",
    features: [
      "Up to 15 Businesses",
      "Client View Mode",
      "Bulk License Import",
      "Dedicated Account Manager",
    ],
    actionLabel: "Contact Sales",
    priceId: "contact", // Special handler
    popular: false,
  }
];

export default function UpgradePage() {
  const [loading, setLoading] = useState<string | null>(null);

  const onCheckout = async (priceId: string | null, planName: string) => {
    if (!priceId) return; // Free plan
    if (priceId === "contact") {
      window.location.href = "mailto:sales@safeops.com";
      return;
    }

    setLoading(planName);

    try {
      const response = await onSubscribe(priceId);
      if (response.url) {
        window.location.href = response.url; // Redirect to Stripe
      } else {
        toast.error("Failed to create checkout session.");
      }
    } catch (error) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col py-10 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Upgrade to SafeOps Pro
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Unlock SMS alerts, unlimited licenses, and team features.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "relative flex flex-col p-6 rounded-2xl shadow-sm border transition-all",
              plan.popular
                ? "bg-slate-900 border-slate-900 text-white ring-2 ring-blue-500 scale-105 z-10" // Dark Mode Card
                : "bg-white border-gray-200 text-gray-900 hover:border-blue-300"
            )}
          >
            {plan.popular && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">
                Recommended
              </div>
            )}

            <div className="mb-5">
              <h3 className={cn("text-lg font-semibold", plan.popular ? "text-white" : "text-gray-900")}>
                {plan.name}
              </h3>
              <p className={cn("text-sm mt-1 h-10", plan.popular ? "text-slate-300" : "text-gray-500")}>
                {plan.description}
              </p>
            </div>

            <div className="mb-6 flex items-baseline">
              <span className="text-4xl font-bold">{plan.price}</span>
              <span className={cn("text-sm font-medium ml-1", plan.popular ? "text-slate-400" : "text-gray-500")}>
                {plan.period}
              </span>
            </div>

            <ul className="space-y-4 mb-8 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start">
                  {feature.includes("No SMS") ? (
                    <X className="h-5 w-5 mr-3 text-gray-400 shrink-0" />
                  ) : (
                    <Check className={cn("h-5 w-5 mr-3 shrink-0", plan.popular ? "text-blue-400" : "text-blue-600")} />
                  )}
                  <span className={cn("text-sm",
                    plan.popular ? "text-slate-300" : "text-gray-600",
                    feature.includes("No SMS") && "text-gray-400"
                  )}>
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            <button
              disabled={loading !== null || !plan.priceId}
              onClick={() => onCheckout(plan.priceId, plan.name)}
              className={cn(
                "w-full py-3 rounded-lg text-sm font-semibold transition-all",
                plan.popular
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-900",
                !plan.priceId && "opacity-50 cursor-not-allowed bg-gray-50 text-gray-400"
              )}
            >
              {loading === plan.name ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </div>
              ) : (
                plan.actionLabel
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}