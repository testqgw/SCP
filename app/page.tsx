import Link from 'next/link'
import { SignInButton, SignUpButton } from '@clerk/nextjs'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Navigation */}
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
              <SignInButton mode="modal">
                <button className="text-gray-700 hover:text-gray-900 px-4 py-2 rounded-md text-sm font-medium transition">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="bg-blue-600 text-white hover:bg-blue-700 px-5 py-2 rounded-md text-sm font-medium transition shadow-sm">
                  Sign Up
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        <div className="text-center">
          <h1 className="text-5xl font-extrabold text-gray-900 sm:text-6xl md:text-7xl">
            Never Miss a
            <span className="text-blue-600"> License Renewal</span>
          </h1>
          <p className="mt-6 max-w-2xl mx-auto text-xl text-gray-600 leading-relaxed">
            Automated reminders for business licenses, permits, and certifications.
            Avoid costly fines and business shutdowns with timely SMS and email alerts.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <SignUpButton mode="modal">
              <button className="px-8 py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition shadow-lg hover:shadow-xl">
                Get Started
              </button>
            </SignUpButton>
            <SignInButton mode="modal">
              <button className="px-8 py-4 bg-white text-blue-600 text-lg font-semibold rounded-lg hover:bg-gray-50 transition border-2 border-blue-600">
                Sign In
              </button>
            </SignInButton>
          </div>
        </div>

        {/* Social Proof */}
        <div className="mt-16 text-center">
          <p className="text-sm text-gray-500 uppercase tracking-wide font-semibold">
            Trusted by food trucks, contractors, and mobile service businesses
          </p>
        </div>
      </div>

      {/* Features Section */}
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

            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                📄
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Document Storage
              </h3>
              <p className="text-gray-600">
                Upload and store license documents securely in the cloud. Access them anytime, anywhere.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                🏢
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Multi-Location Support
              </h3>
              <p className="text-gray-600">
                Manage licenses for multiple business locations from a single account.
              </p>
            </div>

            <div className="text-center p-6 rounded-lg hover:shadow-lg transition">
              <div className="flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-4xl mx-auto mb-4">
                📈
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Renewal History
              </h3>
              <p className="text-gray-600">
                Keep track of past renewals and maintain compliance records for audits.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Problem/Solution Section */}
      <div className="bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">
                The Problem
              </h2>
              <ul className="space-y-4 text-gray-700">
                <li className="flex items-start">
                  <span className="text-red-500 font-bold mr-3">✗</span>
                  <span>Missing a renewal deadline can cost <strong>$500-$5,000+</strong> in fines</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 font-bold mr-3">✗</span>
                  <span>Expired licenses can <strong>shut down your business</strong> operations</span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 font-bold mr-3">✗</span>
                  <span>Tracking multiple licenses manually is <strong>time-consuming and error-prone</strong></span>
                </li>
                <li className="flex items-start">
                  <span className="text-red-500 font-bold mr-3">✗</span>
                  <span>Spreadsheets and calendars <strong>don't send automatic reminders</strong></span>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-6">
                The Solution
              </h2>
              <ul className="space-y-4 text-gray-700">
                <li className="flex items-start">
                  <span className="text-green-500 font-bold mr-3">✓</span>
                  <span><strong>Automated reminders</strong> ensure you never miss a deadline</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 font-bold mr-3">✓</span>
                  <span><strong>Stay compliant</strong> and keep your business running smoothly</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 font-bold mr-3">✓</span>
                  <span><strong>Centralized tracking</strong> saves hours of manual work each month</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 font-bold mr-3">✓</span>
                  <span><strong>SMS and email alerts</strong> reach you wherever you are</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-4 text-xl text-gray-600">
              Choose the plan that fits your business
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 border-2 border-gray-200 hover:border-blue-500 transition">
              <h3 className="text-2xl font-bold text-gray-900">Starter</h3>
              <p className="mt-2 text-gray-600">Perfect for single-location businesses</p>
              <div className="mt-6">
                <span className="text-5xl font-extrabold text-gray-900">$49</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mt-8 space-y-4">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>1 Business Location</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Unlimited Licenses</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>SMS & Email Reminders</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Document Storage</span>
                </li>
              </ul>
              <SignUpButton mode="modal">
                <button className="mt-8 block w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center">
                  Get Started
                </button>
              </SignUpButton>
            </div>

            <div className="bg-white rounded-lg shadow-xl p-8 border-4 border-blue-500 relative transform scale-105">
              <div className="absolute top-0 right-0 bg-blue-500 text-white px-4 py-1 text-sm font-semibold rounded-bl-lg rounded-tr-lg">
                POPULAR
              </div>
              <h3 className="text-2xl font-bold text-gray-900">Professional</h3>
              <p className="mt-2 text-gray-600">For growing businesses</p>
              <div className="mt-6">
                <span className="text-5xl font-extrabold text-gray-900">$99</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mt-8 space-y-4">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>3 Business Locations</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Unlimited Licenses</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>SMS & Email Reminders</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Document Storage</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Priority Support</span>
                </li>
              </ul>
              <SignUpButton mode="modal">
                <button className="mt-8 block w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center">
                  Get Started
                </button>
              </SignUpButton>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-8 border-2 border-gray-200 hover:border-blue-500 transition">
              <h3 className="text-2xl font-bold text-gray-900">Multi-Location</h3>
              <p className="mt-2 text-gray-600">For enterprise businesses</p>
              <div className="mt-6">
                <span className="text-5xl font-extrabold text-gray-900">$149</span>
                <span className="text-gray-600">/month</span>
              </div>
              <ul className="mt-8 space-y-4">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Unlimited Locations</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Unlimited Licenses</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>SMS & Email Reminders</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Document Storage</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span>Dedicated Support</span>
                </li>
              </ul>
              <SignUpButton mode="modal">
                <button className="mt-8 block w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition text-center">
                  Get Started
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-blue-600 py-16">
        <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-white mb-4">
            Ready to Stay Compliant?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join businesses that never miss a license renewal deadline
          </p>
          <SignUpButton mode="modal">
            <button className="inline-block px-10 py-4 bg-white text-blue-600 text-lg font-bold rounded-lg hover:bg-gray-100 transition shadow-lg">
              Sign Up Now
            </button>
          </SignUpButton>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-white font-bold mb-4">Compliance Reminder</h3>
              <p className="text-sm">
                Helping businesses stay compliant and avoid costly fines through automated license tracking.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Features</a></li>
                <li><a href="#" className="hover:text-white transition">Pricing</a></li>
                <li><a href="#" className="hover:text-white transition">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">About</a></li>
                <li><a href="#" className="hover:text-white transition">Contact</a></li>
                <li><a href="#" className="hover:text-white transition">Privacy Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm">
            <p>&copy; 2025 Compliance Reminder. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}