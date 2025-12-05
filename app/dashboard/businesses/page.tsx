"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, Lock, Loader2, Plus, Building2, MapPin, Phone, FileText, ChevronDown, ChevronUp, X } from "lucide-react";
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
  _count?: { licenses: number };
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
  const [showAddForm, setShowAddForm] = useState(false);

  // Form State
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
        const businessesResponse = await fetch("/api/businesses");
        if (businessesResponse.ok) {
          const businessesData = await businessesResponse.json();
          setBusinesses(businessesData);
        }

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
        setFormData({ name: "", businessType: "", address: "", city: "", state: "", zip: "", phone: "" });
        setShowAddForm(false);
        toast.success("Business created successfully!");
        router.refresh();
      } else if (response.status === 403) {
        const errorData = await response.json();
        if (errorData.error === "LIMIT_REACHED") {
          toast.error("Free plan limited to 1 Business. Upgrade to add more!", {
            action: { label: "Upgrade", onClick: () => router.push("/dashboard/upgrade") },
          });
        }
      } else {
        toast.error("Failed to create business. Please try again.");
      }
    } catch (error) {
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const isFreeTier = userTier === 'starter';
  const hasReachedLimit = isFreeTier && businesses.length >= 1;

  const formatLocation = (city: string, state: string) => {
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    if (state) return state;
    return null;
  };

  const getBusinessTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      food_truck: 'Food Truck',
      contractor: 'Contractor',
      restaurant: 'Restaurant',
      other: 'Other'
    };
    return types[type] || type?.replace('_', ' ') || 'Not specified';
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Businesses</h1>
          <p className="text-slate-500 mt-1">
            {businesses.length} {businesses.length === 1 ? 'business' : 'businesses'}
            {isFreeTier && <span className="text-amber-600 ml-2">• Free plan (1 max)</span>}
          </p>
        </div>

        {!hasReachedLimit && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors shadow-sm"
          >
            {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAddForm ? 'Cancel' : 'Add Business'}
          </button>
        )}
      </div>

      {/* ADD FORM - Collapsible */}
      {showAddForm && !hasReachedLimit && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8 animate-in slide-in-from-top-2 duration-200">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Add New Business</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Business Name *</label>
              <input
                type="text"
                placeholder="e.g. Joe's Food Truck"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                disabled={isSubmitting}
                maxLength={100}
              />
              <p className="text-xs text-slate-400 mt-1 text-right">{formData.name.length}/100</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business Type</label>
              <select
                className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.businessType}
                onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                disabled={isSubmitting}
              >
                <option value="">Select Type</option>
                <option value="food_truck">Food Truck</option>
                <option value="restaurant">Restaurant</option>
                <option value="contractor">Contractor</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input
                type="tel"
                placeholder="(555) 123-4567"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
              <input
                type="text"
                placeholder="Atlanta"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">State</label>
              <input
                type="text"
                placeholder="GA"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div className="md:col-span-2 flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-500 transition font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : 'Create Business'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LIMIT REACHED BANNER */}
      {hasReachedLimit && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 mb-8">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Lock className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">Free Plan Limit Reached</h3>
              <p className="text-amber-700 text-sm">Upgrade to Pro to add unlimited businesses.</p>
            </div>
            <Link
              href="/dashboard/upgrade"
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:shadow-lg transition-all"
            >
              Upgrade 🚀
            </Link>
          </div>
        </div>
      )}

      {/* BUSINESS LIST */}
      {businesses.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No businesses yet</h3>
          <p className="text-slate-500 mb-6">Add your first business to start tracking licenses</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-500"
          >
            <Plus className="w-4 h-4" /> Add Your First Business
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {businesses.map((biz) => (
            <div key={biz.id} className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all group">
              {/* Card Header */}
              <div className="p-5 border-b border-slate-100">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">{biz.name}</h3>
                      <span className="text-sm text-slate-500 capitalize">{getBusinessTypeLabel(biz.businessType)}</span>
                    </div>
                  </div>

                  {/* Delete Button */}
                  {deleteConfirmId === biz.id ? (
                    <div className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                      <span className="text-xs text-red-700">Delete?</span>
                      <button onClick={() => handleDelete(biz.id)} className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Yes</button>
                      <button onClick={() => setDeleteConfirmId(null)} className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300">No</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(biz.id)}
                      className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5">
                <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-4">
                  {formatLocation(biz.city, biz.state) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-slate-400" />
                      {formatLocation(biz.city, biz.state)}
                    </div>
                  )}
                  {biz.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-slate-400" />
                      {biz.phone}
                    </div>
                  )}
                </div>

                {/* Action Button */}
                <Link
                  href={`/dashboard/licenses?businessId=${biz.id}`}
                  className="inline-flex items-center gap-2 w-full justify-center bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border border-slate-200 hover:border-blue-200"
                >
                  <FileText className="w-4 h-4" />
                  View Licenses
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}