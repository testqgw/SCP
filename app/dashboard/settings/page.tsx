"use client";

import { useEffect, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export default function SettingsPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Local state for the form
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    tier: "starter",
    status: "active"
  });

  const [message, setMessage] = useState({ type: "", text: "" });

  // 1. Fetch User Data on Load
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

  // 2. Handle Save
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
        setMessage({ type: "success", text: "Profile updated successfully!" });
        router.refresh();
      } else {
        setMessage({ type: "error", text: "Failed to update profile." });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Something went wrong." });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="p-8">Loading settings...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Account Settings</h1>

      {/* Notification Message */}
      {message.text && (
        <div className={`p-4 mb-6 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-8">

        {/* CARD 1: Profile Settings */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Contact Information</h2>
          <p className="text-gray-500 text-sm mb-6">
            This is the contact info we will use for your automated reminders.
          </p>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded-md bg-gray-50"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  disabled
                  className="w-full p-2 border rounded-md bg-gray-100 text-gray-500 cursor-not-allowed"
                  value={formData.email}
                />
                <p className="text-xs text-gray-400 mt-1">Managed via Google/Clerk</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile Phone (For SMS Reminders)
              </label>
              <input
                type="tel"
                placeholder="+1 (555) 000-0000"
                className="w-full p-2 border rounded-md"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">
                We'll send text alerts to this number.
              </p>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>

        {/* CARD 2: Subscription */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Subscription</h2>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${formData.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
              {formData.status.toUpperCase()}
            </span>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg mb-6">
            <p className="text-gray-700">
              Current Plan: <span className="font-bold capitalize">{formData.tier} Plan</span>
            </p>
          </div>

          <button
            className="text-gray-400 border border-gray-300 px-4 py-2 rounded-md cursor-not-allowed w-full sm:w-auto"
            disabled
          >
            Manage Billing (Coming Soon)
          </button>
        </div>

        {/* CARD 3: Account Actions (Sign Out moved here) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Account Actions</h2>
          <div className="flex justify-between items-center">
            <p className="text-gray-600 text-sm">Sign out of your current session.</p>
            <button
              onClick={() => signOut(() => router.push("/"))}
              className="flex items-center gap-2 text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-md transition font-medium border border-gray-200"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>

        {/* CARD 4: Danger Zone (Reserved for destructive actions) */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-red-100">
          <h2 className="text-xl font-semibold text-red-600 mb-4">Danger Zone</h2>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-gray-600 text-sm font-medium">Delete Account</p>
              <p className="text-gray-500 text-xs mt-1">Permanently delete your account and all data. This action cannot be undone.</p>
            </div>
            <button
              className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-md transition font-medium border border-red-200 cursor-not-allowed opacity-50"
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