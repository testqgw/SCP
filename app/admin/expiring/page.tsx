import { getAdminAccess } from "@/lib/admin";
import { prisma as db } from "@/lib/prisma";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Calendar, Building2, User } from "lucide-react";

export default async function ExpiringLicensesPage() {
    await getAdminAccess();

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Get all licenses expiring in the next 30 days or already expired
    const expiringLicenses = await db.license.findMany({
        where: {
            expirationDate: {
                lte: thirtyDaysFromNow,
            },
        },
        include: {
            business: {
                include: {
                    user: true,
                },
            },
        },
        orderBy: {
            expirationDate: 'asc',
        },
    });

    // Separate into expired and expiring soon
    const expiredLicenses = expiringLicenses.filter(l => new Date(l.expirationDate) < now);
    const expiringSoonLicenses = expiringLicenses.filter(l => {
        const expDate = new Date(l.expirationDate);
        return expDate >= now && expDate <= thirtyDaysFromNow;
    });

    const getDaysUntil = (date: Date) => {
        const diff = date.getTime() - now.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Link
                    href="/admin"
                    className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                >
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <AlertTriangle className="text-yellow-600" />
                        Expiring Licenses
                    </h1>
                    <p className="text-gray-600">All licenses expiring within 30 days or already expired</p>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-red-100 rounded-lg text-red-600">
                            <AlertTriangle className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold text-red-700">{expiredLicenses.length}</p>
                            <p className="text-sm text-red-600">Already Expired</p>
                        </div>
                    </div>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-yellow-100 rounded-lg text-yellow-600">
                            <Calendar className="w-6 h-6" />
                        </div>
                        <div>
                            <p className="text-3xl font-bold text-yellow-700">{expiringSoonLicenses.length}</p>
                            <p className="text-sm text-yellow-600">Expiring in 30 Days</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Expired Licenses Table */}
            {expiredLicenses.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b bg-red-50">
                        <h3 className="font-semibold text-red-800 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Expired Licenses ({expiredLicenses.length})
                        </h3>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="px-6 py-3">License Type</th>
                                <th className="px-6 py-3">Business</th>
                                <th className="px-6 py-3">Owner</th>
                                <th className="px-6 py-3">Expired On</th>
                                <th className="px-6 py-3">Days Overdue</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {expiredLicenses.map((license) => {
                                const expDate = new Date(license.expirationDate);
                                const daysOverdue = Math.abs(getDaysUntil(expDate));

                                return (
                                    <tr key={license.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 font-medium">{license.licenseType}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-gray-400" />
                                                {license.business.name}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link
                                                href={`/admin/users/${license.business.userId}`}
                                                className="flex items-center gap-2 text-blue-600 hover:underline"
                                            >
                                                <User className="w-4 h-4" />
                                                {license.business.user.email}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-gray-600">
                                            {expDate.toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                                                {daysOverdue} days overdue
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Expiring Soon Licenses Table */}
            {expiringSoonLicenses.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="px-6 py-4 border-b bg-yellow-50">
                        <h3 className="font-semibold text-yellow-800 flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            Expiring Within 30 Days ({expiringSoonLicenses.length})
                        </h3>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="px-6 py-3">License Type</th>
                                <th className="px-6 py-3">Business</th>
                                <th className="px-6 py-3">Owner</th>
                                <th className="px-6 py-3">Expires On</th>
                                <th className="px-6 py-3">Days Left</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {expiringSoonLicenses.map((license) => {
                                const expDate = new Date(license.expirationDate);
                                const daysLeft = getDaysUntil(expDate);

                                return (
                                    <tr key={license.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 font-medium">{license.licenseType}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="w-4 h-4 text-gray-400" />
                                                {license.business.name}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <Link
                                                href={`/admin/users/${license.business.userId}`}
                                                className="flex items-center gap-2 text-blue-600 hover:underline"
                                            >
                                                <User className="w-4 h-4" />
                                                {license.business.user.email}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-4 text-gray-600">
                                            {expDate.toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 text-xs font-bold rounded-full ${daysLeft <= 7
                                                    ? 'bg-red-100 text-red-700'
                                                    : daysLeft <= 14
                                                        ? 'bg-orange-100 text-orange-700'
                                                        : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {daysLeft} days left
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {expiringLicenses.length === 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
                    <div className="w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                        <Calendar className="w-6 h-6 text-green-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-green-800">All Clear!</h3>
                    <p className="text-green-600">No licenses expiring in the next 30 days.</p>
                </div>
            )}
        </div>
    );
}
