"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Business {
  id: string;
  name: string;
  businessType: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

interface UserTier {
  subscriptionTier: string;
}

export default function BusinessesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [userTier, setUserTier] = useState<string>('starter');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form State - Changed 'type' to 'businessType' to match API expectation
  const [formData, setFormData] = useState({
    name: "",
    businessType: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: ""
  });

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch businesses
        const businessesResponse = await fetch("/api/businesses");
        if (businessesResponse.ok) {
          const businessesData = await businessesResponse.json();
          setBusinesses(businessesData);
        }

        // Fetch user tier
        const userResponse = await fetch("/api/settings");
        if (userResponse.ok) {
          const userData = await userResponse.json();
          setUserTier(userData.subscriptionTier || 'starter');
        }
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setIsLoading(false);
      }
    }

    if (isLoaded && userId) {
      fetchData();
    }
  }, [isLoaded, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const newBiz = await response.json();
        setBusinesses([newBiz, ...businesses]);
        setFormData({
          name: "", businessType: "", address: "",
          city: "", state: "", zip: "", phone: ""
        });
        toast.success("Business created successfully!");
        router.refresh();
      } else if (response.status === 403) {
        const errorData = await response.json();
        if (errorData.error === "LIMIT_REACHED") {
          toast.error("Free plan limited to 1 Business. Upgrade to add more!", {
            action: {
              label: "Upgrade",
              onClick: () => router.push("/dashboard/upgrade"),
            },
          });
        }
      } else {
        toast.error("Failed to create business. Please try again.");
      }
    } catch (error) {
      console.error("Failed to create", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/businesses?id=${id}`, { method: 'DELETE' });
      setBusinesses(businesses.filter(b => b.id !== id));
      toast.success("Business deleted successfully");
      router.refresh();
    } catch (error) {
      toast.error("Failed to delete business");
    } finally {
      setDeleteConfirmId(null);
    }
  };

  if (isLoading) return <div className="p-8 text-center">Loading businesses...</div>;

  // Determine if user has reached business limit
  const isFreeTier = userTier === 'starter';
  const hasReachedLimit = isFreeTier && businesses.length >= 1;

  // Format city/state display - only show comma if both city and state exist
  const formatLocation = (city: string, state: string) => {
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    if (state) return state;
    return null;
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* ✅ 1. Back to Dashboard Link */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-2"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Businesses</h1>
        {isFreeTier && (
          <span className="text-sm text-slate-500">
            {businesses.length}/1 Free Limit
          </span>
        )}
      </div>

      {/* Creation Form - Only show if limit not reached */}
      {!hasReachedLimit ? (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-10">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Add New Business</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
              <input
                type="text"
                placeholder="e.g. Joe's Food Truck"
                className="w-full p-2 border rounded-md"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Type</label>
              <select
                className="w-full p-2 border rounded-md bg-white"
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                disabled={isSubmitting}
              >
                <option value="">Select Type</option>
                <option value="food_truck">Food Truck</option>
                <option value="contractor">Contractor</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                placeholder="City"
                className="w-full p-2 border rounded-md"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input
                type="text"
                placeholder="State"
                className="w-full p-2 border rounded-md"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="md:col-span-2 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition font-medium mt-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Business...
                </>
              ) : (
                "Add Business"
              )}
            </button>
          </form>
        </div>
      ) : (
        // 🚫 Limit Reached - Show Upgrade Prompt
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-6 mb-10">
          <div className="flex items-center gap-4">
            <Lock className="w-8 h-8 text-amber-600" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-amber-900">Free Plan Limit Reached</h3>
              <p className="text-amber-700 text-sm mt-1">
                You've reached the maximum of 1 business on the Free plan. Upgrade to Pro to add unlimited businesses.
              </p>
            </div>
            <Link
              href="/dashboard/upgrade"
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg text-sm font-semibold hover:shadow-lg transition-all whitespace-nowrap"
            >
              Upgrade to Pro 🚀
            </Link>
          </div>
        </div>
      )}

      {/* Business List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {businesses.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
            <p className="text-gray-500 text-lg">No businesses yet. Add your first one above!</p>
          </div>
        ) : (
          businesses.map((biz) => (
            <div key={biz.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow flex flex-col justify-between h-full relative group">

              {/* DELETE BUTTON with inline confirmation */}
              {deleteConfirmId === biz.id ? (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                  <span className="text-xs text-red-700">Delete?</span>
                  <button
                    onClick={() => handleDelete(biz.id)}
                    className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(biz.id)}
                  className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}

              <div>
                <h3 className="font-bold text-xl text-gray-900 mb-1">{biz.name}</h3>
                <p className="text-gray-500 text-sm capitalize mb-4">Type: {biz.businessType?.replace('_', ' ') || 'Not specified'}</p>

                <div className="text-sm text-gray-600 space-y-1 mb-6">
                  {formatLocation(biz.city, biz.state) && <p>📍 {formatLocation(biz.city, biz.state)}</p>}
                  {biz.phone && <p>📞 {biz.phone}</p>}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end">
                {/* Link includes businessId for auto-fill */}
                <Link
                  href={`/dashboard/licenses?businessId=${biz.id}`}
                  className="text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center gap-1"
                >
                  Manage Licenses →
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}