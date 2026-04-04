import NewDashboard from "@/components/snapshot/NewDashboard";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

export default async function SnapshotPage() {
  const dateEt = getTodayEtDateString();
  const data = await getSnapshotBoardData(dateEt);

  return <NewDashboard data={data} />;
}
