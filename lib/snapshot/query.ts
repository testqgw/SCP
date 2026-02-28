import { prisma } from "@/lib/prisma";
import { formatUtcToEt } from "@/lib/snapshot/time";
import type {
  SnapshotBoardData,
  SnapshotMarket,
  SnapshotMatchupOption,
  SnapshotMetricRecord,
  SnapshotRow,
  SnapshotStatLog,
  SnapshotTeamMatchupStats,
  SnapshotTeamRecord,
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

type MatchupMeta = {
  matchupKey: string;
  awayTeamId: string;
  homeTeamId: string;
  awayTeamCode: string;
  homeTeamCode: string;
  gameTimeEt: string;
};

type TeamAllowanceAgg = {
  count: number;
  sums: Record<SnapshotMarket, number>;
};

type TeamGameAggregate = {
  teamId: string;
  opponentTeamId: string | null;
  externalGameId: string;
  gameDateEt: string;
  metrics: SnapshotMetricRecord;
};

type TeamGameEnriched = TeamGameAggregate & {
  allowedMetrics: SnapshotMetricRecord | null;
  win: boolean | null;
};

type TeamSummary = {
  seasonFor: SnapshotMetricRecord;
  seasonAllowed: SnapshotMetricRecord;
  last10For: SnapshotMetricRecord;
  last10Allowed: SnapshotMetricRecord;
  seasonRecord: SnapshotTeamRecord;
  last10Record: SnapshotTeamRecord;
};

const MARKETS: SnapshotMarket[] = ["PTS", "REB", "AST", "THREES", "PRA", "PA", "PR", "RA"];

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

function toStat(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function valueByMarket(log: SnapshotStatLog, market: SnapshotMarket): number {
  if (market === "PTS") return log.points;
  if (market === "REB") return log.rebounds;
  if (market === "AST") return log.assists;
  if (market === "THREES") return log.threes;
  if (market === "PRA") return log.points + log.rebounds + log.assists;
  if (market === "PA") return log.points + log.assists;
  if (market === "PR") return log.points + log.rebounds;
  return log.rebounds + log.assists;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, 2);
}

function averagesByMarket(logs: SnapshotStatLog[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    result[market] = average(logs.map((log) => valueByMarket(log, market)));
  });
  return result;
}

