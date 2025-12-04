"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { LogOut, Phone, MessageSquare, Check, Crown, Loader2, Smartphone, Mail, Building2, FileText, Users, Shield, CreditCard } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

// Billing Portal Button Component
function BillingPortalButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.url) {
        window.location.href = data.url;
      } else if (data.error === "NO_SUBSCRIPTION") {
        toast.info("No Stripe subscription found. If you upgraded recently, please contact support.", {
          duration: 5000,
        });
      } else {
        toast.error(data.message || "Failed to open billing portal. Please contact support.");
      }
    } catch (error) {
      toast.error("Unable to connect. Please try again or contact support.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex-1 flex items-center justify-center gap-2 bg-white text-slate-700 py-2.5 rounded-lg font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <CreditCard className="w-4 h-4" />
      )}
      Manage Billing
    </button>
  );
}
// Plan configuration
const PLANS: Record<string, { name: string; price: string; features: string[]; color: string }> = {
  starter: {
    name: "The Starter",
    price: "$0/mo",
    features: ["1 Business", "3 Licenses Max", "Email Reminders Only"],
    color: "slate"
  },
  professional: {
    name: "Owner Operator",
    price: "$49/mo",
    features: ["1 Business", "Unlimited Licenses", "SMS & Email Alerts", "2 Team Members"],
    color: "blue"
  },
  multi_location: {
    name: "Fleet Manager",
    price: "$99/mo",
    features: ["Up to 5 Businesses", "Unlimited Licenses", "SMS & Email Alerts", "Priority Support"],
    color: "indigo"
  },
  enterprise: {
    name: "Commissary",
    price: "$149/mo",
    features: ["Up to 15 Businesses", "Unlimited Everything", "Dedicated Account Manager"],
    color: "purple"
  }
};

export default function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    tier: "starter",
    status: "active"
  });

  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setFormData({
            name: data.name || user?.fullName || "",
            email: data.email || user?.primaryEmailAddress?.emailAddress || "",
            phone: data.phone || "",
            tier: data.subscriptionTier || "starter",
            status: data.subscriptionStatus || "active"
          });
        }
      } catch (error) {
        console.error("Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    }

    fetchSettings();
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ type: "", text: "" });

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone
        })
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Settings updated successfully!" });
        router.refresh();
      } else {
        setMessage({ type: "error", text: "Failed to update settings." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Something went wrong." });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const currentPlan = PLANS[formData.tier] || PLANS.starter;
  const isPaid = formData.tier !== 'starter';
  const hasSMS = isPaid;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header with Sign Out */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Account Settings</h1>
        <button
          onClick={() => signOut(() => router.push("/"))}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-3 py-2 rounded-lg transition text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>

      {/* Notification Message */}
      {message.text && (
        <div className={`p-4 mb-6 rounded-xl ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-6">

        {/* CARD 1: Subscription Plan */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isPaid ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <Crown className={`w-5 h-5 ${isPaid ? 'text-blue-600' : 'text-slate-500'}`} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Your Plan</h2>
                <p className="text-sm text-slate-500">Current subscription details</p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${formData.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
              {formData.status}
            </span>
          </div>

          {/* Plan Details Card */}
          <div className={`p-5 rounded-xl border-2 ${isPaid ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className={`text-xl font-bold ${isPaid ? 'text-blue-900' : 'text-slate-900'}`}>
                  {currentPlan.name}
                </h3>
                <p className="text-2xl font-bold text-slate-900 mt-1">{currentPlan.price}</p>
              </div>
              {isPaid && (
                <span className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  PRO
                </span>
              )}
            </div>

            <ul className="space-y-2 mb-4">
              {currentPlan.features.map((feature, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                  <Check className={`w-4 h-4 ${isPaid ? 'text-blue-600' : 'text-green-600'}`} />
                  {feature}
                </li>
              ))}
            </ul>

            {!isPaid && (
              <Link
                href="/dashboard/upgrade"
                className="block w-full text-center bg-blue-600 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-500 transition-colors mt-4"
              >
                Upgrade to Pro
              </Link>
            )}
          </div>

          {/* Plan Actions */}
          <div className="flex flex-wrap gap-3 mt-4">
            <Link
              href={isPaid ? "/dashboard/settings/plan" : "/dashboard/upgrade"}
              className={`flex-1 text-center py-2.5 rounded-lg font-medium transition-colors ${isPaid
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
            >
              {isPaid ? 'Change Plan' : 'View Plans'}
            </Link>
            {isPaid && (
              <BillingPortalButton />
            )}
          </div>
        </div>

        {/* CARD 2: Contact Information with SMS Setup */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Mail className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Contact Information</h2>
              <p className="text-sm text-slate-500">Used for automated reminder notifications</p>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  disabled
                  className="w-full p-2.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                  value={formData.email}
                />
                <p className="text-xs text-slate-400 mt-1">Managed via Google/Clerk</p>
              </div>
            </div>

            {/* SMS Phone Section */}
            <div className={`p-4 rounded-xl border ${hasSMS ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Smartphone className={`w-5 h-5 ${hasSMS ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="font-medium text-slate-900">SMS Reminders</span>
                {hasSMS ? (
                  <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">Enabled</span>
                ) : (
                  <span className="bg-slate-200 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">Pro Feature</span>
                )}
              </div>

              {hasSMS ? (
                <>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Mobile Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                  <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" />
                    We'll send text alerts before licenses expire
                  </p>
                </>
              ) : (
                <div className="text-sm text-slate-600">
                  <p className="mb-3">Get text message reminders when licenses are about to expire. Never miss a renewal deadline.</p>
                  <Link
                    href="/dashboard/upgrade"
                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Upgrade to enable SMS →
                  </Link>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-500 transition disabled:opacity-50 font-medium flex items-center gap-2"
              >
                {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* CARD 4: Danger Zone */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-red-100">
          <h2 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h2>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-slate-700 font-medium">Delete Account</p>
              <p className="text-slate-500 text-sm mt-0.5">Permanently delete your account and all data</p>
            </div>
            <button
              className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition font-medium border border-red-200 opacity-50 cursor-not-allowed"
              disabled
              title="Contact support to delete your account"
            >
              Delete Account
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}