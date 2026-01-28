"use client";

export function DashboardSkeleton() {
    return (
        <div className="space-y-8 animate-pulse">
            {/* Header Skeleton */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="h-8 w-32 bg-slate-200 rounded mb-2" />
                    <div className="h-4 w-64 bg-slate-100 rounded" />
                </div>
                <div className="flex gap-3">
                    <div className="h-10 w-36 bg-slate-200 rounded-lg" />
                    <div className="h-10 w-28 bg-blue-200 rounded-lg" />
                </div>
            </div>

            {/* Stats Grid Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-slate-100 rounded-lg w-10 h-10" />
                            <div className="h-4 w-12 bg-slate-100 rounded" />
                        </div>
                        <div className="h-8 w-16 bg-slate-200 rounded mb-2" />
                        <div className="h-4 w-28 bg-slate-100 rounded" />
                    </div>
                ))}
            </div>

            {/* Priority Feed Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <div className="h-5 w-40 bg-slate-200 rounded" />
                        <div className="h-4 w-16 bg-slate-100 rounded" />
                    </div>
                    <div className="divide-y divide-slate-100">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="p-4 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-3 h-3 rounded-full bg-slate-200" />
                                    <div>
                                        <div className="h-4 w-32 bg-slate-200 rounded mb-2" />
                                        <div className="h-3 w-24 bg-slate-100 rounded" />
                                    </div>
                                </div>
                                <div className="h-6 w-24 bg-slate-100 rounded-full" />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-slate-800 rounded-xl p-6 h-40" />
                    <div className="bg-white rounded-xl border border-slate-200 p-6 h-48" />
                </div>
            </div>
        </div>
    );
}
