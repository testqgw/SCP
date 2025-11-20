import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <nav className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-2xl mr-2">📋</span>
              <h1 className="text-xl font-bold text-gray-900">
                Compliance Reminder
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/sign-in"
                className="text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md text-sm font-medium transition"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="bg-blue-600 text-white hover:bg-blue-700 px-5 py-2 rounded-md text-sm font-medium transition shadow-sm"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24">
        <div className="text-center">
          <h1 className="text-6xl font-extrabold text-gray-900 sm:text-7xl md:text-8xl leading-tight">
            Never Miss a{' '}
            <span className="bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent">
              License Renewal
            </span>
          </h1>
          <p className="mt-8 max-w-3xl mx-auto text-xl text-gray-600 leading-relaxed">
            Automated reminders for business licenses, permits, and certifications.
            <br className="hidden sm:block" />
            Avoid costly fines and business shutdowns with timely SMS and email alerts.
          </p>
          <div className="mt-12 flex flex-col sm:flex-row gap-5 justify-center">
            <Link
              href="/sign-up"
              className="group px-10 py-5 bg-blue-600 text-white text-lg font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
            >
              Start Free Trial
              <span className="inline-block ml-2 group-hover:translate-x-1 transition-transform">→</span>
            </Link>
            <Link
              href="/sign-in"
              className="px-10 py-5 bg-white text-blue-600 text-lg font-bold rounded-xl hover:bg-gray-50 transition-all border-3 border-blue-600 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
            >
              Sign In
            </Link>
          </div>
        </div>

        <div className="mt-20 text-center">
          <p className="text-sm text-gray-500 uppercase tracking-wider font-bold">
            Trusted by food trucks, contractors, and mobile service businesses
          </p>
        </div>
      </div>

      <div className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900">
              Stay Compliant, Avoid Fines
            </h2>
            <p className="mt-4 text-xl text-gray-600">
              Everything you need to track and renew licenses on time
            </p>
          </div>

          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                📅
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Automatic Reminders
              </h3>
              <p className="text-gray-600">
                Get alerts at 90, 60, 30, 14, 7, and 1 day before expiration. Never forget a deadline again.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                📱
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                SMS & Email Alerts
              </h3>
              <p className="text-gray-600">
                Receive notifications via text message and email so you're always informed, wherever you are.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                📊
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Centralized Dashboard
              </h3>
              <p className="text-gray-600">
                Track all your licenses in one place with color-coded status indicators and quick actions.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div className="bg-white rounded-2xl shadow-lg p-10 h-full">
              <h2 className="text-4xl font-bold text-gray-900 mb-8">
                The Problem
              </h2>
              <ul className="space-y-6">
                <li className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-7 w-7 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-lg text-gray-700">
                      Missing a renewal deadline can cost{' '}
                      <span className="font-bold text-gray-900">$500-$5,000+</span> in fines
                    </p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-7 w-7 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-lg text-gray-700">
                      Expired licenses can{' '}
                      <span className="font-bold text-gray-900">shut down your business</span> operations
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-10 h-full border-2 border-blue-500">
              <h2 className="text-4xl font-bold text-gray-900 mb-8">
                The Solution
              </h2>
              <ul className="space-y-6">
                <li className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-7 w-7 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-lg text-gray-700">
                      <span className="font-bold text-gray-900">Automated reminders</span> ensure you never miss a deadline
                    </p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="flex-shrink-0">
                    <svg className="h-7 w-7 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className="text-lg text-gray-700">
                      <span className="font-bold text-gray-900">Stay compliant</span> and keep your business running smoothly
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-600 py-16">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to Stay Compliant?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join businesses that never miss a license renewal deadline
          </p>
          <Link
            href="/sign-in"
            className="inline-block px-10 py-4 bg-white text-blue-600 text-lg font-bold rounded-lg hover:bg-gray-100 transition shadow-lg"
          >
            Sign Up Now
          </Link>
        </div>
      </div>
    </div>
  )
}