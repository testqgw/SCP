import { getAdminAccess } from "@/lib/admin"; // Secure it
import { prisma as db } from "@/lib/prisma";
import Link from "next/link";
import { ShieldAlert, Users, Building2, DollarSign } from "lucide-react";

export default async function AdminDashboard() {
    // 1. 🔒 Security Check
    await getAdminAccess();

    // 2. 📊 Fetch System-Wide Data
    const [users, businesses, licenses] = await Promise.all([
        db.user.findMany({ include: { businesses: true }, orderBy: { createdAt: 'desc' } }),
        db.business.findMany({ include: { licenses: true } }),
        db.license.findMany(),
    ]);

    // Calculate MRR (Rough estimate based on plan IDs)
    // You can refine this with real Stripe data later
    const totalRevenue = users.reduce((acc, user) => {
        if (user.stripePriceId?.includes("price_1SXRu3")) return acc + 49; // $49 Plan ID
        if (user.stripePriceId?.includes("price_1SXRui")) return acc + 99; // $99 Plan ID
        if (user.stripePriceId?.includes("price_1SXRw5")) return acc + 149; // $149 Plan ID
        return acc;
    }, 0);

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                            <ShieldAlert className="text-red-600" /> Master Control
                        </h1>
                        <p className="text-gray-500">System Overview & Support</p>
                    </div>
                    <div className="bg-green-100 text-green-700 px-4 py-2 rounded-lg font-bold flex items-center gap-2">
                        <DollarSign className="w-5 h-5" />
                        ${totalRevenue}/mo MRR
                    </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-sm border">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                                <Users className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Users</p>
                                <h3 className="text-2xl font-bold">{users.length}</h3>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-purple-100 rounded-lg text-purple-600">
                                <Building2 className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Active Businesses</p>
                                <h3 className="text-2xl font-bold">{businesses.length}</h3>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white p-6 rounded-xl shadow-sm border">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-orange-100 rounded-lg text-orange-600">
                                <ShieldAlert className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="text-sm text-gray-500">Total Licenses</p>
                                <h3 className="text-2xl font-bold">{licenses.length}</h3>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Users Table */}
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <div className="px-6 py-4 border-b bg-gray-50">
                        <h3 className="font-semibold text-gray-900">Recent Signups</h3>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="px-6 py-3">Email</th>
                                <th className="px-6 py-3">Businesses</th>
                                <th className="px-6 py-3">Plan</th>
                                <th className="px-6 py-3">Joined</th>
                                <th className="px-6 py-3">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-medium">{user.email}</td>
                                    <td className="px-6 py-4">
                                        {user.businesses.length > 0
                                            ? user.businesses.map(b => b.name).join(", ")
                                            : <span className="text-gray-400">No Business</span>
                                        }
                                    </td>
                                    <td className="px-6 py-4">
                                        {user.stripePriceId ? (
                                            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-bold">PRO</span>
                                        ) : (
                                            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">FREE</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">
                                        {new Date(user.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        {/* This link allows you to "Support" them by seeing what they see */}
                                        {user.businesses[0] && (
                                            <Link
                                                href={`/dashboard/${user.businesses[0].id}`}
                                                className="text-blue-600 hover:underline"
                                            >
                                                View Dashboard
                                            </Link>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

            </div>
        </div>
    );
}
