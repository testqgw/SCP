import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { getTodayEtDateString, inferSeasonFromEtDate } from "../lib/snapshot/time";
import { SNAPSHOT_MARKETS, projectTonightMetrics } from "../lib/snapshot/projection";
import { round } from "../lib/utils";
import type { SnapshotMarket, SnapshotMetricRecord } from "../lib/types/snapshot";

type Args = {
  season: string;
  from: string;
  to: string;
  out: string;
};

type HistoryLog = {
  isHome: boolean | null;
  minutes: number;
  metrics: SnapshotMetricRecord;
};

type RollingAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
};

type MarketErrorStats = {
  count: number;
  sumAbsError: number;
  sumSquaredError: number;
  sumError: number;
  within1: number;
  within2: number;
};

const MARKETS: SnapshotMarket[] = SNAPSHOT_MARKETS;

function parseArgs(): Args {
  const todayEt = getTodayEtDateString();
  const defaultSeason = inferSeasonFromEtDate(todayEt);
  const raw = process.argv.slice(2);

  let season = defaultSeason;
  let from = `${defaultSeason}-10-01`;
  let to = todayEt;
  let out = path.join("exports", `projection-backtest-${defaultSeason}-${from}-to-${to}.json`);

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    const next = raw[i + 1];

    if ((token === "--season" || token === "-s") && next) {
      season = next;
      from = `${season}-10-01`;
      out = path.join("exports", `projection-backtest-${season}-${from}-to-${to}.json`);
      i += 1;
      continue;
    }
    if (token.startsWith("--season=")) {
      season = token.slice("--season=".length);
      from = `${season}-10-01`;
      out = path.join("exports", `projection-backtest-${season}-${from}-to-${to}.json`);
      continue;
    }

    if (token === "--from" && next) {
      from = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--from=")) {
      from = token.slice("--from=".length);
      continue;
    }

    if (token === "--to" && next) {
      to = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--to=")) {
      to = token.slice("--to=".length);
      continue;
    }

    if ((token === "--out" || token === "-o") && next) {
      out = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      out = token.slice("--out=".length);
      continue;
    }
  }

  return { season, from, to, out };
}

function isEtDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
    PRA: null,
    PA: null,
    PR: null,
    RA: null,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function standardDeviation(values: number[]): number | null {
  if (values.length === 0) return null;
  const avg = average(values);
  if (avg == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return round(Math.sqrt(variance), 2);
}

function metricsFromBase(points: number, rebounds: number, assists: number, threes: number): SnapshotMetricRecord {
  return {
    PTS: points,
    REB: rebounds,
    AST: assists,
    THREES: threes,
    PRA: points + rebounds + assists,
    PA: points + assists,
    PR: points + rebounds,
    RA: rebounds + assists,
  };
}

function marketValueFromHistory(log: HistoryLog, market: SnapshotMarket): number {
  return log.metrics[market] ?? 0;
}

function averagesByMarket(logs: HistoryLog[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = average(logs.map((log) => marketValueFromHistory(log, market)));
  });
  return result;
}

function createRollingAgg(): RollingAgg {
  return {
    count: 0,
    sums: {
      PTS: 0,
      REB: 0,
      AST: 0,
      THREES: 0,
      PRA: 0,
      PA: 0,
      PR: 0,
      RA: 0,
    },
  };
}

function addToRollingAgg(agg: RollingAgg, metrics: SnapshotMetricRecord): void {
  agg.count += 1;
  MARKETS.forEach((market) => {
    agg.sums[market] += metrics[market] ?? 0;
  });
}

function averageFromAgg(agg: RollingAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) return blankMetricRecord();
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = round(agg.sums[market] / agg.count, 2);
  });
  return result;
}

function deltaFromLeague(teamAverage: SnapshotMetricRecord, leagueAverage: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const teamValue = teamAverage[market];
    const leagueValue = leagueAverage[market];
    result[market] = teamValue == null || leagueValue == null ? null : round(teamValue - leagueValue, 2);
  });
  return result;
}

