import {Suspense} from "react";
import NewDashboard from "@/components/snapshot/NewDashboard";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";
import type { SnapshotBoardData } from "@/lib/types/snapshot";

export const dynamic = "force-dynamic";

async function NewDashboardPageContent() {
  const dateEt = getTodayEtDateString();
  const data = await getSnapshotBoardData(dateEt);
  return <NewDashboard data={data} />;
}

export default function NewDashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white"><div className="text-center"><div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse"/><p>Loading NewDashboard v1...</p></div></div>}>
      <NewDashboardPageContent />
    </Suspense>
  );
}
