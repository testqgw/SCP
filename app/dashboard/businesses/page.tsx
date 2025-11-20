"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";

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

export default function BusinessesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: ""
  });

  useEffect(() => {
    async function fetchBusinesses() {
      try {
        const response = await fetch("/api/businesses");
        if (response.ok) {
          const data = await response.json();
          setBusinesses(data);
        }
      } catch (error) {
        console.error("Failed to fetch businesses", error);
      } finally {
        setIsLoading(false);
      }
    }

    if (isLoaded && userId) {
      fetchBusinesses();
    }
  }, [isLoaded, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          name: "", type: "", address: "",
          city: "", state: "", zip: "", phone: ""
        });
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to create", error);
    }
  };

  if (isLoading) return <div className="p-8 text-center">Loading businesses...</div>;

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
      </div>

      {/* Creation Form */}
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
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Business Type</label>
            <select
              className="w-full p-2 border rounded-md bg-white"
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
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
            />
          </div>

          <button
            type="submit"
            className="md:col-span-2 bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition font-medium mt-2"
          >
            Add Business
          </button>
        </form>
      </div>

      {/* Business List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {businesses.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
            <p className="text-gray-500 text-lg">No businesses yet. Add your first one above!</p>
          </div>
        ) : (
          businesses.map((biz) => (
            <div key={biz.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow flex flex-col justify-between h-full relative group">

              {/* DELETE BUTTON (Top Right) */}
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  if (!confirm("Delete this business and all its licenses?")) return;
                  await fetch(`/api/businesses?id=${biz.id}`, { method: 'DELETE' });
                  setBusinesses(businesses.filter(b => b.id !== biz.id));
                  router.refresh();
                }}
                className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <div>
                {/* ✅ 2. Fixed Text Color (text-gray-900) */}
                <h3 className="font-bold text-xl text-gray-900 mb-1">{biz.name}</h3>
                <p className="text-gray-500 text-sm capitalize mb-4">Type: {biz.businessType}</p>

                <div className="text-sm text-gray-600 space-y-1 mb-6">
                  {biz.city && <p>📍 {biz.city}, {biz.state}</p>}
                  {biz.phone && <p>📞 {biz.phone}</p>}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-end">
                {/* ✅ 3. Working Link to Licenses */}
                <Link
                  href="/dashboard/licenses"
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