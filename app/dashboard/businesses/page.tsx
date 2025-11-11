'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Business {
  id: string;
  name: string;
  business_type: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export default function BusinessesPage() {
  // Initialize with empty array (critical!)
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    business_type: 'food_vendor',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
  });

  // Fetch businesses on load
  useEffect(() => {
    fetchBusinesses();
  }, []);

  const fetchBusinesses = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('http://localhost:3001/api/businesses');
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Ensure data is an array
      if (Array.isArray(data)) {
        setBusinesses(data);
      } else {
        console.error('API returned non-array:', data);
        setBusinesses([]);
        setError('Invalid data format from API');
      }
    } catch (error) {
      console.error('Error fetching businesses:', error);
      setBusinesses([]);
      setError('Failed to load businesses. Make sure API is running on port 3001.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch('http://localhost:3001/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          user_id: 'demo-user-id', // In production, this comes from auth
        }),
      });

      if (response.ok) {
        // Reset form
        setFormData({
          name: '',
          business_type: 'food_vendor',
          address: '',
          city: '',
          state: '',
          zip: '',
          phone: '',
        });
        setShowForm(false);
        // Refresh list
        fetchBusinesses();
      }
    } catch (error) {
      console.error('Error creating business:', error);
      alert('Failed to create business. Make sure the API is running on port 3001.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this business?')) return;

    try {
      await fetch(`http://localhost:3001/api/businesses/${id}`, {
        method: 'DELETE',
      });
      fetchBusinesses();
    } catch (error) {
      console.error('Error deleting business:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Businesses</h1>
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
        {/* Add Business Form */}
        {showForm ? (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Add New Business</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Taco Paradise"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Business Type *
                  </label>
                  <select
                    value={formData.business_type}
                    onChange={(e) => setFormData({...formData, business_type: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 font-medium"
                    style={{ color: '#111827' }}
                    required
                  >
                    <option value="food_vendor" style={{ color: '#111827' }}>Food Vendor</option>
                    <option value="contractor" style={{ color: '#111827' }}>Contractor</option>
                    <option value="mobile_service" style={{ color: '#111827' }}>Mobile Service</option>
                    <option value="other" style={{ color: '#111827' }}>Other</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Address *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="123 Food Street"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.city}
                    onChange={(e) => setFormData({...formData, city: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Austin"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.state}
                    onChange={(e) => setFormData({...formData, state: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="TX"
                    maxLength={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ZIP Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.zip}
                    onChange={(e) => setFormData({...formData, zip: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="78701"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="+1 555-123-4567"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Save Business
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="mb-6">
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium"
            >
              + Add Business
            </button>
          </div>
        )}

        {/* Business List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">Your Businesses</h2>
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800">{error}</p>
                <button
                  onClick={fetchBusinesses}
                  className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
                >
                  Try Again
                </button>
              </div>
            )}
            
            {loading ? (
              <div className="text-center py-8">
                <p className="text-gray-600">Loading businesses...</p>
              </div>
            ) : businesses.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600 mb-4">No businesses yet</p>
                <p className="text-sm text-gray-500">
                  Click "Add Business" above to get started
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {businesses.map((business) => (
                  <div
                    key={business.id}
                    className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 transition"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {business.name || 'Unnamed Business'}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1">
                          {(business.business_type || 'other').replace('_', ' ').toUpperCase()}
                        </p>
                        <p className="text-sm text-gray-600 mt-2">
                          {business.address || 'No address'}, {business.city || ''}, {business.state || ''} {business.zip || ''}
                        </p>
                        <p className="text-sm text-gray-600">
                          {business.phone || 'No phone'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/dashboard/licenses?business=${business.id}`}
                          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          View Licenses
                        </Link>
                        <button
                          onClick={() => handleDelete(business.id)}
                          className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}