import Link from "next/link";
import { Check, ShieldCheck, Truck, Building2 } from "lucide-react";

const tiers = [
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
        featured: true, // Highlights this card
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
        cta: "Get Growth",
        href: "/sign-up?plan=growth",
        featured: false,
    },
    {
        name: "Commissary / Agency",
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
        cta: "Contact Sales",
        href: "mailto:sales@safeops.com", // Or link to enterprise form
        featured: false,
    },
];

export default function PricingSection() {
    return (
        <section className="py-24 bg-white" id="pricing">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                        Simple pricing, zero hidden fines.
                    </h2>
                    <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
                        A single health code violation costs $2,000+. SafeOps costs less than a tank of gas.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    {tiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`relative flex flex-col rounded-2xl border p-8 shadow-sm transition-all hover:shadow-md ${tier.featured
                                    ? "border-blue-600 ring-1 ring-blue-600 bg-blue-50/50"
                                    : "border-gray-200 bg-white"
                                }`}
                        >
                            {tier.featured && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-sm font-semibold text-white">
                                    Most Popular
                                </div>
                            )}

                            <div className="mb-6 flex items-center justify-center h-12 w-12 rounded-lg bg-blue-100 text-blue-600">
                                <tier.icon className="h-6 w-6" />
                            </div>

                            <h3 className="text-xl font-semibold text-gray-900">{tier.name}</h3>
                            <p className="mt-2 text-sm text-gray-500">{tier.description}</p>

                            <div className="my-6 flex items-baseline">
                                <span className="text-4xl font-bold tracking-tight text-gray-900">
                                    {tier.price}
                                </span>
                                <span className="text-sm font-semibold text-gray-500">/month</span>
                            </div>

                            <ul className="mb-8 space-y-4 flex-1">
                                {tier.features.map((feature) => (
                                    <li key={feature} className="flex items-start">
                                        <Check className="h-5 w-5 flex-shrink-0 text-blue-600" />
                                        <span className="ml-3 text-sm text-gray-600">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <Link
                                href={tier.href}
                                className={`block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${tier.featured
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "bg-gray-50 text-blue-600 hover:bg-gray-100"
                                    }`}
                            >
                                {tier.cta}
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