function arraysByMarket(logs: SnapshotStatLog[]): Record<SnapshotMarket, number[]> {
  return {
    PTS: logs.map((log) => log.points),
    REB: logs.map((log) => log.rebounds),
    AST: logs.map((log) => log.assists),
    THREES: logs.map((log) => log.threes),
    PRA: logs.map((log) => log.points + log.rebounds + log.assists),
    PA: logs.map((log) => log.points + log.assists),
    PR: logs.map((log) => log.points + log.rebounds),
    RA: logs.map((log) => log.rebounds + log.assists),
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

function createAllowanceAgg(): TeamAllowanceAgg {
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

function addToAllowance(agg: TeamAllowanceAgg, points: number, rebounds: number, assists: number, threes: number): void {
  const metrics = metricsFromBase(points, rebounds, assists, threes);
  agg.count += 1;
  MARKETS.forEach((market) => {
    agg.sums[market] += metrics[market] ?? 0;
  });
}

function averageFromAllowance(agg: TeamAllowanceAgg | null): SnapshotMetricRecord {
  if (!agg || agg.count === 0) {
    return blankMetricRecord();
  }
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

function averageFromMetrics(metricsList: SnapshotMetricRecord[]): SnapshotMetricRecord {
  const result = blankMetricRecord();
  MARKETS.forEach((market) => {
    const values = metricsList
      .map((metric) => metric[market])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    result[market] = average(values);
  });
  return result;
}

function recordFromGames(games: TeamGameEnriched[]): SnapshotTeamRecord {
  let wins = 0;
  let losses = 0;
  games.forEach((game) => {
    if (game.win === true) wins += 1;
    if (game.win === false) losses += 1;
  });
  return { wins, losses };
}

function emptyTeamSummary(): TeamSummary {
  return {
    seasonFor: blankMetricRecord(),
    seasonAllowed: blankMetricRecord(),
    last10For: blankMetricRecord(),
    last10Allowed: blankMetricRecord(),
    seasonRecord: { wins: 0, losses: 0 },
    last10Record: { wins: 0, losses: 0 },
  };
}

function toTimestamp(gameDateEt: string): number {
  return new Date(`${gameDateEt}T00:00:00Z`).getTime();
}

function teamSummaryFromGames(teamGames: TeamGameEnriched[]): TeamSummary {
  const sorted = teamGames.slice().sort((a, b) => {
    const dateDiff = toTimestamp(b.gameDateEt) - toTimestamp(a.gameDateEt);
    if (dateDiff !== 0) return dateDiff;
    return b.externalGameId.localeCompare(a.externalGameId);
  });

  const last10 = sorted.slice(0, 10);
  const seasonFor = averageFromMetrics(sorted.map((game) => game.metrics));
  const seasonAllowed = averageFromMetrics(
    sorted
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );
  const last10For = averageFromMetrics(last10.map((game) => game.metrics));
  const last10Allowed = averageFromMetrics(
    last10
      .map((game) => game.allowedMetrics)
      .filter((metrics): metrics is SnapshotMetricRecord => metrics != null),
  );

  return {
    seasonFor,
    seasonAllowed,
    last10For,
    last10Allowed,
    seasonRecord: recordFromGames(sorted),
    last10Record: recordFromGames(last10),
  };
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
      teamMatchups: [],
      rows: [],
    };
  }

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const matchupOptionsByKey = new Map<string, SnapshotMatchupOption>();
  const matchupMetaByKey = new Map<string, MatchupMeta>();

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

    matchupMetaByKey.set(matchupKey, {
      matchupKey,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      awayTeamCode: awayCode,
      homeTeamCode: homeCode,
      gameTimeEt,
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

  const relevantTeamIds = Array.from(
    new Set(
      Array.from(matchupMetaByKey.values()).flatMap((meta) => [meta.awayTeamId, meta.homeTeamId]),
    ),
  );

  const groupedTeamGames = await prisma.playerGameLog.groupBy({
    by: ["teamId", "opponentTeamId", "externalGameId", "gameDateEt"],
    where: {
      teamId: { in: relevantTeamIds },
      gameDateEt: { lt: dateEt },
      minutes: { gt: 0 },
    },
    _sum: {
      points: true,
      rebounds: true,
      assists: true,
      threes: true,
    },
  });

  const teamGameAggregates: TeamGameAggregate[] = groupedTeamGames
    .map((row) => {
      if (!row.teamId) return null;
      const points = toStat(row._sum.points);
      const rebounds = toStat(row._sum.rebounds);
      const assists = toStat(row._sum.assists);
      const threes = toStat(row._sum.threes);
      return {
        teamId: row.teamId,
        opponentTeamId: row.opponentTeamId,
        externalGameId: row.externalGameId,
        gameDateEt: row.gameDateEt,
        metrics: metricsFromBase(points, rebounds, assists, threes),
      };
    })
    .filter((row): row is TeamGameAggregate => row != null);

  const gameMetricsByGameTeam = new Map<string, SnapshotMetricRecord>();
  const teamGamesByTeamId = new Map<string, TeamGameAggregate[]>();
  teamGameAggregates.forEach((game) => {
    gameMetricsByGameTeam.set(`${game.externalGameId}:${game.teamId}`, game.metrics);
    const list = teamGamesByTeamId.get(game.teamId) ?? [];
    list.push(game);
    teamGamesByTeamId.set(game.teamId, list);
  });

  const teamSummaryByTeamId = new Map<string, TeamSummary>();
  teamGamesByTeamId.forEach((gamesForTeam, teamId) => {
    const enriched: TeamGameEnriched[] = gamesForTeam.map((game) => {
      const allowedMetrics =
        game.opponentTeamId != null
          ? gameMetricsByGameTeam.get(`${game.externalGameId}:${game.opponentTeamId}`) ?? null
          : null;
      const teamPoints = game.metrics.PTS;
      const opponentPoints = allowedMetrics?.PTS ?? null;
      const win =
        teamPoints == null || opponentPoints == null
          ? null
          : teamPoints > opponentPoints
            ? true
            : teamPoints < opponentPoints
              ? false
              : null;
      return {
        ...game,
        allowedMetrics,
        win,
      };
    });

    teamSummaryByTeamId.set(teamId, teamSummaryFromGames(enriched));
  });

  const teamMatchups: SnapshotTeamMatchupStats[] = Array.from(matchupMetaByKey.values())
    .map((meta) => {
      const awaySummary = teamSummaryByTeamId.get(meta.awayTeamId) ?? emptyTeamSummary();
      const homeSummary = teamSummaryByTeamId.get(meta.homeTeamId) ?? emptyTeamSummary();
      return {
        matchupKey: meta.matchupKey,
        awayTeam: meta.awayTeamCode,
        homeTeam: meta.homeTeamCode,
        gameTimeEt: meta.gameTimeEt,
        awaySeasonFor: awaySummary.seasonFor,
        awaySeasonAllowed: awaySummary.seasonAllowed,
        awayLast10For: awaySummary.last10For,
        awayLast10Allowed: awaySummary.last10Allowed,
        awaySeasonRecord: awaySummary.seasonRecord,
        awayLast10Record: awaySummary.last10Record,
        homeSeasonFor: homeSummary.seasonFor,
        homeSeasonAllowed: homeSummary.seasonAllowed,
        homeLast10For: homeSummary.last10For,
        homeLast10Allowed: homeSummary.last10Allowed,
        homeSeasonRecord: homeSummary.seasonRecord,
        homeLast10Record: homeSummary.last10Record,
      };
    })
    .sort((a, b) => a.matchupKey.localeCompare(b.matchupKey));

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
      teamMatchups,
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
  const opponentTeamIdSet = new Set(opponentTeamIds);

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
      if (!opponentTeamIdSet.has(teamId)) continue;
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

    const points = toStat(log.points);
    const rebounds = toStat(log.rebounds);
    const assists = toStat(log.assists);
    const threes = toStat(log.threes);

    const teamAgg = allowanceByOpponentTeamId.get(log.opponentTeamId) ?? createAllowanceAgg();
    addToAllowance(teamAgg, points, rebounds, assists, threes);
    allowanceByOpponentTeamId.set(log.opponentTeamId, teamAgg);
    addToAllowance(leagueAgg, points, rebounds, assists, threes);
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
        last5: arraysByMarket(last5Logs),
        last10: arraysByMarket(last10Logs),
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
    teamMatchups,
    rows: rowsWithSortKeys.map((item) => item.row),
  };
}
