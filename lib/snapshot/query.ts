import { prisma } from "@/lib/prisma";
import { formatUtcToEt } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotMatchupOption,
  SnapshotMetricRecord,
  SnapshotRow,
  SnapshotStatLog,
} from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type TeamMatchup = {
  teamCode: string;
  opponentCode: string;
  opponentTeamId: string;
  matchupKey: string;
  gameTimeEt: string;
  gameTimeUtc: Date | null;
  isHome: boolean;
};

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES"];

function blankMetricRecord(): SnapshotMetricRecord {
  return {
    PTS: null,
    REB: null,
    AST: null,
    THREES: null,
  };
}

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function valueByMarket(log: SnapshotStatLog, market: SnapshotMarket): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  return log.threes;
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  return {
    PTS: average(logs.map((log) => log.points)),
    REB: average(logs.map((log) => log.rebounds)),
    AST: average(logs.map((log) => log.assists)),
    THREES: average(logs.map((log) => log.threes)),
  };
}

function trendFrom(last3: SnapshotMetricRecord, season: SnapshotMetricRecord): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const left = last3[market];
    const right = season[market];
    result[market] = left == null || right == null ? null : round(left - right, 2);
  });
  return result;
}

type TeamAllowanceAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
};

function createAllowanceAgg(): TeamAllowanceAgg {
  return {
    count: 0,
    sums: {
      PTS: 0,
      REB: 0,
      AST: 0,
      THREES: 0,
    },
  };
}

function averageFromAllowance(agg: TeamAllowanceAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) {
    return blankMetricRecord();
  }
  return {
    PTS: round(agg.sums.PTS / agg.count, 2),
    REB: round(agg.sums.REB / agg.count, 2),
    AST: round(agg.sums.AST / agg.count, 2),
    THREES: round(agg.sums.THREES / agg.count, 2),
  };
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

