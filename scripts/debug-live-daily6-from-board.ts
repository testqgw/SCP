import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizePlayerName } from "../lib/lineups/rotowire";
import {
  fetchDailyAstLineMap,
  fetchDailyPaLineMap,
  fetchDailyPraLineMap,
  fetchDailyPrLineMap,
  fetchDailyPtsLineMap,
  fetchDailyRaLineMap,
  fetchDailyRebLineMap,
  fetchDailyThreesLineMap,
} from "../lib/snapshot/pointsContext";
import { buildPrecisionPick, comparePrecisionSignals, DEFAULT_DAILY_6_RULES } from "../lib/snapshot/precisionPickSystem";
import { getTodayEtDateString } from "../lib/snapshot/time";
import type { SnapshotMarket } from "../lib/types/snapshot";

type Market = SnapshotMarket;

type BoardPayload = {
  ok: boolean;
  result: {
    dateEt: string;
    rows: BoardRow[];
  };
};

type LineSourceFilter = "any" | "sportsdata" | "scoresandodds";

type BoardSignal = {
  baselineSide?: "OVER" | "UNDER" | "NEUTRAL" | null;
  lineupTimingConfidence?: number | null;
};

type BoardRow = {
  playerId: string;
  playerName: string;
  position: string | null;
  matchupKey: string;
  projectedTonight: Partial<Record<Market, number | null>>;
  modelLines: Partial<Record<Market, { modelSide: "OVER" | "UNDER" | "NEUTRAL" }>>;
  ptsSignal?: BoardSignal | null;
  rebSignal?: BoardSignal | null;
  astSignal?: BoardSignal | null;
  threesSignal?: BoardSignal | null;
  praSignal?: BoardSignal | null;
  paSignal?: BoardSignal | null;
  prSignal?: BoardSignal | null;
  raSignal?: BoardSignal | null;
  dataCompleteness?: {
    score?: number | null;
  } | null;
  playerContext?: {
    starterRateLast10?: number | null;
    minutesVolatility?: number | null;
    projectedMinutes?: number | null;
    availabilityStatus?: "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "ACTIVE" | "UNKNOWN" | null;
    availabilityPercentPlay?: number | null;
  } | null;
};

type Candidate = {
  playerId: string;
  playerName: string;
  matchupKey: string;
  market: Market;
  side: "OVER" | "UNDER" | "NEUTRAL";
  historicalAccuracy: number;
  absLineGap: number | null;
  leafAccuracy: number | null;
  bucketRecentAccuracy: number | null;
};

const SIGNAL_BY_MARKET: Record<Market, keyof BoardRow> = {
  PTS: "ptsSignal",
  REB: "rebSignal",
  AST: "astSignal",
  THREES: "threesSignal",
  PRA: "praSignal",
  PA: "paSignal",
  PR: "prSignal",
  RA: "raSignal",
};

async function loadBoard(boardPath: string): Promise<BoardPayload> {
  return JSON.parse(await readFile(boardPath, "utf8")) as BoardPayload;
}

async function loadLineMaps(
  dateEt: string,
  sourceFilter: LineSourceFilter,
): Promise<Record<Market, Map<string, { line: number; overPrice: number | null; underPrice: number | null }>>> {
  const [
    pts,
    reb,
    ast,
    threes,
    pra,
    pa,
    pr,
    ra,
  ] = await Promise.all([
    fetchDailyPtsLineMap(dateEt),
    fetchDailyRebLineMap(dateEt),
    fetchDailyAstLineMap(dateEt),
    fetchDailyThreesLineMap(dateEt),
    fetchDailyPraLineMap(dateEt),
    fetchDailyPaLineMap(dateEt),
    fetchDailyPrLineMap(dateEt),
    fetchDailyRaLineMap(dateEt),
  ]);

  const maybeFilter = <T extends { source: string }>(input: Map<string, T>): Map<string, T> => {
    if (sourceFilter === "any") return input;
    return new Map([...input.entries()].filter(([, value]) => value.source === sourceFilter));
  };

  return {
    PTS: maybeFilter(pts),
    REB: maybeFilter(reb),
    AST: maybeFilter(ast),
    THREES: maybeFilter(threes),
    PRA: maybeFilter(pra),
    PA: maybeFilter(pa),
    PR: maybeFilter(pr),
    RA: maybeFilter(ra),
  };
}

function marketSignal(row: BoardRow, market: Market): BoardSignal | null {
  const key = SIGNAL_BY_MARKET[market];
  const value = row[key];
  return value && typeof value === "object" ? (value as BoardSignal) : null;
}

async function main(): Promise<void> {
  const boardPath = process.argv[2] || path.resolve("..", "tmp-board.json");
  const dateEtArg = process.argv[3] ?? getTodayEtDateString();
  const sourceFilter = (process.argv[4] as LineSourceFilter | undefined) ?? "any";
  const board = await loadBoard(boardPath);
  const dateEt = board.result?.dateEt ?? dateEtArg;
  const lineMaps = await loadLineMaps(dateEt, sourceFilter);
  const markets = Object.keys(DEFAULT_DAILY_6_RULES) as Market[];

  const direct = board.result.rows.flatMap((row) => {
    const playerKey = `${row.matchupKey}|${normalizePlayerName(row.playerName)}`;
    return markets.flatMap((market) => {
      const marketLine = lineMaps[market].get(playerKey);
      const projectedValue = row.projectedTonight?.[market] ?? null;
      if (!marketLine || projectedValue == null) return [];

      const signal = marketSignal(row, market);
      const precision = buildPrecisionPick(
        {
          market,
          projectedValue,
          line: marketLine.line,
          overPrice: marketLine.overPrice,
          underPrice: marketLine.underPrice,
          finalSide: signal?.baselineSide ?? row.modelLines?.[market]?.modelSide ?? "NEUTRAL",
          expectedMinutes: row.playerContext?.projectedMinutes ?? null,
          minutesVolatility: row.playerContext?.minutesVolatility ?? null,
          starterRateLast10: row.playerContext?.starterRateLast10 ?? null,
          openingTeamSpread: null,
          openingTotal: null,
          lineupTimingConfidence: signal?.lineupTimingConfidence ?? null,
          completenessScore: row.dataCompleteness?.score ?? null,
          playerPosition: row.position,
          pointsProjection: row.projectedTonight?.PTS ?? null,
          reboundsProjection: row.projectedTonight?.REB ?? null,
          assistProjection: row.projectedTonight?.AST ?? null,
          threesProjection: row.projectedTonight?.THREES ?? null,
          availabilityStatus: row.playerContext?.availabilityStatus ?? null,
          availabilityPercentPlay: row.playerContext?.availabilityPercentPlay ?? null,
        },
        DEFAULT_DAILY_6_RULES,
      );

      if (!precision?.qualified || precision.side === "NEUTRAL") return [];
      return [
        {
          playerId: row.playerId,
          playerName: row.playerName,
          matchupKey: row.matchupKey,
          market,
          side: precision.side,
          historicalAccuracy: precision.historicalAccuracy,
          absLineGap: precision.absLineGap ?? null,
          leafAccuracy: precision.leafAccuracy ?? null,
          bucketRecentAccuracy: precision.bucketRecentAccuracy ?? null,
        } satisfies Candidate,
      ];
    });
  });

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
        boardPath,
        sourceFilter,
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
