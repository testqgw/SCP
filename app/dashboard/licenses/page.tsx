'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface License {
  id: string;
  business_id: string;
  license_type: string;
  license_number: string;
  issuing_authority: string;
  issue_date: string;
  expiration_date: string;
  renewal_url: string;
  status: 'current' | 'expiring_soon' | 'expired' | 'grace_period';
  grace_period_days: number;
}

interface Business {
  id: string;
  name: string;
}

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<License[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    business_id: '',
    license_type: 'Health Permit',
    license_number: '',
    issuing_authority: '',
    issue_date: '',
    expiration_date: '',
    renewal_url: '',
    grace_period_days: '0',
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch data on load
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [licensesRes, businessesRes] = await Promise.all([
        fetch('http://localhost:3001/api/licenses'),
        fetch('http://localhost:3001/api/businesses'),
      ]);

      if (!licensesRes.ok || !businessesRes.ok) {
        throw new Error('Failed to fetch data');
      }

      const licensesData = await licensesRes.json();
      const businessesData = await businessesRes.json();

      setLicenses(Array.isArray(licensesData) ? licensesData : []);
      setBusinesses(Array.isArray(businessesData) ? businessesData : []);
    } catch (err) {
      console.error('Error fetching:', err);
      setError('Failed to load data. Make sure API is running on port 3001.');
      setLicenses([]);
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const url = editingId 
        ? `http://localhost:3001/api/licenses/${editingId}`
        : 'http://localhost:3001/api/licenses';
      const method = editingId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          grace_period_days: parseInt(formData.grace_period_days),
        }),
      });

      if (response.ok) {
        setFormData({
          business_id: '',
          license_type: 'Health Permit',
          license_number: '',
          issuing_authority: '',
          issue_date: '',
          expiration_date: '',
          renewal_url: '',
          grace_period_days: '0',
        });
        setEditingId(null);
        setShowForm(false);
        fetchData();
      } else {
        alert(editingId ? 'Failed to update license' : 'Failed to create license');
      }
    } catch (error) {
      console.error('Error saving license:', error);
      alert('Error saving license');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this license?')) return;

    try {
      await fetch(`http://localhost:3001/api/licenses/${id}`, {
        method: 'DELETE',
      });
      fetchData();
    } catch (error) {
      console.error('Error deleting license:', error);
    }
  };

  const handleEdit = (license: License) => {
    setFormData({
      business_id: license.business_id,
      license_type: license.license_type,
      license_number: license.license_number,
      issuing_authority: license.issuing_authority,
      issue_date: license.issue_date,
      expiration_date: license.expiration_date,
      renewal_url: license.renewal_url,
      grace_period_days: String(license.grace_period_days),
    });
    setEditingId(license.id);
    setShowForm(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'current':
        return 'bg-green-50 border-green-200 text-green-900';
      case 'expiring_soon':
        return 'bg-yellow-50 border-yellow-200 text-yellow-900';
      case 'expired':
        return 'bg-red-50 border-red-200 text-red-900';
      case 'grace_period':
        return 'bg-orange-50 border-orange-200 text-orange-900';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-900';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'current':
        return 'bg-green-500';
      case 'expiring_soon':
        return 'bg-yellow-500';
      case 'expired':
        return 'bg-red-500';
      case 'grace_period':
        return 'bg-orange-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getDaysUntilExpiration = (expirationDate: string) => {
    const today = new Date();
    const expDate = new Date(expirationDate);
    const daysLeft = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysLeft;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Licenses</h1>
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
            <button
              onClick={fetchData}
              className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Add License Form */}
        {showForm ? (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {editingId ? 'Edit License' : 'Add New License'}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setFormData({
                    business_id: '',
                    license_type: 'Health Permit',
                    license_number: '',
                    issuing_authority: '',
                    issue_date: '',
                    expiration_date: '',
                    renewal_url: '',
                    grace_period_days: '0',
                  });
                }}
                className="text-gray-600 hover:text-gray-800 font-medium"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Business Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Business *
                  </label>
                  <select
                    required
                    value={formData.business_id}
                    onChange={(e) =>
                      setFormData({ ...formData, business_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium"
                    style={{ color: '#111827' }}
                  >
                    <option value="" className="text-gray-500">Select a business</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id} className="text-gray-900">
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* License Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    License Type *
                  </label>
                  <select
                    value={formData.license_type}
                    onChange={(e) =>
                      setFormData({ ...formData, license_type: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium"
                    style={{ color: '#111827' }}
                  >
                    <option value="Health Permit">Health Permit</option>
                    <option value="Vendor License">Vendor License</option>
                    <option value="Fire Safety Certificate">Fire Safety Certificate</option>
                    <option value="Insurance Certificate">Insurance Certificate</option>
                    <option value="Business License">Business License</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* License Number */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    License Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.license_number}
                    onChange={(e) =>
                      setFormData({ ...formData, license_number: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium placeholder-gray-400"
                    style={{ color: '#111827' }}
                    placeholder="HP-2024-001"
                  />
                </div>

                {/* Issuing Authority */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Issuing Authority *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.issuing_authority}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        issuing_authority: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium placeholder-gray-400"
                    style={{ color: '#111827' }}
                    placeholder="City Health Department"
                  />
                </div>

                {/* Issue Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Issue Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.issue_date}
                    onChange={(e) =>
                      setFormData({ ...formData, issue_date: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium"
                    style={{ color: '#111827' }}
                  />
                </div>

                {/* Expiration Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Expiration Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.expiration_date}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expiration_date: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium"
                    style={{ color: '#111827' }}
                  />
                </div>

                {/* Renewal URL */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Renewal URL
                  </label>
                  <input
                    type="url"
                    value={formData.renewal_url}
                    onChange={(e) =>
                      setFormData({ ...formData, renewal_url: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium placeholder-gray-400"
                    style={{ color: '#111827' }}
                    placeholder="https://example.com/renew"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setFormData({
                      business_id: '',
                      license_type: 'Health Permit',
                      license_number: '',
                      issuing_authority: '',
                      issue_date: '',
                      expiration_date: '',
                      renewal_url: '',
                      grace_period_days: '0',
                    });
                  }}
                  className="px-6 py-2 border-2 border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
                >
                  {editingId ? 'Update License' : 'Save License'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="mb-6">
            <button
              onClick={() => setShowForm(true)}
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium"
            >
              + Add License
            </button>
          </div>
        )}

        {/* Status Legend */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Status Legend</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span>Current</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></div>
              <span>Expiring Soon</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div>
              <span>Expired</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div>
              <span>Grace Period</span>
            </div>
          </div>
        </div>

        {/* Licenses List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">All Licenses</h2>

            {loading ? (
              <p className="text-gray-600">Loading licenses...</p>
            ) : licenses.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600 mb-4">No licenses yet</p>
                <p className="text-sm text-gray-500">
                  Click "Add License" above to get started
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {licenses.map((license) => {
                  const daysLeft = getDaysUntilExpiration(license.expiration_date);
                  return (
                    <div
                      key={license.id}
                      className={`border-2 rounded-lg p-4 ${getStatusColor(
                        license.status
                      )}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-3 h-3 rounded-full ${getStatusDot(
                                license.status
                              )}`}
                            ></div>
                            <h3 className="text-lg font-semibold">
                              {license.license_type}
                            </h3>
                          </div>

                          <p className="text-sm mt-1">
                            <strong>Number:</strong> {license.license_number}
                          </p>
                          <p className="text-sm">
                            <strong>Authority:</strong>{' '}
                            {license.issuing_authority}
                          </p>
                          <p className="text-sm">
                            <strong>Expires:</strong>{' '}
                            {new Date(license.expiration_date).toLocaleDateString()}
                            {daysLeft >= 0 && (
                              <span className="ml-2">
                                ({daysLeft} days remaining)
                              </span>
                            )}
                            {daysLeft < 0 && (
                              <span className="ml-2">
                                (Expired {Math.abs(daysLeft)} days ago)
                              </span>
                            )}
                          </p>

                          {license.renewal_url && (
                            <a
                              href={license.renewal_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-sm mt-2 inline-block"
                            >
                              Renew →
                            </a>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEdit(license)}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(license.id)}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}