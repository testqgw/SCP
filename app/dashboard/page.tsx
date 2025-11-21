import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Building2, FileText, AlertTriangle, CheckCircle, ArrowRight, Plus, AlertCircle, Clock } from "lucide-react";

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

  const expiredCount = expiringLicenses.filter(l => new Date(l.expirationDate) < today).length;
  const warningCount = expiringLicenses.length - expiredCount;

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

      {/* STATS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Card 1: Businesses */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <span className="text-xs font-medium text-slate-400 uppercase">Total</span>
          </div>
          <div className="text-3xl font-bold text-slate-900 mb-1">{businessCount}</div>
          <div className="text-sm text-slate-500">Active Businesses</div>
        </div>

        {/* Card 2: Licenses */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <FileText className="w-6 h-6 text-indigo-600" />
            </div>
            <span className="text-xs font-medium text-slate-400 uppercase">Total</span>
          </div>
          <div className="text-3xl font-bold text-slate-900 mb-1">{licenseCount}</div>
          <div className="text-sm text-slate-500">Tracked Licenses</div>
        </div>

        {/* Card 3: Expiring Soon */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          {warningCount > 0 && <div className="absolute top-0 right-0 w-16 h-16 bg-yellow-400/10 rounded-bl-full" />}
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
            <span className="text-xs font-bold text-yellow-600 uppercase">Action Needed</span>
          </div>
          <div className="text-3xl font-bold text-slate-900 mb-1">{warningCount}</div>
          <div className="text-sm text-slate-500">Expiring within 30 days</div>
        </div>

        {/* Card 4: Expired (Critical) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          {expiredCount > 0 && <div className="absolute top-0 right-0 w-16 h-16 bg-red-400/10 rounded-bl-full" />}
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <span className="text-xs font-bold text-red-600 uppercase">Critical</span>
          </div>
          <div className="text-3xl font-bold text-red-600 mb-1">{expiredCount}</div>
          <div className="text-sm text-red-600/80">Expired Licenses</div>
        </div>

      </div>

      {/* PRIORITY ACTION FEED */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Left: Urgent Tasks */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h2 className="font-semibold text-slate-900">Priority Action Items</h2>
            <Link href="/dashboard/licenses" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              View All
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
                  <div key={license.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-yellow-500'}`} />
                      <div>
                        <div className="font-medium text-slate-900">{license.licenseType}</div>
                        <div className="text-sm text-slate-500">{license.business.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className={`text-sm font-medium ${isExpired ? 'text-red-600' : 'text-yellow-600'}`}>
                        {isExpired ? `Expired ${Math.abs(daysLeft)} days ago` : `${daysLeft} days left`}
                      </div>
                      <Link
                        href={`/dashboard/licenses`}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 transition-all"
                      >
                        <ArrowRight className="w-5 h-5" />
                      </Link>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Quick Tips / Upgrade */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-[#0B1120] to-slate-900 rounded-xl p-6 text-white shadow-lg">
            <h3 className="font-bold text-lg mb-2">SafeOps Pro</h3>
            <p className="text-slate-400 text-sm mb-6">
              Unlock unlimited licenses and SMS alerts for your entire team.
            </p>
            <Link href="/dashboard/upgrade" className="block w-full bg-blue-600 hover:bg-blue-500 text-center py-2 rounded-lg text-sm font-semibold transition-colors">
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
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}