import NewDashboard from "@/components/snapshot/NewDashboard";
import { getInitialSnapshotBoardViewData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

type SnapshotPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function SnapshotPage({ searchParams }: SnapshotPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const dateEt = getTodayEtDateString();
  const data = await getInitialSnapshotBoardViewData(dateEt);

  return (
    <NewDashboard
      data={data}
      initialViewParam={typeof params?.view === "string" ? params.view : null}
      initialModeParam={typeof params?.mode === "string" ? params.mode : null}
      initialPlayerParam={typeof params?.player === "string" ? params.player : null}
      initialMatchupParam={typeof params?.matchup === "string" ? params.matchup : null}
    />
  );
}
