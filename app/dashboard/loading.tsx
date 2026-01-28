import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";

export default function DashboardLoading() {
    return (
        <div className="p-6">
            <DashboardSkeleton />
        </div>
    );
}
