import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Building2, FileText, AlertTriangle, CheckCircle, ArrowRight, Plus, AlertCircle, Clock, ExternalLink } from "lucide-react";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { userId } = auth();

  if (!userId) {
    return <div>Please sign in</div>;
  }

  // 1. Fetch Stats
  const businessCount = await prisma.business.count({
    where: {
      memberships: { some: { userId: userId } }
    }
  });

  const licenseCount = await prisma.license.count({
    where: {
      business: {
        memberships: { some: { userId: userId } }
      }
    }
  });

  // 2. Fetch Priority Items (Expiring Soon or Expired)
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  const expiringLicenses = await prisma.license.findMany({
    where: {
      business: {
        memberships: { some: { userId: userId } }
      },
      expirationDate: { lte: thirtyDaysFromNow }
    },
    orderBy: { expirationDate: 'asc' },
    take: 5,
    include: { business: true }
  });

  const allExpiredLicenses = await prisma.license.findMany({
    where: {
      business: {
        memberships: { some: { userId: userId } }
      },
      expirationDate: { lt: today }
    }
  });

  const expiredCount = allExpiredLicenses.length;
  const warningCount = expiringLicenses.filter(l => new Date(l.expirationDate) >= today).length;

  return (
    <div className="space-y-8">

      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
          <p className="text-slate-500">Here is your compliance health at a glance.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/businesses" className="inline-flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm">
            Manage Businesses
          </Link>
          <Link href="/dashboard/licenses" className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-500 transition-colors shadow-sm shadow-blue-200">
            <Plus className="w-4 h-4" /> Add License
          </Link>
        </div>
      </div>

      {/* CLICKABLE STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Card 1: Businesses - CLICKABLE */}
        <Link href="/dashboard/businesses" className="group">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                <Building2 className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-400 uppercase">Total</span>
                <ExternalLink className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 mb-1">{businessCount}</div>
            <div className="text-sm text-slate-500 group-hover:text-blue-600 transition-colors">Active Businesses</div>
          </div>
        </Link>

        {/* Card 2: Licenses - CLICKABLE */}
        <Link href="/dashboard/licenses" className="group">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer">
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-indigo-50 rounded-lg group-hover:bg-indigo-100 transition-colors">
                <FileText className="w-6 h-6 text-indigo-600" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-400 uppercase">Total</span>
                <ExternalLink className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 mb-1">{licenseCount}</div>
            <div className="text-sm text-slate-500 group-hover:text-indigo-600 transition-colors">Tracked Licenses</div>
          </div>
        </Link>

        {/* Card 3: Expiring Soon - CLICKABLE */}
        <Link href="/dashboard/licenses?filter=expiring" className="group">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-yellow-300 transition-all cursor-pointer relative overflow-hidden">
            {warningCount > 0 && <div className="absolute top-0 right-0 w-16 h-16 bg-yellow-400/10 rounded-bl-full" />}
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-yellow-50 rounded-lg group-hover:bg-yellow-100 transition-colors">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-yellow-600 uppercase">Action Needed</span>
                <ExternalLink className="w-3 h-3 text-yellow-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="text-3xl font-bold text-slate-900 mb-1">{warningCount}</div>
            <div className="text-sm text-slate-500 group-hover:text-yellow-600 transition-colors">Expiring within 30 days</div>
          </div>
        </Link>

        {/* Card 4: Expired (Critical) - CLICKABLE */}
        <Link href="/dashboard/licenses?filter=expired" className="group">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-red-300 transition-all cursor-pointer relative overflow-hidden">
            {expiredCount > 0 && <div className="absolute top-0 right-0 w-16 h-16 bg-red-400/10 rounded-bl-full" />}
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-red-50 rounded-lg group-hover:bg-red-100 transition-colors">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-red-600 uppercase">Critical</span>
                <ExternalLink className="w-3 h-3 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="text-3xl font-bold text-red-600 mb-1">{expiredCount}</div>
            <div className="text-sm text-red-600/80 group-hover:text-red-700 transition-colors">Expired Licenses</div>
          </div>
        </Link>

      </div>

      {/* PRIORITY ACTION FEED */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left: Urgent Tasks */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h2 className="font-semibold text-slate-900">Priority Action Items</h2>
            <Link href="/dashboard/licenses" className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              View All <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {expiringLicenses.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="text-slate-900 font-medium">All Clear!</h3>
                <p className="text-slate-500 text-sm mt-1">No licenses are expiring in the next 30 days.</p>
              </div>
            ) : (
              expiringLicenses.map((license) => {
                const isExpired = new Date(license.expirationDate) < today;
                const daysLeft = Math.ceil((new Date(license.expirationDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                return (
                  <Link key={license.id} href={`/dashboard/licenses?businessId=${license.businessId}`} className="block">
                    <div className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className={`w-3 h-3 rounded-full ${isExpired ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                        <div>
                          <div className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors">{license.licenseType}</div>
                          <div className="text-sm text-slate-500">{license.business.name}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className={`text-sm font-semibold px-3 py-1 rounded-full ${isExpired ? 'bg-red-50 text-red-600' : 'bg-yellow-50 text-yellow-700'}`}>
                          {isExpired ? `Expired ${Math.abs(daysLeft)} days ago` : `${daysLeft} days left`}
                        </div>
                        <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Quick Tips / Upgrade */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-[#0B1120] to-slate-900 rounded-xl p-6 text-white shadow-lg">
            <h3 className="font-bold text-lg mb-2">UltOps Pro</h3>
            <p className="text-slate-400 text-sm mb-6">
              Unlock unlimited licenses and SMS alerts for your entire team.
            </p>
            <Link href="/dashboard/upgrade" className="block w-full bg-blue-600 hover:bg-blue-500 text-center py-2.5 rounded-lg text-sm font-semibold transition-colors">
              Upgrade Plan
            </Link>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="font-semibold text-slate-900 mb-4">Quick Tips</h3>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Upload photos of permits for audit protection.</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Add your phone number in Settings for SMS.</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                <span>Click any stat card above to view details.</span>
              </li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}