"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Trash2, Plus, Calendar, AlertCircle, ExternalLink, Loader2, FileText, Clock, CheckCircle, X, Filter, Building2, ChevronDown, ChevronUp as ChevronUpIcon, Paperclip, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

interface License {
  id: string;
  licenseType: string;
  licenseNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expirationDate: string;
  renewalUrl?: string;
  notes?: string;
  status: string;
  business: { id: string; name: string };
  documents?: { id: string; fileName: string; fileUrl: string }[];
}

interface Business {
  id: string;
  name: string;
}

export default function LicensesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedBusinessId = searchParams.get('businessId');
  const filterParam = searchParams.get('filter');

  const [licenses, setLicenses] = useState<License[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterBusiness, setFilterBusiness] = useState<string>(preselectedBusinessId || 'all');
  const [filterStatus, setFilterStatus] = useState<string>(filterParam || 'all');
  const [userTier, setUserTier] = useState<string>('starter');

  const [formData, setFormData] = useState({
    businessId: preselectedBusinessId || "",
    licenseType: "",
    licenseNumber: "",
    issuingAuthority: "",
    issueDate: "",
    expirationDate: "",
    renewalUrl: "",
    notes: ""
  });

  useEffect(() => {
    if (preselectedBusinessId) {
      setFormData(prev => ({ ...prev, businessId: preselectedBusinessId }));
      setFilterBusiness(preselectedBusinessId);
    }
  }, [preselectedBusinessId]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [licRes, bizRes, settingsRes] = await Promise.all([
          fetch("/api/licenses"),
          fetch("/api/businesses"),
          fetch("/api/settings")
        ]);

        if (licRes.ok && bizRes.ok) {
          setLicenses(await licRes.json());
          setBusinesses(await bizRes.json());
        }
        if (settingsRes.ok) {
          const settings = await settingsRes.json();
          setUserTier(settings.subscriptionTier || 'starter');
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });

      if (res.ok) {
        const newLicense = await res.json();
        setLicenses([newLicense, ...licenses]);
        setFormData({
          businessId: preselectedBusinessId || "", licenseType: "", licenseNumber: "",
          issuingAuthority: "", issueDate: "", expirationDate: "",
          renewalUrl: "", notes: ""
        });
        setShowAddForm(false);
        toast.success("License created successfully!");
        router.refresh();
      } else if (res.status === 403) {
        const errorData = await res.json();
        toast.error(errorData.message || "License limit reached. Please upgrade.", {
          action: { label: "Upgrade", onClick: () => router.push("/dashboard/upgrade") },
        });
      } else {
        toast.error("Failed to create license.");
      }
    } catch (error) {
      toast.error("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/licenses?id=${id}`, { method: "DELETE" });
      setLicenses(licenses.filter(l => l.id !== id));
      toast.success("License deleted");
      router.refresh();
    } catch (error) {
      toast.error("Failed to delete");
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const datePart = dateString.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getStatus = (expirationDate: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const datePart = expirationDate.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    const expDate = new Date(year, month - 1, day);
    const daysUntil = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { label: 'Expired', color: 'red', days: Math.abs(daysUntil), icon: AlertCircle };
    if (daysUntil <= 30) return { label: 'Expiring Soon', color: 'yellow', days: daysUntil, icon: Clock };
    return { label: 'Current', color: 'green', days: daysUntil, icon: CheckCircle };
  };

  // Filter licenses
  const filteredLicenses = licenses.filter(license => {
    const matchesBusiness = filterBusiness === 'all' || license.business.id === filterBusiness;
    const status = getStatus(license.expirationDate);
    const matchesStatus = filterStatus === 'all' ||
      (filterStatus === 'expired' && status.label === 'Expired') ||
      (filterStatus === 'expiring' && status.label === 'Expiring Soon') ||
      (filterStatus === 'current' && status.label === 'Current');
    return matchesBusiness && matchesStatus;
  });

  // Group by status for better organization
  const expiredLicenses = filteredLicenses.filter(l => getStatus(l.expirationDate).label === 'Expired');
  const expiringLicenses = filteredLicenses.filter(l => getStatus(l.expirationDate).label === 'Expiring Soon');
  const currentLicenses = filteredLicenses.filter(l => getStatus(l.expirationDate).label === 'Current');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Licenses & Permits</h1>
          <p className="text-slate-500 mt-1">{licenses.length} total licenses tracked</p>
        </div>

        {/* Add/Upgrade Button */}
        {userTier === 'starter' && licenses.length >= 3 ? (
          <Link
            href="/dashboard/upgrade"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm"
          >
            <Lock className="w-4 h-4" />
            Upgrade for More Licenses
          </Link>
        ) : (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors shadow-sm"
          >
            {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAddForm ? 'Cancel' : 'Add License'}
          </button>
        )}
      </div>

      {/* FILTERS */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 text-slate-600">
          <Filter className="w-4 h-4" />
          <span className="text-sm font-medium">Filter:</span>
        </div>

        <select
          value={filterBusiness}
          onChange={(e) => setFilterBusiness(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">All Businesses</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="expired">🔴 Expired</option>
          <option value="expiring">🟡 Expiring Soon</option>
          <option value="current">🟢 Current</option>
        </select>

        {(filterBusiness !== 'all' || filterStatus !== 'all') && (
          <button
            onClick={() => { setFilterBusiness('all'); setFilterStatus('all'); }}
            className="text-sm text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ADD FORM - Collapsible */}
      {showAddForm && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-6 animate-in slide-in-from-top-2 duration-200">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Add New License</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business *</label>
                <select
                  required
                  className="w-full p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.businessId}
                  onChange={(e) => setFormData({ ...formData, businessId: e.target.value })}
                  disabled={isSubmitting}
                >
                  <option value="">Select a Business</option>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License Type *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Health Permit"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.licenseType}
                  onChange={(e) => setFormData({ ...formData, licenseType: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">License Number</label>
                <input
                  type="text"
                  placeholder="Optional"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.licenseNumber}
                  onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Issuing Authority</label>
                <input
                  type="text"
                  placeholder="e.g. City Health Dept"
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.issuingAuthority}
                  onChange={(e) => setFormData({ ...formData, issuingAuthority: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Issue Date *</label>
                <input
                  type="date"
                  required
                  className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.issueDate}
                  onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expiration Date *</label>
                <input
                  type="date"
                  required
                  className="w-full p-2.5 border border-red-200 bg-red-50/50 rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  value={formData.expirationDate}
                  onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Renewal URL</label>
              <input
                type="url"
                placeholder="https://example.com/renew"
                className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                value={formData.renewalUrl}
                onChange={(e) => setFormData({ ...formData, renewalUrl: e.target.value })}
                disabled={isSubmitting}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
              <button
                disabled={isSubmitting}
                type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-500 disabled:opacity-50 font-medium flex items-center gap-2"
              >
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Add License'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* LICENSES LIST */}
      {filteredLicenses.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            {licenses.length === 0 ? 'No licenses yet' : 'No licenses match your filters'}
          </h3>
          <p className="text-slate-500 mb-6">
            {licenses.length === 0 ? 'Add your first license to start tracking' : 'Try adjusting your filters'}
          </p>
          {licenses.length === 0 && (
            <button onClick={() => setShowAddForm(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-500">
              <Plus className="w-4 h-4" /> Add Your First License
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* EXPIRED SECTION */}
          {expiredLicenses.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Expired ({expiredLicenses.length})
              </h2>
              <div className="space-y-3">
                {expiredLicenses.map((license) => <LicenseCard key={license.id} license={license} getStatus={getStatus} formatDate={formatDate} deleteConfirmId={deleteConfirmId} setDeleteConfirmId={setDeleteConfirmId} handleDelete={handleDelete} />)}
              </div>
            </div>
          )}

          {/* EXPIRING SOON SECTION */}
          {expiringLicenses.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-yellow-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Expiring Soon ({expiringLicenses.length})
              </h2>
              <div className="space-y-3">
                {expiringLicenses.map((license) => <LicenseCard key={license.id} license={license} getStatus={getStatus} formatDate={formatDate} deleteConfirmId={deleteConfirmId} setDeleteConfirmId={setDeleteConfirmId} handleDelete={handleDelete} />)}
              </div>
            </div>
          )}

          {/* CURRENT SECTION */}
          {currentLicenses.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" /> Current ({currentLicenses.length})
              </h2>
              <div className="space-y-3">
                {currentLicenses.map((license) => <LicenseCard key={license.id} license={license} getStatus={getStatus} formatDate={formatDate} deleteConfirmId={deleteConfirmId} setDeleteConfirmId={setDeleteConfirmId} handleDelete={handleDelete} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// License Card Component
function LicenseCard({ license, getStatus, formatDate, deleteConfirmId, setDeleteConfirmId, handleDelete }: any) {
  const [isExpanded, setIsExpanded] = useState(false);
  const status = getStatus(license.expirationDate);
  const StatusIcon = status.icon;
  const docCount = license.documents?.length || 0;

  const colorClasses: Record<string, { bg: string; text: string; border: string; badge: string }> = {
    red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
    yellow: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700' },
    green: { bg: 'bg-white', text: 'text-green-700', border: 'border-slate-200', badge: 'bg-green-100 text-green-700' }
  };
  const colors = colorClasses[status.color];

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} hover:shadow-md transition-all group overflow-hidden`}>
      {/* Main Row - Clickable */}
      <div className="p-4 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-lg ${colors.badge}`}>
              <StatusIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900">{license.licenseType}</h3>
                {license.licenseNumber && (
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">#{license.licenseNumber}</span>
                )}
                {docCount > 0 && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> {docCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> {license.business?.name}
                </span>
                {license.issuingAuthority && (
                  <span>• {license.issuingAuthority}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className={`text-sm font-medium ${colors.text}`}>
                {status.label === 'Expired' ? `Expired ${status.days} days ago` :
                  status.label === 'Expiring Soon' ? `${status.days} days left` :
                    `${status.days} days left`}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Exp: {formatDate(license.expirationDate)}
              </div>
            </div>

            {license.renewalUrl && (
              <a
                href={license.renewalUrl.startsWith('http') ? license.renewalUrl : `https://${license.renewalUrl}`}
                target="_blank"
                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Renewal Link"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {deleteConfirmId === license.id ? (
              <div className="flex items-center gap-1 bg-red-50 px-2 py-1 rounded-lg border border-red-200" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => handleDelete(license.id)} className="text-xs bg-red-600 text-white px-2 py-0.5 rounded">Yes</button>
                <button onClick={() => setDeleteConfirmId(null)} className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded">No</button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(license.id); }}
                className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            <div className={`p-1 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
              <ChevronDown className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Documents Section */}
      {isExpanded && (
        <div className="border-t border-slate-200 bg-white p-4">
          <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Linked Documents
          </h4>
          {docCount === 0 ? (
            <p className="text-sm text-slate-500 italic">No documents attached to this license.</p>
          ) : (
            <div className="space-y-2">
              {license.documents?.map((doc: any) => (
                <a
                  key={doc.id}
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg hover:bg-blue-50 transition-colors group/doc"
                >
                  <div className="p-1.5 bg-blue-100 rounded">
                    <FileText className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="text-sm text-slate-700 group-hover/doc:text-blue-700 flex-1">{doc.fileName}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover/doc:text-blue-600" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}