export async function getSnapshotBoardData(dateEt: string): Promise<SnapshotBoardData> {
  const [games, latestDataWrite] = await Promise.all([
    prisma.game.findMany({
      where: { gameDateEt: dateEt },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ commenceTimeUtc: "asc" }],
    }),
    prisma.playerGameLog.aggregate({
      _max: { updatedAt: true },
    }),
  ]);

  if (games.length === 0) {
    return {
      dateEt,
      lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
      matchups: [],
      rows: [],
    };
  }

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const matchupOptionsByKey = new Map<string, SnapshotMatchupOption>();

  for (const game of games) {
    const homeCode = game.homeTeam.abbreviation;
    const awayCode = game.awayTeam.abbreviation;
    const gameTimeEt = formatUtcToEt(game.commenceTimeUtc);
    const matchupKey = `${awayCode}@${homeCode}`;

    matchupOptionsByKey.set(matchupKey, {
      key: matchupKey,
      awayTeam: awayCode,
      homeTeam: homeCode,
      gameTimeEt,
      label: `${awayCode} @ ${homeCode} - ${gameTimeEt}`,
    });

    if (!matchupByTeamId.has(game.homeTeamId)) {
      matchupByTeamId.set(game.homeTeamId, {
        teamCode: homeCode,
        opponentCode: awayCode,
        opponentTeamId: game.awayTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: true,
      });
    }

    if (!matchupByTeamId.has(game.awayTeamId)) {
      matchupByTeamId.set(game.awayTeamId, {
        teamCode: awayCode,
        opponentCode: homeCode,
        opponentTeamId: game.homeTeamId,
        matchupKey,
        gameTimeEt,
        gameTimeUtc: game.commenceTimeUtc,
        isHome: false,
      });
    }
  }

  const teamIds = Array.from(matchupByTeamId.keys());
  const players = await prisma.player.findMany({
    where: {
      teamId: { in: teamIds },
      isActive: true,
    },
    select: {
      id: true,
      fullName: true,
      position: true,
      teamId: true,
    },
    orderBy: [{ fullName: "asc" }],
  });

  if (players.length === 0) {
    return {
      dateEt,
      lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
      matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
      rows: [],
    };
  }

  const playerIds = players.map((player) => player.id);
  const logs = await prisma.playerGameLog.findMany({
    where: {
      playerId: { in: playerIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    include: {
      opponentTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ playerId: "asc" }, { gameDateEt: "desc" }],
  });

  const logsByPlayerId = new Map<string, SnapshotStatLog[]>();
  for (const log of logs) {
    const existing = logsByPlayerId.get(log.playerId) ?? [];
    if (existing.length >= 80) {
      continue;
    }

    existing.push({
      gameDateEt: log.gameDateEt,
      opponent: log.opponentTeam?.abbreviation ?? null,
      isHome: log.isHome,
      minutes: toStat(log.minutes),
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
    });
    logsByPlayerId.set(log.playerId, existing);
  }

  const opponentTeamIds = Array.from(
    new Set(Array.from(matchupByTeamId.values()).map((matchup) => matchup.opponentTeamId)),
  );

  const opponentGameRows = await prisma.game.findMany({
    where: {
      gameDateEt: { lt: dateEt },
      OR: [{ homeTeamId: { in: opponentTeamIds } }, { awayTeamId: { in: opponentTeamIds } }],
    },
    select: {
      externalId: true,
      gameDateEt: true,
      homeTeamId: true,
      awayTeamId: true,
    },
    orderBy: [{ gameDateEt: "desc" }, { externalId: "desc" }],
  });

  const gameIdsByOpponentTeamId = new Map<string, Set<string>>();
  for (const row of opponentGameRows) {
    const candidateTeamIds = [row.homeTeamId, row.awayTeamId];
    for (const teamId of candidateTeamIds) {
      if (!opponentTeamIds.includes(teamId)) continue;
      const set = gameIdsByOpponentTeamId.get(teamId) ?? new Set<string>();
      if (set.size >= 10) continue;
      set.add(row.externalId);
      gameIdsByOpponentTeamId.set(teamId, set);
    }
  }

  const relevantGameIds = new Set<string>();
  gameIdsByOpponentTeamId.forEach((set) => {
    set.forEach((id) => relevantGameIds.add(id));
  });

  const opponentAllowanceLogs =
    relevantGameIds.size > 0
      ? await prisma.playerGameLog.findMany({
          where: {
            opponentTeamId: { in: opponentTeamIds },
            externalGameId: { in: Array.from(relevantGameIds) },
            minutes: { gt: 0 },
          },
          select: {
            opponentTeamId: true,
            externalGameId: true,
            points: true,
            rebounds: true,
            assists: true,
            threes: true,
          },
        })
      : [];

  const allowanceByOpponentTeamId = new Map<string, TeamAllowanceAgg>();
  const leagueAgg = createAllowanceAgg();

  for (const log of opponentAllowanceLogs) {
    if (!log.opponentTeamId) continue;
    const validGames = gameIdsByOpponentTeamId.get(log.opponentTeamId);
    if (!validGames || !validGames.has(log.externalGameId)) {
      continue;
    }

    const teamAgg = allowanceByOpponentTeamId.get(log.opponentTeamId) ?? createAllowanceAgg();
    teamAgg.count += 1;
    teamAgg.sums.PTS += toStat(log.points);
    teamAgg.sums.REB += toStat(log.rebounds);
    teamAgg.sums.AST += toStat(log.assists);
    teamAgg.sums.THREES += toStat(log.threes);
    allowanceByOpponentTeamId.set(log.opponentTeamId, teamAgg);

    leagueAgg.count += 1;
    leagueAgg.sums.PTS += toStat(log.points);
    leagueAgg.sums.REB += toStat(log.rebounds);
    leagueAgg.sums.AST += toStat(log.assists);
    leagueAgg.sums.THREES += toStat(log.threes);
  }

  const leagueAverage = averageFromAllowance(leagueAgg.count > 0 ? leagueAgg : null);

  const rowsWithSortKeys: Array<{ sortTime: number; row: SnapshotRow }> = [];

  for (const player of players) {
    if (!player.teamId) {
      continue;
    }
    const matchup = matchupByTeamId.get(player.teamId);
    if (!matchup) {
      continue;
    }

    const logsForPlayer = logsByPlayerId.get(player.id) ?? [];
    const last5Logs = logsForPlayer.slice(0, 5);
    const last10Logs = logsForPlayer.slice(0, 10);
    const last3Logs = logsForPlayer.slice(0, 3);
    const homeAwayLogs = logsForPlayer.filter((log) => log.isHome === matchup.isHome);

    const seasonAverage = averagesByMarket(logsForPlayer);
    const last3Average = averagesByMarket(last3Logs);
    const last10Average = averagesByMarket(last10Logs);
    const homeAwayAverage = averagesByMarket(homeAwayLogs);
    const trendVsSeason = trendFrom(last3Average, seasonAverage);

    const opponentAgg = allowanceByOpponentTeamId.get(matchup.opponentTeamId) ?? null;
    const opponentAllowance = averageFromAllowance(opponentAgg);
    const opponentAllowanceDelta = deltaFromLeague(opponentAllowance, leagueAverage);

    rowsWithSortKeys.push({
      sortTime: matchup.gameTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER,
      row: {
        playerId: player.id,
        playerName: player.fullName,
        position: player.position,
        teamCode: matchup.teamCode,
        opponentCode: matchup.opponentCode,
        matchupKey: matchup.matchupKey,
        isHome: matchup.isHome,
        gameTimeEt: matchup.gameTimeEt,
        last5: {
          PTS: last5Logs.map((log) => log.points),
          REB: last5Logs.map((log) => log.rebounds),
          AST: last5Logs.map((log) => log.assists),
          THREES: last5Logs.map((log) => log.threes),
        },
        last10: {
          PTS: last10Logs.map((log) => log.points),
          REB: last10Logs.map((log) => log.rebounds),
          AST: last10Logs.map((log) => log.assists),
          THREES: last10Logs.map((log) => log.threes),
        },
        last3Average,
        last10Average,
        seasonAverage,
        homeAwayAverage,
        trendVsSeason,
        opponentAllowance,
        opponentAllowanceDelta,
        recentLogs: last10Logs,
      },
    });
  }

  rowsWithSortKeys.sort((a, b) => {
    if (a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    if (a.row.matchupKey !== b.row.matchupKey) {
      return a.row.matchupKey.localeCompare(b.row.matchupKey);
    }
    return a.row.playerName.localeCompare(b.row.playerName);
  });

  return {
    dateEt,
    lastUpdatedAt: latestDataWrite._max.updatedAt?.toISOString() ?? null,
    matchups: Array.from(matchupOptionsByKey.values()).sort((a, b) => a.label.localeCompare(b.label)),
    rows: rowsWithSortKeys.map((item) => item.row),
  };
}

export function marketValues(row: SnapshotRow, market: SnapshotMarket, span: "L5" | "L10"): number[] {
  return span === "L5" ? row.last5[market] : row.last10[market];
}

export function metricValue(row: SnapshotRow, market: SnapshotMarket, kind: keyof Pick<
  SnapshotRow,
  "last3Average" | "last10Average" | "seasonAverage" | "homeAwayAverage" | "trendVsSeason" | "opponentAllowance" | "opponentAllowanceDelta"
>): number | null {
  return row[kind][market];
}

export function hitCount(values: number[], line: number): { over: number; under: number; push: number } {
  let over = 0;
  let under = 0;
  let push = 0;
  values.forEach((value) => {
    if (value > line) over += 1;
    else if (value < line) under += 1;
    else push += 1;
  });
  return { over, under, push };
}

export function displayHomeAway(isHome: boolean): string {
  return isHome ? "Home" : "Away";
}

export function valuesForMarket(logs: SnapshotStatLog[], market: SnapshotMarket): number[] {
  return logs.map((log) => valueByMarket(log, market));
}
