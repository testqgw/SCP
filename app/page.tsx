import { SnapshotDashboard } from "@/components/snapshot/SnapshotDashboard";
import { getSnapshotBoardData } from "@/lib/snapshot/query";
import { getTodayEtDateString } from "@/lib/snapshot/time";
import type { SnapshotBoardData, SnapshotMarket } from "@/lib/types/snapshot";

type MarketFilter = SnapshotMarket | "ALL";

type HomePageProps = {
  searchParams?: {
    date?: string;
    market?: string;
    matchup?: string;
    player?: string;
  };
};

const ALLOWED_MARKETS: MarketFilter[] = ["ALL", "PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

function isValidEtDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getMarket(value: string | undefined): MarketFilter {
  if (value && ALLOWED_MARKETS.includes(value as MarketFilter)) {
    return value as MarketFilter;
  }
  return "ALL";
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
  const hasExplicitBoardQuery = Boolean(
    searchParams?.date || searchParams?.market || searchParams?.matchup || searchParams?.player,
  );
  let data: SnapshotBoardData;

  if (!hasExplicitBoardQuery) {
    data = createBoardShell(dateEt);
  } else {
    try {
      data = await getSnapshotBoardData(dateEt);
    } catch {
      data = createBoardShell(dateEt);
    }
  }

  return (
    <SnapshotDashboard
      data={data}
      initialMarket={getMarket(searchParams?.market)}
      initialMatchup={searchParams?.matchup?.toUpperCase() ?? ""}
      initialPlayerSearch={searchParams?.player ?? ""}
    />
  );
}
