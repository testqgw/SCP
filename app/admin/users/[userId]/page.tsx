import { getAdminAccess } from "@/lib/admin";
import { prisma as db } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, User, Building2, FileText, Calendar, Mail, Phone, CreditCard, AlertTriangle, Check } from "lucide-react";

interface PageProps {
    params: { userId: string };
}

export default async function AdminUserView({ params }: PageProps) {
    await getAdminAccess();

    const user = await db.user.findUnique({
        where: { id: params.userId },
        include: {
            businesses: {
                include: {
                    licenses: true,
                },
            },
        },
    });

    if (!user) {
        return (
            <div className="p-8">
                <h1 className="text-2xl font-bold text-red-600">User not found</h1>
                <Link href="/admin" className="text-blue-600 hover:underline">Back to Admin</Link>
            </div>
        );
    }

    // Count expiring/expired licenses
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    let expiredCount = 0;
    let expiringCount = 0;
    let activeCount = 0;

    user.businesses.forEach(business => {
        business.licenses.forEach(license => {
            const expDate = new Date(license.expirationDate);
            if (expDate < now) {
                expiredCount++;
            } else if (expDate < thirtyDaysFromNow) {
                expiringCount++;
            } else {
                activeCount++;
            }
        });
    });

    const totalLicenses = expiredCount + expiringCount + activeCount;

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Link
                    href="/admin"
                    className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900">User Details</h1>
                    <p className="text-gray-600">Viewing account for {user.email}</p>
                </div>
            </div>

            {/* User Info Card */}
            <div className="bg-white rounded-xl border shadow-sm p-6 mb-6">
                <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <User className="w-8 h-8" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-gray-900">{user.email}</h2>
                        <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-600">
                            {user.phone && (
                                <span className="flex items-center gap-1">
                                    <Phone className="w-4 h-4" />
                                    {user.phone}
                                </span>
                            )}
                            <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                Joined {new Date(user.createdAt).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${user.subscriptionTier === 'starter' ? 'bg-gray-100 text-gray-600' :
                                    'bg-green-100 text-green-700'
                                }`}>
                                {user.subscriptionTier?.toUpperCase() || 'FREE'}
                            </span>
                            {user.role === 'ADMIN' && (
                                <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                    ADMIN
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                            <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{user.businesses.length}</p>
                            <p className="text-sm text-gray-500">Businesses</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg text-green-600">
                            <Check className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{activeCount}</p>
                            <p className="text-sm text-gray-500">Active Licenses</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-yellow-100 rounded-lg text-yellow-600">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{expiringCount}</p>
                            <p className="text-sm text-gray-500">Expiring Soon</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 rounded-lg text-red-600">
                            <AlertTriangle className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{expiredCount}</p>
                            <p className="text-sm text-gray-500">Expired</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Businesses & Licenses */}
            <div className="space-y-6">
                {user.businesses.map((business) => (
                    <div key={business.id} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                        <div className="px-6 py-4 bg-gray-50 border-b flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Building2 className="w-5 h-5 text-gray-600" />
                                <div>
                                    <h3 className="font-semibold text-gray-900">{business.name}</h3>
                                    <p className="text-sm text-gray-500">
                                        {business.city}{business.state ? `, ${business.state}` : ''} • {business.businessType}
                                    </p>
                                </div>
                            </div>
                            <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                                {business.licenses.length} Licenses
                            </span>
                        </div>

                        {business.licenses.length === 0 ? (
                            <div className="p-6 text-center text-gray-500">
                                No licenses tracked yet
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 text-gray-500 border-b">
                                    <tr>
                                        <th className="px-6 py-3">License Type</th>
                                        <th className="px-6 py-3">License #</th>
                                        <th className="px-6 py-3">Expiration</th>
                                        <th className="px-6 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {business.licenses.map((license) => {
                                        const expDate = new Date(license.expirationDate);
                                        const isExpired = expDate < now;
                                        const isExpiring = !isExpired && expDate < thirtyDaysFromNow;

                                        return (
                                            <tr key={license.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium">{license.licenseType}</td>
                                                <td className="px-6 py-4 text-gray-600">{license.licenseNumber || '-'}</td>
                                                <td className="px-6 py-4 text-gray-600">
                                                    {expDate.toLocaleDateString()}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {isExpired ? (
                                                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                                            Expired
                                                        </span>
                                                    ) : isExpiring ? (
                                                        <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded-full">
                                                            Expiring Soon
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                                                            Active
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
