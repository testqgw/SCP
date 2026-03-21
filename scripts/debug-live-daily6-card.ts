import { comparePrecisionSignals } from "../lib/snapshot/precisionPickSystem";
import { getSnapshotBoardData } from "../lib/snapshot/query";
import { getTodayEtDateString } from "../lib/snapshot/time";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Candidate = {
  playerId: string;
  playerName: string;
  market: SnapshotMarket;
  matchupKey: string;
  side: string;
  historicalAccuracy: number;
  absLineGap: number | null;
  leafAccuracy: number | null;
  bucketRecentAccuracy: number | null;
};

async function main(): Promise<void> {
  const dateEt = process.argv[2] ?? getTodayEtDateString();
  const board = await getSnapshotBoardData(dateEt);
  const supportedMarkets = board.precisionSystem?.supportedMarkets ?? [];

  const direct = board.rows.flatMap((row) =>
    supportedMarkets.flatMap((market) => {
      const precision = row.precisionSignals?.[market];
      if (!precision?.qualified || precision.side === "NEUTRAL") return [];
      return [
        {
          playerId: row.playerId,
          playerName: row.playerName,
          market,
          matchupKey: row.matchupKey,
          side: precision.side,
          historicalAccuracy: precision.historicalAccuracy,
          absLineGap: precision.absLineGap ?? null,
          leafAccuracy: precision.leafAccuracy ?? null,
          bucketRecentAccuracy: precision.bucketRecentAccuracy ?? null,
        } satisfies Candidate,
      ];
    }),
  );

  direct.sort((left, right) => {
    const signalComparison = comparePrecisionSignals(left, right);
    if (signalComparison !== 0) return signalComparison;
    return left.playerName.localeCompare(right.playerName);
  });

  const seenPlayers = new Set<string>();
  const onePerPlayer = direct.filter((candidate) => {
    if (seenPlayers.has(candidate.playerId)) return false;
    seenPlayers.add(candidate.playerId);
    return true;
  });

  console.log(
    JSON.stringify(
      {
        dateEt,
        rowCount: board.rows.length,
        supportedMarkets,
        directCandidates: direct.length,
        onePerPlayerCandidates: onePerPlayer.length,
        topCandidates: onePerPlayer.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
