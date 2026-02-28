import { prisma } from "@/lib/prisma";
import { formatUtcToEt } from "@/lib/snapshot/time";
import type { SnapshotBoardData, SnapshotRow, SnapshotStatLog, SnapshotTeamOption } from "@/lib/types/snapshot";
import { round } from "@/lib/utils";

type TeamMatchup = {
  teamCode: string;
  opponentCode: string;
  gameTimeEt: string;
  gameTimeUtc: Date | null;
};

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

export async function getSnapshotBoardData(dateEt: string): Promise<SnapshotBoardData> {
  const [games, latestRun] = await Promise.all([
    prisma.game.findMany({
      where: { gameDateEt: dateEt },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: [{ commenceTimeUtc: "asc" }],
    }),
    prisma.refreshRun.findFirst({
      where: { completedAt: { not: null } },
      orderBy: [{ completedAt: "desc" }],
      select: { completedAt: true },
    }),
  ]);

  if (games.length === 0) {
    return {
      dateEt,
      lastUpdatedAt: latestRun?.completedAt?.toISOString() ?? null,
      teams: [],
      rows: [],
    };
  }

  const matchupByTeamId = new Map<string, TeamMatchup>();
  const teamOptionsByCode = new Map<string, SnapshotTeamOption>();

  for (const game of games) {
    const homeCode = game.homeTeam.abbreviation;
    const awayCode = game.awayTeam.abbreviation;
    const gameTimeEt = formatUtcToEt(game.commenceTimeUtc);

    matchupByTeamId.set(game.homeTeamId, {
      teamCode: homeCode,
      opponentCode: awayCode,
      gameTimeEt,
      gameTimeUtc: game.commenceTimeUtc,
    });
    matchupByTeamId.set(game.awayTeamId, {
      teamCode: awayCode,
      opponentCode: homeCode,
      gameTimeEt,
      gameTimeUtc: game.commenceTimeUtc,
    });

    teamOptionsByCode.set(homeCode, {
      code: homeCode,
      label: `${homeCode} vs ${awayCode} - ${gameTimeEt}`,
    });
    teamOptionsByCode.set(awayCode, {
      code: awayCode,
      label: `${awayCode} at ${homeCode} - ${gameTimeEt}`,
    });
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
      lastUpdatedAt: latestRun?.completedAt?.toISOString() ?? null,
      teams: Array.from(teamOptionsByCode.values()).sort((a, b) => a.code.localeCompare(b.code)),
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
    if (existing.length >= 40) {
      continue;
    }

    existing.push({
      gameDateEt: log.gameDateEt,
      opponent: log.opponentTeam?.abbreviation ?? null,
      points: toStat(log.points),
      rebounds: toStat(log.rebounds),
      assists: toStat(log.assists),
      threes: toStat(log.threes),
    });
    logsByPlayerId.set(log.playerId, existing);
  }

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
    const last5 = logsForPlayer.slice(0, 5);

    const pointsSeason = logsForPlayer.map((log) => log.points);
    const reboundsSeason = logsForPlayer.map((log) => log.rebounds);
    const assistsSeason = logsForPlayer.map((log) => log.assists);
    const threesSeason = logsForPlayer.map((log) => log.threes);

    rowsWithSortKeys.push({
      sortTime: matchup.gameTimeUtc?.getTime() ?? Number.MAX_SAFE_INTEGER,
      row: {
        playerId: player.id,
        playerName: player.fullName,
        position: player.position,
        teamCode: matchup.teamCode,
        opponentCode: matchup.opponentCode,
        gameTimeEt: matchup.gameTimeEt,
        last5: {
          PTS: last5.map((log) => log.points),
          REB: last5.map((log) => log.rebounds),
          AST: last5.map((log) => log.assists),
          THREES: last5.map((log) => log.threes),
        },
        seasonAverage: {
          PTS: average(pointsSeason),
          REB: average(reboundsSeason),
          AST: average(assistsSeason),
          THREES: average(threesSeason),
        },
        recentLogs: logsForPlayer.slice(0, 10),
      },
    });
  }

  rowsWithSortKeys.sort((a, b) => {
    if (a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    return a.row.playerName.localeCompare(b.row.playerName);
  });

  return {
    dateEt,
    lastUpdatedAt: latestRun?.completedAt?.toISOString() ?? null,
    teams: Array.from(teamOptionsByCode.values()).sort((a, b) => a.code.localeCompare(b.code)),
    rows: rowsWithSortKeys.map((item) => item.row),
  };
}
