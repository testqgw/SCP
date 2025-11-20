"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { Trash2, Plus, Calendar, AlertCircle, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

interface License {
  id: string;
  licenseType: string;
  licenseNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expirationDate: string;
  renewalUrl?: string;
  notes?: string;
  business: { name: string };
}

interface Business {
  id: string;
  name: string;
}

export default function LicensesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [licenses, setLicenses] = useState<License[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    businessId: "",
    licenseType: "",
    licenseNumber: "",
    issuingAuthority: "",
    issueDate: "",
    expirationDate: "",
    renewalUrl: "",
    notes: ""
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const [licRes, bizRes] = await Promise.all([
          fetch("/api/licenses"),
          fetch("/api/businesses")
        ]);

        if (licRes.ok && bizRes.ok) {
          setLicenses(await licRes.json());
          setBusinesses(await bizRes.json());
        }
      } catch (error) {
        console.error("Error fetching data");
      } finally {
        setIsLoading(false);
      }
    }

    if (isLoaded && userId) fetchData();
  }, [isLoaded, userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/licenses", {
        method: "POST",
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        const newLicense = await res.json();
        setLicenses([newLicense, ...licenses]);
        setFormData({
          businessId: "", licenseType: "", licenseNumber: "",
          issuingAuthority: "", issueDate: "", expirationDate: "",
          renewalUrl: "", notes: ""
        });
        router.refresh();
      } else if (res.status === 403) {
        alert("Free Plan Limit Reached. Please Upgrade.");
      }
    } catch (error) {
      console.error("Error creating license");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this license?")) return;

    try {
      await fetch(`/api/licenses?id=${id}`, { method: "DELETE" });
      setLicenses(licenses.filter(l => l.id !== id));
      router.refresh();
    } catch (error) {
      console.error("Failed to delete");
    }
  };

  if (isLoading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-8">Manage Licenses</h1>

      {/* ADD FORM */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-10">
        <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" /> Add New License
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business *</label>
              <select
                required
                className="w-full p-2 border rounded-md bg-white"
                value={formData.businessId}
                onChange={(e) => setFormData({ ...formData, businessId: e.target.value })}
              >
                <option value="">Select a Business</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">License Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Health Permit"
                className="w-full p-2 border rounded-md"
                value={formData.licenseType}
                onChange={(e) => setFormData({ ...formData, licenseType: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">License Number</label>
              <input
                type="text"
                className="w-full p-2 border rounded-md"
                value={formData.licenseNumber}
                onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Issuing Authority</label>
              <input
                type="text"
                placeholder="e.g. City Hall"
                className="w-full p-2 border rounded-md"
                value={formData.issuingAuthority}
                onChange={(e) => setFormData({ ...formData, issuingAuthority: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Issue Date</label>
              <input
                type="date"
                required
                className="w-full p-2 border rounded-md"
                value={formData.issueDate}
                onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Expiration Date *</label>
              <input
                type="date"
                required
                className="w-full p-2 border rounded-md border-red-200 bg-red-50/50"
                value={formData.expirationDate}
                onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
              />
            </div>
          </div>

          {/* URL FIX: Changed type to 'text' to avoid validation errors */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Renewal URL</label>
            <input
              type="text"
              placeholder="https://example.com/renew"
              className="w-full p-2 border rounded-md"
              value={formData.renewalUrl}
              onChange={(e) => setFormData({ ...formData, renewalUrl: e.target.value })}
            />
          </div>

          <button
            disabled={isSubmitting}
            type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium w-full sm:w-auto"
          >
            {isSubmitting ? "Saving..." : "Track License"}
          </button>
        </form>
      </div>

      {/* LIST VIEW */}
      <div className="grid gap-4">
        {licenses.map((license) => (
          <div key={license.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">{license.licenseType}</h3>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                  {license.business?.name}
                </span>
              </div>
              <div className="text-sm text-slate-500 mt-1 flex items-center gap-4">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Exp: {new Date(license.expirationDate).toLocaleDateString()}</span>
                <span>#{license.licenseNumber}</span>
              </div>
              {license.renewalUrl && (
                <a href={license.renewalUrl.startsWith('http') ? license.renewalUrl : `https://${license.renewalUrl}`} target="_blank" className="text-blue-600 text-xs flex items-center gap-1 mt-2 hover:underline">
                  Renewal Link <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* DELETE BUTTON */}
            <button
              onClick={() => handleDelete(license.id)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors self-end sm:self-center"
              title="Delete License"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}