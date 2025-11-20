"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

export default function LicensesPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const [licenses, setLicenses] = useState<any[]>([]);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state for creating
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [licenseType, setLicenseType] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [renewalUrl, setRenewalUrl] = useState("");
  const [notes, setNotes] = useState("");

  // Edit state
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    licenseType: "",
    licenseNumber: "",
    issuingAuthority: "",
    issueDate: "",
    expirationDate: "",
    renewalUrl: "",
    notes: "",
  });

  // Fetch Licenses and Businesses
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch licenses
        const licensesResponse = await fetch("/api/licenses");
        const licensesData = await licensesResponse.json();
        setLicenses(licensesData);

        // Fetch businesses for the dropdown
        const businessesResponse = await fetch("/api/businesses");
        const businessesData = await businessesResponse.json();
        setBusinesses(businessesData);
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

  // Create License
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/licenses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessId: selectedBusinessId,
          licenseType,
          licenseNumber,
          issuingAuthority,
          issueDate,
          expirationDate,
          renewalUrl,
          notes,
        }),
      });

      if (response.ok) {
        const newLicense = await response.json();
        setLicenses([newLicense, ...licenses]); // Optimistic update
        // Reset form
        setSelectedBusinessId("");
        setLicenseType("");
        setLicenseNumber("");
        setIssuingAuthority("");
        setIssueDate("");
        setExpirationDate("");
        setRenewalUrl("");
        setNotes("");
        setShowForm(false);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to create license", error);
    }
  };

  // Edit handlers
  const handleEdit = (license: any) => {
    setEditingLicenseId(license.id);
    setEditForm({
      licenseType: license.licenseType,
      licenseNumber: license.licenseNumber || "",
      issuingAuthority: license.issuingAuthority,
      issueDate: license.issueDate.split('T')[0],
      expirationDate: license.expirationDate.split('T')[0],
      renewalUrl: license.renewalUrl || "",
      notes: license.notes || "",
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLicenseId) return;

    try {
      const response = await fetch(`/api/licenses/${editingLicenseId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        const updatedLicense = await response.json();
        setLicenses(licenses.map(lic => lic.id === editingLicenseId ? updatedLicense : lic));
        setEditingLicenseId(null);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to update license", error);
    }
  };

  const handleDelete = async (licenseId: string) => {
    if (!confirm("Are you sure you want to delete this license?")) return;

    try {
      const response = await fetch(`/api/licenses/${licenseId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setLicenses(licenses.filter(lic => lic.id !== licenseId));
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to delete license", error);
    }
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'current':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'expiring_soon':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'grace_period':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Calculate days until expiration
  const getDaysUntilExpiration = (expirationDate: string) => {
    const today = new Date();
    const expiration = new Date(expirationDate);
    const diffTime = expiration.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (isLoading) return <div className="p-6">Loading licenses...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">License Tracking</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition font-medium"
        >
          {showForm ? 'Cancel' : '+ Add License'}
        </button>
      </div>

      {/* Add License Form */}
      {showForm && (
        <div className="bg-white p-6 rounded-lg shadow mb-8 border">
          <h2 className="text-xl font-semibold mb-4">Add New License</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Business *
              </label>
              <select
                className="w-full p-2 border rounded-md"
                value={selectedBusinessId}
                onChange={(e) => setSelectedBusinessId(e.target.value)}
                required
              >
                <option value="">Select a business...</option>
                {businesses.map((biz) => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  License Type *
                </label>
                <input
                  type="text"
                  placeholder="e.g., Mobile Food Vendor License"
                  className="w-full p-2 border rounded-md"
                  value={licenseType}
                  onChange={(e) => setLicenseType(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  License Number
                </label>
                <input
                  type="text"
                  placeholder="License Number"
                  className="w-full p-2 border rounded-md"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issuing Authority *
              </label>
              <input
                type="text"
                placeholder="e.g., NYC Dept of Health"
                className="w-full p-2 border rounded-md"
                value={issuingAuthority}
                onChange={(e) => setIssuingAuthority(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Issue Date *
                </label>
                <input
                  type="date"
                  className="w-full p-2 border rounded-md"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiration Date *
                </label>
                <input
                  type="date"
                  className="w-full p-2 border rounded-md"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Renewal URL
              </label>
              <input
                type="url"
                placeholder="https://renewal-portal.com"
                className="w-full p-2 border rounded-md"
                value={renewalUrl}
                onChange={(e) => setRenewalUrl(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                placeholder="Additional notes..."
                className="w-full p-2 border rounded-md"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 transition font-medium"
            >
              Add License
            </button>
          </form>
        </div>
      )}

      {/* Licenses List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {licenses.length === 0 ? (
          <p className="text-gray-500 col-span-full">No licenses found. Add one above!</p>
        ) : (
          licenses.map((license) => {
            const daysUntilExpiration = getDaysUntilExpiration(license.expirationDate);
            const isExpiringSoon = daysUntilExpiration <= 30 && daysUntilExpiration > 0;
            const isExpired = daysUntilExpiration < 0;

            return (
              <div key={license.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition p-4">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-bold text-lg flex-1">{license.licenseType}</h3>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(license.status)}`}>
                    {license.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                {/* Edit Form */}
                {editingLicenseId === license.id ? (
                  <form onSubmit={handleUpdate} className="space-y-3 mb-4">
                    <input
                      type="text"
                      placeholder="License Type"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.licenseType}
                      onChange={(e) => setEditForm({...editForm, licenseType: e.target.value})}
                      required
                    />
                    <input
                      type="text"
                      placeholder="License Number"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.licenseNumber}
                      onChange={(e) => setEditForm({...editForm, licenseNumber: e.target.value})}
                    />
                    <input
                      type="text"
                      placeholder="Issuing Authority"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.issuingAuthority}
                      onChange={(e) => setEditForm({...editForm, issuingAuthority: e.target.value})}
                      required
                    />
                    <input
                      type="date"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.issueDate}
                      onChange={(e) => setEditForm({...editForm, issueDate: e.target.value})}
                      required
                    />
                    <input
                      type="date"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.expirationDate}
                      onChange={(e) => setEditForm({...editForm, expirationDate: e.target.value})}
                      required
                    />
                    <input
                      type="url"
                      placeholder="Renewal URL"
                      className="w-full p-2 border rounded-md text-sm"
                      value={editForm.renewalUrl}
                      onChange={(e) => setEditForm({...editForm, renewalUrl: e.target.value})}
                    />
                    <textarea
                      placeholder="Notes"
                      className="w-full p-2 border rounded-md text-sm"
                      rows={2}
                      value={editForm.notes}
                      onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                    />
                  </form>
                ) : (
                  <div className="space-y-2 text-sm text-gray-600">
                    <p><span className="font-medium">Business:</span> {license.business?.name || 'Unknown'}</p>
                    {license.licenseNumber && (
                      <p><span className="font-medium">Number:</span> {license.licenseNumber}</p>
                    )}
                    <p><span className="font-medium">Authority:</span> {license.issuingAuthority}</p>
                    <p><span className="font-medium">Issued:</span> {formatDate(license.issueDate)}</p>
                    <p>
                      <span className="font-medium">Expires:</span> {formatDate(license.expirationDate)}
                      {isExpiringSoon && (
                        <span className="ml-2 text-yellow-600 font-medium">
                          ({daysUntilExpiration} days)
                        </span>
                      )}
                      {isExpired && (
                        <span className="ml-2 text-red-600 font-medium">
                          ({Math.abs(daysUntilExpiration)} days ago)
                        </span>
                      )}
                    </p>
                    {license.renewalUrl && (
                      <p>
                        <span className="font-medium">Renewal:</span> 
                        <a 
                          href={license.renewalUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline ml-1"
                        >
                          Link
                        </a>
                      </p>
                    )}
                  </div>
                )}

                {license.notes && editingLicenseId !== license.id && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Notes:</span> {license.notes}
                    </p>
                  </div>
                )}

                <div className="mt-4 flex justify-end space-x-2">
                  {editingLicenseId === license.id ? (
                    <>
                      <button 
                        onClick={handleUpdate}
                        className="text-green-600 text-sm font-medium hover:underline"
                      >
                        Save
                      </button>
                      <button 
                        onClick={() => setEditingLicenseId(null)}
                        className="text-gray-600 text-sm font-medium hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        onClick={() => handleEdit(license)}
                        className="text-blue-600 text-sm font-medium hover:underline"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDelete(license.id)}
                        className="text-red-600 text-sm font-medium hover:underline"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}