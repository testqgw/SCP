import { SignIn } from '@clerk/nextjs'
import { isClerkConfigured } from '@/lib/clerk-config'

export default function Page() {
  // If Clerk is not configured, show development mode message
  if (!isClerkConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold mb-4">Sign In</h1>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800">
              <strong>Clerk Authentication Not Configured</strong>
            </p>
            <p className="text-yellow-700 text-sm mt-2">
              Please add your Clerk API keys to .env.local
            </p>
          </div>
          <div className="bg-gray-100 rounded-lg p-6">
            <p className="text-gray-600 mb-4">Development mode: Authentication bypassed</p>
            <a
              href="/dashboard"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700"
            >
              Continue to Dashboard →
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Real Clerk sign-in page
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <SignIn />
      </div>
    </div>
  );
}