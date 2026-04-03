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
const BOARD_SERVER_LOAD_TIMEOUT_MS = 4_000;

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

async function getInitialBoardData(dateEt: string, shouldFetchServerData: boolean): Promise<SnapshotBoardData> {
  if (!shouldFetchServerData) {
    return createBoardShell(dateEt);
  }

  try {
    // Keep the route from getting trapped behind app/loading.tsx when the live board query runs long.
    return await Promise.race<SnapshotBoardData>([
      getSnapshotBoardData(dateEt),
      new Promise<SnapshotBoardData>((resolve) => {
        setTimeout(() => resolve(createBoardShell(dateEt)), BOARD_SERVER_LOAD_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return createBoardShell(dateEt);
  }
}

export default async function HomePage({ searchParams }: HomePageProps): Promise<React.ReactElement> {
  const dateEt = isValidEtDate(searchParams?.date) ? searchParams.date : getTodayEtDateString();
  const hasExplicitBoardQuery = Boolean(
    searchParams?.date || searchParams?.market || searchParams?.matchup || searchParams?.player,
  );
  const data = await getInitialBoardData(dateEt, hasExplicitBoardQuery);

  return (
    <SnapshotDashboard
      data={data}
      initialMarket={getMarket(searchParams?.market)}
      initialMatchup={searchParams?.matchup?.toUpperCase() ?? ""}
      initialPlayerSearch={searchParams?.player ?? ""}
    />
  );
}
