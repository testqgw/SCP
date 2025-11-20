import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { LayoutDashboard, FileText, ShieldCheck, Briefcase } from "lucide-react"; 

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ✅ GLOBAL NAVIGATION BAR */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            
            {/* Left Side: Logo & Nav Links */}
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <span className="text-xl font-bold text-blue-600 ml-2">
                  Safe<span className="text-blue-400">Ops</span>
                </span>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {/* DASHBOARD LINK */}
                <Link 
                  href="/dashboard" 
                  className="border-transparent text-gray-500 hover:border-blue-500 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  <LayoutDashboard className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>

                <Link 
                  href="/dashboard/businesses" 
                  className="border-transparent text-gray-500 hover:border-blue-500 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  <Briefcase className="w-4 h-4 mr-2" />
                  Businesses
                </Link>

                <Link 
                  href="/dashboard/licenses" 
                  className="border-transparent text-gray-500 hover:border-blue-500 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Licenses
                </Link>

                <Link 
                  href="/dashboard/documents" 
                  className="border-transparent text-gray-500 hover:border-blue-500 hover:text-gray-700 inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Documents
                </Link>
              </div>
            </div>

            {/* Right Side: User Profile */}
            <div className="flex items-center">
              <UserButton afterSignOutUrl="/" />
            </div>
          </div>
        </div>
      </nav>

      {/* ✅ PAGE CONTENT INJECTED HERE */}
      <main className="py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}