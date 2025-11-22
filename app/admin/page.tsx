import { prisma } from "@/lib/prisma";
import { CheckCircle, Clock, AlertCircle, Mail } from "lucide-react";
import { revalidatePath } from "next/cache";

async function resolveFeedback(formData: FormData) {
    "use server";
    const id = formData.get("id") as string;
    await prisma.feedback.update({
        where: { id },
        data: { status: "resolved" }
    });
    revalidatePath("/admin");
}

export default async function AdminFeedbackPage() {
    const feedback = await prisma.feedback.findMany({
        orderBy: { createdAt: "desc" },
        include: {
            // If you want to show user details, you'd need to fetch them or relate them
            // For now, we'll just show the feedback content
        }
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900">User Feedback</h2>
                <div className="flex gap-2">
                    <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm font-medium">
                        Total: {feedback.length}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">
                        Resolved: {feedback.filter(f => f.status === 'resolved').length}
                    </span>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Message</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">User / Email</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {feedback.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {item.status === 'resolved' ? (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                            <CheckCircle className="w-3 h-3 mr-1" /> Resolved
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                            <Clock className="w-3 h-3 mr-1" /> New
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                    ${item.type === 'bug' ? 'bg-red-100 text-red-800' :
                                            item.type === 'feature' ? 'bg-purple-100 text-purple-800' :
                                                'bg-blue-100 text-blue-800'}`}>
                                        {item.type}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-sm text-slate-900 max-w-xs truncate" title={item.message}>
                                        {item.message}
                                    </p>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-slate-900">{item.email || 'Anonymous'}</div>
                                    <div className="text-xs text-slate-500">{item.userId ? `ID: ${item.userId.slice(0, 8)}...` : ''}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                                    {new Date(item.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    {item.status !== 'resolved' && (
                                        <form action={resolveFeedback}>
                                            <input type="hidden" name="id" value={item.id} />
                                            <button type="submit" className="text-blue-600 hover:text-blue-900 hover:underline">
                                                Mark Resolved
                                            </button>
                                        </form>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {feedback.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                                    <div className="flex flex-col items-center justify-center">
                                        <Mail className="w-12 h-12 text-slate-300 mb-3" />
                                        <p>No feedback received yet.</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
