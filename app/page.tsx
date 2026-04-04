import { Suspense } from "react";
import NewDashboard from "@/components/snapshot/NewDashboard";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

async function getBoardData() {
  const dateEt = getTodayEtDateString();
  return await getSnapshotBoardData(dateEt);
}

async function PageContent() {
  const data = await getBoardData();
  return <NewDashboard data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white"><div className="text-center"><div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse"/><p>Loading dashboard...</p></div></div>}>
      <PageContent />
    </Suspense>
  );
}
