import Link from 'next/link';

export default function DashboardPage() {
  // In production, these would come from your API
  // For now, we'll use placeholder data
  const stats = {
    totalBusinesses: 1,
    totalLicenses: 3,
    expiringSoon: 1,
    expired: 1,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-600 mt-1">
                Compliance Reminder System
              </p>
            </div>
            <Link 
              href="/"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Businesses Card */}
          <Link href="/dashboard/businesses">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Total Businesses
                  </p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {stats.totalBusinesses}
                  </p>
                </div>
                <div className="bg-blue-100 rounded-full p-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-blue-600 mt-3 font-medium">
                Click to manage →
              </p>
            </div>
          </Link>

          {/* Total Licenses Card */}
          <Link href="/dashboard/licenses">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Total Licenses
                  </p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {stats.totalLicenses}
                  </p>
                </div>
                <div className="bg-green-100 rounded-full p-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-green-600 mt-3 font-medium">
                Click to view all →
              </p>
            </div>
          </Link>

          {/* Expiring Soon Card */}
          <Link href="/dashboard/licenses?filter=expiring">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-yellow-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Expiring Soon
                  </p>
                  <p className="text-3xl font-bold text-yellow-600 mt-2">
                    {stats.expiringSoon}
                  </p>
                </div>
                <div className="bg-yellow-100 rounded-full p-3">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-yellow-600 mt-3 font-medium">
                Click to review →
              </p>
            </div>
          </Link>

          {/* Expired Card */}
          <Link href="/dashboard/licenses?filter=expired">
            <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow cursor-pointer border-2 border-transparent hover:border-red-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    Expired
                  </p>
                  <p className="text-3xl font-bold text-red-600 mt-2">
                    {stats.expired}
                  </p>
                </div>
                <div className="bg-red-100 rounded-full p-3">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              </div>
              <p className="text-xs text-red-600 mt-3 font-medium">
                Click to renew →
              </p>
            </div>
          </Link>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link 
              href="/dashboard/businesses"
              className="flex items-center p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition"
            >
              <span className="text-2xl mr-3">🏢</span>
              <div>
                <p className="font-medium text-gray-900">Add Business</p>
                <p className="text-xs text-gray-600">Create a new business profile</p>
              </div>
            </Link>
            
            <Link 
              href="/dashboard/licenses"
              className="flex items-center p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition"
            >
              <span className="text-2xl mr-3">📋</span>
              <div>
                <p className="font-medium text-gray-900">Add License</p>
                <p className="text-xs text-gray-600">Track a new license or permit</p>
              </div>
            </Link>
            
            <Link 
              href="/dashboard/settings"
              className="flex items-center p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition"
            >
              <span className="text-2xl mr-3">⚙️</span>
              <div>
                <p className="font-medium text-gray-900">Settings</p>
                <p className="text-xs text-gray-600">Manage your account</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Getting Started (if no data) */}
        {stats.totalBusinesses === 0 && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">
              👋 Welcome! Let's get started
            </h3>
            <p className="text-blue-800 mb-4">
              Set up your first business and start tracking license renewals in 3 easy steps:
            </p>
            <ol className="space-y-2 text-blue-900">
              <li className="flex items-start">
                <span className="font-bold mr-2">1.</span>
                <span>Add your business information (name, address, type)</span>
              </li>
              <li className="flex items-start">
                <span className="font-bold mr-2">2.</span>
                <span>Add your licenses (health permit, vendor license, etc.)</span>
              </li>
              <li className="flex items-start">
                <span className="font-bold mr-2">3.</span>
                <span>We'll automatically remind you before they expire!</span>
              </li>
            </ol>
            <Link 
              href="/dashboard/businesses"
              className="inline-block mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
            >
              Add Your First Business →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}