function arraysByMarket(logs: HistoryLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.metrics.PTS ?? 0),
    REB: logs.map((log) => log.metrics.REB ?? 0),
    AST: logs.map((log) => log.metrics.AST ?? 0),
    THREES: logs.map((log) => log.metrics.THREES ?? 0),
    PRA: logs.map((log) => log.metrics.PRA ?? 0),
    PA: logs.map((log) => log.metrics.PA ?? 0),
    PR: logs.map((log) => log.metrics.PR ?? 0),
    RA: logs.map((log) => log.metrics.RA ?? 0),
  };
}

function createMarketStats(): Record<SnapshotMarket, MarketErrorStats> {
  return {
    PTS: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    REB: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    AST: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    THREES: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    PRA: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    PA: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    PR: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    RA: { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
  };
}

function finalizeMarketStats(stats: MarketErrorStats): {
  samples: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  within1Pct: number | null;
  within2Pct: number | null;
} {
  if (stats.count === 0) {
    return {
      samples: 0,
      mae: null,
      rmse: null,
      bias: null,
      within1Pct: null,
      within2Pct: null,
    };
  }
  return {
    samples: stats.count,
    mae: round(stats.sumAbsError / stats.count, 3),
    rmse: round(Math.sqrt(stats.sumSquaredError / stats.count), 3),
    bias: round(stats.sumError / stats.count, 3),
    within1Pct: round((stats.within1 / stats.count) * 100, 2),
    within2Pct: round((stats.within2 / stats.count) * 100, 2),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!isEtDate(args.from) || !isEtDate(args.to)) {
    throw new Error("Dates must be YYYY-MM-DD (ET). Example: --from 2025-10-01 --to 2026-03-01");
  }

  const logs = await prisma.playerGameLog.findMany({
    where: {
      gameDateEt: { gte: args.from, lte: args.to },
      minutes: { gt: 0 },
    },
    select: {
      playerId: true,
      gameDateEt: true,
      isHome: true,
      opponentTeamId: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
    },
    orderBy: [{ gameDateEt: "asc" }, { playerId: "asc" }],
  });

  if (logs.length === 0) {
    throw new Error(`No player_game_logs found in range ${args.from}..${args.to}`);
  }

  const logsByDate = new Map<string, typeof logs>();
  logs.forEach((log) => {
    const bucket = logsByDate.get(log.gameDateEt) ?? [];
    bucket.push(log);
    logsByDate.set(log.gameDateEt, bucket);
  });
  const allDates = Array.from(logsByDate.keys()).sort((a, b) => a.localeCompare(b));

  const playerHistory = new Map<string, HistoryLog[]>();
  const opponentAggByTeamId = new Map<string, RollingAgg>();
  const leagueAgg = createRollingAgg();
  const marketStats = createMarketStats();

  let rowsWithHistory = 0;
  let rowsWithoutHistory = 0;
  let rowsWithoutProjection = 0;

  for (const date of allDates) {
    const dayLogs = logsByDate.get(date) ?? [];

    for (const log of dayLogs) {
      const history = playerHistory.get(log.playerId) ?? [];
      if (history.length === 0) {
        rowsWithoutHistory += 1;
        continue;
      }

      rowsWithHistory += 1;
      const last10 = history.slice(-10);
      const last3 = history.slice(-3);
      const homeAway = log.isHome == null ? [] : history.filter((item) => item.isHome === log.isHome);

      const seasonAverage = averagesByMarket(history);
      const last10Average = averagesByMarket(last10);
      const last3Average = averagesByMarket(last3);
      const homeAwayAverage = averagesByMarket(homeAway);
      const last10ByMarket = arraysByMarket(last10);

      const opponentAllowance = averageFromAgg(
        log.opponentTeamId ? (opponentAggByTeamId.get(log.opponentTeamId) ?? null) : null,
      );
      const leagueAverage = averageFromAgg(leagueAgg.count > 0 ? leagueAgg : null);
      const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);

      const minutesLast10Avg = average(last10.map((item) => item.minutes));
      const minutesLast3Avg = average(last3.map((item) => item.minutes));
      const minutesVolatility = standardDeviation(last10.map((item) => item.minutes));
      const projected = projectTonightMetrics({
        last3Average,
        last10Average,
        seasonAverage,
        homeAwayAverage,
        opponentAllowance,
        opponentAllowanceDelta,
        last10ByMarket,
        sampleSize: history.length,
        minutesLast3Avg,
        minutesLast10Avg,
        minutesVolatility,
        minutesHomeAwayAvg: average(homeAway.map((item) => item.minutes)),
        minutesCurrentTeamLast5Avg: average(last10.slice(-5).map((item) => item.minutes)),
        minutesCurrentTeamGames: Math.min(last10.length, 10),
        lineupStarter: null,
        starterRateLast10: null,
      });
      const actual = metricsFromBase(
        toStat(log.points),
        toStat(log.rebounds),
        toStat(log.assists),
        toStat(log.threes),
      );

      let projectedAtLeastOne = false;
      MARKETS.forEach((market) => {
        const predictedValue = projected[market];
        if (predictedValue == null) return;
        projectedAtLeastOne = true;
        const actualValue = actual[market] ?? 0;
        const error = predictedValue - actualValue;
        const absError = Math.abs(error);
        marketStats[market].count += 1;
        marketStats[market].sumError += error;
        marketStats[market].sumAbsError += absError;
        marketStats[market].sumSquaredError += error * error;
        if (absError <= 1) marketStats[market].within1 += 1;
        if (absError <= 2) marketStats[market].within2 += 1;
      });
      if (!projectedAtLeastOne) rowsWithoutProjection += 1;
    }

    for (const log of dayLogs) {
      const metrics = metricsFromBase(
        toStat(log.points),
        toStat(log.rebounds),
        toStat(log.assists),
        toStat(log.threes),
      );
      const history = playerHistory.get(log.playerId) ?? [];
      history.push({
        isHome: log.isHome,
        minutes: toStat(log.minutes),
        metrics,
      });
      if (history.length > 140) {
        history.splice(0, history.length - 140);
      }
      playerHistory.set(log.playerId, history);

      if (log.opponentTeamId) {
        const teamAgg = opponentAggByTeamId.get(log.opponentTeamId) ?? createRollingAgg();
        addToRollingAgg(teamAgg, metrics);
        opponentAggByTeamId.set(log.opponentTeamId, teamAgg);
      }
      addToRollingAgg(leagueAgg, metrics);
    }
  }

  const byMarket = MARKETS.map((market) => ({
    market,
    ...finalizeMarketStats(marketStats[market]),
  }));

  const overall = finalizeMarketStats(
    MARKETS.reduce<MarketErrorStats>(
      (acc, market) => {
        const current = marketStats[market];
        acc.count += current.count;
        acc.sumAbsError += current.sumAbsError;
        acc.sumSquaredError += current.sumSquaredError;
        acc.sumError += current.sumError;
        acc.within1 += current.within1;
        acc.within2 += current.within2;
        return acc;
      },
      { count: 0, sumAbsError: 0, sumSquaredError: 0, sumError: 0, within1: 0, within2: 0 },
    ),
  );

  const result = {
    model: "snapshot_projection_v3_role_split",
    season: args.season,
    from: args.from,
    to: args.to,
    evaluatedDates: allDates.length,
    logsInRange: logs.length,
    rowsWithHistory,
    rowsWithoutHistory,
    rowsWithoutProjection,
    byMarket,
    overall,
    notes: [
      "Backtest uses strictly historical data before each game date (no same-day leakage).",
      "Opponent allowance is rolling by opponent team from prior logs in the selected window.",
      "Only completed logs with minutes > 0 are evaluated.",
    ],
  };

  const outputPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\nSaved backtest report: ${outputPath}`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Projection backtest failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
