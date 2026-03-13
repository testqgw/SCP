import { SnapshotDashboard } from "@/components/snapshot/SnapshotDashboard";
import { getTodayEtDateString } from "@/lib/snapshot/time";
import type { SnapshotBoardData, SnapshotMarket } from "@/lib/types/snapshot";

type HomePageProps = {
  searchParams?: {
    date?: string;
    market?: string;
    matchup?: string;
    player?: string;
  };
};

const ALLOWED_MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

function isValidEtDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getMarket(value: string | undefined): SnapshotMarket {
  if (value && ALLOWED_MARKETS.includes(value as SnapshotMarket)) {
    return value as SnapshotMarket;
  }
  return "PTS";
}

export const dynamic = "force-dynamic";

function createBoardShell(dateEt: string): SnapshotBoardData {
  return {
    dateEt,
    lastUpdatedAt: null,
    matchups: [],
    teamMatchups: [],
    rows: [],
  };
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<React.ReactElement> {
  const dateEt = isValidEtDate(searchParams?.date) ? searchParams.date : getTodayEtDateString();

  return (
    <SnapshotDashboard
      data={createBoardShell(dateEt)}
      initialMarket={getMarket(searchParams?.market)}
      initialMatchup={searchParams?.matchup?.toUpperCase() ?? ""}
      initialPlayerSearch={searchParams?.player ?? ""}
    />
  );
}
