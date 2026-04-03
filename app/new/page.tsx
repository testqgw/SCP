import { Suspense } from "react";
import NewDashboard from "@/components/snapshot/NewDashboard";
import { getBoardData } from "@/lib/snapshot/query"; // adjust to your actual data fetcher

export const dynamic = "force-dynamic";

async function NewDashboardPageContent() {
  // Fetch your real data using same method as main page
  const data = await getBoardData();
  
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse" />
          <p>Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return <NewDashboard data={data} initialMarket="ALL" />;
}

export default function NewDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-white">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse" />
            <p>Loading NewDashboard v1...</p>
          </div>
        </div>
      }
    >
      <NewDashboardPageContent />
    </Suspense>
  );
}
